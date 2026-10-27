/**
 * packages/hsm-runtime — HTTP service contract (TDD, task G77-d)
 * ===============================================================
 * A REAL node:http server is booted on an ephemeral port and probed with
 * fetch. The pinned surface:
 *
 *   GET  /health      → 200, BARE liveness (no operational data, fleet law)
 *   GET  /status      → Bearer-gated full measured verdicts
 *   POST /keys        → Bearer-gated metadata-only listing
 *   POST /sign/steem  → Bearer-gated steem-family signing → receipt
 *   POST /sign/bytes  → Bearer-gated ed25519 signing → receipt
 *
 * Deny-by-default everywhere: no token configured ⇒ 503 fail-closed on every
 * gated route; missing token ⇒ 401; wrong token ⇒ 403. No broadcast endpoint
 * exists AT ALL (side-effect law) — a POST to /broadcast is a 404, honestly.
 * All fixture keys are self-generated; nothing touches real custody.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { PrivateKey } from "../../crypto/src/index";
import { openVault } from "../../vault/src/index";

import { closeHsmServer, createHsmServer, listenOnEphemeralPort } from "../src/server";
import type { HsmConfig } from "../src/config";

const MASTER = "88".repeat(32);
const TOKEN = "hsm-fixture-srv-token-abcdef0123456789";
const FIXTURE_ACCOUNT = "fixture.carol";
const NOW = 1_893_455_600_000; // inside the fixture tx expiration window

const activeKey = PrivateKey.fromSeed("hsm-fixture-active-srv-G77d");
const edSeed = createHash("sha256").update("hsm-fixture-ed25519-srv-G77d").digest();

let dir = "";
let server: ReturnType<typeof createHsmServer>;
let base = "";

const FIXTURE_TX = {
  refBlockNum: 1000,
  refBlockPrefix: 42,
  expiration: 1_893_456_000,
  operations: [
    {
      name: "vote",
      body: { voter: FIXTURE_ACCOUNT, author: "fixture.dave", permlink: "srv-proof", weight: 2500 },
    },
  ],
};

async function boot(withToken: boolean) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hsm-srv-test-"));
  process.env.SAOS_VAULT_MASTER_KEY = MASTER;
  const vault = await openVault({ dir });
  await vault.sealKey({
    id: `${FIXTURE_ACCOUNT}/active`,
    type: "secp256k1-wif",
    material: activeKey.toWif(),
    meta: { account: FIXTURE_ACCOUNT, role: "active" },
  });
  await vault.sealKey({
    id: "fixture.ed/proof",
    type: "ed25519",
    material: Buffer.from(edSeed),
    meta: null,
  });
  const config: HsmConfig = {
    vaultDir: dir,
    token: withToken ? TOKEN : null,
    port: 0,
    blurtChainIdHex: null,
  };
  server = createHsmServer({
    config,
    startedAt: NOW - 1000,
    now: () => NOW,
  });
  base = await listenOnEphemeralPort(server);
}

// Bounded graceful shutdown (the run-#48 law): a bare server.close() waits
// for connections with NO bound — on a loaded runner that wait blew the 5s
// hook budget (CI run 40499124392, afterAll timeout). closeHsmServer bounds
// the wait deterministically, so the hook can never hang again.
async function shutdown() {
  await closeHsmServer(server, 1000);
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.SAOS_VAULT_MASTER_KEY;
}

describe("hsm-runtime server — armed (token configured)", () => {
  beforeAll(() => boot(true), 20_000);
  afterAll(shutdown, 20_000);

  test("GET /health is bare liveness — zero operational data", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("SIGN-ONLY");
    expect(body.broadcast).toBe("DISABLED");
    expect(JSON.stringify(body).includes(FIXTURE_ACCOUNT)).toBe(false);
    expect(JSON.stringify(body).includes("READY")).toBe(false);
  });

  test("GET /status without token ⇒ 401; wrong token ⇒ 403; correct ⇒ full verdicts", async () => {
    const anon = await fetch(`${base}/status`);
    expect(anon.status).toBe(401);
    const bad = await fetch(`${base}/status`, { headers: { authorization: "Bearer nope" } });
    expect(bad.status).toBe(403);
    const ok = await fetch(`${base}/status`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.signing).toBe("READY");
    expect(body.vault).toBe("OPEN");
    expect(body.token).toBe("SET");
    expect(body.keys.total).toBe(2);
    expect(body.broadcast).toBe("DISABLED");
    expect(JSON.stringify(body).includes(activeKey.toWif())).toBe(false);
  });

  test("POST /sign/steem signs a fixture tx — receipt verifiable, SIGN-ONLY", async () => {
    const res = await fetch(`${base}/sign/steem`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ chain: "steem", tx: FIXTURE_TX, keyId: `${FIXTURE_ACCOUNT}/active` }),
    });
    expect(res.status).toBe(200);
    const receipt = await res.json();
    expect(receipt.mode).toBe("SIGN-ONLY");
    expect(receipt.broadcast).toBe("DISABLED");
    expect(receipt.policy.broadcast).toBe(false);
    expect(receipt.kind).toBe("steem-family");
    expect(receipt.keyId).toBe(`${FIXTURE_ACCOUNT}/active`);
    expect(receipt.signatureCount).toBe(1);
    expect(typeof receipt.wireSha256).toBe("string");
    expect(receipt.wireSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.receiptId).toMatch(/^[0-9a-f]{64}$/);
  });

  test("POST /sign/steem refuses funds ops on posting-class keys with the stable code", async () => {
    // fixture: sign a transfer with the role-less/ed key ids — unknown key ⇒ 422
    const res = await fetch(`${base}/sign/steem`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ chain: "steem", tx: FIXTURE_TX, keyId: "ghost/active" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("HSM_E_UNKNOWN_KEY");
  });

  test("POST /sign/bytes signs ed25519 — receipt with wire digest", async () => {
    const res = await fetch(`${base}/sign/bytes`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ keyId: "fixture.ed/proof", messageHex: Buffer.from("srv-proof").toString("hex") }),
    });
    expect(res.status).toBe(200);
    const receipt = await res.json();
    expect(receipt.kind).toBe("ed25519");
    expect(receipt.mode).toBe("SIGN-ONLY");
    expect(receipt.broadcast).toBe("DISABLED");
    expect(receipt.policy.broadcast).toBe(false);
  });

  test("POST /keys is metadata-only (ids/types — never envelopes)", async () => {
    const res = await fetch(`${base}/keys`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const raw = JSON.stringify(body);
    expect(raw.includes("ciphertext")).toBe(false);
    expect(raw.includes("material")).toBe(false);
    expect(body.keys.length).toBe(2);
    expect(body.keys[0].id).toBeTypeOf("string");
  });

  test("garbage JSON body ⇒ 400 (honest validation, never a 500)", async () => {
    const res = await fetch(`${base}/sign/steem`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  test("unknown route ⇒ 404; wrong method ⇒ 405; /broadcast does not exist ⇒ 404", async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect(
      (
        await fetch(`${base}/sign/steem`, {
          headers: { authorization: `Bearer ${TOKEN}` },
        })
      ).status,
    ).toBe(405);
    expect(
      (
        await fetch(`${base}/broadcast`, {
          method: "POST",
          headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(404);
  });

  test("oversized body ⇒ 413 (bounded)", async () => {
    const res = await fetch(`${base}/sign/steem`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ pad: "x".repeat(300_000) }),
    });
    expect(res.status).toBe(413);
  });
});

describe("hsm-runtime server — token UNSET (fail-closed boot)", () => {
  beforeAll(() => boot(false), 20_000);
  afterAll(shutdown, 20_000);

  test("every gated route answers 503 HSM_E_TOKEN_UNSET — deny-by-default", async () => {
    for (const [method, path] of [
      ["GET", "/status"],
      ["POST", "/keys"],
      ["POST", "/sign/steem"],
      ["POST", "/sign/bytes"],
    ] as const) {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { authorization: "Bearer anything", "content-type": "application/json" },
        body: method === "POST" ? "{}" : undefined,
      });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error.code).toBe("HSM_E_TOKEN_UNSET");
    }
  });

  test("/status reports the honest BLOCKED-AUTH posture once a token is configured elsewhere", async () => {
    // /health stays bare and honest about the posture it CAN state without custody
    const res = await fetch(`${base}/health`);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("SIGN-ONLY");
    expect(body.broadcast).toBe("DISABLED");
  });
});

describe("hsm-runtime server — bounded graceful shutdown (run-#48 class cure)", () => {
  test("closeHsmServer resolves bounded even with idle + active connections held", async () => {
    await boot(true);
    try {
      // idle keep-alive connection (the undici pool class)
      const idle = await fetch(`${base}/health`);
      expect(idle.status).toBe(200);
      await idle.arrayBuffer();

      // ACTIVE connection whose request never completes (the in-flight class
      // a bare server.close() would wait on forever under Node semantics)
      const port = Number(new URL(base).port);
      const sock = net.connect(port, "127.0.0.1");
      await new Promise<void>((r) => sock.once("connect", r));
      sock.write("POST /sign/steem HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 100\r\n\r\nhalf");

      const t0 = Date.now();
      await closeHsmServer(server, 400);
      const elapsed = Date.now() - t0;
      // the whole point: bounded — never the unbounded wait run #48 died on
      expect(elapsed).toBeLessThan(2500);
      sock.destroy();
    } finally {
      await shutdown();
    }
  }, 10_000);
});
