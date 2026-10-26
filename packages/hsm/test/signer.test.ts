/**
 * packages/hsm — signer SEAM contract tests (owner directive §3, wave #82)
 * =========================================================================
 * Pinned by test (TDD, RED-first: the suite failed on the missing module):
 *
 *   1. LocalSoftwareHsm determinism — same (key, digest) → identical
 *      signature; byte-equal to an INDEPENDENT direct @noble/curves
 *      computation (RFC6979 nonce law, canonical low-s)
 *   2. fail-closed — unknown keyRef, bad digest length, bad key material,
 *      bad keyRef all throw HsmSignerError with stable codes
 *   3. round-trip — signature verifies against the imported key's public
 *      point via @noble/curves; tampered digest fails verification
 *   4. importSeed — priv = sha256(utf8(seed)) derivation is deterministic
 *   5. VaultBackedSigner — constructor is fail-closed on missing
 *      HSM_ENDPOINT / HSM_TOKEN (env restored after every case)
 *   6. VaultBackedSigner happy path — global fetch is mocked IN THE TEST
 *      (a lawful test vector; production code carries no mock): the request
 *      is POST {base}/sign with {keyRef, digestHex} + Bearer header, and the
 *      hex signature response decodes to the exact bytes
 *   7. remote failure law — non-2xx (incl. HSM_E_UNKNOWN_KEY mapping),
 *      non-JSON body, and signature-less 2xx all throw; error text never
 *      carries the bearer token
 *   8. /keys contract — publicKey(keyRef) and listKeys() speak the deployed
 *      hsm-runtime response shape ({keys:[{id, publicKey}]})
 */

import { afterEach, describe, expect, test } from "bun:test";

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";

import {
  HSM_DIGEST_BYTES,
  HsmSignerError,
  LocalSoftwareHsm,
  VaultBackedSigner,
  bytesToHex,
  hexToBytes,
  type HsmSigner,
} from "../src/signer";

// Throwaway key material — generated in-test, never committed, never logged.
const PRIV_A = hexToBytes("11".repeat(32));
const PRIV_B = hexToBytes("ab".repeat(32));
const DIGEST = sha256(new TextEncoder().encode("sovereign-digest-vector"));
const TOKEN = "test-bearer-token-not-a-secret-0123456789abcdef";

function expectHsmError(promise: Promise<unknown>, code: HsmSignerError["code"]): Promise<void> {
  return promise.then(
    () => {
      throw new Error(`expected HsmSignerError ${code} — call succeeded`);
    },
    (err: unknown) => {
      expect(err).toBeInstanceOf(HsmSignerError);
      expect((err as HsmSignerError).code).toBe(code);
    },
  );
}

// ---------------------------------------------------------------------------
// 1–4: LocalSoftwareHsm (the reference backend)
// ---------------------------------------------------------------------------

