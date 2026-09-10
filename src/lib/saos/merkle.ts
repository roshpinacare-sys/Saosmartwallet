/**
 * Merkle tree + inclusion proofs — הרכבת שורש-האיטום.
 * Ported from: zip2pdf `src/merkle.ts` (self-verifying artifacts),
 * workspace-TFA `transparency-log/merkle-tree.ts` (inclusion proofs),
 * steem-main weave_batch (root of all anchor leaves of the batch).
 *
 * FIX(Roast-64-a · F2/CRITICAL) — CVE-2012-2459: הסכמה-הקודמת (sha256 שרשור-גולמי)
 * סבלה משלושה-פרצות-שהוכחו-מדיד ברוסט:
 *   1. שכפול-עלה-אחרון: [A,B,C] ≡ [A,B,C,C] — אותו root ואותה הוכחת-הכלה.
 *   2. אין-הפרדת-דומיינים: ["a","bc"] ≡ ["ab","c"] (פיצול-שרשור שקול).
 *   3. עלה-יחיד = ה-bytes הגולמיים בלי hashing בכלל.
 * הסכמה-החדשה (RFC-6962-style, fail-closed):
 *   leaf     = sha256(0x00 || leafBytes)
 *   interior = sha256(0x01 || left || right)
 *   עלה אחרון-אי-זוגי משוכפל כמקובל, ובנוסף:
 *   root     = sha256(0x02 || uint32le(leafCount) || topHash)
 * הקידומות 0x00/0x01 מבדילות עלה מצומת (סוגרת את פיצול-השרשור), ואיגוד
 * מספר-העלים בשורש הסופי סוגר את התקפת-השכפול — אותו root מחייב אותו מספר עלים.
 */

export interface MerkleProof {
  index: number;
  leaf: string;
  /** מספר-העלים-הכולל — נאגר-בשורש (anti-CVE-2012-2459), נדרש לאימות */
  leafCount: number;
  root: string;
  path: { sibling: string; dir: "L" | "R" }[];
}

export interface MerkleTree {
  leaves: string[];
  root: string;
  /** levels[0] = leaf hashes (מגובשים), levels[למעלה] = interior hashes */
  levels: string[][];
}

// ─── byte-level primitives (domain separation) ───────────────────────────────

const enc = new TextEncoder();
const LEAF_TAG = new Uint8Array([0x00]);
const NODE_TAG = new Uint8Array([0x01]);
const ROOT_TAG = new Uint8Array([0x02]);

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function uint32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}

async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  // ArrayBufferLike→ArrayBuffer slice — TS BufferSource discipline (target ES2017)
  const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const buf = await crypto.subtle.digest("SHA-256", ab);
  return new Uint8Array(buf);
}

function toHex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function fromHex(h: string): Uint8Array {
  if (h.length % 2 !== 0 || /[^0-9a-f]/i.test(h)) throw new Error("bad hex in merkle node");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** leaf hash — sha256(0x00 || leafBytes) */
async function leafHash(leaf: string): Promise<string> {
  return toHex(await sha256Bytes(concatBytes(LEAF_TAG, enc.encode(leaf))));
}

/** interior node — sha256(0x01 || left || right) */
async function nodeHash(left: string, right: string): Promise<string> {
  return toHex(await sha256Bytes(concatBytes(NODE_TAG, fromHex(left), fromHex(right))));
}

/** final root — sha256(0x02 || uint32le(leafCount) || topHash) */
async function finalRoot(leafCount: number, topHash: string): Promise<string> {
  if (!Number.isSafeInteger(leafCount) || leafCount < 1) throw new Error("bad leaf count");
  return toHex(await sha256Bytes(concatBytes(ROOT_TAG, uint32le(leafCount), fromHex(topHash))));
}

// ─── tree assembly ───────────────────────────────────────────────────────────

export async function buildMerkleTree(leaves: string[]): Promise<MerkleTree> {
  if (leaves.length === 0) throw new Error("no leaves — nothing to seal");
  const first = await Promise.all(leaves.map(leafHash));
  const levels: string[][] = [first];
  let current = [...first];
  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]!;
      const right = i + 1 < current.length ? current[i + 1]! : left; // odd → duplicate
      next.push(await nodeHash(left, right));
    }
    levels.push(next);
    current = next;
  }
  const root = await finalRoot(leaves.length, current[0]!);
  return { leaves, root, levels };
}

export async function merkleProof(tree: MerkleTree, index: number): Promise<MerkleProof> {
  if (!Number.isSafeInteger(index) || index < 0 || index >= tree.leaves.length) throw new Error("index out of batch");
  const path: MerkleProof["path"] = [];
  let idx = index;
  for (let l = 0; l < tree.levels.length - 1; l++) {
    const level = tree.levels[l]!;
    const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    const sibling = siblingIdx < level.length ? level[siblingIdx]! : level[idx]!;
    path.push({ sibling, dir: idx % 2 === 0 ? "R" : "L" });
    idx = Math.floor(idx / 2);
  }
  return { index, leaf: tree.leaves[index]!, leafCount: tree.leaves.length, root: tree.root, path };
}

/** independent verification — anyone can check without trusting us */
export async function verifyMerkleProof(p: MerkleProof): Promise<boolean> {
  try {
    if (!Number.isSafeInteger(p.leafCount) || p.leafCount < 1) return false; // fail-closed
    if (!Number.isSafeInteger(p.index) || p.index < 0 || p.index >= p.leafCount) return false;
    // מספר-הצעדים חייב להתאים ל-log2(leafCount) (עגול-מעלה) — מניעת path-מזויף
    const expectedSteps = Math.max(1, Math.ceil(Math.log2(p.leafCount)));
    if (p.leafCount > 1 && p.path.length !== expectedSteps) return false;
    let hash = await leafHash(p.leaf);
    for (const step of p.path) {
      hash =
        step.dir === "R"
          ? await nodeHash(hash, step.sibling)
          : await nodeHash(step.sibling, hash);
    }
    const root = await finalRoot(p.leafCount, hash);
    return root === p.root;
  } catch {
    return false; // malformed proof — never a throw to the caller
  }
}
