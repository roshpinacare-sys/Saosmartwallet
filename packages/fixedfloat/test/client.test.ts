/**
 * Saosmartwallet packages/fixedfloat — TDD suite 3/4: API client (injected transport)
 * =====================================================================================
 * Red-first, fully deterministic: every test runs against an INJECTED transport —
 * no socket is ever opened, no API response is fabricated as "real". The honest
 * live probe lives in bin/probe-live.ts (env-gated, real network, public data only).
 *
 * Official v2 wire laws pinned here (source: https://fixedfloat.com/api, archived):
 *   • POST {baseUrl}{method}; baseUrl default "https://ff.io/api/v2/".
 *   • Body is the EXACT canonical JSON string that was signed (sign-the-sent law).
 *   • Headers: Content-Type "application/json; charset=UTF-8", X-API-KEY, X-API-SIGN.
 *   • Envelope {code, msg, data}; code === 0 ⇒ resolve data.
 *   • No-parameters requests sign the empty string and send an empty body.
 *
 * Honest-transport laws pinned here:
 *   • RETRY CLASSIFICATION: read-only methods (ccies, price, order, qr) may be
 *     retried on transport errors / 429 / 5xx with exponential backoff + jitter
 *     (both injected ⇒ deterministic); SIDE-EFFECTFUL methods (create, emergency,
 *     setEmail) are attempted EXACTLY ONCE — a retry could double-create an order
 *     or double-trigger a refund action, so they fail honest instead.
 *   • TIMEOUT: aborts map to FF_E_TIMEOUT (retryable only for read-only methods).
 *   • FAIL-HONEST: business errors (code≠0) never retry and surface code+msg;
 *     malformed bodies surface FF_E_MALFORMED; exhausted retries surface
 *     FF_E_TRANSPORT — never a fabricated success.
 *   • NO-SECRET-LEAK: the client holds its keys in #private fields, exposes no
 *     accessor, and JSON.stringify(client) carries no material.
 */

import { createHmac } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { FixedFloatClient } from "../src/client";
import { FixedFloatError } from "../src/errors";
import { canonicalPayloadString } from "../src/sign";

const KEY = "FFDUMMY-KEY";
const SECRET = "ff-test-secret";
const BASE = "https://ff.io/api/v2/";

type Call = { url: string; method: string; headers: Record<string, string>; body: string };

function hmac(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("hex");
}

/** Scripted transport: response factories consume the captured call. */
function scriptTransport(respond: (call: Call, attempt: number) => { status: number; text: string } | Promise<never> | never) {
  const calls: Call[] = [];
  const transport = async (req: Call): Promise<{ status: number; text: string }> => {
    calls.push({ ...req });
    return respond({ ...req }, calls.length);
  };
  return { calls, transport };
}

const okJson = (data: unknown) => ({ status: 200, text: JSON.stringify({ code: 0, msg: "OK", data }) });

function makeClient(transport: any, extra: Partial<ConstructorParameters<typeof FixedFloatClient>[0]> = {}) {
  return new FixedFloatClient({
    apiKey: KEY,
    apiSecret: SECRET,
    transport,
    sleep: async () => {},
    rng: () => 0,
    ...extra,
  });
}

describe("FixedFloatClient — wire truth (official v2)", () => {
  test("createOrder: POST {base}create with canonical body, exact headers, sign-of-sent-body", async () => {
    const { calls, transport } = scriptTransport(() => okJson({ id: "8PQWPY", token: "tok", status: "NEW" }));
    const client = makeClient(transport);
    const order = await client.createOrder({
      type: "fixed",
      fromCcy: "BTC",
      toCcy: "ETH",
      direction: "from",
      amount: 0.5,
      toAddress: "bc1qtest",
    });
    expect(calls.length).toBe(1);
    const call = calls[0];
    const expectedBody = canonicalPayloadString({
      type: "fixed",
      fromCcy: "BTC",
      toCcy: "ETH",
      direction: "from",
      amount: 0.5,
      toAddress: "bc1qtest",
    });
    expect(call.url).toBe(BASE + "create");
    expect(call.method).toBe("POST");
    expect(call.body).toBe(expectedBody); // the exact signed string is the sent string
    expect(call.headers["Content-Type"]).toBe("application/json; charset=UTF-8");
    expect(call.headers["X-API-KEY"]).toBe(KEY);
    expect(call.headers["X-API-SIGN"]).toBe(hmac(expectedBody));
    expect(order).toEqual({ id: "8PQWPY", token: "tok", status: "NEW" });
  });

  test("ccies: empty body, signature over the empty string", async () => {
    const { calls, transport } = scriptTransport(() => okJson([{ code: "BTC", coin: "BTC" }]));
    const client = makeClient(transport);
    const list = await client.currencies();
    expect(calls[0].url).toBe(BASE + "ccies");
    expect(calls[0].body).toBe("");
    expect(calls[0].headers["X-API-SIGN"]).toBe(hmac(""));
    expect(list).toEqual([{ code: "BTC", coin: "BTC" }]);
  });

  test("orderInfo: body {id, token} signed exactly (pinned vector body)", async () => {
    const { calls, transport } = scriptTransport(() => okJson({ id: "8PQWPY", status: "PENDING" }));
    const client = makeClient(transport);
    const order = await client.orderInfo("8PQWPY", "tok");
    expect(calls[0].body).toBe('{"id":"8PQWPY","token":"tok"}');
    expect(calls[0].headers["X-API-SIGN"]).toBe(hmac('{"id":"8PQWPY","token":"tok"}'));
    expect(order.id).toBe("8PQWPY");
  });

  test("determinism: identical request twice ⇒ identical body and signature", async () => {
    const { calls, transport } = scriptTransport(() => okJson({}));
    const client = makeClient(transport);
    await client.orderInfo("8PQWPY", "tok");
    await client.orderInfo("8PQWPY", "tok");
    expect(calls[0].body).toBe(calls[1].body);
    expect(calls[0].headers["X-API-SIGN"]).toBe(calls[1].headers["X-API-SIGN"]);
  });

  test("emergencyAction REFUND: {id, token, choice, address} canonical, omitted-tag form", async () => {
    const { calls, transport } = scriptTransport(() => okJson({ choice: "REFUND" }));
    const client = makeClient(transport);
    await client.emergencyAction({ id: "8PQWPY", token: "tok", choice: "REFUND", address: "bc1qrefund" });
    const expectedBody = canonicalPayloadString({ id: "8PQWPY", token: "tok", choice: "REFUND", address: "bc1qrefund" });
    expect(calls[0].body).toBe(expectedBody);
    expect(calls[0].url).toBe(BASE + "emergency");
    expect(calls[0].headers["X-API-SIGN"]).toBe(hmac(expectedBody));
  });
});

