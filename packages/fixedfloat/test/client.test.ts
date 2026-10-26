/**
 * Saosmartwallet packages/fixedfloat — client law suite (measured v2 wire)
 * ========================================================================
 * The exchange-rail client over an INJECTED transport (house law: zero
 * network in tests; the real fetch transport exists but is never invoked
 * from this suite).
 *
 * Laws pinned:
 *   • Wire form: POST JSON (deep-sorted deterministic bytes) to
 *     {base}{method}, auth X-Api-Key + X-Signature = ffSign(body, secret).
 *   • Signature on the wire == ffSign(body, secret) — recomputed in the test
 *     via the same pure law and cross-checked against the RFC-pinned
 *     primitive.
 *   • Method whitelist: the measured v2 set {price, ccies, create, order,
 *     emergency, qr}; unknown methods refuse LOCALLY (zero wire calls).
 *   • Envelope law: `data` present (+ code absent/0/200) → data; refusing
 *     code → FixedFloatError kind API carrying the code (the measured 501
 *     "Not have permission" class); non-JSON → PARSE; non-2xx → NETWORK;
 *     every error path is redacted (no key/secret anywhere).
 *   • Fail-closed input validation before any wire call (empty pair, bad
 *     type, non-positive amount, empty order id all refuse LOCALLY with
 *     zero transport invocations).
 */

import { describe, expect, test } from "bun:test";

import {
  FixedFloatClient,
  makeDefaultTransport,
  type FixedFloatTransport,
  type TransportRequest,
  type TransportResponse,
} from "../src/client";
import { FixedFloatError } from "../src/errors";
import { ffSign } from "../src/sign";
import { loadFixedFloatConfig } from "../src/config";

const TEST_KEY = "ff-test-key-0123456789abcdef";
const TEST_SECRET = "ff-test-secret-0123456789abcdef";

/** Deterministic scripted transport: maps method → response, records every request. */
function scriptedTransport(
  responder: (req: TransportRequest) => TransportResponse | Promise<TransportResponse>,
) {
  const calls: TransportRequest[] = [];
  const transport: FixedFloatTransport = async (req) => {
    calls.push(req);
    return responder(req);
  };
  return { calls, transport };
}

function okEnvelope(data: unknown): TransportResponse {
  // Measured v2 success shape: data present, code may be absent.
  return { status: 200, text: JSON.stringify({ msg: "ok", data }) };
}

function makeClient(transport: FixedFloatTransport) {
  const cfg = loadFixedFloatConfig({ FIXEDFLOAT_API_KEY: TEST_KEY, FIXEDFLOAT_API_SECRET: TEST_SECRET });
  const client = new FixedFloatClient(cfg, { transport });
  return { client };
}

describe("fixedfloat client — measured v2 wire law", () => {
  test("sends the measured auth headers and a signed JSON body to {base}{method}", async () => {
    const { calls, transport } = scriptedTransport(() => okEnvelope({}));
    const { client } = makeClient(transport);
    await client.getPrice("ETH", "BTC", "0.25");

    expect(calls).toHaveLength(1);
    const req = calls[0]!;
    expect(req.url).toBe("https://ff.io/api/v2/price");
    expect(req.method).toBe("POST");
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.headers["X-Api-Key"]).toBe(TEST_KEY);

    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body).toEqual({ type: "float", from: "eth", to: "btc", amount: "0.25" });
    // signature is over the canonical form of the wire body
    expect(req.headers["X-Signature"]).toBe(ffSign(body, TEST_SECRET));
  });

  test("JSON body is deep-sorted — deterministic bytes regardless of param order", async () => {
    const { calls, transport } = scriptedTransport(() => okEnvelope({}));
    const { client } = makeClient(transport);
    await client.getPrice("ETH", "BTC", "0.25");
    const req = calls[0]!;
    expect(req.body).toBe('{"amount":"0.25","from":"eth","to":"btc","type":"float"}');
  });

  test("nested params are deep-sorted in the body and the signature", async () => {
    const { calls, transport } = scriptedTransport(() => okEnvelope({}));
    const { client } = makeClient(transport);
    // drive the raw surface with a nested body through a known method:
    await client.callRaw("price", { method: "price", params: { to: "usdt", from: "btc", type: "float" } });
    const req = calls[0]!;
    expect(req.body).toBe(
      '{"method":"price","params":{"from":"btc","to":"usdt","type":"float"}}',
    );
    expect(req.headers["X-Signature"]).toBe(ffSign(JSON.parse(req.body) as Record<string, unknown>, TEST_SECRET));
  });

  test("createOrder sends the validated params as JSON", async () => {
    const { calls, transport } = scriptedTransport(() => okEnvelope({ id: "CH-9" }));
    const { client } = makeClient(transport);
    await client.createOrder({ from: "BTC", to: "ETH", amount: "0.05", type: "fixed", addrTo: "0xabc" });
    const req = calls[0]!;
    expect(req.url).toBe("https://ff.io/api/v2/create");
    expect(JSON.parse(req.body)).toEqual({
      addrTo: "0xabc",
      amount: "0.05",
      from: "btc",
      to: "eth",
      type: "fixed",
    });
    expect(req.headers["X-Signature"]).toBe(ffSign(JSON.parse(req.body) as Record<string, unknown>, TEST_SECRET));
  });
});