describe("LocalSoftwareHsm — reference impl", () => {
  test("determinism: same (key, digest) → byte-identical signature", async () => {
    const hsm = new LocalSoftwareHsm();
    hsm.importKey("k/a", PRIV_A);
    const s1 = await hsm.sign(DIGEST, "k/a");
    const s2 = await hsm.sign(DIGEST, "k/a");
    expect(s1.length).toBe(64); // r||s compact
    expect(bytesToHex(s1)).toBe(bytesToHex(s2));
  });

  test("determinism: byte-equal to an independent direct @noble computation (RFC6979)", async () => {
    const hsm = new LocalSoftwareHsm();
    hsm.importKey("k/a", PRIV_A);
    const viaSeam = await hsm.sign(DIGEST, "k/a");
    const direct = new Uint8Array(secp256k1.sign(DIGEST, PRIV_A, { prehash: false }));
    expect(bytesToHex(viaSeam)).toBe(bytesToHex(new Uint8Array(direct)));
  });

  test("round-trip: signature verifies; tampered digest does not", async () => {
    const hsm = new LocalSoftwareHsm();
    hsm.importKey("k/a", PRIV_A);
    const pub = secp256k1.getPublicKey(PRIV_A, true);
    const sig = await hsm.sign(DIGEST, "k/a");
    expect(secp256k1.verify(sig, DIGEST, pub, { prehash: false })).toBe(true);
    const tampered = sha256(new TextEncoder().encode("tampered"));
    expect(secp256k1.verify(sig, tampered, pub, { prehash: false })).toBe(false);
  });

  test("publicKey returns the 33-byte compressed point of the imported key", async () => {
    const hsm = new LocalSoftwareHsm();
    hsm.importKey("k/b", PRIV_B);
    const pub = await hsm.publicKey("k/b");
    expect(pub.length).toBe(33);
    expect(bytesToHex(pub)).toBe(bytesToHex(new Uint8Array(secp256k1.getPublicKey(PRIV_B, true))));
  });

  test("importSeed derives priv = sha256(utf8(seed)) deterministically", async () => {
    const h1 = new LocalSoftwareHsm();
    const h2 = new LocalSoftwareHsm();
    h1.importSeed("derived", "seed-vector-1");
    h2.importSeed("derived", "seed-vector-1");
    expect(bytesToHex(await h1.publicKey("derived"))).toBe(bytesToHex(await h2.publicKey("derived")));
    const expected = secp256k1.getPublicKey(sha256(new TextEncoder().encode("seed-vector-1")), true);
    expect(bytesToHex(await h1.publicKey("derived"))).toBe(bytesToHex(new Uint8Array(expected)));
  });

  test("fail-closed: unknown keyRef on sign and publicKey", async () => {
    const hsm = new LocalSoftwareHsm();
    hsm.importKey("present", PRIV_A);
    await expectHsmError(hsm.sign(DIGEST, "absent"), "HSM_E_UNKNOWN_KEY");
    await expectHsmError(hsm.publicKey("absent"), "HSM_E_UNKNOWN_KEY");
  });

  test("fail-closed: wrong digest length, zero scalar key, empty keyRef", async () => {
    const hsm = new LocalSoftwareHsm();
    hsm.importKey("k", PRIV_A);
    await expectHsmError(hsm.sign(new Uint8Array(31), "k"), "HSM_E_BAD_DIGEST");
    await expectHsmError(hsm.sign(new Uint8Array(0), "k"), "HSM_E_BAD_DIGEST");
    await expectHsmError(hsm.sign(DIGEST, ""), "HSM_E_BAD_KEYREF");
    expect(() => hsm.importKey("k/z", new Uint8Array(32))).toThrow(HsmSignerError); // zero scalar
    expect(() => hsm.importKey("k/z", new Uint8Array(16))).toThrow(HsmSignerError);
  });

  test("listKeys is sorted and imports are isolated per keyRef", async () => {
    const hsm = new LocalSoftwareHsm();
    hsm.importKey("zz", PRIV_A);
    hsm.importSeed("aa", "seed");
    hsm.importKey("mm", PRIV_B);
    expect(await hsm.listKeys()).toEqual(["aa", "mm", "zz"]);
    await expectHsmError(hsm.sign(DIGEST, "zzz"), "HSM_E_UNKNOWN_KEY");
  });

  test("material hygiene: returned signatures/keys are copies the store never shares", async () => {
    const hsm = new LocalSoftwareHsm();
    const raw = new Uint8Array(PRIV_A);
    hsm.importKey("k", raw);
    raw.fill(0); // caller-side mutation must not reach the store
    const pubAfter = await hsm.publicKey("k");
    expect(bytesToHex(pubAfter)).toBe(bytesToHex(new Uint8Array(secp256k1.getPublicKey(PRIV_A, true))));
    const mut = await hsm.publicKey("k");
    mut.fill(0);
    expect(bytesToHex(await hsm.publicKey("k"))).toBe(bytesToHex(pubAfter));
  });

  test("satisfies the HsmSigner interface shape", () => {
    const hsm: HsmSigner = new LocalSoftwareHsm();
    expect(typeof hsm.sign).toBe("function");
    expect(typeof hsm.publicKey).toBe("function");
    expect(typeof hsm.listKeys).toBe("function");
    expect(HSM_DIGEST_BYTES).toBe(32);
  });
});

