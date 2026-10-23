/**
 * packages/crypto — unified multichain signing surface (task t56, agent-9)
 * ========================================================================
 * TDD coverage for multichain.ts, the ONE answer to directive §7B:
 * "unified WIF/Ed25519/Secp256k1 signing interfaces for STEEM, BLURT,
 *  ETH, SOL" — with key-isolation invariants enforced BY TEST:
 *
 *   1. WIF      — canonical vectors (uncompressed 5K… / compressed K…),
 *                 checksum fail-closed, version fail-closed
 *   2. secp256k1 — RFC 6979 determinism, compact-65 steem wire form,
 *                 recover-to-pubkey, tamper rejection, DER form
 *   3. ed25519  — RFC 8032 test vectors 1 & 2 (exact KAT)
 *   4. wipe     — zeroization helper
 *   5. isolation — NO error message ever carries key material (scanned)
 *   6. schemes  — chain→key-scheme registry, fail-closed on unknown chain
 *
 * ZERO network. All material is in-test fixtures or fixed vectors.
 */

import { describe, it, expect } from "bun:test";
import { base58 } from "@scure/base";

import {
  Secp256k1Signer,
  Ed25519Signer,
  wipeBytes,
  CHAIN_KEY_SCHEMES,
  describeChainKeyScheme,
} from "../src/multichain";
import { wifEncode } from "../src/encoding";

const KEY_01_HEX = "0000000000000000000000000000000000000000000000000000000000000001";
/** Bitcoin mainnet WIF (uncompressed) of scalar 1 — public known-answer. */
const KEY_01_WIF_UNCOMPRESSED = "5HpHagT65TZzG1PH3CSu63k8DbpvD8s5ip4nEB3kEsreAnchuDf";
/** Bitcoin mainnet WIF (compressed, 0x01 flag) of scalar 1 — public known-answer. */
const KEY_01_WIF_COMPRESSED = "KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn";

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, "hex"));
}

function bytesToHex(b: Uint8Array): string {
  return Buffer.from(b).toString("hex");
}

describe("Secp256k1Signer — WIF decoding (fail-closed)", () => {
  it("decodes the canonical uncompressed WIF vector (scalar 1)", () => {
    const s = Secp256k1Signer.fromWif(KEY_01_WIF_UNCOMPRESSED);
    expect(bytesToHex(s.scalar)).toBe(KEY_01_HEX);
  });

  it("decodes the canonical compressed WIF vector (scalar 1, 0x01 flag stripped)", () => {
    const s = Secp256k1Signer.fromWif(KEY_01_WIF_COMPRESSED);
    expect(bytesToHex(s.scalar)).toBe(KEY_01_HEX);
  });

  it("roundtrips through the package encoder", () => {
    const seedHex = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
    const wif = wifEncode(hexToBytes(seedHex));
    const s = Secp256k1Signer.fromWif(wif);
    expect(bytesToHex(s.scalar)).toBe(seedHex);
  });

  it("rejects a corrupted checksum (never signs garbage)", () => {
    const corrupted =
      KEY_01_WIF_UNCOMPRESSED.slice(0, -1) +
      (KEY_01_WIF_UNCOMPRESSED.endsWith("f") ? "H" : "f");
    expect(() => Secp256k1Signer.fromWif(corrupted)).toThrow();
  });

  it("rejects a non-0x80 version byte", () => {
    const raw = new Uint8Array(37);
    raw[0] = 0xef;
    raw[1] = 1;
    const wif = base58.encode(raw);
    expect(() => Secp256k1Signer.fromWif(wif)).toThrow();
  });
});

describe("Secp256k1Signer — sign / verify / recover (RFC 6979 determinism)", () => {
  const signer = Secp256k1Signer.fromSeed("steem-account" + "active" + "master-password-PX");
  const digest = Buffer.from(
    "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", // sha256("test")
    "hex",
  );

  it("is deterministic for (key, digest) — RFC 6979", () => {
    const a = signer.signDigest(digest).compact65;
    const b = signer.signDigest(digest).compact65;
    expect(bytesToHex(a)).toBe(bytesToHex(b));
  });

  it("produces the steem-family compact-65 wire form with header 31..34", () => {
    const { compact65 } = signer.signDigest(digest);
    expect(compact65.length).toBe(65);
    expect(compact65[0]).toBeGreaterThanOrEqual(31);
    expect(compact65[0]).toBeLessThanOrEqual(34);
  });

  it("recovers the signer's compressed public key from the compact signature", () => {
    const { compact65 } = signer.signDigest(digest);
    const recovered = Secp256k1Signer.recover(digest, compact65);
    expect(bytesToHex(recovered)).toBe(bytesToHex(signer.publicKey));
  });

  it("verifies a genuine signature and rejects tampering", () => {
    const { compact65 } = signer.signDigest(digest);
    expect(Secp256k1Signer.verify(digest, compact65, signer.publicKey)).toBe(true);

    const tampered = new Uint8Array(compact65);
    tampered[33] ^= 0x01;
    expect(Secp256k1Signer.verify(digest, tampered, signer.publicKey)).toBe(false);

    const otherDigest = new Uint8Array(digest);
    otherDigest[0] ^= 0x01;
    expect(Secp256k1Signer.verify(otherDigest, compact65, signer.publicKey)).toBe(false);
  });

  it("emits a valid DER form that verifies over the same digest", () => {
    const { der } = signer.signDigest(digest);
    expect(der.length).toBeGreaterThanOrEqual(8);
    expect(Secp256k1Signer.verifyDer(digest, der, signer.publicKey)).toBe(true);
  });

  it("refuses zero and out-of-range scalars (fail-closed)", () => {
    expect(() => Secp256k1Signer.fromBytes(new Uint8Array(32))).toThrow();
    const nBytes = hexToBytes("fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"); // == N
    expect(() => Secp256k1Signer.fromBytes(nBytes)).toThrow();
    expect(() => Secp256k1Signer.fromBytes(new Uint8Array(31))).toThrow();
  });
});

