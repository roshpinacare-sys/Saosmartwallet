/**
 * packages/core — signing-path test suite (wave: feat/saosmartwallet-signing-engine)
 * ===================================================================================
 * First deterministic coverage of the KEY-SIGNING HEART that the vault suite
 * (crypto-core.test.ts) deliberately leaves out:
 *
 *   1. packages/crypto keys.ts    — PrivateKey/PublicKey sign→verify→recover,
 *                                   WIF roundtrips, password/brain-key hierarchy
 *   2. packages/core vault/keys   — VaultKeys seal→reveal lifecycle, the
 *                                   §7.B key-isolation invariant (plaintext key
 *                                   material NEVER persists in state or error text)
 *   3. M3 unified identity        — one 32-byte secret → STM / EIP-55 / Solana
 *                                   base58 identities (verified by INDEPENDENT
 *                                   recomputation, not by trusting the impl)
 *   4. chains/steem transaction   — digest commitment sha256(chainId ‖ tx),
 *                                   wire roundtrips, BLURT fork op-id table
 *
 * ALL test material is generated in-test (fake seeds, obvious strings).
 * ZERO network. ZERO reads of any .enc/vault/.env file. Deterministic.
 */

import { describe, it, expect } from "bun:test";

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 as keccak256 } from "@noble/hashes/sha3.js";
import { base58 } from "@scure/base";

import {
  PrivateKey,
  PublicKey,
  recoverFromCompact,
  derivePrivateKey,
  derivePrivateKeys,
  generateMasterPassword,
  normalizeBrainKey,
  EncodingError,
  wifEncode,
  wifDecode,
  steemPublicKeyEncode,
} from "../../crypto/src/index";

import { VaultKeys } from "../src/vault/keys";
import { emptyState } from "../src/vault/defaults";
import { VaultError, type VaultErrorCode } from "../src/types";
import type { VaultStateDoc } from "../src/types";

import {
  serializeTransaction,
  deserializeTransaction,
  transactionDigest,
  transactionId,
  STEEM_CHAIN_ID,
} from "../../chains/steem/src/transaction";
import { OP_IDS, BLURT_OP_IDS } from "../../chains/steem/src/operations";

// ---------------------------------------------------------------------------
// Deterministic test material (never a real secret)
// ---------------------------------------------------------------------------

const SEED_A = "obviously-fake seed A for unit tests — not a wallet";
const SEED_B = "obviously-fake seed B for unit tests — not a wallet";
const KEY_A = PrivateKey.fromSeed(SEED_A);
const KEY_B = PrivateKey.fromSeed(SEED_B);
const DIGEST = sha256(new TextEncoder().encode("unit-test digest preimage — 32 bytes out"));

function hex(b: Uint8Array): string {
  return Buffer.from(b).toString("hex");
}

function freshState(): VaultStateDoc {
  return emptyState("test-vault-instance-0000-0000");
}

/** The in-test WIF used by the vault suites (fake, generated below). */
const VAULT_WIF = KEY_A.toWif();

/** EIP-55 checksum encoding, computed independently of the implementation. */
function eip55(addressLowerHex: string): string {
  const addr = addressLowerHex.replace(/^0x/, "").toLowerCase();
  const digest = keccak256(new TextEncoder().encode(addr));
  let out = "0x";
  for (let i = 0; i < addr.length; i++) {
    const nibble = i % 2 === 0 ? digest[i >> 1] >> 4 : digest[i >> 1] & 0x0f;
    out += Number(nibble >= 8) ? addr[i].toUpperCase() : addr[i];
  }
  return out;
}

function expectVaultError(fn: () => unknown, code: VaultErrorCode): void {
  // Local helper: assert VaultError with a given code (same typing discipline
  // as crypto-core.test.ts; the instanceof check is strict).
  try {
    fn();
    throw new Error(`expected VaultError — nothing thrown`);
  } catch (e) {
    expect(e).toBeInstanceOf(VaultError);
    expect((e as VaultError).code).toBe(code);
  }
}

// ---------------------------------------------------------------------------
// 1. PrivateKey / WIF / sign → verify → recover (secp256k1, steem family)
// ---------------------------------------------------------------------------

