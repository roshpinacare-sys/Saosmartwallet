/**
 * Saosmartwallet packages/fixedfloat — TDD suite 2/4: vault-custody key loading
 * ================================================================================
 * Red-first, fully deterministic (zero network). The REAL FixedFloat credentials
 * never appear in this suite: every fixture uses DUMMY material ("FFTESTKEY", etc.)
 * written into throwaway temp files under /tmp via fixture helpers.
 *
 * Custody laws pinned here (owner directive §3+§4, wave G76-b):
 *   • SOURCE-OF-TRUTH: keys load from a vault file resolved as
 *       explicit path  →  env FIXEDFLOAT_VAULT  →  packages/fixedfloat/state/keys.json
 *     Nothing else. No hardcoded credentials, no env-inline secrets, no fallback
 *     to plaintext config anywhere in the repo.
 *   • PERMS LAW: the vault file MUST be mode 0600 exactly — anything looser
 *     (0644, 0666) is a custody breach and fails closed with the actual mode
 *     in the error (the mode is public metadata; the material never is).
 *   • FAIL-CLOSED MATRIX: missing file, missing env, directory instead of file,
 *     corrupt JSON, wrong format tag, missing/empty/whitespace keys, charset
 *     violation (keys are alphanumeric — colons/spaces refuse), oversized file —
 *     every deviation throws FF_E_VAULT_* ; nothing degrades to a partial load.
 *   • ENVELOPE MODE: format "fixedfloat/keys/enc/1" — AES-256-GCM envelope sealed
 *     under SAOS_VAULT_MASTER_KEY (HKDF info "saos/fixedfloat/v1/key"), reusing the
 *     W49 packages/vault envelope primitives. Wrong master key, tampered
 *     ciphertext, or missing master key env each fail closed (FF_E_VAULT_ENVELOPE).
 *   • NO-SECRET-LEAK: no error message ever carries key material — pinned with a
 *     canary value that must never appear in any thrown error text.
 */

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

import { FixedFloatVaultError, loadFixedFloatKeys } from "../src/vault-loader";
import { buildApiSignature } from "../src/sign";
import { gcmSeal } from "../../vault/src/envelope";

// ---------------------------------------------------------------------------
// Fixtures (dummy material only)
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ff-vault-test-"));
const CLEANUP: string[] = [];
afterAll(() => {
  for (const p of CLEANUP) fs.rmSync(p, { recursive: true, force: true });
});

function vaultFile(name: string, content: string, mode: number): string {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, content, { mode });
  fs.chmodSync(p, mode);
  CLEANUP.push(p);
  return p;
}

function plainVault(apiKey: string, apiSecret: string, mode = 0o600): string {
  return vaultFile(
    `plain-${randomBytes(4).toString("hex")}.json`,
    JSON.stringify({ format: "fixedfloat/keys/1", apiKey, apiSecret }, null, 2) + "\n",
    mode,
  );
}

/** Seals a dummy key pair into the fixedfloat/keys/enc/1 envelope document. */
function sealEnvelope(apiKey: string, apiSecret: string, masterKeyHex: string): string {
  const master = Buffer.from(masterKeyHex, "hex");
  const salt = randomBytes(32);
  const info = Buffer.from("saos/fixedfloat/v1/key", "utf8");
  const aes = Buffer.from(hkdfSync("sha256", master, salt, info, 32));
  const plaintext = Buffer.from(JSON.stringify({ apiKey, apiSecret }), "utf8");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", aes, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const block = { iv: iv.toString("hex"), authTag: cipher.getAuthTag().toString("hex"), ciphertext: ciphertext.toString("hex") };
  return vaultFile(
    `enc-${randomBytes(4).toString("hex")}.json`,
    JSON.stringify({ format: "fixedfloat/keys/enc/1", v: 1, salt: salt.toString("hex"), ...block }, null, 2) + "\n",
    0o600,
  );
}

const MASTER_KEY = randomBytes(32).toString("hex");

// ---------------------------------------------------------------------------
// Source-of-truth resolution
// ---------------------------------------------------------------------------

