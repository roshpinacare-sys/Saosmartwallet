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
import { db } from "@/lib/db";
import { sealSecret, openSecret, GateError } from "@/lib/gate/crypto";

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

/** Read the NIM key from the vault; on first use, seal it there from env. */
async function nvidiaKey(): Promise<string> {
  const row = await db.vaultEntry.findFirst({ where: NV_ENTRY });
  if (row) return openSecret({ encPriv: row.encPriv, privIv: row.privIv, privTag: row.privTag });
  const envKey = process.env.NVIDIA_API_KEY?.trim();
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
  return envKey;
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

/* zai provider — backend-only SDK. Extracted so the nvidia path can fall back
 * to it honestly when the vault is locked (no operator session open). */
async function zaiChat(messages: ChatMsg[], opts: { maxTokens: number; temperature: number }): Promise<BrainReply> {
  const { default: ZAI } = await import("z-ai-web-dev-sdk");
  // z-ai chat contract: system instructions ride on the "assistant" role.
  const mapped = messages.map((m) => ({
    role: m.role === "system" ? ("assistant" as const) : m.role,
    content: m.content,
  }));
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
    let key: string;
    try {
      key = await nvidiaKey();
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
    for (let attempt = 0; attempt < BRAIN_LADDER_MS.length + 1; attempt++) {
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
        const transient = /(?:^|\D)(?:429|5\d\d)(?:\D|$)|rate.?limit|too many requests|timeout|ECONN|ETIMEDOUT|EAI_AGAIN/i.test(msg);
        if (!transient) break;
        if (attempt < BRAIN_LADDER_MS.length) await new Promise((r) => setTimeout(r, jitter(BRAIN_LADDER_MS[attempt])));
      }
    }
    throw lastErr instanceof Error ? lastErr : new GateError("brain-failed", "המוח (NVIDIA) לא הגיב");
  }

  return brainGate(() => zaiChat(messages, { maxTokens, temperature }));
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
