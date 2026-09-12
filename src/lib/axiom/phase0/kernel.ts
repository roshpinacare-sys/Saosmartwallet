import * as fs from 'node:fs';
import * as path from 'node:path';
import { Buffer } from 'node:buffer';

// ============================================================
// AxiomState Phase 0: Log-Structured State Kernel
// Node.js | Strict TypeScript | Zero External Dependencies
// ============================================================

// --- Domain Primitives --------------------------------------

const enum Op { Put = 0x01, Delete = 0x02 }

export interface Delta {
  readonly seq: bigint;
  readonly op: Op;
  readonly key: string;
  readonly value: Uint8Array | null;
}

export type StateVector = ReadonlyMap<string, Uint8Array | null>;

export interface LSSStats {
  readonly seq: bigint;
  readonly keyCount: number;
  readonly checkpointSeq: bigint | null;
  readonly writeOffset: number;
}

// --- CRC32 --------------------------------------------------

function makeCRC32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
}

const CRC32_TABLE = makeCRC32Table();

function crc32(buf: Buffer): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = CRC32_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// --- Binary Protocol: Delta Record --------------------------
// Layout: [seq: u64][op: u8][keyLen: u32][valLen: u32][key][value?][crc: u32]

const DELTA_MIN_SIZE = 8 + 1 + 4 + 4 + 4; // header + crc
const U32_MAX = 0xFFFFFFFF;

function encodeDelta(d: Delta): Buffer {
  const keyBuf = Buffer.from(d.key, 'utf-8');
  const valBuf = d.value
    ? Buffer.from(d.value.buffer, d.value.byteOffset, d.value.byteLength)
    : Buffer.alloc(0);

  if (keyBuf.length > U32_MAX) {
    throw new Error(`Key length exceeds u32 limit: ${keyBuf.length}`);
  }
  if (valBuf.length > U32_MAX) {
    throw new Error(`Value length exceeds u32 limit: ${valBuf.length}`);
  }

  const bodyLen = 8 + 1 + 4 + 4 + keyBuf.length + valBuf.length;
  const buf = Buffer.allocUnsafe(bodyLen + 4);

  let p = 0;
  buf.writeBigUInt64BE(d.seq, p); p += 8;
  buf.writeUInt8(d.op, p); p += 1;
  buf.writeUInt32BE(keyBuf.length, p); p += 4;
  buf.writeUInt32BE(valBuf.length, p); p += 4;
  keyBuf.copy(buf, p); p += keyBuf.length;
  if (valBuf.length) { valBuf.copy(buf, p); p += valBuf.length; }

  buf.writeUInt32BE(crc32(buf.subarray(0, p)), p);
  return buf;
}

export function decodeDelta(buf: Buffer, off: number): { delta: Delta; nextOffset: number } | null {
  if (off + DELTA_MIN_SIZE > buf.length) return null;

  const start = off;
  const seq = buf.readBigUInt64BE(off); off += 8;
  const op = buf.readUInt8(off) as Op; off += 1;
  const keyLen = buf.readUInt32BE(off); off += 4;
  const valLen = buf.readUInt32BE(off); off += 4;

  if (off + keyLen + valLen + 4 > buf.length) return null;

  const key = buf.toString('utf-8', off, off + keyLen); off += keyLen;
  const value = valLen > 0
    ? new Uint8Array(buf.slice(off, off + valLen))
    : null;
  off += valLen;

  const storedCrc = buf.readUInt32BE(off); off += 4;
  const bodyLen = off - start - 4;
  const computed = crc32(buf.subarray(start, start + bodyLen));
  if (computed !== storedCrc) {
    throw new Error(`CRC mismatch at offset ${start}: stored=${storedCrc}, computed=${computed}`);
  }

  return { delta: { seq, op, key, value }, nextOffset: off };
}

// --- Binary Protocol: Checkpoint ----------------------------
// Magic "AXCP" + version(1) + seq(u64) + count(u32) + entries

const CHECKPOINT_MAGIC = 'AXCP';
const CHECKPOINT_VERSION = 1;

export function serializeCheckpoint(seq: bigint, state: Map<string, Uint8Array | null>): Buffer {
  const entries = Array.from(state.entries());
  let size = 4 + 1 + 8 + 4; // magic, version, seq, count
  for (const [k, v] of entries) {
    size += 4 + Buffer.byteLength(k, 'utf-8') + 1 + 4 + (v ? v.byteLength : 0);
  }

  const buf = Buffer.allocUnsafe(size);
  let p = 0;
  buf.write(CHECKPOINT_MAGIC, p); p += 4;
  buf.writeUInt8(CHECKPOINT_VERSION, p); p += 1;
  buf.writeBigUInt64BE(seq, p); p += 8;
  buf.writeUInt32BE(entries.length, p); p += 4;

  for (const [k, v] of entries) {
    const kbuf = Buffer.from(k, 'utf-8');
    buf.writeUInt32BE(kbuf.length, p); p += 4;
    kbuf.copy(buf, p); p += kbuf.length;

    const tomb = v === null ? 1 : 0;
    buf.writeUInt8(tomb, p); p += 1;

    const vlen = v ? v.byteLength : 0;
    buf.writeUInt32BE(vlen, p); p += 4;
    if (v) {
      const vbuf = Buffer.from(v.buffer, v.byteOffset, v.byteLength);
      vbuf.copy(buf, p); p += vbuf.length;
    }
  }

  return buf;
}