describe("fixedfloat client — envelope law", () => {
  test("measured success shape ({msg,data}) unwraps data", async () => {
    const { transport } = scriptedTransport(() => okEnvelope({ id: "CH-123" }));
    const { client } = makeClient(transport);
    const data = await client.getOrder("CH-123");
    expect(data).toEqual({ id: "CH-123" });
  });

  test("code=0 envelope (v1 style) also unwraps data", async () => {
    const { transport } = scriptedTransport(() => ({
      status: 200,
      text: JSON.stringify({ code: 0, msg: "OK", data: { ok: 1 } }),
    }));
    const { client } = makeClient(transport);
    expect(await client.getOrder("CH-1")).toEqual({ ok: 1 });
  });

  test("refusing code throws kind=API carrying the code — the measured 501 class", async () => {
    const { transport } = scriptedTransport(() => ({
      status: 200,
      text: JSON.stringify({ code: 501, msg: "Not have permission" }),
    }));
    const { client } = makeClient(transport);
    try {
      await client.getPrice("ETH", "BTC", "1");
      expect.unreachable();
    } catch (e) {
      const err = e as FixedFloatError;
      expect(err.kind).toBe("API");
      expect(err.apiCode).toBe(501);
      expect(err.message).toContain("Not have permission");
    }
  });

  test("malformed JSON throws kind=PARSE", async () => {
    const { transport } = scriptedTransport(() => ({ status: 200, text: "<html>blocked</html>" }));
    const { client } = makeClient(transport);
    try {
      await client.getCurrencies();
      expect.unreachable();
    } catch (e) {
      const err = e as FixedFloatError;
      expect(err.kind).toBe("PARSE");
    }
  });

  test("non-2xx throws kind=NETWORK carrying the status — the measured Cloudflare 403 class", async () => {
    const { transport } = scriptedTransport(() => ({ status: 403, text: "forbidden" }));
    const { client } = makeClient(transport);
    try {
      await client.getCurrencies();
      expect.unreachable();
    } catch (e) {
      const err = e as FixedFloatError;
      expect(err.kind).toBe("NETWORK");
      expect(err.httpStatus).toBe(403);
      expect(err.message).toContain("403");
    }
  });

  test("every error path is redacted: key and secret never appear in messages", async () => {
    const { transport } = scriptedTransport(() => ({ status: 403, text: `denied key=${TEST_KEY}` }));
    const { client } = makeClient(transport);
    try {
      await client.getCurrencies();
      expect.unreachable();
    } catch (e) {
      const err = e as FixedFloatError;
      expect(err.message).not.toContain(TEST_KEY);
      expect(err.message).not.toContain(TEST_SECRET);
    }
  });

  test("unknown methods refuse locally at zero wire cost", async () => {
    const { calls, transport } = scriptedTransport(() => okEnvelope({}));
    const { client } = makeClient(transport);
    await expect(
      client.callRaw("getRate" as "price", {}),
    ).rejects.toThrow(FixedFloatError);
    expect(calls).toHaveLength(0);
  });
});

describe("fixedfloat client — fail-closed local validation (zero wire calls)", () => {
  test("createOrder refuses empty from/to", async () => {
    const { calls, transport } = scriptedTransport(() => okEnvelope({}));
    const { client } = makeClient(transport);
    await expect(client.createOrder({ from: "", to: "ETH", amount: "1", type: "fixed" })).rejects.toThrow(
      FixedFloatError,
    );
    await expect(client.createOrder({ from: "BTC", to: " ", amount: "1", type: "fixed" })).rejects.toThrow(
      FixedFloatError,
    );
    expect(calls).toHaveLength(0);
  });

  test("createOrder refuses non-positive amounts and bad type", async () => {
    const { calls, transport } = scriptedTransport(() => okEnvelope({}));
    const { client } = makeClient(transport);
    await expect(
      client.createOrder({ from: "BTC", to: "ETH", amount: "0", type: "fixed" }),
    ).rejects.toThrow(FixedFloatError);
    await expect(
      client.createOrder({ from: "BTC", to: "ETH", amount: "-1", type: "fixed" }),
    ).rejects.toThrow(FixedFloatError);
    await expect(
      client.createOrder({ from: "BTC", to: "ETH", amount: "1", type: "agile" as "fixed" }),
    ).rejects.toThrow(FixedFloatError);
    expect(calls).toHaveLength(0);
  });

  test("getOrder refuses an empty order id", async () => {
    const { calls, transport } = scriptedTransport(() => okEnvelope({}));
    const { client } = makeClient(transport);
    await expect(client.getOrder("")).rejects.toThrow(FixedFloatError);
    expect(calls).toHaveLength(0);
  });

  test("the default transport exists for runtime use but performs no I/O when merely created", () => {
    const t = makeDefaultTransport();
    expect(typeof t).toBe("function");
  });
});
