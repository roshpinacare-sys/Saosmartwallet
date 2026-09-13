/**
 * SOVEREIGN GATE — agent harness · brain (המוח).
 *
 * Harness-engineering principle ("What a harness actually is"):
 * the harness doesn't make the model smarter — it wraps the model in a
 * closed-loop system. The brain is the ONLY component allowed to think;
 * everything else (modules, trace, checker) constrains and verifies it.
 *
 * Two real providers, both live-verified:
 *  · nvidia — NVIDIA NIM (integrate.api.nvidia.com, OpenAI-compatible).
 *    The key never sits in code or repo: it is read from the vault
 *    (VaultEntry chain="nvidia"), lazily sealed from env on first use.
 *  · zai — z-ai-web-dev-sdk chat completions (backend-only SDK).
 *
 * Generator/evaluator separation: the caller MUST pick a different brain
 * for the checker than for the maker (see loop.ts) — "someone in your
 * crew must not believe you."
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { sealSecret, openSecret, masterReady, GateError } from "@/lib/gate/crypto";

export interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface BrainSpec {
  provider: "nvidia" | "zai";
  model: string;
}

/** Parse "provider:model" — defaults keep every run functional. */
export function parseBrain(spec: string | null | undefined): BrainSpec {
  const s = String(spec || "").trim();
  const m = s.match(/^(nvidia|zai):(.+)$/);
  if (m) return { provider: m[1] as BrainSpec["provider"], model: m[2] };
  return { provider: "zai", model: "default" };
}

/** Brains offered to the operator in the armory. Checker suggestions differ from maker defaults. */
export const BRAIN_CATALOG = {
  maker: ["nvidia:openai/gpt-oss-20b", "nvidia:deepseek-ai/deepseek-v4-flash-0731", "zai:default"],
  checker: ["zai:default", "nvidia:openai/gpt-oss-20b", "nvidia:deepseek-ai/deepseek-v4-flash-0731"],
} as const;

/* ── NVIDIA key from the vault (never plaintext in repo) ── */

const NV_ENTRY = { chain: "nvidia", kind: "token", account: "nvidia-nim" };

/**
 * Read the NIM key. Order (r27 efficiency plane):
 *  1. vault open  → decrypt the sealed entry (existing flow).
 *  2. vault sealed + runtime env key → use the env key READ-ONLY (never sealed,
 *     never written to git/disk). The sealed entry stays sealed — sovereignty
 *     untouched. Previously this case silently fell through to the weak brain
 *     (zai 34.5% success vs nvidia 91.5% measured live r27) and burned run
 *     budget on failures during every locked window.
 *  3. vault sealed + no env key → honest vault-locked (caller falls back to zai).
 *  4. no vault entry + env key → seal it on first use (existing flow, requires
 *     an open vault — which is exactly when sealing is possible).
 */
/* ── r30: the NIM POOL (owner mandate: "בהמשך אני אשלח לך עוד מפתחות") ──
 * The vault may hold ANY number of verified NIM tokens (chain="nvidia",
 * kind="token") — keys-batch (r28-distinct-slots) already seals each into its
 * own row. The pool is read fresh per call, deduped by fingerprint, and the
 * fetch loop rotates across it: a 429 cools ONE key for a bounded window and
 * the next attempt rides a DIFFERENT key instead of sleeping a dead window.
 * Honesty fix measured live r30: the r28 doc claimed "pool=4" but the vault
 * holds exactly ONE NIM row — this code makes the pool REAL and ready the
 * moment the operator delivers more keys (zero code change needed to grow). */
const NV_KEY_COOLDOWN_MS = 60_000;
const nvPoolG = globalThis as unknown as { __nvCooldown?: Map<string, number>; __nvCursor?: number };
const nvFp = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 12);