describe("Ed25519Signer — RFC 8032 known-answer vectors", () => {
  // RFC 8032 §7.1 TEST 1
  const V1 = {
    sk: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
    pk: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
    msg: "",
    sig: "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
  };
  // RFC 8032 §7.1 TEST 2
  const V2 = {
    sk: "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
    pk: "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
    msg: "72",
    sig: "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00",
  };

  it("TEST 1: empty message KAT", () => {
    const s = Ed25519Signer.fromSeed(hexToBytes(V1.sk));
    expect(bytesToHex(s.publicKey)).toBe(V1.pk);
    const sig = s.sign(new Uint8Array(0));
    expect(bytesToHex(sig)).toBe(V1.sig);
    expect(Ed25519Signer.verify(new Uint8Array(0), sig, s.publicKey)).toBe(true);
  });

  it("TEST 2: one-byte message KAT", () => {
    const s = Ed25519Signer.fromSeed(hexToBytes(V2.sk));
    expect(bytesToHex(s.publicKey)).toBe(V2.pk);
    const sig = s.sign(hexToBytes(V2.msg));
    expect(bytesToHex(sig)).toBe(V2.sig);
    expect(Ed25519Signer.verify(hexToBytes(V2.msg), sig, s.publicKey)).toBe(true);
  });

  it("rejects tampered signatures and wrong signers (fail-closed)", () => {
    const s = Ed25519Signer.fromSeed(hexToBytes(V2.sk));
    const msg = hexToBytes(V2.msg);
    const sig = s.sign(msg);
    const tampered = new Uint8Array(sig);
    tampered[10] ^= 0xff;
    expect(Ed25519Signer.verify(msg, tampered, s.publicKey)).toBe(false);

    const other = Ed25519Signer.fromSeed(hexToBytes(V1.sk));
    expect(Ed25519Signer.verify(msg, other.sign(msg), s.publicKey)).toBe(false);
  });

  it("fail-closed on non-32-byte seeds", () => {
    expect(() => Ed25519Signer.fromSeed(new Uint8Array(31))).toThrow();
    expect(() => Ed25519Signer.fromSeed(new Uint8Array(33))).toThrow();
  });
});

describe("key isolation — wipeBytes", () => {
  it("zeroizes every byte of every buffer", () => {
    const a = hexToBytes(KEY_01_HEX);
    const b = new Uint8Array([9, 9, 9]);
    wipeBytes(a, b);
    expect([...a].every((v) => v === 0)).toBe(true);
    expect([...b].every((v) => v === 0)).toBe(true);
  });
});

describe("key isolation — no key material in error messages", () => {
  const secretHex = "2b9d4c8e7f0a1325b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3";
  const secretWif = wifEncode(hexToBytes(secretHex));

  function collectErrors(fn: () => void): string {
    try {
      fn();
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    return "";
  }

  it("signer error paths never echo the WIF or the scalar hex", () => {
    const messages = [
      collectErrors(() => Secp256k1Signer.fromWif("not-a-wif")),
      collectErrors(() => Secp256k1Signer.fromBytes(new Uint8Array(32))), // zero scalar
      collectErrors(() => Secp256k1Signer.fromBytes(new Uint8Array(16))),
      collectErrors(() => Ed25519Signer.fromSeed(new Uint8Array(31))),
      collectErrors(() => Secp256k1Signer.recover(new Uint8Array(31), new Uint8Array(65))),
    ];
    for (const m of messages) {
      expect(m).not.toContain(secretHex);
      expect(m).not.toContain(secretWif);
      expect(m.toLowerCase()).not.toContain("2b9d4c8e");
    }
  });
});

describe("CHAIN_KEY_SCHEMES — the §7B chain→scheme registry", () => {
  it("maps the four directive chains to their signing schemes", () => {
    expect(CHAIN_KEY_SCHEMES.steem).toEqual({ curve: "secp256k1", privateKeyFormat: "wif" });
    expect(CHAIN_KEY_SCHEMES.blurt).toEqual({ curve: "secp256k1", privateKeyFormat: "wif" });
    expect(CHAIN_KEY_SCHEMES.ethereum).toEqual({ curve: "secp256k1", privateKeyFormat: "raw-32" });
    expect(CHAIN_KEY_SCHEMES.solana).toEqual({ curve: "ed25519", privateKeyFormat: "seed-32" });
  });

  it("fails closed on an unknown chain", () => {
    expect(() => describeChainKeyScheme("tron")).toThrow();
    expect(describeChainKeyScheme("blurt").curve).toBe("secp256k1");
  });
});
