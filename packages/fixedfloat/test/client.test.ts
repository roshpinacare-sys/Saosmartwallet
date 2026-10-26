/**
 * Saosmartwallet packages/fixedfloat — client law suite (RED first)
 * =================================================================
 * The exchange-rail client over an INJECTED transport (house law: zero
 * network in tests; the real fetch transport exists but is never invoked
 * from this suite).
 *
 * Laws pinned:
 *   • Wire form: POST form-encoded, params sent in insertion order, auth via
 *     X-API-KEY / X-API-SIGN (HMAC over concatenated values) / X-API-NONCE.
 *   • Signature on the wire == ffSign(secret, values-in-body-order) — verified
 *     against the locally-recomputed expectation in every wire assertion.
 *   • Nonce strictly increases across calls on one client.
 *   • Envelope law: {code:0} → data; {code≠0} → FixedFloatError kind API with
 *     the API code carried; non-JSON → PARSE; non-2xx → NETWORK with the
 *     status carried; every error path is redacted (no key/secret anywhere).
 *   • Fail-closed input validation before any wire call (empty pair, bad
 *     direction, non-positive amount, unknown order type all refuse LOCALLY
 *     with zero transport invocations).
 *   • The client counts wire calls — the validation laws assert 0.
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
  return { status: 200, text: JSON.stringify({ code: 0, msg: "OK", data }) };
}

function makeClient(transport: FixedFloatTransport) {
  const cfg = loadFixedFloatConfig({ FIXEDFLOAT_API_KEY: TEST_KEY, FIXEDFLOAT_API_SECRET: TEST_SECRET });
  let tick = 1_700_000_000_000;
  const client = new FixedFloatClient(cfg, { transport, now: () => tick });
  return { client, tickRef: () => tick };
}

describe("fixedfloat client — wire law", () => {
  test("sends the documented v1 auth headers and a correctly-signed form body", async () => {
    const { calls, transport } = scriptedTransport(() => okEnvelope({ currencies: [] }));
    const { client } = makeClient(transport);
    await client.getPair("BTC", "ETH");

    expect(calls).toHaveLength(1);
    const req = calls[0]!;
    expect(req.url).toBe("https://ff.io/api/v1/getPair");
    expect(req.method).toBe("POST");
    expect(req.headers["X-API-KEY"]).toBe(TEST_KEY);

    // body = form-encoding of {from: BTC, to: ETH} in insertion order
    expect(req.body).toBe("from=BTC&to=ETH");
    const expectedSig = ffSign(new TextEncoder().encode(TEST_SECRET), ["BTC", "ETH"]);
    expect(req.headers["X-API-SIGN"]).toBe(expectedSig);
    expect(req.headers["X-API-NONCE"]).toMatch(/^[0-9]+$/);
  });

  test("empty-param method (getCurrencies) signs the empty concatenation", async () => {
    const { calls, transport } = scriptedTransport(() => okEnvelope([]));
    const { client } = makeClient(transport);
    await client.getCurrencies();

    const req = calls[0]!;
    expect(req.url).toBe("https://ff.io/api/v1/getCurrencies");
    expect(req.body).toBe("");
    expect(req.headers["X-API-SIGN"]).toBe(ffSign(new TextEncoder().encode(TEST_SECRET), []));
  });

  test("nonce strictly increases across successive calls on the wire", async () => {
    const { calls, transport } = scriptedTransport(() => okEnvelope({}));
    const { client } = makeClient(transport);
    await client.getCurrencies();
    await client.getCurrencies();
    const n1 = BigInt(calls[0]!.headers["X-API-NONCE"]);
    const n2 = BigInt(calls[1]!.headers["X-API-NONCE"]);
    expect(n2 > n1).toBe(true);
    expect(client.nonceCount).toBe(2n);
  });

  test("values keep insertion order in the body and the signature", async () => {
    const { calls, transport } = scriptedTransport(() => okEnvelope({ o: 1 }));
    const { client } = makeClient(transport);
    await client.createOrder({
      from: "BTC",
      to: "ETH",
      amount: "0.05",
      direction: "from",
      type: "fixed",
    });
    const req = calls[0]!;
    expect(req.body).toBe("from=BTC&to=ETH&amount=0.05&direction=from&type=fixed");
    expect(req.headers["X-API-SIGN"]).toBe(
      ffSign(new TextEncoder().encode(TEST_SECRET), ["BTC", "ETH", "0.05", "from", "fixed"]),
    );
  });
});

describe("fixedfloat client — envelope law", () => {
  test("code=0 unwraps data", async () => {
    const { transport } = scriptedTransport(() => okEnvelope({ id: "CH-123" }));
    const { client } = makeClient(transport);
    const data = await client.getOrder("CH-123");
    expect(data).toEqual({ id: "CH-123" });
  });

  test("code≠0 throws kind=API carrying the API code and message", async () => {
    const { transport } = scriptedTransport(() => ({
      status: 200,
      text: JSON.stringify({ code: 5, msg: "Pair not found" }),
    }));
    const { client } = makeClient(transport);
    try {
      await client.getPair("XXX", "YYY");
      expect.unreachable();
    } catch (e) {
      const err = e as FixedFloatError;
      expect(err.kind).toBe("API");
      expect(err.apiCode).toBe(5);
      expect(err.message).toContain("Pair not found");
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
});

describe("fixedfloat client — fail-closed local validation (zero wire calls)", () => {
  test("createOrder refuses empty from/to", async () => {
    const { calls, transport } = scriptedTransport(() => okEnvelope({}));
    const { client } = makeClient(transport);
    await expect(client.createOrder({ from: "", to: "ETH", amount: "1", direction: "from" })).rejects.toThrow(
      FixedFloatError,
    );
    await expect(client.createOrder({ from: "BTC", to: " ", amount: "1", direction: "from" })).rejects.toThrow(
      FixedFloatError,
    );
    expect(calls).toHaveLength(0);
  });

  test("createOrder refuses non-positive amounts and bad direction/type", async () => {
    const { calls, transport } = scriptedTransport(() => okEnvelope({}));
    const { client } = makeClient(transport);
    await expect(
      client.createOrder({ from: "BTC", to: "ETH", amount: "0", direction: "from" }),
    ).rejects.toThrow(FixedFloatError);
    await expect(
      client.createOrder({ from: "BTC", to: "ETH", amount: "-1", direction: "from" }),
    ).rejects.toThrow(FixedFloatError);
    await expect(
      client.createOrder({ from: "BTC", to: "ETH", amount: "1", direction: "sideways" as "from" }),
    ).rejects.toThrow(FixedFloatError);
    await expect(
      client.createOrder({ from: "BTC", to: "ETH", amount: "1", direction: "from", type: "agile" as "fixed" }),
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