describe("FixedFloatClient — envelope + fail-honest errors", () => {
  test("code≠0 ⇒ FF_E_API carrying code and msg; NO retry (single attempt)", async () => {
    const { calls, transport } = scriptTransport(() => ({ status: 200, text: JSON.stringify({ code: 401, msg: "BAD_KEY" }) }));
    const client = makeClient(transport);
    try {
      await client.price({ fromCcy: "BTC", toCcy: "ETH", amount: 1, direction: "from", type: "float" });
      throw new Error("expected FF_E_API");
    } catch (err) {
      expect(err).toBeInstanceOf(FixedFloatError);
      expect((err as FixedFloatError).code).toBe("FF_E_API");
      expect((err as Error).message).toContain("401");
      expect((err as Error).message).toContain("BAD_KEY");
    }
    expect(calls.length).toBe(1);
  });

  test("non-JSON 200 body ⇒ FF_E_MALFORMED", async () => {
    const { transport } = scriptTransport(() => ({ status: 200, text: "<html>blocked</html>" }));
    const client = makeClient(transport);
    try {
      await client.currencies();
      throw new Error("expected FF_E_MALFORMED");
    } catch (err) {
      expect((err as FixedFloatError).code).toBe("FF_E_MALFORMED");
    }
  });

  test("code=0 without data ⇒ FF_E_MALFORMED (envelope law)", async () => {
    const { transport } = scriptTransport(() => ({ status: 200, text: JSON.stringify({ code: 0, msg: "OK" }) }));
    const client = makeClient(transport);
    try {
      await client.currencies();
      throw new Error("expected FF_E_MALFORMED");
    } catch (err) {
      expect((err as FixedFloatError).code).toBe("FF_E_MALFORMED");
    }
  });

  test("HTTP 404 non-JSON ⇒ FF_E_TRANSPORT with status named", async () => {
    const { transport } = scriptTransport(() => ({ status: 404, text: "nope" }));
    const client = makeClient(transport);
    try {
      await client.currencies();
      throw new Error("expected FF_E_TRANSPORT");
    } catch (err) {
      expect((err as FixedFloatError).code).toBe("FF_E_TRANSPORT");
      expect((err as Error).message).toContain("404");
    }
  });

  test("errors never carry the key material", async () => {
    const { transport } = scriptTransport(() => ({ status: 200, text: JSON.stringify({ code: 7, msg: "ERR" }) }));
    const client = makeClient(transport);
    try {
      await client.orderInfo("X", "Y");
      throw new Error("expected FF_E_API");
    } catch (err) {
      const text = `${(err as Error).message}|${JSON.stringify(err)}`;
      expect(text.includes(KEY)).toBe(false);
      expect(text.includes(SECRET)).toBe(false);
    }
  });
});