export function loadCheckpoint(buf: Buffer): { seq: bigint; state: Map<string, Uint8Array | null> } {
  if (buf.toString('ascii', 0, 4) !== CHECKPOINT_MAGIC) {
    throw new Error('Invalid checkpoint magic');
  }
  if (buf.readUInt8(4) !== CHECKPOINT_VERSION) {
    throw new Error('Unsupported checkpoint version');
  }

  let p = 5;
  const seq = buf.readBigUInt64BE(p); p += 8;
  const count = buf.readUInt32BE(p); p += 4;

  const state = new Map<string, Uint8Array | null>();
  for (let i = 0; i < count; i++) {
    const klen = buf.readUInt32BE(p); p += 4;
    const key = buf.toString('utf-8', p, p + klen); p += klen;
    const tomb = buf.readUInt8(p); p += 1;
    const vlen = buf.readUInt32BE(p); p += 4;

    if (tomb) {
      state.set(key, null);
      p += vlen; // defensive skip
    } else {
      const value = new Uint8Array(buf.slice(p, p + vlen));
      state.set(key, value);
      p += vlen;
    }
  }

  return { seq, state };
}

// --- LSS Kernel ---------------------------------------------

export class LSSKernel {
  private readonly activeLog: string;
  private readonly checkpointDir: string;
  private logFd: number;

  // State
  private seq: bigint = 0n;
  private state: Map<string, Uint8Array | null> = new Map();
  private seqIndex: Map<bigint, number> = new Map(); // seq -> start offset in active.lss
  private writeOffset: number = 0;

  // Checkpoint metadata
  private baseCheckpoint: { seq: bigint; path: string } | null = null;

  constructor(rootDir: string) {
    const root = path.resolve(rootDir);
    this.activeLog = path.join(root, 'active.lss');
    this.checkpointDir = path.join(root, 'checkpoints');
    fs.mkdirSync(this.checkpointDir, { recursive: true });

    const exists = fs.existsSync(this.activeLog);
    this.logFd = fs.openSync(this.activeLog, 'a+');

    if (exists) {
      this.recover();
    }

    // Always keep a genesis checkpoint so rollback-to-zero is always defined.
    if (this.listCheckpoints().length === 0) {
      this.checkpoint();
    }
  }

  // -- Writes ------------------------------------------------

  apply(key: string, value: Uint8Array | null): bigint {
    this.seq += 1n;
    const seq = this.seq;
    const delta: Delta = { seq, op: value === null ? Op.Delete : Op.Put, key, value };

    const rec = encodeDelta(delta);
    const startOffset = this.writeOffset;

    let written = 0;
    while (written < rec.length) {
      const n = fs.writeSync(this.logFd, rec.subarray(written));
      if (n <= 0) throw new Error('WAL write failed');
      written += n;
    }

    this.writeOffset += rec.length;
    this.seqIndex.set(seq, startOffset);
    this.applyToState(delta);
    return seq;
  }

  private applyToState(d: Delta): void {
    if (d.op === Op.Delete) {
      this.state.set(d.key, null); // tombstone
    } else {
      this.state.set(d.key, d.value);
    }
  }

  // -- Reads -------------------------------------------------

  get(key: string): Uint8Array | undefined {
    const v = this.state.get(key);
    return v === null || v === undefined ? undefined : v;
  }

  has(key: string): boolean {
    return this.state.has(key);
  }

  keys(): IterableIterator<string> {
    return this.state.keys();
  }

  current(): StateVector {
    return this.state;
  }

  stats(): LSSStats {
    return {
      seq: this.seq,
      keyCount: this.state.size,
      checkpointSeq: this.baseCheckpoint ? this.baseCheckpoint.seq : null,
      writeOffset: this.writeOffset,
    };
  }

  // -- Checkpoints -------------------------------------------

  checkpoint(): bigint {
    const seq = this.seq;
    const tmp = path.join(this.checkpointDir, `cp-${seq}.lssc.tmp`);
    const fin = path.join(this.checkpointDir, `cp-${seq}.lssc`);

    const buf = serializeCheckpoint(seq, this.state);
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, fin);

