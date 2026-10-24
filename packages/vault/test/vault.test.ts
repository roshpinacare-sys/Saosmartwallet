/**
 * packages/vault — selftest (TDD, swarm task 4-b)
 * ===============================================
 * Fail-closed invariants pinned BY TEST (owner directive §11):
 *
 *   1.  master-key gate — missing / malformed SAOS_VAULT_MASTER_KEY fails
 *       closed, and the env VALUE never appears in any error text
 *   2.  envelope roundtrip — ed25519 / secp256k1-wif / opaque, Buffer and
 *       string inputs, meta roundtrip, no plaintext in the SealedRecord
 *   3.  tamper — GCM auth-tag failure is fail-closed at BOTH layers: the
 *       store verify block (openVault) and individual key envelopes
 *       (unsealKey), with healthy neighbor keys still usable (isolation)
 *   4.  wrong master key — rejected at openVault BEFORE any key material is
 *       touched (store-level verify block, works even for an empty store)
 *   5.  WIF — hand-rolled base58check, canonical known-answer vectors
 *       (scalar 0x00..01 compressed "KwDiBf89…" / uncompressed "5HpHag…"),
 *       base58 alphabet edges, checksum + version fail-closed
 *   6.  ed25519 — RFC 8032 §7.1 TEST 1/2 known-answer through the vault
 *       signing path; wrong message / tampered signature verify false
 *   7.  zeroization — withKey wipes the material buffer on success AND failure
 *   8.  redaction — a sentinel scan over EVERY error path proves no material
 *       fragment (ASCII, hex, base64, WIF, master key) is ever echoed
 *   9.  persistence — sealed keys survive across independent openVault
 *       instances, including a stale-writer merge (no silent key loss)
 *   10. state hygiene — 0600/0700 file modes, no temp files left behind,
 *       no plaintext in the store file, corrupt-store schema fail-closed
 *
 * ALL key material in this file is deterministic PUBLIC test-vector data —
 * never real funds. Zero network. Zero third-party dependencies.
 */

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  VaultError,
  base58Decode,
  base58Encode,
  ed25519PublicKey,
  ed25519Verify,
  openVault,
  wifDecode,
  wifEncode,
  type VaultErrorCode,
} from "../src/index";

// ---------------------------------------------------------------------------
// Deterministic fixtures (PUBLIC test vectors — never real funds)
// ---------------------------------------------------------------------------

const ENV_NAME = "SAOS_VAULT_MASTER_KEY";
const MASTER_A = "ab".repeat(32);
const MASTER_B = "cd".repeat(32);
const MASTER_SENTINEL = "5e".repeat(32);

// RFC 8032 §7.1 TEST 1 / TEST 2
const ED_SEED1_HEX = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const ED_PK1_HEX = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const ED_SIG1_HEX =
  "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155" +
  "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b";
const ED_SEED2_HEX = "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb";
const ED_PK2_HEX = "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c";
const ED_SIG2_HEX =
  "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da" +
  "085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00";

const SCALAR_01 = Buffer.alloc(32, 0);
SCALAR_01[31] = 1;
/** Bitcoin mainnet WIF (compressed, 0x01 flag) of scalar 1 — canonical vector. */
const WIF_01_COMPRESSED = "KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn";
/** Bitcoin mainnet WIF (uncompressed) of scalar 1 — canonical vector. */
const WIF_01_UNCOMPRESSED = "5HpHagT65TZzG1PH3CSu63k8DbpvD8s5ip4nEB3kEsreAnchuDf";
const SCALAR_AB = Buffer.from("9a".repeat(32), "hex");

/** secp256k1 group order (SEC2) — for out-of-range scalar rejection tests. */
const SECP256K1_N = Buffer.from(
  "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141",
  "hex",
);

// Redaction sentinels — none of these fragments may appear in ANY error text.
const SENTINEL_ASCII = "SAOS-SENTINEL-9f2c7a-MATERIAL";
const SENTINEL_BYTES = Buffer.from(SENTINEL_ASCII, "utf8");
const SENTINEL_HEX = SENTINEL_BYTES.toString("hex");
const SENTINEL_B64 = SENTINEL_BYTES.toString("base64");
const SENTINEL_SCALAR_HEX = "9f".repeat(32);
const SENTINEL_WIF = wifEncode(Buffer.from(SENTINEL_SCALAR_HEX, "hex"));
const FORBIDDEN_FRAGMENTS: string[] = [
  SENTINEL_ASCII,
  SENTINEL_HEX,
  SENTINEL_B64,
  SENTINEL_HEX.slice(0, 8),
  SENTINEL_HEX.slice(-8),
  SENTINEL_SCALAR_HEX,
  SENTINEL_SCALAR_HEX.slice(0, 8), // "9f9f9f9f"
  SENTINEL_SCALAR_HEX.slice(-8),
  SENTINEL_WIF,
  SENTINEL_WIF.slice(0, 8),
  SENTINEL_WIF.slice(-8),
  MASTER_SENTINEL,
  MASTER_SENTINEL.slice(0, 8), // "5e5e5e5e"
  MASTER_SENTINEL.slice(-8),
];

function assertNoMaterial(err: unknown): void {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  for (const frag of FORBIDDEN_FRAGMENTS) {
    expect(text).not.toContain(frag);
  }
}

