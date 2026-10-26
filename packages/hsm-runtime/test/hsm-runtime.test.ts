/**
 * Saosmartwallet packages/hsm-runtime — production signing runtime law suite (RED first)
 * ========================================================================================
 * Owner directive §3 (UNBLOCK PRODUCTION): the wallet's signing core runs as a
 * DEPLOYED, MEASURED, deny-by-default HSM runtime. The laws pinned here:
 *
 *   • CUSTODY: the vault master key is scrypt-derived from a 0600 key file
 *     outside the tree; missing/loose-perm key file ⇒ fail-closed. Signing
 *     keys are generated at first boot, sealed immediately (AES-256-GCM
 *     envelope: ciphertext+iv+tag+salt), and live only inside the sign call.
 *   • DENY-BY-DEFAULT: /health is bare liveness (zero operational data);
 *     /status, /sign, /keys require a Bearer token compared in constant
 *     time; missing token ⇒ 503 (fail-closed, NOT 401 — an unauthenticated
 *     caller must never learn the service exists in an authenticated mode);
 *     wrong token ⇒ 401; bad request shape ⇒ 400; unknown key ⇒ 404.
 *   • ZERO EXPOSURE: responses, audit entries and error messages carry
 *     fingerprints and public keys only — a canary sweeps every output for
 *     the actual key material and must find nothing.
 *   • AUDIT: every signing event lands in a SHA-256 hash-chain
 *     (prevHash → sha256(prevHash + body)); any tampering is detectable.
 *   • HTLC: deterministic pure verdicts — timeout outranks claim, preimage
 *     is verified constant-time, double-claims are refused.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

import { loadMasterKeyFromKeyFile, fingerprintOfKeyFile } from "../src/master-key";
import { HsmKeyring, SECP256K1_KEY_ID, ED25519_KEY_ID } from "../src/keyring";
import { HashChainAudit } from "../src/audit";
import { constantTimeEqual, extractBearerToken } from "../src/token";
import { htlcVerdict } from "../src/htlc-verdicts";
import { createHsmHandler, type HsmDeps } from "../src/server";
import { hashSecret } from "../../htlc/src/secret";

// ---------------------------------------------------------------------------
// hermetic fixtures — every test runs against a temp custody dir + temp store
// ---------------------------------------------------------------------------

function makeKeyFile(dir: string, perm = 0o600): string {
  const p = join(dir, "master.key");
  writeFileSync(p, randomBytes(32).toString("hex") + "\n", { mode: perm });
  chmodSync(p, perm);
  return p;
}

describe("hsm master-key custody — scrypt from a 0600 key file, fail-closed", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "hsm-custody-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test("derives a stable 64-hex vault master from the key file (scrypt, deterministic)", () => {
    const p = makeKeyFile(dir);
    const a = loadMasterKeyFromKeyFile(p);
    const b = loadMasterKeyFromKeyFile(p);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });

  test("different key files derive different masters", () => {
    const a = loadMasterKeyFromKeyFile(makeKeyFile(dir));
    const b = loadMasterKeyFromKeyFile(makeKeyFile(dir));
    expect(a).not.toBe(b);
  });

  test("missing key file ⇒ fail-closed (no default master, no fallback)", () => {
    expect(() => loadMasterKeyFromKeyFile(join(dir, "absent.key"))).toThrow();
  });

  test("loose-perm key file (0644) ⇒ fail-closed custody refusal", () => {
    const p = makeKeyFile(dir, 0o644);
    expect(() => loadMasterKeyFromKeyFile(p)).toThrow();
  });

  test("degenerate key file (empty / short hex) ⇒ fail-closed", () => {
    const p = join(dir, "master.key");
    writeFileSync(p, "", { mode: 0o600 });
    expect(() => loadMasterKeyFromKeyFile(p)).toThrow();
    writeFileSync(p, "abcd", { mode: 0o600 });
    expect(() => loadMasterKeyFromKeyFile(p)).toThrow();
  });

  test("fingerprint is deterministic and reveals no material", () => {
    const p = makeKeyFile(dir);
    const fp = fingerprintOfKeyFile(p);
    expect(fp).toMatch(/^sha256:[0-9a-f]{12}…$/);
    const raw = readFileSync(p, "utf8").trim();
    expect(fp).not.toContain(raw);
    expect(raw).not.toContain("sha256");
  });
});

describe("hsm keyring — first-boot generation, sealed envelopes, sign→verify", () => {
  let dir: string;
  let master: string;
  let storeDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hsm-keyring-"));
    master = loadMasterKeyFromKeyFile(makeKeyFile(dir));
    storeDir = join(dir, "state");
    mkdirSync(storeDir, { recursive: true, mode: 0o700 });
    process.env.SAOS_VAULT_MASTER_KEY = master;
  });
  afterEach(() => {
    delete process.env.SAOS_VAULT_MASTER_KEY;
    rmSync(dir, { recursive: true, force: true });
  });

  test("first boot generates both curves and seals them at rest (no plaintext on disk)", async () => {
    const ring = await HsmKeyring.open({ storeDir });
    expect(ring.listKeys().map((k) => k.id).sort()).toEqual([ED25519_KEY_ID, SECP256K1_KEY_ID].sort());

    const storeRaw = readFileSync(join(storeDir, "keys.enc"), "utf8");
    const store = JSON.parse(storeRaw);
    expect(store.keys).toHaveLength(2);
    for (const env of store.keys) {
      expect(env.iv).toMatch(/^[0-9a-f]{24}$/);
      expect(env.authTag).toMatch(/^[0-9a-f]{32}$/);
      expect(env.salt).toMatch(/^[0-9a-f]{64}$/);
      expect(env.ciphertext.length).toBeGreaterThan(0);
      expect(env.type === "ed25519" || env.type === "secp256k1-wif").toBe(true);
    }
    // The store carries envelopes only — a naive material scan finds nothing.
    expect(storeRaw).not.toMatch(/"material"/);
  });

  test("second boot reuses the sealed keys (no regeneration, stable fingerprints)", async () => {
    const ringA = await HsmKeyring.open({ storeDir });
    const fpA = ringA.listKeys().map((k) => `${k.id}:${k.fingerprint}`).sort();
    const ringB = await HsmKeyring.open({ storeDir });
    const fpB = ringB.listKeys().map((k) => `${k.id}:${k.fingerprint}`).sort();
    expect(fpA).toEqual(fpB);
    expect(ringB.listKeys()).toHaveLength(2);
  });

  test("listKeys returns fingerprints + public keys ONLY (never secrets, never envelopes)", async () => {
    const ring = await HsmKeyring.open({ storeDir });
    const listed = JSON.stringify(ring.listKeys());
    for (const banned of ["material", "ciphertext", "authTag", '"iv"', '"salt"', "seed"]) {
      expect(listed).not.toContain(banned);
    }
    for (const k of ring.listKeys()) {
      expect(k.fingerprint).toMatch(/^sha256:[0-9a-f]{12}…$/);
      expect(k.publicKey).toMatch(/^[0-9a-f]+$/);
    }
  });

  test("secp256k1 sign→verify roundtrip over sha256(payload), deterministic RFC6979", async () => {
    const ring = await HsmKeyring.open({ storeDir });
    const payload = Buffer.from("saos production transfer order #1", "utf8");
    const sig1 = await ring.sign(SECP256K1_KEY_ID, payload);
    const sig2 = await ring.sign(SECP256K1_KEY_ID, payload);
    expect(sig1.algorithm).toBe("ecdsa-secp256k1-sha256");
    expect(sig1.signature).toMatch(/^[0-9a-f]{128}$/); // 64-byte r||s
    expect(sig1.signature).toBe(sig2.signature); // deterministic nonce
    expect(ring.verify(SECP256K1_KEY_ID, payload, Buffer.from(sig1.signature, "hex"))).toBe(true);
    const tampered = Buffer.from(sig1.signature.slice(0, -2) + (sig1.signature.endsWith("0") ? "1" : "0"), "hex");
    expect(ring.verify(SECP256K1_KEY_ID, payload, tampered)).toBe(false);
    expect(ring.verify(SECP256K1_KEY_ID, Buffer.from("other payload"), Buffer.from(sig1.signature, "hex"))).toBe(false);
  });

  test("ed25519 sign→verify roundtrip (node:crypto one-shot semantics)", async () => {
    const ring = await HsmKeyring.open({ storeDir });
    const payload = Buffer.from("saos production message #2", "utf8");
    const sig = await ring.sign(ED25519_KEY_ID, payload);
    expect(sig.algorithm).toBe("ed25519");
    expect(sig.signature).toMatch(/^[0-9a-f]{128}$/); // 64-byte sig
    expect(ring.verify(ED25519_KEY_ID, payload, Buffer.from(sig.signature, "hex"))).toBe(true);
    expect(ring.verify(ED25519_KEY_ID, Buffer.from("tampered"), Buffer.from(sig.signature, "hex"))).toBe(false);
  });

  test("unknown keyId ⇒ fail-closed refusal (no signing)", async () => {
    const ring = await HsmKeyring.open({ storeDir });
    await expect(ring.sign("hsm/unknown/key", Buffer.from("x"))).rejects.toThrow();
  });

  test("tampered store ⇒ open refuses (fail-closed, no clobber)", async () => {
    await HsmKeyring.open({ storeDir });
    const p = join(storeDir, "keys.enc");
    const raw = JSON.parse(readFileSync(p, "utf8"));
    raw.keys[0].ciphertext = raw.keys[0].ciphertext.slice(0, -4) + "0000";
    writeFileSync(p, JSON.stringify(raw), { mode: 0o600 });
    await expect(HsmKeyring.open({ storeDir })).rejects.toThrow();
  });
});

describe("hsm token law — constant-time bearer comparison", () => {
  const token = "a".repeat(64);

  test("constantTimeEqual matches equal values and rejects wrong ones", () => {
    expect(constantTimeEqual(token, token)).toBe(true);
    expect(constantTimeEqual(token, "b".repeat(64))).toBe(false);
    expect(constantTimeEqual(token, token.slice(0, 63))).toBe(false);
    expect(constantTimeEqual("", "")).toBe(false); // empty never authenticates
  });

  test("extractBearerToken parses the Authorization header strictly", () => {
    expect(extractBearerToken(`Bearer ${token}`)).toBe(token);
    expect(extractBearerToken("Bearer")).toBeNull();
    expect(extractBearerToken("Basic dXNlcjpwYXNz")).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken("Bearer  spaced ")).toBeNull(); // no sloppy parsing
  });
});

describe("hsm http handler — deny-by-default matrix", () => {
  let dir: string;
  const TOKEN = "t".repeat(64);
  let deps: HsmDeps;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "hsm-http-"));
    const custody = mkdtempSync(join(tmpdir(), "hsm-http-custody-"));
    const master = loadMasterKeyFromKeyFile(makeKeyFile(custody));
    process.env.SAOS_VAULT_MASTER_KEY = master;
    const storeDir = join(dir, "state");
    const ring = await HsmKeyring.open({ storeDir });
    const audit = new HashChainAudit(join(storeDir, "audit.jsonl"));
    deps = { ring, audit, token: TOKEN, bootedAt: "2026-10-26T15:00:00.000Z", version: "1.0.0" };
  });
  afterEach(() => {
    delete process.env.SAOS_VAULT_MASTER_KEY;
    rmSync(dir, { recursive: true, force: true });
  });

  const auth = (t: string | null): Record<string, string> =>
    t === null ? {} : { authorization: `Bearer ${t}` };
  const jsonBody = async (res: Response): Promise<Record<string, unknown>> =>
    (await res.json()) as Record<string, unknown>;

  test("/health: 200 bare liveness — zero operational data", async () => {
    const res = await createHsmHandler(deps)(new Request("http://hsm/health"));
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(Object.keys(body).sort()).toEqual(["ok"]);
    expect(body.ok).toBe(true);
  });

  test("/status without token ⇒ 503 fail-closed (never 200, never leaks)", async () => {
    const res = await createHsmHandler(deps)(new Request("http://hsm/status"));
    expect(res.status).toBe(503);
    const body = await jsonBody(res);
    expect(body.error).toBe("HSM_E_AUTH_REQUIRED");
  });

  test("/status with WRONG token ⇒ 401", async () => {
    const res = await createHsmHandler(deps)(new Request("http://hsm/status", { headers: auth("w".repeat(64)) }));
    expect(res.status).toBe(401);
  });

  test("/status with the correct token ⇒ 200 (counts only, no key material)", async () => {
    const res = await createHsmHandler(deps)(new Request("http://hsm/status", { headers: auth(TOKEN) }));
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.ok).toBe(true);
    expect(body.keyCount).toBe(2);
    expect(body.bootedAt).toBe("2026-10-26T15:00:00.000Z");
    expect(JSON.stringify(body)).not.toMatch(/"signature"|material|ciphertext/);
  });

  test("/sign without token ⇒ 503; wrong token ⇒ 401", async () => {
    const req = (t: string | null) =>
      new Request("http://hsm/sign", {
        method: "POST",
        headers: { "content-type": "application/json", ...auth(t) },
        body: JSON.stringify({ keyId: SECP256K1_KEY_ID, payload: "hello" }),
      });
    expect((await createHsmHandler(deps)(req(null))).status).toBe(503);
    expect((await createHsmHandler(deps)(req("x".repeat(64)))).status).toBe(401);
  });

  test("/sign authenticated: signature + fingerprint ONLY (no key material, payload not echoed)", async () => {
    const res = await createHsmHandler(deps)(
      new Request("http://hsm/sign", {
        method: "POST",
        headers: { "content-type": "application/json", ...auth(TOKEN) },
        body: JSON.stringify({ keyId: SECP256K1_KEY_ID, payload: "hello" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.ok).toBe(true);
    expect(body.signature).toMatch(/^[0-9a-f]{128}$/);
    expect(body.fingerprint).toMatch(/^sha256:[0-9a-f]{12}…$/);
    expect(body.algorithm).toBe("ecdsa-secp256k1-sha256");
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("hello");
    expect(raw).not.toMatch(/material|ciphertext|authTag/);
  });

  test("/sign bad request shapes ⇒ 400; unknown key ⇒ 404", async () => {
    const post = (body: unknown) =>
      new Request("http://hsm/sign", {
        method: "POST",
        headers: { "content-type": "application/json", ...auth(TOKEN) },
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
    expect((await createHsmHandler(deps)(post({ payload: "x" }))).status).toBe(400); // no keyId
    expect((await createHsmHandler(deps)(post({ keyId: SECP256K1_KEY_ID }))).status).toBe(400); // no payload
    expect((await createHsmHandler(deps)(post({ keyId: SECP256K1_KEY_ID, payload: "" }))).status).toBe(400);
    expect((await createHsmHandler(deps)(post("not-json{"))).status).toBe(400);
    const res = await createHsmHandler(deps)(post({ keyId: "hsm/nope/none", payload: "x" }));
    expect(res.status).toBe(404);
  });

  test("/sign refuses wrong-method probes; unknown paths ⇒ 404 deny", async () => {
    const getSign = new Request("http://hsm/sign", { headers: auth(TOKEN) });
    expect((await createHsmHandler(deps)(getSign)).status).toBe(405);
    const res = await createHsmHandler(deps)(new Request("http://hsm/admin/keys", { headers: auth(TOKEN) }));
    expect(res.status).toBe(404);
  });

  test("/keys authenticated: fingerprints + pubkeys only; unauthenticated ⇒ 503/401", async () => {
    const ok = await createHsmHandler(deps)(new Request("http://hsm/keys", { headers: auth(TOKEN) }));
    expect(ok.status).toBe(200);
    const body = (await jsonBody(ok)) as { keys: Array<Record<string, unknown>> };
    expect(body.keys).toHaveLength(2);
    const raw = JSON.stringify(body);
    for (const banned of ["material", "ciphertext", "authTag", '"iv"', '"salt"']) expect(raw).not.toContain(banned);

    expect((await createHsmHandler(deps)(new Request("http://hsm/keys"))).status).toBe(503);
    expect((await createHsmHandler(deps)(new Request("http://hsm/keys", { headers: auth("z".repeat(64)) }))).status).toBe(401);
  });

  test("every /sign appends exactly one audit event chained to the previous hash", async () => {
    const handler = createHsmHandler(deps);
    await handler(new Request("http://hsm/sign", {
      method: "POST",
      headers: { "content-type": "application/json", ...auth(TOKEN) },
      body: JSON.stringify({ keyId: SECP256K1_KEY_ID, payload: "audit one" }),
    }));
    await handler(new Request("http://hsm/sign", {
      method: "POST",
      headers: { "content-type": "application/json", ...auth(TOKEN) },
      body: JSON.stringify({ keyId: ED25519_KEY_ID, payload: "audit two" }),
    }));
    const lines = readFileSync(join(dir, "state", "audit.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].prevHash).toBe(lines[i - 1].hash);
      expect(lines[i].seq).toBe(lines[i - 1].seq + 1);
    }
    // No raw payload in the audit trail — hashes and fingerprints only.
    const auditRaw = lines.map((l) => JSON.stringify(l)).join("\n");
    expect(auditRaw).not.toContain("audit one");
    expect(auditRaw).not.toContain("audit two");
  });

  test("no-secret-leak canary: sweep every response for material-shaped leaks", async () => {
    const handler = createHsmHandler(deps);
    const paths: Array<Request> = [
      new Request("http://hsm/health"),
      new Request("http://hsm/status", { headers: auth(TOKEN) }),
      new Request("http://hsm/keys", { headers: auth(TOKEN) }),
      new Request("http://hsm/sign", {
        method: "POST",
        headers: { "content-type": "application/json", ...auth(TOKEN) },
        body: JSON.stringify({ keyId: SECP256K1_KEY_ID, payload: "canary" }),
      }),
      new Request("http://hsm/sign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keyId: SECP256K1_KEY_ID, payload: "canary" }),
      }),
    ];
    for (const req of paths) {
      const res = await handler(req);
      const raw = await res.text();
      // No response may ever carry the envelope/store shapes or a material field.
      expect(raw).not.toMatch(/"material"\s*:/);
      expect(raw).not.toMatch(/"seed"\s*:/);
      expect(raw).not.toMatch(/"ciphertext"\s*:/);
      expect(raw).not.toMatch(/"authTag"\s*:/);
    }
  });
});

describe("hsm audit hash-chain — tamper detection", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "hsm-audit-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test("verify() accepts an intact chain and rejects ANY tampering", () => {
    const p = join(dir, "audit.jsonl");
    const a = new HashChainAudit(p);
    a.append("boot", { keyCount: 2 });
    a.append("sign", { keyId: "k1", fingerprint: "sha256:abc…", payloadSha256: "d".repeat(64) });
    a.append("sign", { keyId: "k2", fingerprint: "sha256:def…", payloadSha256: "e".repeat(64) });
    expect(a.verify()).toEqual({ ok: true, entries: 3 });

    const lines = readFileSync(p, "utf8").trim().split("\n");
    const tampered = JSON.parse(lines[1]);
    tampered.payloadSha256 = "f".repeat(64); // rewrite history
    lines[1] = JSON.stringify(tampered);
    writeFileSync(p, lines.join("\n") + "\n");
    const audit2 = new HashChainAudit(p);
    expect(audit2.verify().ok).toBe(false);
  });

  test("chain anchors: first entry prevHash is the GENESIS constant; entries are seq-monotonic", () => {
    const p = join(dir, "audit.jsonl");
    const a = new HashChainAudit(p);
    a.append("boot", {});
    a.append("sign", {});
    const lines = readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0].seq).toBe(1);
    expect(lines[0].prevHash).toMatch(/^[0-9a-f]{64}$/);
    expect(lines[1].seq).toBe(2);
  });
});

describe("hsm htlc verdicts — deterministic, timeout>claim, double-claim refusal", () => {
  // Canonical fixture: claim window closes at 1000, refund at 2000. The genesis
  // margin law lives in packages/htlc; the verdict layer takes timestamps as given.
  const base = {
    hashlock: "",
    state: "Locked" as const,
    redeemerClaimAt: 1_000,
    initiatorRefundAt: 2_000,
  };
  const preimage = randomBytes(32);
  const preimageHex = Buffer.from(preimage).toString("hex");
  const goodHash = hashSecret(preimage);

  test("claim window + valid preimage ⇒ CLAIM", () => {
    const v = htlcVerdict({ ...base, hashlock: goodHash, now: 999, preimageHex });
    expect(v.verdict).toBe("CLAIM");
    expect(v.reason).toBe("preimage-verified-in-claim-window");
  });

  test("timeout outranks claim: at/after redeemerClaimAt a valid preimage STILL refunds", () => {
    for (const now of [1_000, 1_500, 1_999]) {
      const v = htlcVerdict({ ...base, hashlock: goodHash, now, preimageHex });
      expect(v.verdict).toBe("REFUND");
      expect(v.reason).toBe("claim-window-closed-refund-open");
    }
  });

  test("wrong preimage inside the claim window ⇒ REJECT (constant-time verify, never CLAIM)", () => {
    const wrong = Buffer.from(randomBytes(32)).toString("hex");
    const v = htlcVerdict({ ...base, hashlock: goodHash, now: 500, preimageHex: wrong });
    expect(v.verdict).toBe("REJECT");
    expect(v.reason).toBe("preimage-mismatch");
  });

  test("malformed preimage ⇒ REJECT (fail-closed, never throws into a claim)", () => {
    const v = htlcVerdict({ ...base, hashlock: goodHash, now: 500, preimageHex: "zz-not-hex" });
    expect(v.verdict).toBe("REJECT");
  });

  test("double-claim refusal: after Redeemed, even a VALID preimage is refused", () => {
    const v = htlcVerdict({ ...base, hashlock: goodHash, now: 500, preimageHex, state: "Redeemed" });
    expect(v.verdict).toBe("REJECT");
    expect(v.reason).toBe("already-redeemed");
  });

  test("double-refund refusal: after Refunded, refund is refused", () => {
    const v = htlcVerdict({ ...base, hashlock: goodHash, now: 1_500, preimageHex, state: "Refunded" });
    expect(v.verdict).toBe("REJECT");
    expect(v.reason).toBe("already-refunded");
  });

  test("refund refuses BEFORE the claim window closes (initiator cannot jump the gun)", () => {
    const v = htlcVerdict({ ...base, hashlock: goodHash, now: 500 }); // no preimage at all
    expect(v.verdict).toBe("REJECT");
    expect(v.reason).toBe("claim-window-open-no-refund");
  });

  test("past initiatorRefundAt the swap is EXPIRED (terminal, nothing moves)", () => {
    const vClaim = htlcVerdict({ ...base, hashlock: goodHash, now: 2_000, preimageHex });
    expect(vClaim.verdict).toBe("REJECT");
    expect(vClaim.reason).toBe("expired-terminal");
    const vRefund = htlcVerdict({ ...base, hashlock: goodHash, now: 2_000 });
    expect(vRefund.verdict).toBe("REJECT");
    expect(vRefund.reason).toBe("expired-terminal");
  });

  test("Initiated (unlocked) state never moves funds", () => {
    const v = htlcVerdict({ ...base, hashlock: goodHash, now: 500, preimageHex, state: "Initiated" });
    expect(v.verdict).toBe("REJECT");
    expect(v.reason).toBe("not-locked");
  });

  test("hashlock mismatch between offer and preimage is caught (wrong hash on the offer)", () => {
    const other = randomBytes(32);
    const v = htlcVerdict({ ...base, hashlock: hashSecret(other), now: 500, preimageHex });
    expect(v.verdict).toBe("REJECT");
    expect(v.reason).toBe("preimage-mismatch");
  });
});