async function nvidiaPool(): Promise<string[]> {
  const envKey = process.env.NVIDIA_API_KEY?.trim();
  const rows = await db.vaultEntry.findMany({
    where: { chain: "nvidia", kind: "token", status: "verified" },
    orderBy: { createdAt: "asc" },
  });
  if (rows.length) {
    if (!masterReady()) {
      // r27 semantics preserved: sealed keys stay sealed when locked; the env
      // key (if any) serves READ-ONLY, never cached, never written.
      if (envKey) return [envKey];
      throw new GateError("vault-locked", "הכספת נעולה ואין מפתח-סביבה — המוח-NIM לא זמין בכנות");
    }
    const pool: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const key = openSecret({ encPriv: row.encPriv, privIv: row.privIv, privTag: row.privTag });
      const fp = nvFp(key);
      if (!seen.has(fp)) { seen.add(fp); pool.push(key); }
    }
    if (envKey && !seen.has(nvFp(envKey))) pool.push(envKey);
    return pool;
  }
  if (!envKey) throw new GateError("no-brain-key", "אין מפתח NVIDIA בכספת ובסביבה — המוח לא זמין");
  await db.vaultEntry.create({
    data: {
      ...NV_ENTRY,
      role: "infrastructure",
      pub: null,
      ...sealSecret(envKey),
      status: "verified",
      verifyNote: "NIM key sealed on first harness use; response-verified live",
      source: "operator-input",
      verifiedAt: new Date(),
    },
  });
  return [envKey];
}

/** Round-robin pick that skips keys in 429-cooldown. When EVERY key is
 *  cooling it still advances (the ladder below keeps the pacing honest). */
function nvPick(pool: string[]): number {
  const cd = (nvPoolG.__nvCooldown ??= new Map<string, number>());
  const now = Date.now();
  const cursor = nvPoolG.__nvCursor ?? 0;
  for (let i = 0; i < pool.length; i++) {
    const idx = (cursor + i) % pool.length;
    if ((cd.get(nvFp(pool[idx])) ?? 0) <= now) { nvPoolG.__nvCursor = idx + 1; return idx; }
  }
  nvPoolG.__nvCursor = cursor + 1;
  return cursor % pool.length;
}

export interface BrainReply {
  content: string;
  usage?: { prompt: number; completion: number };
  model: string;
}

/* ── r18: in-process brain spacing ──
 * One real provider serves N parallel runs (maker + checker + idle missions
 * fire together). Proven live (r7/r18 forensics): 17 of 69 non-done runs died
 * to sustained 429 windows that co-firing amplifies. Serialize brain calls
 * through a chained queue and keep a minimum gap — bounded, so a run never
 * starves (a stale last-call timestamp is ignored, not waited on). */
const brainG = globalThis as unknown as { __brainLastCall?: number; __brainChain?: Promise<unknown> };
const MIN_BRAIN_GAP_MS = 1200;

async function brainGate<T>(fn: () => Promise<T>): Promise<T> {
  const slot = (brainG.__brainChain ?? Promise.resolve()).then(async () => {
    const last = brainG.__brainLastCall ?? 0;
    const wait = last + MIN_BRAIN_GAP_MS - Date.now();
    if (wait > 0 && wait < 6000) await new Promise((r) => setTimeout(r, wait));
    brainG.__brainLastCall = Date.now();
  });
  brainG.__brainChain = slot.catch(() => {});
  await slot;
  return fn();
}

/* Bounded backoff ladder with jitter. r7 used 6s/15s and STILL died inside a
 * sustained rate window; r18 forensics counted 17 explicit 429 deaths. A 4th
 * attempt at 35s rides out windows that outlive 21s, and ±0.8s jitter stops
 * co-firing runs from re-synchronizing their retries into the same window. */
const BRAIN_LADDER_MS = [6_000, 15_000, 35_000];
const jitter = (ms: number) => Math.max(1_000, ms + Math.floor(Math.random() * 1_600) - 800);

/* ── r47: zai gateway 401 resilience (measured live) ──
 * The gateway rejects with 401 {"error":"missing X-Token header"} when the
 * request carries no X-Token. The SDK omits that header whenever the config
 * it loaded (project → home → /etc, read fresh on EVERY ZAI.create()) lacks
 * the `token` field — and r47 measured failure BURSTS (6 consecutive idle
 * runs in 20 minutes, all 401) followed by recovery, consistent with the
 * platform rewriting the config in token-less windows. Fix, three layers:
 *   1. memory-only snapshot of the last seen-good token (never logged,
 *      never persisted — the SDK itself already holds it in memory);
 *   2. on a 401/X-Token failure: ONE direct retry injecting
 *      config.token || snapshot (same request shape as the SDK);
 *   3. if that still fails: brainChat fails over to the nvidia brain
 *      (open vault or env key) instead of killing the run — and if nvidia is
 *      also unreachable the ORIGINAL zai error is rethrown (honest record). */
let zaiTokenSnapshot: string | null = null;