/** Captures a rejection; fails loudly if the call resolves (fail-open). */
async function errorOf(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
  throw new Error("expected the call to reject — it resolved instead (fail-open?)");
}

function expectVaultError(err: Error, code?: VaultErrorCode): VaultError {
  expect(err).toBeInstanceOf(VaultError);
  const ve = err as VaultError;
  if (code) expect(ve.code).toBe(code);
  return ve;
}

// ---------------------------------------------------------------------------
// Environment + store helpers
// ---------------------------------------------------------------------------

function setMaster(hex: string): void {
  process.env[ENV_NAME] = hex;
}

function clearMaster(): void {
  delete process.env[ENV_NAME];
}
afterEach(clearMaster);

const TMP_DIRS: string[] = [];
function newStoreDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "saos-vault-test-"));
  TMP_DIRS.push(dir);
  return dir;
}
afterAll(() => {
  for (const d of TMP_DIRS) fs.rmSync(d, { recursive: true, force: true });
});

function storePath(dir: string): string {
  return path.join(dir, "keys.enc");
}
function readStoreJson(dir: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(storePath(dir), "utf8"));
}
function writeStoreJson(dir: string, obj: unknown): void {
  fs.writeFileSync(storePath(dir), JSON.stringify(obj, null, 2));
}
/** Flips one hex character at `pos` to a DIFFERENT hex char (length preserved). */
function flipHexChar(s: string, pos = 0): string {
  const ch = s[pos];
  const replacement = ch === "0" ? "1" : "0";
  return s.slice(0, pos) + replacement + s.slice(pos + 1);
}
/** Replaces the char at `pos` with a different valid base58 char. */
function mutateBase58At(s: string, pos: number): string {
  const ch = s[pos];
  const alt = ch === "A" ? "B" : "A";
  return s.slice(0, pos) + alt + s.slice(pos + 1);
}
function doubleSha256(b: Buffer): Buffer {
  return createHash("sha256").update(createHash("sha256").update(b).digest()).digest();
}

// ---------------------------------------------------------------------------
// 1. master-key gate
// ---------------------------------------------------------------------------

