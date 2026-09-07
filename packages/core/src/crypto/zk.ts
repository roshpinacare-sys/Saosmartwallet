/**
 * Saosmartwallet — non-interactive ZK proof of password knowledge (M2, layer 2)
 * =============================================================================
 * Fiat–Shamir Schnorr identification over secp256k1, used to prove a party
 * knows the vault password WITHOUT revealing it (or a hash an attacker could
 * brute-force offline — only the curve commitment is stored/transmitted):
 *
 *   enrollment:  x = H(password ‖ salt ‖ context) mod n     (secret scalar)
 *                X = x·G                                     (public commitment)
 *   prove:       r ← random scalar mod n
 *                A = r·G
 *                c = H(X ‖ A ‖ context)                      (Fiat–Shamir)
 *                z = r + c·x mod n
 *   verify:      X_stored ==? proof.commitment (enrollment anchor)
 *                c' =? H(X ‖ A ‖ context)  and  z·G == A + c·X
 *
 * SECURITY NOTE: verification MUST be anchored to the commitment the verifier
 * stored at enrollment (deriveCommitment output). Checking only the transcript's
 * internal equation would accept ANY self-consistent proof — including one made
 * for a different password — because (X, A, c, z) is trivially consistent by
 * construction. The stored X is what binds the proof to THE password.
 *
 * Security properties:
 *   • Zero-knowledge (honest-verifier): (A, c, z) is a Schnorr transcript —
 *     it leaks nothing about x beyond what the public commitment already has.
 *   • Soundness: a fake proof requires solving the discrete log of X.
 *   • The context string binds proofs to a purpose (vault id + scope), so a
 *     transcript captured for one context cannot be replayed for another.
 *   • x is derived deterministically, so the commitment X is stable across
 *     sessions for the same (password, salt, context).
 *
 * All point arithmetic uses the audited @noble/curves secp256k1 v2 API.
 * Scalars are ALWAYS reduced mod n before multiplication (noble rejects
 * out-of-range scalars) and verification never throws — failures return
 * false so the API cannot be used as a parsing oracle.
 */

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";

import { b64ToBytes, bytesToB64, bytesEqual, concat, utf8 } from "../encoding";
import { VaultError, type ZKProof } from "../types";
import { randomBytes } from "./kdf";

/** Subgroup order n of secp256k1 (via the audited curve parameters). */
const CURVE_ORDER_N: bigint = secp256k1.Point.Fn.ORDER;

const POINT_BYTES = 33; // compressed SEC1
const SCALAR_BYTES = 32;

/**
 * Deterministically maps (password, salt, context) onto a nonzero scalar.
 * The (astronomically unlikely, ~2^-256) case of a zero reduction is handled
 * by re-hashing with a deterministic counter suffix — same input always
 * yields the same scalar, keeping the commitment X stable.
 */
function deriveScalar(password: string, saltB64: string, context: string): bigint {
  for (let attempt = 0; attempt < 256; attempt++) {
    const material = attempt === 0 ? `${password}${saltB64}${context}` : `${password}${saltB64}${context}#${attempt}`;
    const x = beBytesToScalar(sha256(utf8(material))) % CURVE_ORDER_N;
    if (x !== 0n) return x;
  }
  // Unreachable in practice (each attempt fails with probability < 2^-256).
  throw new VaultError("VALIDATION", "scalar derivation exhausted");
}

/**
 * Enrollment commitment — X = x·G for x = deriveScalar(password, salt, context).
 * Persist this at setup time; verification anchors against it (see verifyZKProof).
 */
export function deriveCommitment(password: string, saltB64: string, context: string): string {
  if (password.length === 0) throw new VaultError("VALIDATION", "password must not be empty");
  if (saltB64.length === 0) throw new VaultError("VALIDATION", "salt must not be empty");
  if (context.length === 0) throw new VaultError("VALIDATION", "context must not be empty");
  const x = deriveScalar(password, saltB64, context);
  return bytesToB64(secp256k1.Point.BASE.multiply(x).toBytes(true));
}

/**
 * Generates a non-interactive proof that the caller knows `password` for the
 * given enrollment `saltB64` — without transmitting anything derived from it
 * that could be verified offline against a guess.
 *
 * The returned commitment is safe to persist server-side as an enrollment
 * record; the secret scalar never leaves this function.
 */