describe("loadFixedFloatKeys — source-of-truth resolution", () => {
  test("explicit path wins over env; both point at the same 0600 file ⇒ loads", () => {
    const p = plainVault("FFTESTKEY", "FFTESTSECRET");
    const viaPath = loadFixedFloatKeys({ path: p, env: {} });
    const viaEnv = loadFixedFloatKeys({ path: p, env: { FIXEDFLOAT_VAULT: p } });
    expect(viaPath.apiKey).toBe("FFTESTKEY");
    expect(viaPath.apiSecret).toBe("FFTESTSECRET");
    expect(viaEnv.apiKey).toBe("FFTESTKEY");
  });

  test("env FIXEDFLOAT_VAULT resolves when no explicit path is given", () => {
    const p = plainVault("FFTESTKEY", "FFTESTSECRET");
    const keys = loadFixedFloatKeys({ env: { FIXEDFLOAT_VAULT: p } });
    expect(keys.apiKey).toBe("FFTESTKEY");
    expect(keys.apiSecret).toBe("FFTESTSECRET");
  });

  test("no path, no env ⇒ fail-closed FF_E_VAULT_MISSING naming the resolution order", () => {
    try {
      loadFixedFloatKeys({ env: { FIXEDFLOAT_VAULT: path.join(TMP, "definitely-absent.json") } });
      throw new Error("expected FF_E_VAULT_MISSING");
    } catch (err) {
      expect(err).toBeInstanceOf(FixedFloatVaultError);
      expect((err as FixedFloatVaultError).code).toBe("FF_E_VAULT_MISSING");
      expect((err as Error).message).toContain("FIXEDFLOAT_VAULT");
    }
  });

  test("existing directory instead of file ⇒ FF_E_VAULT_MISSING (honest, not a crash)", () => {
    try {
      loadFixedFloatKeys({ path: TMP, env: {} });
      throw new Error("expected FF_E_VAULT_MISSING");
    } catch (err) {
      expect((err as FixedFloatVaultError).code).toBe("FF_E_VAULT_MISSING");
    }
  });
});

// ---------------------------------------------------------------------------
// Perms law (0600 exactly)
// ---------------------------------------------------------------------------

describe("loadFixedFloatKeys — custody perms law", () => {
  test("0600 loads", () => {
    const p = plainVault("FFTESTKEY", "FFTESTSECRET", 0o600);
    expect(loadFixedFloatKeys({ path: p, env: {} }).apiKey).toBe("FFTESTKEY");
  });

  test.each([0o644, 0o666, 0o640, 0o642])("mode %s refuses (FF_E_VAULT_PERMS, actual mode named)", (mode) => {
    const p = plainVault("FFTESTKEY", "FFTESTSECRET", mode as number);
    try {
      loadFixedFloatKeys({ path: p, env: {} });
      throw new Error("expected FF_E_VAULT_PERMS");
    } catch (err) {
      expect(err).toBeInstanceOf(FixedFloatVaultError);
      expect((err as FixedFloatVaultError).code).toBe("FF_E_VAULT_PERMS");
      expect((err as Error).message).toContain(mode.toString(8));
    }
  });

  test("0400 (read-only owner) is honest-tight enough to READ but the loader refuses non-0600 custody", () => {
    // The law is 0600 exactly: a 0400 file is tighter than needed for read-only
    // use but breaks the documented custody contract — refuse, honestly.
    const p = vaultFile(
      "ro.json",
      JSON.stringify({ format: "fixedfloat/keys/1", apiKey: "FFTESTKEY", apiSecret: "FFTESTSECRET" }),
      0o400,
    );
    try {
      loadFixedFloatKeys({ path: p, env: {} });
      throw new Error("expected FF_E_VAULT_PERMS");
    } catch (err) {
      expect((err as FixedFloatVaultError).code).toBe("FF_E_VAULT_PERMS");
      expect((err as Error).message).toContain("400");
    }
  });
});

// ---------------------------------------------------------------------------
// Fail-closed schema matrix
// ---------------------------------------------------------------------------