// ---------------------------------------------------------------------------
// 5–8: VaultBackedSigner (the remote backend; global fetch mocked per-test)
// ---------------------------------------------------------------------------

const REAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  delete process.env.HSM_ENDPOINT;
  delete process.env.HSM_TOKEN;
});

function mockFetchJson(handler: (url: string, init: RequestInit) => { status?: number; body: unknown }): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { status = 200, body } = handler(url, init ?? {});
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("VaultBackedSigner — remote adapter (env fail-closed)", () => {
  test("constructor throws without HSM_ENDPOINT", () => {
    delete process.env.HSM_ENDPOINT;
    process.env.HSM_TOKEN = TOKEN;
    expect(() => new VaultBackedSigner()).toThrow(HsmSignerError);
    try {
      new VaultBackedSigner();
    } catch (err) {
      expect((err as HsmSignerError).code).toBe("HSM_E_NOT_CONFIGURED");
    }
  });

  test("constructor throws without HSM_TOKEN", () => {
    process.env.HSM_ENDPOINT = "http://127.0.0.1:3057";
    delete process.env.HSM_TOKEN;
    expect(() => new VaultBackedSigner()).toThrow(HsmSignerError);
    try {
      new VaultBackedSigner();
    } catch (err) {
      expect((err as HsmSignerError).code).toBe("HSM_E_NOT_CONFIGURED");
    }
  });

  test("constructor throws on a non-http HSM_ENDPOINT", () => {
    expect(() => new VaultBackedSigner({ baseUrl: "file:///etc", token: TOKEN })).toThrow(HsmSignerError);
  });

  test("happy path: POST {base}/sign {keyRef, digestHex} + Bearer; hex response → exact bytes", async () => {
    const hsm = new LocalSoftwareHsm();
    hsm.importKey("k/a", PRIV_A);
    const expectedSig = await hsm.sign(DIGEST, "k/a"); // reference signature bytes
    const seen: { url: string; init: RequestInit }[] = [];
    mockFetchJson((url, init) => {
      seen.push({ url, init });
      return { body: { ok: true, keyRef: "k/a", signatureHex: bytesToHex(expectedSig) } };
    });
    const signer = new VaultBackedSigner({ baseUrl: "http://127.0.0.1:3057", token: TOKEN });
    const sig = await signer.sign(DIGEST, "k/a");
    expect(seen.length).toBe(1);
    expect(seen[0].url).toBe("http://127.0.0.1:3057/sign");
    expect(seen[0].init.method).toBe("POST");
    expect((seen[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    const sent = JSON.parse(String(seen[0].init.body)) as { keyRef: string; digestHex: string };
    expect(sent.keyRef).toBe("k/a");
    expect(sent.digestHex).toBe(bytesToHex(DIGEST));
    expect(bytesToHex(sig)).toBe(bytesToHex(expectedSig));
    expect(sig).toBeInstanceOf(Uint8Array);
  });

  test("happy path: also accepts the deployed hsm-runtime {signature} field name", async () => {
    mockFetchJson(() => ({ body: { ok: true, keyId: "k/a", signature: "aa55".repeat(32) } }));
    const signer = new VaultBackedSigner({ baseUrl: "http://127.0.0.1:3057", token: TOKEN });
    const sig = await signer.sign(DIGEST, "k/a");
    expect(sig.length).toBe(64);
    expect(sig[0]).toBe(0xaa);
  });

  test("fail-closed: HTTP 404 HSM_E_UNKNOWN_KEY maps to HSM_E_UNKNOWN_KEY", async () => {
    mockFetchJson(() => ({ status: 404, body: { error: "HSM_E_UNKNOWN_KEY" } }));
    const signer = new VaultBackedSigner({ baseUrl: "http://127.0.0.1:3057", token: TOKEN });
    await expectHsmError(signer.sign(DIGEST, "ghost"), "HSM_E_UNKNOWN_KEY");
  });

  test("fail-closed: other non-2xx and non-JSON bodies throw; no token in any error text", async () => {
    mockFetchJson(() => ({ status: 503, body: { error: "HSM_E_NO_TOKEN" } }));
    const signer = new VaultBackedSigner({ baseUrl: "http://127.0.0.1:3057", token: TOKEN });
    await expectHsmError(signer.sign(DIGEST, "k"), "HSM_E_REMOTE");
    globalThis.fetch = (async () => new Response("<html>boom</html>", { status: 200 })) as unknown as typeof fetch;
    await expectHsmError(signer.sign(DIGEST, "k"), "HSM_E_REMOTE_BAD_RESPONSE");
    mockFetchJson(() => ({ body: { ok: true } })); // 2xx without a signature
    await expectHsmError(signer.sign(DIGEST, "k"), "HSM_E_REMOTE_BAD_RESPONSE");
    // transport-level failure
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    try {
      await signer.sign(DIGEST, "k");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as HsmSignerError).code).toBe("HSM_E_REMOTE");
      expect(String(err)).not.toContain(TOKEN);
    }
  });

  test("client-side fail-closed: bad digest never reaches the wire", async () => {
    let called = 0;
    mockFetchJson(() => {
      called++;
      return { body: { ok: true, signatureHex: "00" } };
    });
    const signer = new VaultBackedSigner({ baseUrl: "http://127.0.0.1:3057", token: TOKEN });
    await expectHsmError(signer.sign(new Uint8Array(31), "k"), "HSM_E_BAD_DIGEST");
    expect(called).toBe(0);
  });

  test("/keys contract: publicKey(keyRef) and listKeys() speak the deployed shape", async () => {
    const pubHex = bytesToHex(new Uint8Array(secp256k1.getPublicKey(PRIV_A, true)));
    mockFetchJson(() => ({
      body: { ok: true, keys: [{ id: "k/b", curve: "secp256k1", publicKey: pubHex }, { id: "k/a", curve: "secp256k1", publicKey: pubHex }] },
    }));
    const signer = new VaultBackedSigner({ baseUrl: "http://127.0.0.1:3057", token: TOKEN });
    const pub = await signer.publicKey("k/a");
    expect(bytesToHex(pub)).toBe(pubHex);
    expect(await signer.listKeys()).toEqual(["k/a", "k/b"]);
    await expectHsmError(signer.publicKey("ghost"), "HSM_E_UNKNOWN_KEY");
  });

  test("env construction works end-to-end when HSM_ENDPOINT/HSM_TOKEN are set", async () => {
    process.env.HSM_ENDPOINT = "http://127.0.0.1:3057/";
    process.env.HSM_TOKEN = TOKEN;
    const seen: string[] = [];
    mockFetchJson((url) => {
      seen.push(url);
      return { body: { ok: true, signatureHex: "ff".repeat(64) } };
    });
    const signer = new VaultBackedSigner(); // env-fed
    const sig = await signer.sign(DIGEST, "k/a");
    expect(seen[0]).toBe("http://127.0.0.1:3057/sign"); // trailing slash trimmed
    expect(sig.every((b) => b === 0xff)).toBe(true);
  });

  test("satisfies the HsmSigner interface shape", () => {
    const signer: HsmSigner = new VaultBackedSigner({ baseUrl: "http://127.0.0.1:3057", token: TOKEN });
    expect(typeof signer.sign).toBe("function");
    expect(typeof signer.publicKey).toBe("function");
    expect(typeof signer.listKeys).toBe("function");
  });
});