async function readZaiConfig(): Promise<Record<string, string> | null> {
  const candidates = [
    path.join(process.cwd(), ".z-ai-config"),
    path.join(os.homedir(), ".z-ai-config"),
    "/etc/.z-ai-config",
  ];
  for (const p of candidates) {
    try {
      const parsed = JSON.parse(await readFile(p, "utf8")) as Record<string, string>;
      if (parsed.baseUrl && parsed.apiKey) return parsed;
    } catch {
      /* missing/invalid — try the next candidate (same order as the SDK) */
    }
  }
  return null;
}

/** Direct gateway call mirroring the SDK's exact request shape, with a token
 * we control (config.token || snapshot). Success upgrades the snapshot. */
async function zaiDirectCall(mapped: Array<{ role: string; content: string }>): Promise<BrainReply> {
  const cfg = await readZaiConfig();
  if (!cfg) throw new Error("zai direct retry: no config found");
  const token = cfg.token || zaiTokenSnapshot;
  if (!token) throw new Error("zai direct retry: no X-Token in config and no snapshot");
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
      "X-Z-AI-From": "Z",
      ...(cfg.chatId ? { "X-Chat-Id": cfg.chatId } : {}),
      ...(cfg.userId ? { "X-User-Id": cfg.userId } : {}),
      "X-Token": token,
    },
    body: JSON.stringify({ messages: mapped, thinking: { type: "disabled" } }),
    signal: AbortSignal.timeout(90_000),
  });
  const txt = await res.text();
  if (!res.ok) {
    // never log the token — status + short gateway body only
    throw new Error(`API request failed with status ${res.status}: ${txt.slice(0, 140)}`);
  }
  const j = JSON.parse(txt) as { choices?: { message?: { content?: string } }[] };
  zaiTokenSnapshot = token; // proven good — remember for token-less windows
  return { content: j.choices?.[0]?.message?.content ?? "", model: "zai" };
}

async function zaiChat(messages: ChatMsg[], opts: { maxTokens: number; temperature: number }): Promise<BrainReply> {
  void opts; // the SDK path sends shape-only bodies; kept for signature parity
  const { default: ZAI } = await import("z-ai-web-dev-sdk");
  // z-ai chat contract: system instructions ride on the "assistant" role.
  const mapped = messages.map((m) => ({
    role: m.role === "system" ? "assistant" : m.role,
    content: m.content,
  }));
  // refresh the memory snapshot before flying (cheap local read)
  try {
    const cfgNow = await readZaiConfig();
    if (cfgNow?.token) zaiTokenSnapshot = cfgNow.token;
  } catch { /* snapshot stays as-is */ }
  let zaiLastErr: unknown = null;
  for (let attempt = 0; attempt < BRAIN_LADDER_MS.length + 1; attempt++) {
    try {
      const zai = await ZAI.create();
      const completion = await zai.chat.completions.create({
        messages: mapped as Parameters<typeof zai.chat.completions.create>[0]["messages"],
        thinking: { type: "disabled" },
      });
      const content = completion.choices[0]?.message?.content ?? "";
      return { content, model: "zai" };
    } catch (e) {
      zaiLastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (/401|X-Token/i.test(msg)) {
        // gateway rejected the request for a missing token — one direct retry
        // injecting config.token || snapshot (layer 2)
        try {
          return await zaiDirectCall(mapped);
        } catch (e2) {
          zaiLastErr = e2;
          const m2 = e2 instanceof Error ? e2.message : String(e2);
          const transient2 = /(?:^|\D)(?:429|5\d\d)(?:\D|$)|rate.?limit|too many requests|timeout|ECONN|ETIMEDOUT|EAI_AGAIN/i.test(m2);
          if (!transient2) break;
          if (attempt < BRAIN_LADDER_MS.length) await new Promise((r) => setTimeout(r, jitter(BRAIN_LADDER_MS[attempt])));
          continue;
        }
      }
      const transient = /(?:^|\D)(?:429|5\d\d)(?:\D|$)|rate.?limit|too many requests|timeout|ECONN|ETIMEDOUT|EAI_AGAIN/i.test(msg);
      if (!transient) break;
      if (attempt < BRAIN_LADDER_MS.length) await new Promise((r) => setTimeout(r, jitter(BRAIN_LADDER_MS[attempt])));
    }
  }
  throw zaiLastErr instanceof Error ? zaiLastErr : new GateError("brain-failed", "המוח (ZAI) לא הגיב");
}