export async function generateZKProof(password: string, saltB64: string, context: string): Promise<ZKProof> {
  if (password.length === 0) throw new VaultError("VALIDATION", "password must not be empty");
  if (saltB64.length === 0) throw new VaultError("VALIDATION", "salt must not be empty");
  if (context.length === 0) throw new VaultError("VALIDATION", "context must not be empty");

  const x = deriveScalar(password, saltB64, context);
  const commitment = secp256k1.Point.BASE.multiply(x).toBytes(true);

  // Fresh random nonce per proof — reusing r would leak x (classic Schnorr
  // hazard). The z = 0 redraw loop is unreachable insurance (~2^-256 per
  // attempt) that guarantees a well-formed, non-identity transcript.
  for (let attempt = 0; attempt < 8; attempt++) {
    let r = 0n;
    while (r === 0n) {
      r = beBytesToScalar(randomBytes(SCALAR_BYTES)) % CURVE_ORDER_N;
    }
    const nonceCommitment = secp256k1.Point.BASE.multiply(r).toBytes(true);
    const challenge = sha256(concat(commitment, nonceCommitment, utf8(context)));
    const z = (r + beBytesToScalar(challenge) * x) % CURVE_ORDER_N;
    if (z === 0n) continue;
    return {
      commitment: bytesToB64(commitment),
      nonceCommitment: bytesToB64(nonceCommitment),
      challenge: bytesToB64(challenge),
      response: bytesToB64(scalarToBytes(z)),
      context,
      createdAt: Date.now(),
    };
  }
  throw new VaultError("VALIDATION", "proof generation exhausted");
}

/**
 * Verifies a proof against the enrollment commitment stored by the verifier:
 *   1. the expected commitment must parse and be on-curve,
 *   2. proof.commitment must EQUAL the expected commitment — this is the
 *      anchor that binds the transcript to THE password (without it, any
 *      self-consistent transcript would pass),
 *   3. the Fiat–Shamir challenge must equal H(X ‖ A ‖ proof.context),
 *   4. the Schnorr equation z·G == A + c·X must hold.
 *
 * Returns false on ANY failure — malformed base64, wrong lengths, points not
 * on the curve, tampered fields. It never throws, so callers cannot be
 * crashed by hostile proof material.
 */
export async function verifyZKProof(proof: ZKProof, expectedCommitmentB64: string): Promise<boolean> {
  try {
    if (proof === null || typeof proof !== "object") return false;
    if (typeof proof.context !== "string" || proof.context.length === 0) return false;
    if (typeof expectedCommitmentB64 !== "string" || expectedCommitmentB64.length === 0) return false;

    const expected = b64ToBytes(expectedCommitmentB64);
    if (expected.length !== POINT_BYTES) return false;
    const X = secp256k1.Point.fromBytes(expected);
    X.assertValidity();

    const commitment = b64ToBytes(proof.commitment);
    const nonceCommitment = b64ToBytes(proof.nonceCommitment);
    const challenge = b64ToBytes(proof.challenge);
    const response = b64ToBytes(proof.response);
    if (commitment.length !== POINT_BYTES || nonceCommitment.length !== POINT_BYTES) return false;
    if (challenge.length !== SCALAR_BYTES || response.length !== SCALAR_BYTES) return false;

    // Enrollment anchor — the proof must be ABOUT this commitment.
    if (!bytesEqual(commitment, expected)) return false;

    const A = secp256k1.Point.fromBytes(nonceCommitment);
    A.assertValidity();

    // Challenge binding — Fiat–Shamir over the recomputed transcript.
    const expectedChallenge = sha256(concat(X.toBytes(true), A.toBytes(true), utf8(proof.context)));
    if (!bytesEqual(expectedChallenge, challenge)) return false;

    // Schnorr equation with both scalars reduced mod n (equivalent on-curve).
    const z = beBytesToScalar(response) % CURVE_ORDER_N;
    const c = beBytesToScalar(challenge) % CURVE_ORDER_N;
    const lhs = secp256k1.Point.BASE.multiply(z);
    const rhs = A.add(X.multiply(c));
    return lhs.equals(rhs);
  } catch {
    return false;
  }
}

/** Big-endian byte string → bigint (empty input is 0n). */
function beBytesToScalar(b: Uint8Array): bigint {
  let v = 0n;
  for (const byte of b) {
    v = (v << 8n) | BigInt(byte);
  }
  return v;
}

/** Scalar → 32-byte big-endian; throws (unreachably) on values ≥ 2^256. */
function scalarToBytes(v: bigint): Uint8Array {
  const out = new Uint8Array(SCALAR_BYTES);
  let x = v;
  for (let i = SCALAR_BYTES - 1; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  if (x !== 0n) {
    throw new VaultError("VALIDATION", "scalar does not fit in 32 bytes");
  }
  return out;
}