describe("master-key gate (fail-closed)", () => {
  it("refuses to open when SAOS_VAULT_MASTER_KEY is missing", async () => {
    clearMaster();
    const err = await errorOf(() => openVault({ dir: newStoreDir() }));
    const ve = expectVaultError(err, "VAULT_E_ENV_MISSING");
    expect(ve.message).toContain(ENV_NAME);
  });

  it("rejects wrong-length and non-hex values WITHOUT echoing them", async () => {
    const badValues = ["f".repeat(63), "f".repeat(65), "g".repeat(64), "0x" + "f".repeat(64)];
    for (const bad of badValues) {
      setMaster(bad);
      const err = await errorOf(() => openVault({ dir: newStoreDir() }));
      expectVaultError(err, "VAULT_E_ENV_INVALID");
      expect(err.message).not.toContain(bad);
      expect(err.message).toContain(ENV_NAME);
    }
  });

  it("accepts a valid 64-hex key and establishes the store with a verify block", async () => {
    setMaster(MASTER_A);
    const dir = newStoreDir();
    const vault = await openVault({ dir });
    expect(fs.existsSync(storePath(dir))).toBe(true);
    expect(vault.listKeys()).toEqual([]);
    const parsed = readStoreJson(dir);
    expect(parsed.version).toBe(1);
    expect(parsed.store.salt).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.store.verify.iv).toMatch(/^[0-9a-f]{24}$/);
    expect(parsed.store.verify.authTag).toMatch(/^[0-9a-f]{32}$/);
    expect(parsed.store.verify.ciphertext).toMatch(/^[0-9a-f]+$/);
    expect(parsed.keys).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. seal / unseal roundtrip — all three key types
// ---------------------------------------------------------------------------

describe("seal / unseal roundtrip — all three key types", () => {
  it("ed25519: Buffer seed roundtrip + meta", async () => {
    setMaster(MASTER_A);
    const vault = await openVault({ dir: newStoreDir() });
    const seed = Buffer.from(ED_SEED1_HEX, "hex");
    const meta = { account: "saos.tst", role: "active", nested: { n: 1 } };
    const sealed = await vault.sealKey({ id: "ed-main", type: "ed25519", material: seed, meta });
    expect(sealed.id).toBe("ed-main");
    expect(sealed.type).toBe("ed25519");
    const un = await vault.unsealKey("ed-main");
    expect(un.type).toBe("ed25519");
    expect(Buffer.compare(un.material, seed)).toBe(0);
    expect(un.meta).toEqual(meta);
  });

  it("ed25519: accepts a 64-hex string seed", async () => {
    setMaster(MASTER_A);
    const vault = await openVault({ dir: newStoreDir() });
    await vault.sealKey({ id: "ed-str", type: "ed25519", material: ED_SEED2_HEX });
    const un = await vault.unsealKey("ed-str");
    expect(Buffer.compare(un.material, Buffer.from(ED_SEED2_HEX, "hex"))).toBe(0);
  });

  it("ed25519: fails closed on wrong-length, all-zero and non-hex seeds", async () => {
    setMaster(MASTER_A);
    const vault = await openVault({ dir: newStoreDir() });
    await expect(
      vault.sealKey({ id: "bad1", type: "ed25519", material: Buffer.alloc(31) }),
    ).rejects.toThrow(VaultError);
    await expect(
      vault.sealKey({ id: "bad2", type: "ed25519", material: Buffer.alloc(32) }),
    ).rejects.toThrow(VaultError);
    await expect(
      vault.sealKey({ id: "bad3", type: "ed25519", material: "zz".repeat(32) }),
    ).rejects.toThrow(VaultError);
    await expect(
      vault.sealKey({ id: "bad4", type: "ed25519", material: "ab".repeat(31) }),
    ).rejects.toThrow(VaultError);
    expect(vault.listKeys()).toEqual([]);
  });

  it("secp256k1-wif: WIF string input decodes to the 32-byte secret", async () => {
    setMaster(MASTER_A);
    const vault = await openVault({ dir: newStoreDir() });
    await vault.sealKey({ id: "wif-posting", type: "secp256k1-wif", material: WIF_01_COMPRESSED });
    const un = await vault.unsealKey("wif-posting");
    expect(un.type).toBe("secp256k1-wif");
    expect(Buffer.compare(un.material, SCALAR_01)).toBe(0);
  });

  it("secp256k1-wif: raw 32-byte Buffer roundtrip", async () => {
    setMaster(MASTER_A);
    const vault = await openVault({ dir: newStoreDir() });
    await vault.sealKey({ id: "scalar", type: "secp256k1-wif", material: Buffer.from(SCALAR_AB) });
    const un = await vault.unsealKey("scalar");
    expect(Buffer.compare(un.material, SCALAR_AB)).toBe(0);
  });

  it("secp256k1-wif: fails closed on corrupt WIF, zero and out-of-range scalars", async () => {
    setMaster(MASTER_A);
    const vault = await openVault({ dir: newStoreDir() });
    const seal = (material: Buffer | string, id: string) =>
      vault.sealKey({ id, type: "secp256k1-wif", material });
    await expect(seal("not-a-wif", "x1")).rejects.toThrow(VaultError);
    const corrupted = WIF_01_COMPRESSED.slice(0, -1) + (WIF_01_COMPRESSED.endsWith("n") ? "m" : "n");
    await expect(seal(corrupted, "x2")).rejects.toThrow(VaultError);
    await expect(seal(Buffer.alloc(32), "x3")).rejects.toThrow(VaultError);
    await expect(seal(Buffer.from(SECP256K1_N), "x4")).rejects.toThrow(VaultError);
    await expect(seal(Buffer.alloc(31, 1), "x5")).rejects.toThrow(VaultError);
    expect(vault.listKeys()).toEqual([]);
  });

  it("opaque: arbitrary bytes (incl. 0x00/0xff) and UTF-8 strings roundtrip", async () => {
    setMaster(MASTER_A);
    const vault = await openVault({ dir: newStoreDir() });
    const blob = Buffer.from([0x00, 0x01, 0xff, 0x80, 0x7f, 0x00]);
    await vault.sealKey({ id: "blob", type: "opaque", material: blob });
    const unBlob = await vault.unsealKey("blob");
    expect(Buffer.compare(unBlob.material, blob)).toBe(0);
    await vault.sealKey({ id: "str", type: "opaque", material: SENTINEL_ASCII });
    const unStr = await vault.unsealKey("str");
    expect(unStr.material.toString("utf8")).toBe(SENTINEL_ASCII);
  });

  it("opaque: refuses empty material", async () => {
    setMaster(MASTER_A);
    const vault = await openVault({ dir: newStoreDir() });
    await expect(
      vault.sealKey({ id: "empty", type: "opaque", material: Buffer.alloc(0) }),
    ).rejects.toThrow(VaultError);
    await expect(vault.sealKey({ id: "empty2", type: "opaque", material: "" })).rejects.toThrow(
      VaultError,
    );
  });

  it("SealedRecord never contains plaintext material", async () => {
    setMaster(MASTER_A);
    const vault = await openVault({ dir: newStoreDir() });
    const sealed = await vault.sealKey({ id: "s", type: "opaque", material: SENTINEL_BYTES });
    const text = JSON.stringify(sealed);
    expect(text).not.toContain(SENTINEL_ASCII);
    expect(text).not.toContain(SENTINEL_HEX);
    expect(Object.keys(sealed).sort()).toEqual([
      "authTag",
      "ciphertext",
      "createdAt",
      "id",
      "iv",
      "meta",
      "salt",
      "type",
    ]);
  });

  it("refuses duplicate ids (fail-closed, no silent overwrite)", async () => {
    setMaster(MASTER_A);
    const vault = await openVault({ dir: newStoreDir() });
    await vault.sealKey({ id: "dup", type: "opaque", material: "first" });
    const err = await errorOf(() =>
      vault.sealKey({ id: "dup", type: "opaque", material: "second" }),
    );
    expectVaultError(err, "VAULT_E_DUPLICATE_ID");
    const un = await vault.unsealKey("dup");
    expect(un.material.toString("utf8")).toBe("first");
  });

  it("refuses empty / whitespace ids and unknown types", async () => {
    setMaster(MASTER_A);
    const vault = await openVault({ dir: newStoreDir() });
    await expect(vault.sealKey({ id: "", type: "opaque", material: "x" })).rejects.toThrow(
      VaultError,
    );
    await expect(vault.sealKey({ id: "   ", type: "opaque", material: "x" })).rejects.toThrow(
      VaultError,
    );
    await expect(vault.sealKey({ id: "t", type: "rsa" as any, material: "x" })).rejects.toThrow(
      VaultError,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. tamper — GCM auth failure is fail-closed
// ---------------------------------------------------------------------------

describe("tamper — GCM auth failure is fail-closed", () => {
  it("flipping one verify-block byte makes openVault reject", async () => {
    setMaster(MASTER_A);
    const dir = newStoreDir();
    const vault = await openVault({ dir });
    await vault.sealKey({ id: "k", type: "opaque", material: SENTINEL_BYTES });
    const parsed = readStoreJson(dir);
    parsed.store.verify.ciphertext = flipHexChar(parsed.store.verify.ciphertext, 0);
    writeStoreJson(dir, parsed);
    const err = await errorOf(() => openVault({ dir }));
    expectVaultError(err, "VAULT_E_AUTH");
    assertNoMaterial(err);
  });

  it("flipping a key-envelope byte: THAT unseal fails closed, neighbors survive", async () => {
    setMaster(MASTER_A);
    const dir = newStoreDir();
    const vault = await openVault({ dir });
    await vault.sealKey({
      id: "ed-main",
      type: "ed25519",
      material: Buffer.from(ED_SEED1_HEX, "hex"),
    });
    await vault.sealKey({ id: "side", type: "opaque", material: "neighbor" });
    const parsed = readStoreJson(dir);
    const env = parsed.keys.find((e: Record<string, any>) => e.id === "ed-main");
    env.ciphertext = flipHexChar(env.ciphertext, 3);
    writeStoreJson(dir, parsed);

    const reopened = await openVault({ dir }); // structural load succeeds
    const err = await errorOf(() => reopened.unsealKey("ed-main"));
    expectVaultError(err, "VAULT_E_AUTH");
    assertNoMaterial(err);
    const neighbor = await reopened.unsealKey("side"); // isolation
    expect(neighbor.material.toString("utf8")).toBe("neighbor");
  });

  it("tampered authTag fails closed at unseal", async () => {
    setMaster(MASTER_A);
    const dir = newStoreDir();
    const vault = await openVault({ dir });
    await vault.sealKey({ id: "t", type: "opaque", material: SENTINEL_BYTES });
    const parsed = readStoreJson(dir);
    parsed.keys[0].authTag = flipHexChar(parsed.keys[0].authTag, 8);
    writeStoreJson(dir, parsed);
    const reopened = await openVault({ dir });
    const err = await errorOf(() => reopened.unsealKey("t"));
    expectVaultError(err, "VAULT_E_AUTH");
  });

  it("flipping the store salt fails closed at openVault", async () => {
    setMaster(MASTER_A);
    const dir = newStoreDir();
    const vault = await openVault({ dir });
    await vault.sealKey({ id: "k", type: "opaque", material: "x" });
    const parsed = readStoreJson(dir);
    parsed.store.salt = flipHexChar(parsed.store.salt, 0);
    writeStoreJson(dir, parsed);
    const err = await errorOf(() => openVault({ dir }));
    expect(err).toBeInstanceOf(VaultError);
    assertNoMaterial(err);
  });
});

// ---------------------------------------------------------------------------
// 4. wrong master key — fail-closed at openVault
// ---------------------------------------------------------------------------

describe("wrong master key — fail-closed at openVault", () => {
  it("a store created under key A cannot be opened with key B (even when empty)", async () => {
    setMaster(MASTER_A);
    const dir = newStoreDir();
    await openVault({ dir }); // establishes salt + verify block
    setMaster(MASTER_B);
    const err = await errorOf(() => openVault({ dir }));
    expectVaultError(err, "VAULT_E_AUTH");
    assertNoMaterial(err);
  });

  it("a store with sealed keys cannot be opened with a wrong key", async () => {
    setMaster(MASTER_A);
    const dir = newStoreDir();
    const vault = await openVault({ dir });
    await vault.sealKey({ id: "k", type: "opaque", material: SENTINEL_BYTES });
    setMaster(MASTER_B);
    const err = await errorOf(() => openVault({ dir }));
    expectVaultError(err, "VAULT_E_AUTH");
    assertNoMaterial(err);
  });

  it("the correct key still opens it (sanity)", async () => {
    setMaster(MASTER_A);
    const dir = newStoreDir();
    const vault = await openVault({ dir });
    await vault.sealKey({ id: "k", type: "opaque", material: "payload" });
    const again = await openVault({ dir });
    expect(again.listKeys().map((k) => k.id)).toEqual(["k"]);
  });
});

// ---------------------------------------------------------------------------
// 5. WIF — hand-rolled base58check, known-answer vectors
// ---------------------------------------------------------------------------

describe("WIF — hand-rolled base58check (known-answer vectors)", () => {
  it("encodes scalar 0x00..01 to the canonical COMPRESSED vector", () => {
    expect(wifEncode(SCALAR_01, { compressed: true })).toBe(WIF_01_COMPRESSED);
  });

  it("encodes scalar 0x00..01 to the canonical UNCOMPRESSED vector", () => {
    expect(wifEncode(SCALAR_01)).toBe(WIF_01_UNCOMPRESSED);
    expect(wifEncode(SCALAR_01, { compressed: false })).toBe(WIF_01_UNCOMPRESSED);
  });

  it("decodes the canonical COMPRESSED vector → 0x00..01, compressed=true", () => {
    const d = wifDecode(WIF_01_COMPRESSED);
    expect(Buffer.compare(d.secret, SCALAR_01)).toBe(0);
    expect(d.compressed).toBe(true);
  });

  it("decodes the canonical UNCOMPRESSED vector → 0x00..01, compressed=false", () => {
    const d = wifDecode(WIF_01_UNCOMPRESSED);
    expect(Buffer.compare(d.secret, SCALAR_01)).toBe(0);
    expect(d.compressed).toBe(false);
  });

  it("base58 edges: leading zeros, alphabet, invalid chars, empty input", () => {
    expect(base58Encode(Buffer.from([0, 0, 0, 1]))).toBe("1112");
    expect(base58Decode("1112").toString("hex")).toBe("00000001");
    expect(base58Encode(Buffer.alloc(3))).toBe("111");
    expect(base58Decode("111").toString("hex")).toBe("000000");
    expect(base58Encode(Buffer.alloc(0))).toBe("");
    for (const bad of [
      "0",
      "I",
      "l",
      "O",
      "lI0O",
      "abc0def",
      "KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn0",
      " ",
    ]) {
      expect(() => base58Decode(bad)).toThrow(VaultError);
    }
    expect(() => base58Decode("")).toThrow(VaultError);
  });

  it("checksum corruption fails closed (never returns partial material)", () => {
    const lastChar = WIF_01_UNCOMPRESSED[WIF_01_UNCOMPRESSED.length - 1];
    const corrupted = WIF_01_UNCOMPRESSED.slice(0, -1) + (lastChar === "f" ? "H" : "f");
    expect(() => wifDecode(corrupted)).toThrow(VaultError);
    for (const pos of [5, 20]) {
      expect(() => wifDecode(mutateBase58At(WIF_01_UNCOMPRESSED, pos))).toThrow(VaultError);
      expect(() => wifDecode(mutateBase58At(WIF_01_COMPRESSED, pos))).toThrow(VaultError);
    }
  });

  it("rejects a non-0x80 version byte even with a VALID checksum (handcrafted)", () => {
    const body = Buffer.concat([Buffer.from([0x81]), SCALAR_AB, Buffer.from([0x01])]);
    const w = base58Encode(Buffer.concat([body, doubleSha256(body).subarray(0, 4)]));
    expect(() => wifDecode(w)).toThrow(/version/);
  });

  it("rejects a 38-byte payload whose flag byte is not 0x01", () => {
    const body = Buffer.concat([Buffer.from([0x80]), SCALAR_AB, Buffer.from([0x02])]);
    const w = base58Encode(Buffer.concat([body, doubleSha256(body).subarray(0, 4)]));
    expect(() => wifDecode(w)).toThrow(/flag/);
  });

  it("deterministic scalar roundtrips in both forms", () => {
    const c = wifEncode(SCALAR_AB, { compressed: true });
    expect(wifDecode(c).secret.equals(SCALAR_AB)).toBe(true);
    expect(wifDecode(c).compressed).toBe(true);
    const u = wifEncode(SCALAR_AB);
    expect(wifDecode(u).secret.equals(SCALAR_AB)).toBe(true);
    expect(wifDecode(u).compressed).toBe(false);
  });

  it("WIF decode of garbage / empty / whitespace fails closed", () => {
    expect(() => wifDecode("")).toThrow(VaultError);
    expect(() => wifDecode("   ")).toThrow(VaultError);
    expect(() => wifDecode("not-a-wif")).toThrow(VaultError);
    expect(() => wifDecode("1111")).toThrow(VaultError); // 4 zero bytes — wrong length
  });
});

// ---------------------------------------------------------------------------
// 6. ed25519 — RFC 8032 vectors through the vault path
// ---------------------------------------------------------------------------

describe("ed25519 — RFC 8032 vectors through the vault path", () => {
  it("TEST 1 (empty message): seed→sign matches the KAT; verify true", async () => {
    setMaster(MASTER_A);
    const vault = await openVault({ dir: newStoreDir() });
    await vault.sealKey({ id: "ed1", type: "ed25519", material: Buffer.from(ED_SEED1_HEX, "hex") });
    const sig = await vault.signEd25519("ed1", Buffer.alloc(0));
    expect(sig.length).toBe(64);
    expect(sig.toString("hex")).toBe(ED_SIG1_HEX);
    const pk = ed25519PublicKey(Buffer.from(ED_SEED1_HEX, "hex"));
    expect(pk.toString("hex")).toBe(ED_PK1_HEX);
    expect(ed25519Verify(pk, Buffer.alloc(0), sig)).toBe(true);
  });

  it("TEST 2 (one-byte message 0x72): KAT + verify", async () => {
    setMaster(MASTER_A);
    const vault = await openVault({ dir: newStoreDir() });
    await vault.sealKey({ id: "ed2", type: "ed25519", material: Buffer.from(ED_SEED2_HEX, "hex") });
    const msg = Buffer.from([0x72]);
    const sig = await vault.signEd25519("ed2", msg);
    expect(sig.toString("hex")).toBe(ED_SIG2_HEX);
    expect(ed25519Verify(Buffer.from(ED_PK2_HEX, "hex"), msg, sig)).toBe(true);
  });

  it("wrong message → false; tampered signature → false; wrong pubkey → false", async () => {
    setMaster(MASTER_A);
    const vault = await openVault({ dir: newStoreDir() });
    await vault.sealKey({ id: "ed2", type: "ed25519", material: Buffer.from(ED_SEED2_HEX, "hex") });
    const pk = Buffer.from(ED_PK2_HEX, "hex");
    const sig = await vault.signEd25519("ed2", Buffer.from([0x72]));
    expect(ed25519Verify(pk, Buffer.from([0x73]), sig)).toBe(false);
    const tampered = Buffer.from(sig);
    tampered[10] ^= 0xff;
    expect(ed25519Verify(pk, Buffer.from([0x72]), tampered)).toBe(false);
    expect(ed25519Verify(Buffer.alloc(32), Buffer.from([0x72]), sig)).toBe(false);
  });

  it("ed25519Verify returns false (never throws) on malformed inputs", () => {
    const pk = Buffer.from(ED_PK1_HEX, "hex");
    expect(ed25519Verify(Buffer.alloc(31), Buffer.alloc(0), Buffer.alloc(64))).toBe(false);
    expect(ed25519Verify(pk, Buffer.alloc(0), Buffer.alloc(63))).toBe(false);
    expect(ed25519Verify(pk, Buffer.alloc(0), Buffer.alloc(64, 7))).toBe(false);
    expect(ed25519Verify(Buffer.alloc(32, 3), Buffer.alloc(4), Buffer.alloc(64, 1))).toBe(false);
  });

  it("signEd25519 refuses ids of other types and unknown ids", async () => {
    setMaster(MASTER_A);
    const vault = await openVault({ dir: newStoreDir() });
    await vault.sealKey({ id: "op", type: "opaque", material: "not-a-seed" });
    await expect(vault.signEd25519("op", Buffer.alloc(1))).rejects.toThrow(VaultError);
    await expect(vault.signEd25519("ghost", Buffer.alloc(1))).rejects.toThrow(VaultError);
  });

  it("instance ed25519PublicKey(id) matches the pure derivation", async () => {
    setMaster(MASTER_A);
    const vault = await openVault({ dir: newStoreDir() });
    await vault.sealKey({ id: "ed1", type: "ed25519", material: Buffer.from(ED_SEED1_HEX, "hex") });
    const pk = await vault.ed25519PublicKey("ed1");
    expect(Buffer.compare(pk, ed25519PublicKey(Buffer.from(ED_SEED1_HEX, "hex")))).toBe(0);
    await expect(vault.ed25519PublicKey("ghost")).rejects.toThrow(VaultError);
  });
});

// ---------------------------------------------------------------------------
// 7. zeroization — withKey
// ---------------------------------------------------------------------------

describe("zeroization — withKey", () => {
  it("wipes the material buffer after fn resolves and passes the result through", async () => {
    setMaster(MASTER_A);
    const vault = await openVault({ dir: newStoreDir() });
    const seed = Buffer.from(ED_SEED1_HEX, "hex");
    await vault.sealKey({ id: "z", type: "ed25519", material: seed });
    let captured: Buffer | null = null;
    const out = await vault.withKey("z", (k) => {
      captured = k.material;
      expect(Buffer.compare(k.material, seed)).toBe(0);
      return 42;
    });
    expect(out).toBe(42);
    if (!captured) throw new Error("fn was never invoked");
    expect([...captured].every((b) => b === 0)).toBe(true);
  });

  it("wipes the material buffer even when fn throws, then rethrows", async () => {
    setMaster(MASTER_A);
    const vault = await openVault({ dir: newStoreDir() });
    await vault.sealKey({ id: "z", type: "opaque", material: SENTINEL_BYTES });
    let captured: Buffer | null = null;
    await expect(
      vault.withKey("z", (k) => {
        captured = k.material;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    if (!captured) throw new Error("fn was never invoked");
    expect([...captured].every((b) => b === 0)).toBe(true);
  });

  it("supports async fn bodies", async () => {
    setMaster(MASTER_A);
    const vault = await openVault({ dir: newStoreDir() });
    await vault.sealKey({ id: "z", type: "ed25519", material: Buffer.from(ED_SEED1_HEX, "hex") });
    const out = await vault.withKey("z", async (k) => {
      await Promise.resolve();
      return k.material.length;
    });
    expect(out).toBe(32);
  });

  it("withKey on unknown id fails closed (fn never invoked)", async () => {
    setMaster(MASTER_A);
    const vault = await openVault({ dir: newStoreDir() });
    let called = false;
    await expect(
      vault.withKey("ghost", () => {
        called = true;
        return 1;
      }),
    ).rejects.toThrow(VaultError);
    expect(called).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. redaction — no error path ever echoes material
// ---------------------------------------------------------------------------

describe("redaction — no error path ever echoes material", () => {
  it("sentinel scan over every failure mode", async () => {
    setMaster(MASTER_A);
    const dir = newStoreDir();
    const vault = await openVault({ dir });
    await vault.sealKey({ id: "s-ed", type: "ed25519", material: Buffer.from(ED_SEED1_HEX, "hex") });
    await vault.sealKey({ id: "s-op", type: "opaque", material: SENTINEL_BYTES });
    await vault.sealKey({ id: "s-wif", type: "secp256k1-wif", material: SENTINEL_WIF });
    await vault.sealKey({
      id: "s-scalar",
      type: "secp256k1-wif",
      material: Buffer.from(SENTINEL_SCALAR_HEX, "hex"),
    });

    const errors: Error[] = [];

    // (a) healthy-vault failure modes
    errors.push(await errorOf(() => vault.unsealKey("ghost-id")));
    errors.push(await errorOf(() => vault.sealKey({ id: "s-ed", type: "opaque", material: "x" })));
    errors.push(
      await errorOf(() =>
        vault.sealKey({ id: "bad-len", type: "ed25519", material: Buffer.alloc(31, 9) }),
      ),
    );
    errors.push(
      await errorOf(() =>
        vault.sealKey({ id: "bad-wif", type: "secp256k1-wif", material: "not-a-wif" }),
      ),
    );

    // (b) tampered envelope → reopen → unseal
    const parsed = readStoreJson(dir);
    const env = parsed.keys.find((e: Record<string, any>) => e.id === "s-op");
    env.ciphertext = flipHexChar(env.ciphertext, 0);
    writeStoreJson(dir, parsed);
    const vault2 = await openVault({ dir });
    errors.push(await errorOf(() => vault2.unsealKey("s-op")));

    // (c) wrong master key (sentinel master must never be echoed)
    setMaster(MASTER_SENTINEL);
    errors.push(await errorOf(() => openVault({ dir })));

    // (d) invalid env values derived from the sentinel (must never be echoed)
    setMaster(MASTER_SENTINEL + "7");
    errors.push(await errorOf(() => openVault({ dir: newStoreDir() })));
    setMaster("z".repeat(64));
    errors.push(await errorOf(() => openVault({ dir: newStoreDir() })));

    // (e) missing env
    clearMaster();
    errors.push(await errorOf(() => openVault({ dir: newStoreDir() })));

    // (f) corrupt JSON store
    setMaster(MASTER_A);
    fs.writeFileSync(storePath(dir), "{not-json-at-all");
    errors.push(await errorOf(() => openVault({ dir })));

    // (g) schema-corrupt store (JSON, but wrong shape)
    writeStoreJson(dir, { version: 1, store: { salt: "zz", verify: {} }, keys: 42 });
    errors.push(await errorOf(() => openVault({ dir })));

    for (const err of errors) assertNoMaterial(err);
  });

  it("the store file never contains plaintext material", async () => {
    setMaster(MASTER_A);
    const dir = newStoreDir();
    const vault = await openVault({ dir });
    await vault.sealKey({ id: "a", type: "opaque", material: SENTINEL_BYTES });
    await vault.sealKey({ id: "b", type: "secp256k1-wif", material: SENTINEL_WIF });
    await vault.sealKey({ id: "c", type: "ed25519", material: Buffer.from(ED_SEED1_HEX, "hex") });
    const raw = fs.readFileSync(storePath(dir), "utf8");
    for (const frag of [
      SENTINEL_ASCII,
      SENTINEL_HEX,
      SENTINEL_B64,
      SENTINEL_WIF,
      SENTINEL_SCALAR_HEX,
      ED_SEED1_HEX,
    ]) {
      expect(raw).not.toContain(frag);
    }
    expect(raw).toContain('"version": 1');
  });
});

// ---------------------------------------------------------------------------
// 9. persistence across openVault instances
// ---------------------------------------------------------------------------

describe("persistence across openVault instances", () => {
  it("keys sealed by instance A are visible to a fresh instance B", async () => {
    setMaster(MASTER_A);
    const dir = newStoreDir();
    const a = await openVault({ dir });
    const sealed = await a.sealKey({
      id: "k1",
      type: "ed25519",
      material: Buffer.from(ED_SEED1_HEX, "hex"),
      meta: { account: "saos.tst" },
    });
    await a.sealKey({ id: "k2", type: "opaque", material: SENTINEL_BYTES });

    const b = await openVault({ dir });
    const list = b.listKeys();
    expect(list.map((k) => k.id).sort()).toEqual(["k1", "k2"]);
    const k1 = list.find((k) => k.id === "k1");
    expect(k1?.type).toBe("ed25519");
    expect(k1?.meta).toEqual({ account: "saos.tst" });
    expect(k1?.createdAt).toBe(sealed.createdAt);
    expect(Number.isNaN(Date.parse(k1?.createdAt ?? ""))).toBe(false);

    const un = await b.unsealKey("k1");
    expect(Buffer.compare(un.material, Buffer.from(ED_SEED1_HEX, "hex"))).toBe(0);
    const sig = await b.signEd25519("k1", Buffer.alloc(0));
    expect(sig.toString("hex")).toBe(ED_SIG1_HEX);
  });

  it("listKeys exposes metadata ONLY (no envelope fields, no material)", async () => {
    setMaster(MASTER_A);
    const dir = newStoreDir();
    const a = await openVault({ dir });
    await a.sealKey({ id: "k", type: "opaque", material: SENTINEL_BYTES, meta: { role: "posting" } });
    const b = await openVault({ dir });
    const list = b.listKeys();
    for (const entry of list) {
      expect(Object.keys(entry).sort()).toEqual(["createdAt", "id", "meta", "type"]);
    }
    const text = JSON.stringify(list);
    expect(text).not.toContain(SENTINEL_ASCII);
    expect(text).not.toContain(SENTINEL_HEX);
    expect(text).not.toContain('"ciphertext"');
    expect(text).not.toContain('"authTag"');
  });

  it("a stale writer merges instead of clobbering (no silent key loss)", async () => {
    setMaster(MASTER_A);
    const dir = newStoreDir();
    const a = await openVault({ dir });
    await a.sealKey({ id: "a", type: "opaque", material: "alpha" });
    const b = await openVault({ dir });
    await b.sealKey({ id: "b", type: "opaque", material: "beta" });
    // `a` never saw b's write — its next seal must MERGE, not clobber.
    await a.sealKey({ id: "c", type: "opaque", material: "gamma" });

    const c = await openVault({ dir });
    expect(c.listKeys().map((k) => k.id).sort()).toEqual(["a", "b", "c"]);
    expect((await c.unsealKey("b")).material.toString("utf8")).toBe("beta");
    expect((await c.unsealKey("c")).material.toString("utf8")).toBe("gamma");
  });
});

// ---------------------------------------------------------------------------
// 10. corrupt store — fail-closed schema validation + state hygiene
// ---------------------------------------------------------------------------

describe("corrupt store — fail-closed schema validation", () => {
  async function healthyStore(): Promise<string> {
    setMaster(MASTER_A);
    const dir = newStoreDir();
    const vault = await openVault({ dir });
    await vault.sealKey({ id: "k", type: "opaque", material: "payload" });
    return dir;
  }

  it("invalid JSON rejects and never echoes file contents", async () => {
    const dir = await healthyStore();
    fs.writeFileSync(storePath(dir), "{oops-not-json");
    const err = await errorOf(() => openVault({ dir }));
    expectVaultError(err, "VAULT_E_STORE_CORRUPT");
    expect(err.message).not.toContain("oops-not-json");
  });

  it("non-object JSON (number / string / array / null) rejects", async () => {
    for (const content of ["42", '"a string"', "[1,2,3]", "null"]) {
      const dir = await healthyStore();
      fs.writeFileSync(storePath(dir), content);
      expectVaultError(await errorOf(() => openVault({ dir })), "VAULT_E_STORE_CORRUPT");
    }
  });

  it("wrong version / missing store block / missing keys array reject", async () => {
    const base = await healthyStore();
    const good = readStoreJson(base);

    const variants: Array<[string, unknown]> = [
      ["version", { ...good, version: 2 }],
      ["no store", { version: 1, keys: good.keys }],
      ["no keys", { version: 1, store: good.store }],
      ["keys not array", { ...good, keys: { id: "x" } }],
      ["store not object", { ...good, store: "nope" }],
    ];
    for (const [, variant] of variants) {
      const dir = await healthyStore();
      writeStoreJson(dir, variant);
      expectVaultError(await errorOf(() => openVault({ dir })), "VAULT_E_STORE_CORRUPT");
    }
  });

  it("envelope-level corruption rejects: missing iv, unknown type, salt mismatch, dup ids, bad hex, odd-length ct", async () => {
    const cases: Array<(good: Record<string, any>) => unknown> = [
      (g) => ({ ...g, keys: [{ ...g.keys[0], iv: undefined }] }),
      (g) => ({ ...g, keys: [{ ...g.keys[0], iv: "zzzz" }] }),
      (g) => ({ ...g, keys: [{ ...g.keys[0], type: "rsa" }] }),
      (g) => ({ ...g, keys: [{ ...g.keys[0], salt: flipHexChar(g.store.salt, 1) }] }),
      (g) => ({ ...g, keys: [g.keys[0], { ...g.keys[0] }] }), // duplicate id
      (g) => ({ ...g, keys: [{ ...g.keys[0], authTag: "nothex" }] }),
      (g) => ({ ...g, keys: [{ ...g.keys[0], ciphertext: g.keys[0].ciphertext.slice(1) }] }), // odd length
      (g) => ({ ...g, keys: [{ ...g.keys[0], id: "" }] }),
      (g) => ({ ...g, keys: [{ ...g.keys[0], createdAt: "not-a-date" }] }),
      (g) => ({ ...g, keys: [{ ...g.keys[0], meta: "not-an-object" }] }),
    ];
    for (const make of cases) {
      const dir = await healthyStore();
      writeStoreJson(dir, make(readStoreJson(dir)));
      expectVaultError(await errorOf(() => openVault({ dir })), "VAULT_E_STORE_CORRUPT");
    }
  });

  it("an oversized store file refuses to load (memory-bomb guard)", async () => {
    const dir = await healthyStore();
    fs.writeFileSync(storePath(dir), "a".repeat(17 * 1024 * 1024));
    expectVaultError(await errorOf(() => openVault({ dir })), "VAULT_E_STORE_CORRUPT");
  });
});

describe("state hygiene", () => {
  it("state dir is 0700 and keys.enc is 0600", async () => {
    setMaster(MASTER_A);
    const dir = newStoreDir();
    const vault = await openVault({ dir });
    await vault.sealKey({ id: "k", type: "opaque", material: "x" });
    expect(fs.statSync(storePath(dir)).mode & 0o777).toBe(0o600);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  });

  it("atomic writes leave no temp files behind", async () => {
    setMaster(MASTER_A);
    const dir = newStoreDir();
    const vault = await openVault({ dir });
    await vault.sealKey({ id: "k1", type: "opaque", material: "x" });
    await vault.sealKey({ id: "k2", type: "opaque", material: "y" });
    const leftovers = fs.readdirSync(dir).filter((n) => n.includes(".tmp-"));
    expect(leftovers).toEqual([]);
  });
});