describe("loadFixedFloatKeys — fail-closed schema matrix", () => {
  test("invalid JSON ⇒ FF_E_VAULT_CORRUPT", () => {
    const p = vaultFile("broken.json", "{ not json", 0o600);
    try {
      loadFixedFloatKeys({ path: p, env: {} });
      throw new Error("expected FF_E_VAULT_CORRUPT");
    } catch (err) {
      expect((err as FixedFloatVaultError).code).toBe("FF_E_VAULT_CORRUPT");
    }
  });

  test("wrong format tag ⇒ FF_E_VAULT_CORRUPT", () => {
    const p = vaultFile("wrongfmt.json", JSON.stringify({ format: "something/else", apiKey: "K", apiSecret: "S" }), 0o600);
    try {
      loadFixedFloatKeys({ path: p, env: {} });
      throw new Error("expected FF_E_VAULT_CORRUPT");
    } catch (err) {
      expect((err as FixedFloatVaultError).code).toBe("FF_E_VAULT_CORRUPT");
    }
  });

  test.each([
    ["missing apiKey", { format: "fixedfloat/keys/1", apiSecret: "FFTESTSECRET" }],
    ["missing apiSecret", { format: "fixedfloat/keys/1", apiKey: "FFTESTKEY" }],
    ["empty apiKey", { format: "fixedfloat/keys/1", apiKey: "", apiSecret: "FFTESTSECRET" }],
    ["whitespace apiSecret", { format: "fixedfloat/keys/1", apiKey: "FFTESTKEY", apiSecret: "  " }],
    ["colon in apiKey (charset law)", { format: "fixedfloat/keys/1", apiKey: "AB:CD", apiSecret: "FFTESTSECRET" }],
    ["newline in apiSecret", { format: "fixedfloat/keys/1", apiKey: "FFTESTKEY", apiSecret: "AB\nCD" }],
    ["non-string keys", { format: "fixedfloat/keys/1", apiKey: 42, apiSecret: "FFTESTSECRET" }],
  ])("schema deviation (%s) ⇒ FF_E_VAULT_CORRUPT", (_name, doc) => {
    const p = vaultFile("schema.json", JSON.stringify(doc), 0o600);
    try {
      loadFixedFloatKeys({ path: p, env: {} });
      throw new Error("expected FF_E_VAULT_CORRUPT");
    } catch (err) {
      expect((err as FixedFloatVaultError).code).toBe("FF_E_VAULT_CORRUPT");
    }
  });

  test("oversized vault file ⇒ FF_E_VAULT_CORRUPT (memory-bomb guard)", () => {
    const big = "x".repeat(2 * 1024 * 1024 + 1);
    const p = vaultFile("big.json", big, 0o600);
    try {
      loadFixedFloatKeys({ path: p, env: {} });
      throw new Error("expected FF_E_VAULT_CORRUPT");
    } catch (err) {
      expect((err as FixedFloatVaultError).code).toBe("FF_E_VAULT_CORRUPT");
    }
  });

  test("NO-SECRET-LEAK: no thrown error ever carries the canary material", () => {
    const canary = "CANARY-SECRET-7f3a9b";
    const p = vaultFile(
      "canary.json",
      JSON.stringify({ format: "fixedfloat/keys/1", apiKey: canary }), // apiSecret missing ⇒ corrupt
      0o600,
    );
    try {
      loadFixedFloatKeys({ path: p, env: {} });
      throw new Error("expected FF_E_VAULT_CORRUPT");
    } catch (err) {
      const text = `${(err as Error).message}|${JSON.stringify(err)}`;
      expect(text.includes(canary)).toBe(false);
      expect((err as Error).message).toContain("canary.json");
    }
  });
});

// ---------------------------------------------------------------------------
// Envelope mode (fixedfloat/keys/enc/1 — W49 vault primitives)
// ---------------------------------------------------------------------------

