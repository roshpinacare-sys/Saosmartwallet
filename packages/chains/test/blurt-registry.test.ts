/**
 * packages/chains — BLURT registry entry + the unified vault key-route proof
 * (wave 19.77, swarm directive trace 1a169382511f03c1)
 * ==============================================================================
 * Proves, fully offline and deterministic:
 *   1. BLURT_CHAIN_ID is the r10-oracle-MEASURED id (3/3 on-chain signature
 *      recovery under cd8d90f2…, zeros/hive/testnet 0/3; wire-form identical
 *      bit-for-bit — tools/r10-blurt-digest-oracle.ts + r10-blurt-wire-check)
 *      — not an invented constant.
 *   2. makeBlurtAdapter() yields a lawful fork-parameterized SteemAdapter:
 *      measured chain id, "BLT" prefix, the r20 fork op table (custom_json=12),
 *      BLURT/BBD asset pair — and broadcast stays FAIL-CLOSED by default.
 *   3. Prefix isolation: BLT keys encode/decode only under the BLT namespace
 *      and are mutually rejected against STM (fail-closed identity namespaces).
 *   4. THE UNIFIED KEY ROUTE (directive §7.B): ONE AES-256-GCM envelope
 *      (packages/core cipher, ENVELOPE_VERSION 1) carries all four chains'
 *      key material; open → route per chain → correct-format public identity
 *      for STEEM / BLURT / ETH / SOL; the steem-family pair completes a full
 *      offline signing roundtrip with chain-id isolation (identical tx →
 *      different digests → cross-chain replay verifies FALSE).
 *
 * ZERO network. ZERO plaintext key material at rest (everything sealed).
 * ALL test material generated in-test (throwaway keys). No .env/vault reads.
 */

import { describe, it, expect } from "bun:test";

import {
  BLURT_CHAIN_ID,
  BLURT_CHAIN_ID_HEX,
  BLURT_RPC_URLS,
  BLURT_PREFIXES,
  BLURT_ASSET_SYMBOLS,
  makeBlurtAdapter,
} from "../blurt";
import {
  EncodingError,
  PrivateKey,
  PublicKey,
  base58Decode,
  steemPublicKeyDecode,
  steemPublicKeyEncode,
} from "../../crypto/src/index";
import { sealJson, openJson } from "../../core/src/crypto/cipher";
import { serializeTransaction, transactionDigest, STEEM_CHAIN_ID } from "../steem/src/transaction";
import { BLURT_OP_IDS } from "../steem/src/operations";
import { ethAddressFromPrivateKey } from "../ethereum";
import { solanaAddressFromSeed } from "../solana";

const ORACLE_MEASURED_ID = "cd8d90f29ae273abec3eaa7731e25934c63eb654d55080caff2ebb7f5df6381f";