describe("PrivateKey (packages/crypto): determinism, WIF, signatures", () => {
  it("fromSeed is deterministic and distinct seeds give distinct scalars", () => {
    expect(hex(PrivateKey.fromSeed(SEED_A).bytes)).toBe(hex(KEY_A.bytes));
    expect(hex(KEY_A.bytes)).not.toBe(hex(KEY_B.bytes));
  });

  it("WIF roundtrip: toWif → fromWif preserves the scalar exactly", () => {
    const again = PrivateKey.fromWif(KEY_A.toWif());
    expect(hex(again.bytes)).toBe(hex(KEY_A.bytes));
  });

  it("WIF wire form: 0x80 version + 4-byte double-sha256 checksum (37 bytes)", () => {
    const raw = base58.decode(KEY_A.toWif());
    expect(raw.length).toBe(37);
    expect(raw[0]).toBe(0x80);
    const payload = raw.subarray(0, 33);
    const checksum = sha256(sha256(payload)).subarray(0, 4);
    expect(hex(raw.subarray(33))).toBe(hex(checksum));
  });

  it("tampered WIF fails closed with an EncodingError (checksum mismatch)", () => {
    const wif = KEY_A.toWif();
    const raw = Array.from(base58.decode(wif));
    raw[5] ^= 0x01; // flip one payload bit
    const broken = base58.encode(new Uint8Array(raw));
    // base58 re-encode of corrupted bytes keeps checksum invalid
    expect(() => wifDecode(broken)).toThrow(EncodingError);
    expect(() => PrivateKey.fromWif(broken)).toThrow();
  });

  it("fromBytes rejects wrong length and the zero scalar (fail closed)", () => {
    expect(() => PrivateKey.fromBytes(new Uint8Array(31))).toThrow(EncodingError);
    expect(() => PrivateKey.fromBytes(new Uint8Array(32))).toThrow();
  });

  it("signRecoverable is deterministic (RFC6979) and exactly 65 bytes [31+recid, r, s]", () => {
    const sig1 = KEY_A.signRecoverable(DIGEST);
    const sig2 = KEY_A.signRecoverable(DIGEST);
    expect(sig1.length).toBe(65);
    expect(hex(sig1)).toBe(hex(sig2));
    expect(sig1[0]).toBeGreaterThanOrEqual(31);
    expect(sig1[0]).toBeLessThanOrEqual(34);
  });

  it("sign → verify holds for the signer and fails for others / tamper / wrong digest", () => {
    const sig = KEY_A.signRecoverable(DIGEST);
    expect(KEY_A.publicKey.verify(DIGEST, sig)).toBe(true);

    const otherDigest = sha256(new TextEncoder().encode("a different preimage"));
    expect(KEY_A.publicKey.verify(otherDigest, sig)).toBe(false);

    const tampered = new Uint8Array(sig);
    tampered[20] ^= 0xff;
    expect(KEY_A.publicKey.verify(DIGEST, tampered)).toBe(false);

    // Independent verification through @noble recovery (primitive-level truth)
    const recid = sig[0] - 31;
    const noble = secp256k1.Signature.fromBytes(new Uint8Array(sig.subarray(1)), "compact")
      .addRecoveryBit(recid)
      .recoverPublicKey(DIGEST)
      .toBytes(true);
    expect(hex(new Uint8Array(noble))).toBe(hex(KEY_A.publicKey.bytes));
  });

  it("recoverFromCompact returns the signer's 33-byte compressed public key", () => {
    const sig = KEY_A.signRecoverable(DIGEST);
    const recovered = recoverFromCompact(sig, DIGEST);
    expect(recovered.length).toBe(33);
    expect(hex(recovered)).toBe(hex(KEY_A.publicKey.bytes));
    expect(hex(recovered)).not.toBe(hex(KEY_B.publicKey.bytes));
  });

  it("steem identity string: STM prefix roundtrip, cross-key mismatch detected", () => {
    const s = KEY_A.publicKey.toString("STM");
    expect(s.startsWith("STM")).toBe(true);
    const back = PublicKey.fromString(s, ["STM"]);
    expect(hex(back.bytes)).toBe(hex(KEY_A.publicKey.bytes));
    expect(back.verify(DIGEST, KEY_A.signRecoverable(DIGEST))).toBe(true);
    expect(back.verify(DIGEST, KEY_B.signRecoverable(DIGEST))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Steem key hierarchy (password / brain-key schemes)
// ---------------------------------------------------------------------------

describe("steem key hierarchy: password derivation, master password, brain keys", () => {
  it("derivePrivateKey(account, password, role) is deterministic; roles diverge", () => {
    const owner = derivePrivateKey("testacct", "fake-password-1", "owner");
    const owner2 = derivePrivateKey("testacct", "fake-password-1", "owner");
    const active = derivePrivateKey("testacct", "fake-password-1", "active");
    expect(hex(owner.bytes)).toBe(hex(owner2.bytes));
    expect(hex(owner.bytes)).not.toBe(hex(active.bytes));
  });

  it("derivePrivateKeys returns the full 4-role set, all distinct", () => {
    const set: ReturnType<typeof derivePrivateKeys> = derivePrivateKeys("testacct", "fake-password-2");
    const all = [set.owner, set.active, set.posting, set.memo];
    expect(all.every((k) => k !== undefined)).toBe(true);
    expect(new Set(all.map((k) => hex(k!.bytes))).size).toBe(4);
  });

  it("generateMasterPassword yields a 'P'-prefixed WIF that parses to a valid key", () => {
    const mp = generateMasterPassword();
    expect(mp.startsWith("P")).toBe(true);
    const parsed = PrivateKey.fromWif(mp.slice(1));
    expect(parsed.bytes.length).toBe(32);
    // The role keys derived from it must be deterministic and distinct
    const a = derivePrivateKey("acct", mp, "posting");
    const b = derivePrivateKey("acct", mp, "posting");
    expect(hex(a.bytes)).toBe(hex(b.bytes));
  });

  it("normalizeBrainKey collapses whitespace and lowercases (cli_wallet semantic)", () => {
    expect(normalizeBrainKey("  FAKE   Brain   KEY ")).toBe("fake brain key");
    expect(normalizeBrainKey("  FAKE   Brain   KEY ", false)).toBe("FAKE Brain KEY");
  });
});

// ---------------------------------------------------------------------------
// 3. VaultKeys lifecycle — seal → reveal → revoke + §7.B key isolation
// ---------------------------------------------------------------------------

describe("VaultKeys: seal → reveal lifecycle with key-isolation invariants", () => {
  it("addKey seals the WIF and persists ONLY the public identity", () => {
    let state = freshState();
    const { record, state: next } = VaultKeys.addKey(state, KEY_B.bytes, {
      vaultId: "v1",
      network: "steem",
      role: "active",
      account: "testacct",
      wif: VAULT_WIF,
      storage: "hot",
    });
    state = next;
    expect(record.status).toBe("active");
    expect(record.publicKey).toBe(KEY_A.publicKey.toString("STM"));

    // §7.B INVARIANT: the serialized state document contains NO key material —
    // not the WIF, not the raw scalar hex, not any substring that could leak it.
    const serialized = JSON.stringify(state);
    expect(serialized.includes(VAULT_WIF)).toBe(false);
    expect(serialized.includes(hex(KEY_A.bytes))).toBe(false);
    expect(serialized.includes(hex(KEY_A.bytes).slice(4, 24))).toBe(false); // inner slice
  });

  it("revealKey with the SAME session key returns the identical scalar", () => {
    const { record, state } = VaultKeys.addKey(freshState(), KEY_B.bytes, {
      vaultId: "v1",
      network: "steem",
      role: "owner",
      account: "testacct",
      wif: VAULT_WIF,
      storage: "cold",
    });
    const revealed = VaultKeys.revealKey(record, KEY_B.bytes);
    expect(hex(revealed.bytes)).toBe(hex(KEY_A.bytes));
    expect(state.keys[record.keyId].publicKey).not.toBeNull();
  });

  it("revealKey with a WRONG session key fails closed — message carries zero material", () => {
    const { record } = VaultKeys.addKey(freshState(), KEY_B.bytes, {
      vaultId: "v1",
      network: "steem",
      role: "memo",
      account: "testacct",
      wif: VAULT_WIF,
      storage: "hot",
    });
    const wrongKey = new Uint8Array(32).fill(7);
    try {
      VaultKeys.revealKey(record, wrongKey);
      throw new Error("expected VaultError — nothing thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(VaultError);
      expect((e as VaultError).code).toBe("DECRYPTION_FAILED");
      const msg = (e as Error).message;
      expect(msg.includes(VAULT_WIF)).toBe(false);
      expect(msg.includes(hex(KEY_A.bytes))).toBe(false);
    }
  });

  it("validation matrix fails closed per network (steem roles, eth/sol single-key, tron, saos-net)", () => {
    const st = freshState();
    const input = { vaultId: "v1", account: "a", wif: VAULT_WIF, storage: "hot" as const };
    // steem requires a steem-family role
    expect(() => VaultKeys.addKey(st, KEY_B.bytes, { ...input, network: "steem", role: null })).toThrow(VaultError);
    // ethereum: only "active"
    expect(() => VaultKeys.addKey(st, KEY_B.bytes, { ...input, network: "ethereum", role: "owner" })).toThrow(VaultError);
    // solana: only "active"
    expect(() => VaultKeys.addKey(st, KEY_B.bytes, { ...input, network: "solana", role: "posting" })).toThrow(VaultError);
    // tron: null or owner
    expect(() => VaultKeys.addKey(st, KEY_B.bytes, { ...input, network: "tron", role: "posting" })).toThrow(VaultError);
    // saos-net: no memo authority
    expect(() => VaultKeys.addKey(st, KEY_B.bytes, { ...input, network: "saos-net", role: "memo" })).toThrow(VaultError);
    // unparsable WIF → VALIDATION, and the error text never echoes the input
    const junk = "definitely-not-a-wif-strings-are-not-keys";
    try {
      VaultKeys.addKey(st, KEY_B.bytes, { ...input, network: "steem", role: "active", wif: junk });
      throw new Error("expected VaultError — nothing thrown");
    } catch (e) {
      expect((e as VaultError).code).toBe("VALIDATION");
      expect((e as Error).message.includes(junk)).toBe(false);
    }
  });

  it("M3 unified identity: ONE WIF → STM + EIP-55 + Solana base58, independently recomputed", () => {
    const st = freshState();
    const input = { vaultId: "v1", account: null, wif: VAULT_WIF, storage: "hot" as const };
    const steemRec = VaultKeys.addKey(st, KEY_B.bytes, { ...input, network: "steem", role: "active" }).record;
    const ethRec = VaultKeys.addKey(st, KEY_B.bytes, { ...input, network: "ethereum", role: "active" }).record;
    const solRec = VaultKeys.addKey(st, KEY_B.bytes, { ...input, network: "solana", role: "active" }).record;

    // STM identity
    expect(steemRec.publicKey).toBe(KEY_A.publicKey.toString("STM"));

    // Ethereum: EIP-55 of keccak(uncompressed pubkey)[-20:], recomputed independently
    const uncompressed = secp256k1.getPublicKey(KEY_A.bytes, false).subarray(1); // drop 0x04
    const addrBytes = keccak256(new Uint8Array(uncompressed)).subarray(12);
    const expectedEth = eip55(hex(addrBytes));
    expect(ethRec.publicKey).toBe(expectedEth);
    expect(ethRec.publicKey).toMatch(/^0x[0-9a-fA-F]{40}$/);

    // Solana: the SAME 32 scalar bytes interpreted as an Ed25519 SEED
    const expectedSol = base58.encode(ed25519.getPublicKey(KEY_A.bytes));
    expect(solRec.publicKey).toBe(expectedSol);
  });

  it("listKeys orders by creation; revokeKey is idempotent; unknown id → KEY_NOT_FOUND", () => {
    let st = freshState();
    const input = { vaultId: "v1", account: "a", wif: VAULT_WIF, storage: "hot" as const };
    const k1 = VaultKeys.addKey(st, KEY_B.bytes, { ...input, network: "steem", role: "owner" });
    st = k1.state;
    const k2 = VaultKeys.addKey(st, KEY_B.bytes, { ...input, network: "steem", role: "posting" });
    st = k2.state;

    const listed = VaultKeys.listKeys(st);
    expect(listed.length).toBe(2);
    expect(listed[0].keyId).toBe(k1.record.keyId);

    const once = VaultKeys.revokeKey(st, k1.record.keyId);
    expect(once.record.status).toBe("revoked");
    const twice = VaultKeys.revokeKey(once.state, k1.record.keyId);
    expect(twice.record.status).toBe("revoked");

    expectVaultError(() => VaultKeys.revokeKey(st, "key-does-not-exist"), "KEY_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// 4. Steem transaction digest & wire form (the signing seam) + BLURT fork table
// ---------------------------------------------------------------------------

const TX_FIXTURE = {
  refBlockNum: 12345,
  refBlockPrefix: 305419896, // 0x12345678
  expiration: 1792900000,
  operations: [
    {
      name: "custom_json" as const,
      body: { required_auths: [], required_posting_auths: ["agent1"], id: "saos_unit_test", json: '{"k":1}' },
    },
    { name: "vote" as const, body: { voter: "voter1", author: "author1", permlink: "a-permlink", weight: 10000 } },
  ],
};

describe("steem transaction wire: digest commitment, roundtrips, BLURT fork ids", () => {
  it("serialization is deterministic and deserializes back to the same logical tx", () => {
    const bytes1 = serializeTransaction(TX_FIXTURE);
    const bytes2 = serializeTransaction(TX_FIXTURE);
    expect(hex(bytes1)).toBe(hex(bytes2));

    const back = deserializeTransaction(bytes1);
    expect(back.refBlockNum).toBe(TX_FIXTURE.refBlockNum);
    expect(back.refBlockPrefix).toBe(TX_FIXTURE.refBlockPrefix);
    expect(back.expiration).toBe(TX_FIXTURE.expiration);
    expect(back.operations.length).toBe(2);
    expect(back.operations[0].name).toBe("custom_json");
    expect(back.operations[1].name).toBe("vote");
    expect(hex(serializeTransaction(back))).toBe(hex(bytes1));
  });

  it("transactionDigest commits to sha256(chainId ‖ serialized) — recomputed independently", () => {
    const digest = transactionDigest(TX_FIXTURE);
    const serialized = serializeTransaction(TX_FIXTURE);
    const preimage = new Uint8Array(32 + serialized.length);
    preimage.set(STEEM_CHAIN_ID, 0);
    preimage.set(serialized, 32);
    expect(hex(digest)).toBe(hex(sha256(preimage)));
    expect(digest.length).toBe(32);

    // chain id participates: a non-zero fork id changes the digest
    const forkId = new Uint8Array(32).fill(1);
    expect(hex(transactionDigest(TX_FIXTURE, forkId))).not.toBe(hex(digest));
  });

  it("digest signs and verifies through the unified key seam (end-to-end)", () => {
    const digest = transactionDigest(TX_FIXTURE);
    const sig = KEY_A.signRecoverable(digest);
    expect(KEY_A.publicKey.verify(digest, sig)).toBe(true);
    // recoverable path reconstructs the authority without any stored pubkey
    expect(hex(recoverFromCompact(sig, digest))).toBe(hex(KEY_A.publicKey.bytes));
  });

  it("transactionId: first 20 bytes of sha256(serialized) as 40 hex chars", () => {
    const id = transactionId(TX_FIXTURE);
    const expected = Buffer.from(sha256(serializeTransaction(TX_FIXTURE))).toString("hex").slice(0, 40);
    expect(id).toBe(expected);
    expect(id).toMatch(/^[0-9a-f]{40}$/);
  });

  it("M0 guards: non-32-byte chain id and non-empty extensions fail closed", () => {
    expect(() => transactionDigest(TX_FIXTURE, new Uint8Array(31))).toThrow();
    expect(() =>
      serializeTransaction({ ...TX_FIXTURE, extensions: ["x" as never] }),
    ).toThrow();
  });

  it("BLURT fork: custom_json re-maps to op-id 12 via the fork table — byte-level truth", () => {
    const steemBytes = serializeTransaction(TX_FIXTURE); // default OP_IDS
    const blurtBytes = serializeTransaction(TX_FIXTURE, BLURT_OP_IDS);
    // Layout: u16 refBlock + u32 prefix + u32 expiration = 10 bytes, then varint
    // opCount (1 byte), then the FIRST op-id byte → index 11.
    expect(steemBytes[11]).toBe(OP_IDS.custom_json); // 18 on steem
    expect(blurtBytes[11]).toBe(BLURT_OP_IDS.custom_json); // 12 on blurt
    expect(blurtBytes[11]).not.toBe(steemBytes[11]);
    // The blurt wire form is otherwise identical in length (same bodies).
    expect(blurtBytes.length).toBe(steemBytes.length);
  });
});
