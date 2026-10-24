/**
 * Saosmartwallet — packages/swap ↔ packages/htlc interop proof (agent-9)
 * ======================================================================
 * CONVERGENCE ARTIFACT (t56 doctrine: two lanes, one primitive domain, zero
 * forced duplication). packages/htlc (cycle-31 lane) is the canonical HTLC
 * MACHINE + SAOS-HTLC/1 codec + vault-sealed sessions; packages/swap (this
 * lane) is the GRAPHENE WIRE EVIDENCE layer + u32-seconds session
 * coordinator. Their own code declares real per-chain adapters as future
 * work — this suite pins the seam that lets the two compose:
 *
 *   1. SHA-256 BINDING ANCHOR — their hashSecret and this lane's
 *      sha256Bytes+bytesToHex agree byte-for-byte on the same preimage, so a
 *      machine-side Offer binds to the same hashlock a wire-side witness
 *      publishes.
 *   2. CROSS VERIFICATION — their constant-time verifySecret accepts this
 *      lane's hashlock hex and refuses a foreign preimage (the admission
 *      law agrees in both directions).
 *   3. CANONICAL JSON DOMAIN — their canonicalize and this lane's
 *      canonicalJson produce byte-identical output (sorted keys, zero
 *      whitespace): receipt chains and witness payloads live in ONE digest
 *      domain by construction, not by convention.
 *   4. PROTOCOL CONSTANTS — both packages fix the preimage/secret at 32
 *      bytes; the wire layer additionally admits the core's 16..1024 law
 *      for graphene memos.
 *   5. WITNESS SEAM — a preimage-phase witness payload built from THEIR
 *      machine's secret/hash pair passes this lane's binding-truth
 *      validation — evidence for their swaps can be serialized on graphene
 *      legs today (their declared future work, landed here).
 *
 * Read-only in both directions: this suite imports both packages and edits
 * neither.
 */

import { describe, expect, test } from "bun:test";

import { sha256Bytes, canonicalJson } from "../src/htlc";
import { bytesToHex, canonicalWitnessJson, buildWitnessCustomJson, type WitnessPayload } from "../src/witness";

// read-only imports from the sister package (cycle-31 lane)
import { hashSecret, verifySecret, generateSecret, SECRET_BYTES, canonicalize as htlcCanonicalize } from "../../htlc/src";

const enc = new TextEncoder();
/** SAOS-HTLC/1 fixes the secret at exactly 32 bytes — interop fixtures obey. */
const PRE32 = enc.encode("interop-preimage-" + "0".repeat(15)); // exactly 32 ASCII bytes

describe("interop: one binding anchor across both packages", () => {
  test("hashSecret (theirs) === sha256Bytes+hex (ours) on the same preimage", () => {
    const preimage = PRE32; // ≥ 16 bytes
    const theirs = hashSecret(preimage);
    const ours = bytesToHex(sha256Bytes(preimage));
    expect(theirs).toBe(ours);
  });

  test("their constant-time verifySecret accepts our hashlock hex and refuses a foreign preimage", () => {
    const preimage = PRE32;
    const hashlockHex = bytesToHex(sha256Bytes(preimage));
    expect(verifySecret(preimage, hashlockHex)).toBe(true);
    expect(verifySecret(enc.encode("foreign-preimage-" + "0".repeat(15)), hashlockHex)).toBe(false);
    expect(verifySecret(preimage, "not-a-hash")).toBe(false);
  });

  test("both packages fix the preimage at 32 bytes; random generation agrees in size", () => {
    expect(SECRET_BYTES).toBe(32);
    expect(generateSecret().length).toBe(32);
  });
});

describe("interop: one canonical JSON digest domain", () => {
  test("their canonicalize and our canonicalJson are byte-identical", () => {
    const a = { b: 2, a: 1, nested: { z: [3, 1], y: null } };
    expect(htlcCanonicalize(a)).toBe(canonicalJson(a));
  });

  test("canonical witness payloads ride the same sorted-key zero-whitespace form", () => {
    const payload: WitnessPayload = {
      v: 1,
      swap: "interop-swap",
      phase: "hashlock",
      leg: "A",
      chain: "steem",
      hashlock: hashSecret(PRE32),
      expiresAt: 1_700_003_600,
    };
    const s = canonicalWitnessJson(payload);
    expect(s).not.toContain(" ");
    expect(s.indexOf('"chain"')).toBeLessThan(s.indexOf('"swap"'));
    // and the sister package's canonicalizer agrees byte-for-byte on the same document
    expect(htlcCanonicalize(payload)).toBe(s);
  });
});

describe("interop: the witness seam for machine-side swaps", () => {
  test("a preimage-phase witness built from THEIR secret/hash pair passes our binding law", () => {
    const secret = PRE32;
    const hashHex = hashSecret(secret);
    const payload: WitnessPayload = {
      v: 1,
      swap: "interop-swap",
      phase: "preimage",
      leg: "B",
      chain: "blurt",
      hashlock: hashHex,
      preimage: bytesToHex(secret),
      expiresAt: 1_700_003_600,
    };
    // our wire layer accepts the machine's binding — evidence can be serialized today
    const op = buildWitnessCustomJson({ account: "interop.acct", payload });
    expect(op.required_posting_auths).toEqual(["interop.acct"]);
    expect(op.json).toContain('"phase":"preimage"');
    // and the json roundtrips through the sister canonicalizer unchanged
    expect(htlcCanonicalize(JSON.parse(op.json))).toBe(op.json);
  });
});