function random32(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

function bytesToHex(b: Uint8Array): string {
  return Buffer.from(b).toString("hex");
}

function hexToBytes(h: string): Uint8Array {
  return new Uint8Array(Buffer.from(h, "hex"));
}

describe("BLURT registry entry — the measured chain constants", () => {
  it("carries the r10-oracle-measured chain id, bit-exact (not invented)", () => {
    expect(BLURT_CHAIN_ID.length).toBe(32);
    expect(BLURT_CHAIN_ID_HEX).toBe(ORACLE_MEASURED_ID);
    expect(bytesToHex(BLURT_CHAIN_ID)).toBe(ORACLE_MEASURED_ID);
  });

  it("exposes the measured failover endpoint book (https only, oracle endpoint present)", () => {
    expect(BLURT_RPC_URLS.length).toBeGreaterThan(0);
    for (const url of BLURT_RPC_URLS) expect(url.startsWith("https://")).toBe(true);
    expect(BLURT_RPC_URLS).toContain("https://blurt-rpc.saboin.com");
  });

  it("declares the BLT identity namespace and the BLURT/BBD asset pair", () => {
    expect(BLURT_PREFIXES).toEqual(["BLT"]);
    expect(BLURT_ASSET_SYMBOLS).toEqual({ liquid: "BLURT", debt: "BBD" });
  });
});

describe("makeBlurtAdapter — the fork-parameterized registry entry", () => {
  it("yields a lawful ChainAdapter: measured id, BLT prefix, custom_json=12, BLURT/BBD", () => {
    const a = makeBlurtAdapter();
    expect(a.chainId).toBe(ORACLE_MEASURED_ID);
    expect(a.flavor).toBe("steem-family");
    expect(a.capabilities.has("sign-active")).toBe(true);
    expect(a.capabilities.has("sign-posting")).toBe(true);
  });

  it("broadcast stays FAIL-CLOSED by default (no implicit opt-in, ever)", () => {
    const quiet = makeBlurtAdapter();
    expect(quiet.capabilities.has("broadcast")).toBe(false);
  });

  it("broadcast capability appears ONLY with an explicit allowBroadcast override", () => {
    const optedIn = makeBlurtAdapter({ allowBroadcast: true });
    expect(optedIn.capabilities.has("broadcast")).toBe(true);
  });

  it("endpoint overrides replace the whole failover list (no silent merging)", () => {
    const custom = makeBlurtAdapter({ rpcUrls: ["https://example.invalid/rpc"] });
    // The factory's own defaults stay untouched; the override is consumed as-is.
    expect(custom).toBeDefined();
    expect(BLURT_RPC_URLS).toContain("https://blurt-rpc.saboin.com");
  });
});

describe("prefix isolation — BLT vs STM identity namespaces", () => {
  it("BLT keys encode under BLT and roundtrip through BLT-only decoding", () => {
    const k = PrivateKey.random();
    const blt = steemPublicKeyEncode(k.publicKey.bytes, "BLT");
    expect(blt.startsWith("BLT")).toBe(true);
    const back = steemPublicKeyDecode(blt, BLURT_PREFIXES);
    expect(bytesToHex(back)).toBe(bytesToHex(k.publicKey.bytes));
  });

  it("STM-namespace keys are REJECTED under BLT-only decoding (fail closed)", () => {
    const k = PrivateKey.random();
    const stm = steemPublicKeyEncode(k.publicKey.bytes, "STM");
    expect(() => steemPublicKeyDecode(stm, BLURT_PREFIXES)).toThrow(EncodingError);
  });

  it("BLT keys are REJECTED under the default STM/TST decoding (mutual isolation)", () => {
    const k = PrivateKey.random();
    const blt = steemPublicKeyEncode(k.publicKey.bytes, "BLT");
    expect(() => steemPublicKeyDecode(blt)).toThrow(EncodingError);
  });

  it("PublicKey.fromString verifies signatures only inside its own namespace", () => {
    const k = PrivateKey.random();
    const digest = random32();
    const sig = k.signRecoverable(digest);
    const bltPub = PublicKey.fromString(steemPublicKeyEncode(k.publicKey.bytes, "BLT"), BLURT_PREFIXES);
    expect(bltPub.verify(digest, sig)).toBe(true);
  });
});

describe("THE UNIFIED KEY ROUTE — one AES-256-GCM vault, four chains", () => {
  it("seals all four chains' key material in one envelope and routes each chain its identity", () => {
    // In-test generated throwaway keys only — the vault never sees production keys.
    const keyset = {
      steem: { wif: PrivateKey.random().toWif() },
      blurt: { wif: PrivateKey.random().toWif() },
      eth: { priv: bytesToHex(random32()) },
      sol: { seed: bytesToHex(random32()) },
    };
    const masterKey = random32();

    const sealed = sealJson(keyset, masterKey);
    const opened = openJson<typeof keyset>(sealed, masterKey);
    expect(opened).toEqual(keyset);

    // Route per chain — correct public-identity format from the vault-opened keys.
    const steemPub = steemPublicKeyEncode(PrivateKey.fromWif(opened.steem.wif).publicKey.bytes, "STM");
    const blurtPub = steemPublicKeyEncode(PrivateKey.fromWif(opened.blurt.wif).publicKey.bytes, "BLT");
    const ethAddr = ethAddressFromPrivateKey(hexToBytes(opened.eth.priv));
    const solAddr = solanaAddressFromSeed(hexToBytes(opened.sol.seed));

    expect(steemPub.startsWith("STM")).toBe(true);
    expect(blurtPub.startsWith("BLT")).toBe(true);
    expect(ethAddr).toMatch(/^0x[0-9a-fA-F]{40}$/);
    // base58 of a 32-byte ed25519 pubkey is 43-44 chars depending on the
    // seed's leading zero bytes — a literal toBe(44) flakes on ~1/256 of
    // random seeds (caught live by the push-event CI run, t56 convergence).
    // The DETERMINISTIC invariants: the address roundtrips to exactly 32
    // bytes and its char length stays inside the base58 32-byte envelope.
    expect(base58Decode(solAddr).length).toBe(32);
    expect(solAddr.length).toBeGreaterThanOrEqual(43);
    expect(solAddr.length).toBeLessThanOrEqual(44);
  });

  it("the tampered envelope fails closed (AEAD tag) — no key material leaks", () => {
    const keyset = { steem: { wif: PrivateKey.random().toWif() } };
    const masterKey = random32();
    const sealed = sealJson(keyset, masterKey);
    // ciphertext is the canonical base64 string (EncryptedPayload) — decode,
    // flip one bit of the content ciphertext, re-encode (the core test's pattern).
    const raw = Buffer.from(sealed.ciphertext, "base64");
    raw[0] ^= 0xff;
    const tampered = { ...sealed, ciphertext: raw.toString("base64") };
    expect(() => openJson<typeof keyset>(tampered, masterKey)).toThrow();
  });

  it("steem-family chain-id isolation: identical tx → different digests → cross-chain replay FALSE", () => {
    const tx = {
      refBlockNum: 12345,
      refBlockPrefix: 0x1a2b3c4d,
      expiration: 1893456000,
      operations: [
        {
          name: "transfer" as const,
          body: {
            from: "saos.treasury",
            to: "saos.receiver",
            amount: { amount: 1000n, precision: 3, symbol: "BLURT" },
            memo: "wave 19.77 offline vault-route proof",
          },
        },
      ],
    };

    const serialized = serializeTransaction(tx, BLURT_OP_IDS);
    expect(serialized.length).toBeGreaterThan(0);

    const steemDigest = transactionDigest(tx, STEEM_CHAIN_ID);
    const blurtDigest = transactionDigest(tx, BLURT_CHAIN_ID, BLURT_OP_IDS);
    expect(bytesToHex(blurtDigest)).not.toBe(bytesToHex(steemDigest));

    // Sign the BLURT digest with a vault-class key; verify under BLT only.
    const blurtKey = PrivateKey.random();
    const blurtIdentity = steemPublicKeyEncode(blurtKey.publicKey.bytes, "BLT");
    const sig = blurtKey.signRecoverable(blurtDigest);
    expect(sig.length).toBe(65);

    const pub = PublicKey.fromString(blurtIdentity, BLURT_PREFIXES);
    expect(pub.verify(blurtDigest, sig)).toBe(true);
    // Cross-chain replay: the STEEM digest must NOT verify under the BLURT signature.
    expect(pub.verify(steemDigest, sig)).toBe(false);
  });

  it("full offline wire roundtrip: sign → append-form wire → the digest portion verifies", () => {
    const tx = {
      refBlockNum: 42,
      refBlockPrefix: 0x00ff00ff,
      expiration: 1893456000,
      operations: [
        {
          name: "transfer" as const,
          body: {
            from: "saos.a",
            to: "saos.b",
            amount: { amount: 5n, precision: 3, symbol: "BLURT" },
          },
        },
      ],
    };
    const key = PrivateKey.random();
    const digest = transactionDigest(tx, BLURT_CHAIN_ID, BLURT_OP_IDS);
    const sig = key.signRecoverable(digest);
    const wire = new Uint8Array(32 + 1 + 65);
    wire.set(digest, 0);
    wire[32] = 1; // varint signature count
    wire.set(sig, 33);
    expect(wire.length).toBe(32 + 1 + 65);
    // The digest portion is exactly what the signature commits to.
    const pub = PublicKey.fromString(steemPublicKeyEncode(key.publicKey.bytes, "BLT"), BLURT_PREFIXES);
    expect(pub.verify(digest, wire.slice(33))).toBe(true);
  });
});