/** One chat turn against the chosen brain. Retries on transient provider errors. */
export async function brainChat(
  spec: BrainSpec,
  messages: ChatMsg[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<BrainReply> {
  const maxTokens = opts.maxTokens ?? 700;
  const temperature = opts.temperature ?? 0.2;

  if (spec.provider === "nvidia") {
    let pool: string[];
    try {
      pool = await nvidiaPool();
    } catch (e) {
      // r18 — vault locked (no operator session): the NIM key stays sealed in
      // the vault (sovereignty untouched — nothing is decrypted or cached),
      // but autonomous employment must not die for it. Honest fallback to the
      // zai brain; the reply's model string records exactly what happened.
      if (e instanceof GateError && e.code === "vault-locked") {
        const r = await brainGate(() => zaiChat(messages, { maxTokens, temperature }));
        return { ...r, model: "zai (nvidia-fallback:vault-locked)" };
      }
      throw e;
    }
    let lastErr: unknown = null;
    const cd = (nvPoolG.__nvCooldown ??= new Map<string, number>());
    for (let attempt = 0; attempt < BRAIN_LADDER_MS.length + 1; attempt++) {
      const idx = nvPick(pool);
      const key = pool[idx];
      const fp = nvFp(key);
      try {
        return await brainGate(async () => {
          const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: spec.model, messages, max_tokens: maxTokens, temperature }),
            signal: AbortSignal.timeout(90_000),
          });
          const txt = await res.text();
          if (!res.ok) {
            lastErr = new GateError("brain-http", `NIM ${res.status}: ${txt.slice(0, 180)}`);
            throw lastErr; // the catch below classifies transient (429/5xx) vs fatal
          }
          const j = JSON.parse(txt) as {
            choices?: { message?: { content?: string } }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          const content = j.choices?.[0]?.message?.content ?? "";
          return {
            content,
            usage: { prompt: j.usage?.prompt_tokens ?? 0, completion: j.usage?.completion_tokens ?? 0 },
            model: spec.model,
          } satisfies BrainReply;
        });
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        const isRate = /(?:^|\D)429(?:\D|$)|rate.?limit|too many requests/i.test(msg);
        const transient = isRate || /(?:^|\D)5\d\d(?:\D|$)|timeout|ECONN|ETIMEDOUT|EAI_AGAIN/i.test(msg);
        if (!transient) break;
        if (isRate) cd.set(fp, Date.now() + NV_KEY_COOLDOWN_MS); // THIS key is throttled — rotate
        if (attempt < BRAIN_LADDER_MS.length) {
          // r30 — a fresh pool key beats sleeping inside a dead rate window;
          // rotate immediately only when ANOTHER key is actually available.
          const now = Date.now();
          const freshExists = pool.some((k, i) => i !== idx && (cd.get(nvFp(k)) ?? 0) <= now);
          if (isRate && freshExists) continue;
          await new Promise((r) => setTimeout(r, jitter(BRAIN_LADDER_MS[attempt])));
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new GateError("brain-failed", "המוח (NVIDIA) לא הגיב");
  }

  try {
    return await brainGate(() => zaiChat(messages, { maxTokens, temperature }));
  } catch (e) {
    // r47 layer 3 — a zai gateway 401 burst must not kill autonomous runs
    // while a NIM key is reachable (open vault or env). Honest order: fail
    // over to nvidia; if nvidia is ALSO unavailable (vault-locked + no env
    // key) the ORIGINAL zai error is rethrown — the run fails on the record
    // with the real cause, never a masked one.
    const msg = e instanceof Error ? e.message : String(e);
    if (!/X-Token|status 401/i.test(msg)) throw e;
    try {
      const r = await brainChat({ provider: "nvidia", model: "openai/gpt-oss-20b" }, messages, opts);
      return { ...r, model: `${r.model} (zai-401-failover)` } satisfies BrainReply;
    } catch (nvErr) {
      if (nvErr instanceof GateError && nvErr.code === "vault-locked") throw e;
      throw nvErr;
    }
  }
}

/** The checker must NEVER share a brain with the maker (generator/evaluator separation). */
export function pickCheckerBrain(makerSpec: string): string {
  const maker = parseBrain(makerSpec);
  const options = BRAIN_CATALOG.checker.filter((c) => {
    const p = parseBrain(c);
    return !(p.provider === maker.provider && p.model === maker.model);
  });
  // Prefer a different provider first, else a different model on the same provider.
  return options.find((c) => parseBrain(c).provider !== maker.provider) ?? options[0] ?? "zai:default";
}