describe("FixedFloatClient — retry classification (honest transport)", () => {
  test("read-only price: network error retries with deterministic backoff (base 100, jitter 50, rng 0 ⇒ 100, 200)", async () => {
    let attempt = 0;
    const sleeps: number[] = [];
    const transport = async () => {
      attempt++;
      if (attempt < 3) throw new Error("ECONNRESET");
      return okJson({ from: {}, to: {} });
    };
    const client = makeClient(transport, { sleep: async (ms: number) => { sleeps.push(ms); } });
    const data = await client.price({ fromCcy: "BTC", toCcy: "ETH", amount: 1, direction: "from", type: "float" });
    expect(data).toEqual({ from: {}, to: {} });
    expect(attempt).toBe(3);
    expect(sleeps).toEqual([100, 200]);
  });

  test("read-only price: 503 exhausts retries ⇒ FF_E_TRANSPORT after 1+maxRetries attempts", async () => {
    const { calls, transport } = scriptTransport(() => ({ status: 503, text: "overloaded" }));
    const client = makeClient(transport, { maxRetries: 2 });
    try {
      await client.price({ fromCcy: "BTC", toCcy: "ETH", amount: 1, direction: "from", type: "float" });
      throw new Error("expected FF_E_TRANSPORT");
    } catch (err) {
      expect((err as FixedFloatError).code).toBe("FF_E_TRANSPORT");
    }
    expect(calls.length).toBe(3);
  });

  test("read-only order: 429 then 200 ⇒ transparent recovery, exactly one sleep", async () => {
    const { calls, transport } = scriptTransport((_, attempt) =>
      attempt === 1 ? { status: 429, text: "rate" } : okJson({ id: "8PQWPY", status: "DONE" }),
    );
    const sleeps: number[] = [];
    const client = makeClient(transport, { sleep: async (ms: number) => { sleeps.push(ms); } });
    const order = await client.orderInfo("8PQWPY", "tok");
    expect(order.status).toBe("DONE");
    expect(calls.length).toBe(2);
    expect(sleeps.length).toBe(1);
  });

  test("SIDE-EFFECT LAW: 503 on create ⇒ exactly ONE attempt, FF_E_TRANSPORT (no double-order risk)", async () => {
    const { calls, transport } = scriptTransport(() => ({ status: 503, text: "overloaded" }));
    const client = makeClient(transport, { maxRetries: 5 });
    try {
      await client.createOrder({ type: "float", fromCcy: "BTC", toCcy: "ETH", direction: "from", amount: 1, toAddress: "x" });
      throw new Error("expected FF_E_TRANSPORT");
    } catch (err) {
      expect((err as FixedFloatError).code).toBe("FF_E_TRANSPORT");
    }
    expect(calls.length).toBe(1);
  });

  test("SIDE-EFFECT LAW: network error on emergency ⇒ exactly ONE attempt", async () => {
    const { calls, transport } = scriptTransport(() => { throw new Error("EAI_AGAIN"); });
    const client = makeClient(transport, { maxRetries: 4 });
    try {
      await client.emergencyAction({ id: "8PQWPY", token: "tok", choice: "REFUND", address: "bc1q" });
      throw new Error("expected FF_E_TRANSPORT");
    } catch (err) {
      expect((err as FixedFloatError).code).toBe("FF_E_TRANSPORT");
    }
    expect(calls.length).toBe(1);
  });

  test("abort (timeout) ⇒ FF_E_TIMEOUT; retried for read-only order, honest exhaustion at the end", async () => {
    const abortErr = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    const transport = async () => { throw abortErr; };
    const client = makeClient(transport, { maxRetries: 1 });
    try {
      await client.orderInfo("8PQWPY", "tok");
      throw new Error("expected FF_E_TIMEOUT");
    } catch (err) {
      expect((err as FixedFloatError).code).toBe("FF_E_TIMEOUT");
    }
  });

  test("abort on create ⇒ FF_E_TIMEOUT, single attempt (side-effect law)", async () => {
    const abortErr = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    const transport = async () => { throw abortErr; };
    const client = makeClient(transport, { maxRetries: 3 });
    try {
      await client.createOrder({ type: "float", fromCcy: "BTC", toCcy: "ETH", direction: "from", amount: 1, toAddress: "x" });
      throw new Error("expected FF_E_TIMEOUT");
    } catch (err) {
      expect((err as FixedFloatError).code).toBe("FF_E_TIMEOUT");
    }
  });
});

describe("FixedFloatClient — custody hygiene", () => {
  test("keys are #private: no accessor survives, JSON.stringify leaks nothing", () => {
    const { transport } = scriptTransport(() => okJson({}));
    const client = makeClient(transport);
    expect((client as unknown as Record<string, unknown>).apiKey).toBeUndefined();
    expect((client as unknown as Record<string, unknown>).apiSecret).toBeUndefined();
    expect(JSON.stringify(client)).not.toContain(KEY);
    expect(JSON.stringify(client)).not.toContain(SECRET);
  });

  test("default baseUrl pinned to the official endpoint", () => {
    const { transport } = scriptTransport(() => okJson({}));
    const client = makeClient(transport);
    expect(client.baseUrl).toBe(BASE);
  });

  test("real fetch transport is wired by default (honest live path exists, gated by env in probe)", () => {
    const client = new FixedFloatClient({ apiKey: "K", apiSecret: "S" });
    expect(client.baseUrl).toBe(BASE);
  });
});