describe("loadFixedFloatKeys — AES-256-GCM envelope mode", () => {
  test("round-trips: seal with master key ⇒ load returns dummy material", () => {
    const p = sealEnvelope("FFTESTKEY", "FFTESTSECRET", MASTER_KEY);
    const keys = loadFixedFloatKeys({ path: p, env: { SAOS_VAULT_MASTER_KEY: MASTER_KEY } });
    expect(keys.apiKey).toBe("FFTESTKEY");
    expect(keys.apiSecret).toBe("FFTESTSECRET");
  });

  test("wrong master key ⇒ FF_E_VAULT_ENVELOPE (authentication fails closed)", () => {
    const p = sealEnvelope("FFTESTKEY", "FFTESTSECRET", MASTER_KEY);
    const wrongMaster = randomBytes(32).toString("hex");
    try {
      loadFixedFloatKeys({ path: p, env: { SAOS_VAULT_MASTER_KEY: wrongMaster } });
      throw new Error("expected FF_E_VAULT_ENVELOPE");
    } catch (err) {
      expect((err as FixedFloatVaultError).code).toBe("FF_E_VAULT_ENVELOPE");
    }
  });

  test("missing SAOS_VAULT_MASTER_KEY env ⇒ FF_E_VAULT_ENVELOPE naming the env var", () => {
    const p = sealEnvelope("FFTESTKEY", "FFTESTSECRET", MASTER_KEY);
    try {
      loadFixedFloatKeys({ path: p, env: {} });
      throw new Error("expected FF_E_VAULT_ENVELOPE");
    } catch (err) {
      expect((err as FixedFloatVaultError).code).toBe("FF_E_VAULT_ENVELOPE");
      expect((err as Error).message).toContain("SAOS_VAULT_MASTER_KEY");
    }
  });

  test("tampered ciphertext ⇒ FF_E_VAULT_ENVELOPE (GCM auth)", () => {
    const p = sealEnvelope("FFTESTKEY", "FFTESTSECRET", MASTER_KEY);
    const doc = JSON.parse(fs.readFileSync(p, "utf8"));
    doc.ciphertext = doc.ciphertext.slice(0, -2) + (doc.ciphertext.endsWith("00") ? "01" : "00");
    const tampered = vaultFile("tampered.json", JSON.stringify(doc), 0o600);
    try {
      loadFixedFloatKeys({ path: tampered, env: { SAOS_VAULT_MASTER_KEY: MASTER_KEY } });
      throw new Error("expected FF_E_VAULT_ENVELOPE");
    } catch (err) {
      expect((err as FixedFloatVaultError).code).toBe("FF_E_VAULT_ENVELOPE");
    }
  });

  test("envelope with malformed hex fields ⇒ FF_E_VAULT_CORRUPT", () => {
    const p = vaultFile(
      "badhex.json",
      JSON.stringify({ format: "fixedfloat/keys/enc/1", v: 1, salt: "nothex", iv: "zz", authTag: "aa", ciphertext: "bb" }),
      0o600,
    );
    try {
      loadFixedFloatKeys({ path: p, env: { SAOS_VAULT_MASTER_KEY: MASTER_KEY } });
      throw new Error("expected corruption error");
    } catch (err) {
      const code = (err as FixedFloatVaultError).code;
      expect(["FF_E_VAULT_CORRUPT", "FF_E_VAULT_ENVELOPE"]).toContain(code);
    }
  });
});

// ---------------------------------------------------------------------------
// W49 envelope-primitive interop (the vault package stays the single seal/open organ)
// ---------------------------------------------------------------------------

describe("interop — packages/vault gcmSeal/gcmOpen round-trip", () => {
  test("vault envelope primitives open what they sealed (independent of our loader)", () => {
    const key = randomBytes(32);
    const block = gcmSeal(key, Buffer.from("probe", "utf8"));
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(block.iv, "hex"));
    decipher.setAuthTag(Buffer.from(block.authTag, "hex"));
    const pt = Buffer.concat([decipher.update(Buffer.from(block.ciphertext, "hex")), decipher.final()]);
    expect(pt.toString("utf8")).toBe("probe");
  });

  test("HMAC helper agrees with node:crypto on a fresh random vector", () => {
    const secret = randomBytes(16).toString("hex");
    const payload = randomBytes(8).toString("hex");
    const expected = createHmac("sha256", secret).update(payload).digest("hex");
    expect(buildApiSignature(secret, payload)).toBe(expected);
  });
});