    this.baseCheckpoint = { seq, path: fin };
    return seq;
  }

  private listCheckpoints(): Array<{ seq: bigint; path: string }> {
    return fs
      .readdirSync(this.checkpointDir)
      .filter((f: string) => f.startsWith('cp-') && f.endsWith('.lssc'))
      .map((f: string) => {
        const s = BigInt(f.slice(3, -5));
        return { seq: s, path: path.join(this.checkpointDir, f) };
      })
      .sort((a: { seq: bigint }, b: { seq: bigint }) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0));
  }

  // -- Rollback ----------------------------------------------

  rollback(targetSeq: bigint): void {
    if (targetSeq === this.seq) return;
    if (targetSeq > this.seq) {
      throw new Error(`Rollback target ${targetSeq} is ahead of current sequence ${this.seq}`);
    }

    // Find the deepest checkpoint surviving the rollback.
    const cps = this.listCheckpoints();
    let cp = cps.length ? cps[0] : null;
    for (const c of cps) {
      if (c.seq <= targetSeq) {
        cp = c;
      } else {
        fs.unlinkSync(c.path);
        if (this.baseCheckpoint && this.baseCheckpoint.seq === c.seq) {
          this.baseCheckpoint = null;
        }
      }
    }

    if (!cp) {
      throw new Error(`No checkpoint base for rollback to ${targetSeq}`);
    }

    // Load base checkpoint.
    const loaded = loadCheckpoint(fs.readFileSync(cp.path));
    this.state = new Map(loaded.state);
    this.seq = loaded.seq;
    this.baseCheckpoint = cp;

    // Truncate WAL at the first byte of the first invalid sequence.
    const firstBad = targetSeq + 1n;
    const truncateAt = this.seqIndex.get(firstBad);
    if (truncateAt === undefined) {
      throw new Error(`Rollback boundary not found in index: ${firstBad}`);
    }

    fs.ftruncateSync(this.logFd, truncateAt);
    this.writeOffset = truncateAt;

    // Replay deltas in (checkpoint.seq, targetSeq] to reconstruct exact state.
    const buf = fs.readFileSync(this.activeLog);
    const replayStartSeq = loaded.seq + 1n;
    const startOffset = this.seqIndex.get(replayStartSeq);
    if (startOffset !== undefined && loaded.seq < targetSeq) {
      let p = startOffset;
      while (p < truncateAt) {
        const res = decodeDelta(buf, p);
        if (!res) throw new Error('Corruption during rollback replay');
        this.applyToState(res.delta);
        p = res.nextOffset;
      }
    }

    // Purge invalidated index entries.
    for (const s of this.seqIndex.keys()) {
      if (s > targetSeq) this.seqIndex.delete(s);
    }

    this.seq = targetSeq;
  }

  // -- Recovery ----------------------------------------------

  private recover(): void {
    const stat = fs.fstatSync(this.logFd);
    this.writeOffset = stat.size;

    if (stat.size === 0) return;

    const buf = fs.readFileSync(this.activeLog);
    let pos = 0;

    // Pass 1: Build sequence index and establish current sequence.
    while (pos < buf.length) {
      const res = decodeDelta(buf, pos);
      if (!res) {
        // Incomplete trailing record: atomically truncate to valid boundary.
        fs.ftruncateSync(this.logFd, pos);
        this.writeOffset = pos;
        break;
      }
      this.seqIndex.set(res.delta.seq, pos);
      this.seq = res.delta.seq;
      pos = res.nextOffset;
    }
    this.writeOffset = pos;

    // Pass 2: Determine checkpoint base and reconstruct MemTable.
    const cps = this.listCheckpoints();
    let cpLoaded: { seq: bigint; state: Map<string, Uint8Array | null> } | null = null;

    if (cps.length > 0) {
      const latest = cps[cps.length - 1];
      this.baseCheckpoint = latest;
      cpLoaded = loadCheckpoint(fs.readFileSync(latest.path));

      // If checkpoint is ahead of log, the log is stale/corrupt.
      if (cpLoaded.seq > this.seq) {
        throw new Error(`Checkpoint ${cpLoaded.seq} is ahead of log tail ${this.seq}`);
      }
    }

    this.state = new Map();
    if (cpLoaded) {
      for (const [k, v] of cpLoaded.state) this.state.set(k, v);
    }

    const scanStart = cpLoaded
      ? (this.seqIndex.get(cpLoaded.seq + 1n) ?? this.writeOffset)
      : 0;

    let p = scanStart;
    while (p < this.writeOffset) {
      const res = decodeDelta(buf, p);
      if (!res) throw new Error('Corruption during recovery replay');
      this.applyToState(res.delta);
      p = res.nextOffset;
    }
  }

  // -- Lifecycle ---------------------------------------------

  sync(): void {
    fs.fsyncSync(this.logFd);
  }

  close(): void {
    fs.closeSync(this.logFd);
  }
}
