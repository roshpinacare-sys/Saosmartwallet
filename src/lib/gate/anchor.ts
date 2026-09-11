/**
 * THE ANCHOR PLANE (r20) — multi-rail vault sealing.
 *
 * Before r20 the vault anchored on steem only (r12 → r17 → r19, one chain).
 * A single-chain anchor is a single point of custody-verification: the whole
 * D1 unification (11/11 steem accounts on the P5 roots, hive/blurt on the
 * same roots) deserves redundant, chain-independent notarization. This plane:
 *
 *   · vaultDigestV2()     — a deterministic, versioned digest over the vault's
 *                           live custody plane (every verified key row);
 *   · sealBlurtD1Plane()  — the vault had ZERO blurt rows (the blurt authorities
 *                           were proven live in r12 but never sealed). Derive
 *                           D1 per account/role, prove against the chain, seal;
 *   · sealAnchorRound()   — one digest, broadcast to EVERY rail (steem+hive+
 *                           blurt), signed by headcorner@posting per rail,
 *                           synchronous-first (the r17/r19 lesson: async
 *                           anchors die silently), chain-verified after.
 *
 * Fail-closed everywhere: a key that is not the chain's current authority
 * never signs; a rail that refuses records its refusal honestly; nothing
 * private ever leaves the vault (AES-GCM) — the anchor carries PUBLIC state
 * only (counts + public keys + digest).
 */
import { createHash } from "crypto";
import bs58 from "bs58";
import { db } from "@/lib/db";
import { masterReady, openSecret, sealSecret } from "@/lib/gate/crypto";
import { privHexToWif, deriveRolePrivHex } from "@/lib/gate/rotation";
import { wifToChainPub } from "@/lib/gate/key-id";
import { toSigningKey } from "@/lib/gate/harness/orders";
import { steemBroadcastAdapter } from "@/lib/steem-server";
import {
  blurtBroadcastAdapter,
  hiveBroadcastAdapter,
  RAIL_ENDPOINTS,
  verifyPostingKeyOnChain,
  type Rail,
} from "@/lib/social/rails-server";
import { SteemAdapter } from "../../../packages/chains/steem/src/adapter";
import type { PrivateKey } from "../../../packages/crypto/src/index";

export const ANCHOR_ID = "saos.vault.anchor.v1";
export const ANCHOR_ACCOUNT = "headcorner";
const ANCHOR_RAILS: Rail[] = ["steem", "hive", "blurt"];
const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");

export interface AnchorRecord {
  chain: string;
  txId: string;
  blockNum: number | null;
  at: string;
  signedBy: string;
  round: string | null;
}

export interface RailAnchorOutcome {
  rail: Rail;
  ok: boolean;
  txId: string | null;
  blockNum: number | null;
  digest: string | null;
  onChain: boolean;
  digestMatch: boolean | null;
  mode?: string;
  error?: string;
}

/** r20 — deterministic digest over the vault's live custody plane (formula
 *  saos/v2, versioned inside every anchor payload so the formula itself is
 *  anchored). Covers every verified graphene key row across all rails. */
export async function vaultDigestV2(): Promise<{ digest: string; counts: Record<string, number>; rowCount: number }> {
  const rows = await db.vaultEntry.findMany({
    where: { kind: "steem-key", status: "verified" },
    select: { chain: true, account: true, role: true, pub: true },
  });
  const norm = rows.map((r) => `${r.chain}/${r.account}/${r.role}/${r.pub}`).sort();
  const counts = {
    vaultTotal: await db.vaultEntry.count(),
    vaultVerified: await db.vaultEntry.count({ where: { status: "verified" } }),
    vaultImported: await db.vaultEntry.count({ where: { status: "imported" } }),
    vaultRotatedOut: await db.vaultEntry.count({ where: { status: "rotated-out" } }),
    keyRowsSteem: rows.filter((r) => r.chain === "steem").length,
    keyRowsHive: rows.filter((r) => r.chain === "hive").length,
    keyRowsBlurt: rows.filter((r) => r.chain === "blurt").length,
  };
  const digest = sha256hex(JSON.stringify({ protocol: "saos/v2", counts, rows: norm }));
  return { digest, counts, rowCount: norm.length };
}

/** The vault POSTING key of the anchor signer on a rail. Prefer the rail's own
 *  row; fall back to the unified D1 derivation from the sealed P5 (r19 doctrine:
 *  one root per account across all rails). The fail-closed oracle is the chain. */
export async function anchorPostingKey(rail: Rail): Promise<{ wif: string; priv: PrivateKey; source: string }> {
  // verified rows ONLY — a legacy/unverified row may share the same updatedAt
  // timestamp (bulk relabels touch updatedAt) and must never win the pick
  // (live-found 2026-09-10: the r20 anchor first grabbed an unverified הדקור
  // legacy row and the chain itself refused it — fail-closed worked).
  const row = await db.vaultEntry.findFirst({
    where: { kind: "steem-key", chain: rail, account: ANCHOR_ACCOUNT, role: "posting", status: "verified" },
    orderBy: { updatedAt: "desc" },
  });
  if (row) {
    const wif = openSecret(row as never);
    return { wif, priv: toSigningKey(wif), source: "vault-row" };
  }
  const p5row = await db.vaultEntry.findFirst({
    where: { kind: "note", role: "master-password", account: ANCHOR_ACCOUNT },
  });
  if (!p5row) throw new Error(`no posting key available for the anchor on ${rail} (no rail row and no P5 root)`);
  const wif = privHexToWif(deriveRolePrivHex(ANCHOR_ACCOUNT, "posting", openSecret(p5row as never)));
  return { wif, priv: toSigningKey(wif), source: "d1-derivation(P5)" };
}

async function assertPostingAuthority(rail: Rail, priv: PrivateKey): Promise<void> {
  const proof = await verifyPostingKeyOnChain(rail, ANCHOR_ACCOUNT, { pub33: priv.publicKey.bytes });
  if (!proof.match) {
    throw new Error(`the vault key is not the current posting authority of ${ANCHOR_ACCOUNT}@${rail} (chain: ${proof.chainPub ?? "—"}) — fail-closed`);
  }
}

function railBroadcastAdapter(rail: Rail): SteemAdapter {
  return rail === "hive" ? hiveBroadcastAdapter() : rail === "blurt" ? blurtBroadcastAdapter() : steemBroadcastAdapter();
}

async function railRpc<T = unknown>(rail: Rail, method: string, params: unknown[]): Promise<T> {
  let last = "";
  for (const url of RAIL_ENDPOINTS[rail]) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(20_000),
      });
      const j = (await res.json()) as { error?: { message: string }; result?: T };
      if (j?.error) { last = j.error.message; continue; }
      return j.result as T;
    } catch (e) { last = (e as Error).message; }
  }
  throw new Error(`${rail}:${method} — ${last}`);
}

/** Synchronous-first broadcast (r17/r19 lesson: async anchors die silently).
 *  Fallback: async broadcast through the rail adapter, then the chain itself
 *  is polled for the anchor (txId discovered from get_transaction by wire id
 *  is not guaranteed on async — the caller records honestly whatever held). */
async function broadcastAnchorTx(rail: Rail, adapter: SteemAdapter, signed: {
  operations: Array<{ type: string; payload: Record<string, unknown> }>;
  signatures: string[];
  metadata?: Record<string, unknown>;
}): Promise<{ txId: string; blockNum: number | null; mode: "sync" | "async" }> {
  const meta = (signed.metadata ?? {}) as { refBlockNum: number; refBlockPrefix: number; expiration: number };
  const toCompactIso = (t: number) => new Date(t * 1000).toISOString().replace(/[-:]/g, "").slice(0, 15);
  const txJson = {
    ref_block_num: meta.refBlockNum,
    ref_block_prefix: meta.refBlockPrefix,
    expiration: toCompactIso(meta.expiration),
    operations: signed.operations.map((o) => [o.type, o.payload]),
    extensions: [] as string[],
    signatures: signed.signatures,
  };
  for (const url of RAIL_ENDPOINTS[rail]) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "condenser_api.broadcast_transaction_synchronous", params: [txJson] }),
        signal: AbortSignal.timeout(25_000),
      });
      const j = (await res.json()) as { error?: { message: string }; result?: { id?: string; block_num?: number } };
      if (j?.error) continue;
      return { txId: String(j?.result?.id ?? ""), blockNum: j?.result?.block_num ?? null, mode: "sync" };
    } catch { /* next endpoint */ }
  }
  const res = await adapter.broadcast(signed as never);
  return { txId: res.txId || "", blockNum: res.blockNum ?? null, mode: "async" };
}

/** Chain-truth for an anchor: get_transaction first, then a get_block scan
 *  fallback (steemit's get_transaction index can lag/assert for fresh txs —
 *  live-observed r20; the block itself is the primary truth anyway). */
export async function verifyAnchorOnChain(
  rail: Rail,
  txId: string,
  expectDigest?: string,
  knownBlock?: number | null,
): Promise<{ onChain: boolean; blockNum: number | null; digest: string | null; digestMatch: boolean | null }> {
  const scanBlock = async (blockNum: number): Promise<{ onChain: boolean; digest: string | null } | null> => {
    try {
      const b = await railRpc<{ transactions?: Array<{ operations?: Array<unknown>; transaction_id?: string }> }>(rail, "condenser_api.get_block", [blockNum]);
      for (const tx of b?.transactions ?? []) {
        if (tx.transaction_id && tx.transaction_id !== txId) continue;
        for (const op of tx.operations ?? []) {
          const [name, rawBody] = Array.isArray(op) ? (op as [string, unknown]) : [ (op as { name?: string })?.name, (op as { body?: unknown })?.body ];
          if (String(name) === "custom_json") {
            const body = rawBody as { id?: string; json?: string } | undefined;
            if (body?.id === ANCHOR_ID) {
              let digest: string | null = null;
              try { digest = String(JSON.parse(String(body.json))?.digest ?? "") || null; } catch { /* keep null */ }
              return { onChain: true, digest };
            }
          }
        }
      }
      return null;
    } catch { return null; }
  };
  const fromOp = (body: { id?: string; json?: string } | undefined, blockNum: number | null) => {
    let digest: string | null = null;
    try { digest = String(JSON.parse(String(body?.json))?.digest ?? "") || null; } catch { /* keep null */ }
    return { onChain: true, blockNum, digest, digestMatch: expectDigest ? digest === expectDigest : null };
  };
  // 1) the direct transaction read
  try {
    const tx = await railRpc<Record<string, unknown>>(rail, "condenser_api.get_transaction", [txId]);
    const ops = (tx?.operations ?? []) as Array<unknown>;
    for (const op of ops) {
      const [name, body] = Array.isArray(op) ? op : [ (op as { name?: string })?.name, (op as { body?: unknown })?.body ];
      if (String(name) === "custom_json") {
        const b = body as { id?: string; json?: string } | undefined;
        if (b?.id === ANCHOR_ID) return fromOp(b, Number(tx?.block_num ?? 0) || null);
      }
    }
  } catch { /* fall through to the block scan */ }
  // 2) the block scan (known block first, then ±2 for reindex drift)
  if (knownBlock) {
    for (const bn of [knownBlock, knownBlock + 1, knownBlock - 1]) {
      const hit = await scanBlock(bn);
      if (hit) return { onChain: true, blockNum: bn, digest: hit.digest, digestMatch: expectDigest ? hit.digest === expectDigest : null };
    }
    return { onChain: false, blockNum: knownBlock, digest: null, digestMatch: null };
  }
  return { onChain: false, blockNum: null, digest: null, digestMatch: null };
}

/** Latest successful anchor per rail from the audit trail (gateAction). */
export async function readAnchorHistory(): Promise<AnchorRecord[]> {
  const acts = await db.gateAction.findMany({
    where: { action: { startsWith: "vault-anchor" }, ok: true },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  const byChain = new Map<string, AnchorRecord>();
  for (const a of acts) {
    let r: Record<string, unknown> = {};
    try { r = JSON.parse(a.result || "{}") as Record<string, unknown>; } catch { /* skip */ }
    const chain = String(r.chain ?? "steem");
    if (!byChain.has(chain) && r.txId) {
      byChain.set(chain, {
        chain,
        txId: String(r.txId),
        blockNum: (r.blockNum as number | null) ?? null,
        at: a.createdAt.toISOString(),
        signedBy: String(r.signedBy ?? ""),
        round: (r.round as string | null) ?? null,
      });
    }
  }
  return [...byChain.values()];
}

/** Build the unsigned anchor tx on a rail's own adapter (ref-block from the
 *  rail we broadcast to — the same rule the sovereign-voice lane follows). */
async function buildAnchorUnsigned(rail: Rail, payloadJson: string) {
  const payload = {
    required_auths: [] as string[],
    required_posting_auths: [ANCHOR_ACCOUNT],
    id: ANCHOR_ID,
    json: payloadJson,
  };
  return railBroadcastAdapter(rail).buildOperations([{ type: "custom_json", payload: payload as unknown as Record<string, unknown> }]);
}

/** ONE digest, EVERY rail. Per-rail fail-closed: the chain's refusal is a
 *  recorded outcome, never a silent skip. */
export async function sealAnchorRound(round: string, agentName = "operator-delegated"): Promise<{ digest: string; counts: Record<string, number>; rowCount: number; rails: RailAnchorOutcome[] }> {
  if (!masterReady()) throw new Error("הכספת נעולה — איטום-עוגן דורש פתיחה (fail-closed)");
  const { digest, counts, rowCount } = await vaultDigestV2();
  const prior = await readAnchorHistory();
  const payload = {
    protocol: "saos/v1",
    action: "vault-seal",
    at: new Date().toISOString(),
    round,
    digest,
    counts,
    rows: rowCount,
    prior: Object.fromEntries(prior.map((p) => [p.chain, `${p.txId.slice(0, 12)}…`])),
    note: `איטום ${round}: הצי מאוחד על שורשי-D1 (steem 11/11 · hive/blurt מאז-r12); נוסחת-הדיגסט saos/v2 חתומה בתוך העוגן עצמו; עוגן רב-מסילתי = רדונדנציית-עוגנים`,
  };
  const payloadJson = JSON.stringify(payload);
  if (payloadJson.length > 8192) throw new Error("anchor payload exceeds 8192 bytes");

  const rails: RailAnchorOutcome[] = [];
  for (const rail of ANCHOR_RAILS) {
    try {
      // r20 — RC pre-check for hive (the chain economics refused a perfectly
      // signed anchor: headcorner 209.9M RC vs 386.5M needed — measured live).
      // Fail fast with the honest economic answer instead of a doomed broadcast.
      if (rail === "hive") {
        try {
          const rc = await railRpc<{ result?: Array<{ rc_manabar?: { current_mana?: string } }> }>("hive", "condenser_api.find_rc_accounts", [[{ accounts: [ANCHOR_ACCOUNT] }]]);
          const mana = Number(rc?.result?.[0]?.rc_manabar?.current_mana ?? 0);
          if (mana > 0 && mana < 450_000_000) {
            throw new Error(`RC כלכלי — ל-${ANCHOR_ACCOUNT}@hive יש ${Math.round(mana / 1e6)}M RC מול ~387M שנדרשו ל-op (מדוד-חי r20); נדרשת הזרמת HP כדי לפתוח את המסילה`);
          }
        } catch (e) {
          if (String((e as Error).message).includes("RC כלכלי")) throw e;
          // the pre-check itself failed (node flake) — proceed, the chain remains the oracle
        }
      }
      const { priv, source } = await anchorPostingKey(rail);
      await assertPostingAuthority(rail, priv);
      const adapter = railBroadcastAdapter(rail);
      const unsigned = await buildAnchorUnsigned(rail, payloadJson);
      const signed = await adapter.sign(unsigned, { byRole: { posting: priv } }, ["posting"]);
      const { txId, blockNum, mode } = await broadcastAnchorTx(rail, adapter, signed);
      let v = { onChain: false, blockNum: null as number | null, digest: null as string | null, digestMatch: null as boolean | null };
      if (txId) {
        for (let i = 0; i < 4 && !v.onChain; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          v = await verifyAnchorOnChain(rail, txId, digest, blockNum);
        }
      }
      rails.push({ rail, ok: true, txId, blockNum: v.blockNum ?? blockNum, digest, onChain: v.onChain, digestMatch: v.digestMatch, mode: `${source}·${mode}` });
      await db.gateAction.create({
        data: {
          agentName,
          action: "vault-anchor:saos.vault.anchor.v1",
          params: payloadJson.slice(0, 8000),
          ok: true,
          result: JSON.stringify({ chain: rail, txId, blockNum: v.blockNum ?? blockNum, signedBy: `${ANCHOR_ACCOUNT}@posting`, round, prior: payload.prior, mode: `${source}·${mode}`, onChain: v.onChain, digestMatch: v.digestMatch }),
        },
      });
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 240);
      rails.push({ rail, ok: false, txId: null, blockNum: null, digest, onChain: false, digestMatch: null, error: msg });
      await db.gateAction.create({
        data: { agentName, action: "vault-anchor:failed", params: JSON.stringify({ rail, round }), ok: false, result: JSON.stringify({ error: msg }) },
      }).catch(() => {});
    }
  }
  const line = rails
    .map((r) => `${r.rail}=${r.ok ? (r.onChain ? `עוגן-חי ${String(r.txId).slice(0, 10)}… blk ${r.blockNum ?? "?"}` : `שודר ${String(r.txId).slice(0, 10)}… (טרם-נצפה)`) : `נכשל כנה: ${String(r.error).slice(0, 60)}`}`)
    .join(" · ");
  await db.gateMessage.create({
    data: { channel: "command", fromKind: "system", fromName: "anchor-plane", body: `⚓ איטום ${round} · digest ${digest.slice(0, 12)}… · ${line}`.slice(0, 980) },
  }).catch(() => {});
  return { digest, counts, rowCount, rails };
}

// ---------------------------------------------------------------------------
// r20 — the blurt plane enters the vault. The 48 blurt authorities were proven
// live in r12 but never sealed (chain="blurt" had zero rows) — the vault was
// blind to one of its three rails. Derive D1, prove against the chain, seal.
// ---------------------------------------------------------------------------

const FLEET_ACCOUNTS = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq", "ynet", "headcorner"];
const KEY_ROLES = ["owner", "active", "posting", "memo"] as const;

function wireRaw(w: string): string | null {
  const m = /^(STM|HIVE|BLT|TST)([1-9A-HJ-NP-Za-km-z]+)$/.exec(w);
  if (!m) return null;
  try { return Buffer.from(bs58.decode(m[2])).subarray(0, 33).toString("hex"); } catch { return null; }
}

export interface SealPlaneResult {
  sealed: number;
  already: number;
  refused: number;
  details: string[];
}

export async function sealBlurtD1Plane(): Promise<SealPlaneResult> {
  if (!masterReady()) throw new Error("הכספת נעולה — איטום מסילת-blurt דורש פתיחה (fail-closed)");
  const lives = await railRpc<Array<Record<string, never>>>("blurt", "condenser_api.get_accounts", [FLEET_ACCOUNTS]);
  const liveBy = new Map<string, Record<string, never>>();
  for (const a of lives ?? []) liveBy.set(String((a as { name?: string }).name), a);

  const p5rows = await db.vaultEntry.findMany({ where: { kind: "note", role: "master-password" } });
  const p5By = new Map(p5rows.map((r) => [r.account, r]));

  let sealed = 0, already = 0, refused = 0;
  const details: string[] = [];
  for (const acct of FLEET_ACCOUNTS) {
    const a = liveBy.get(acct);
    const p5row = p5By.get(acct);
    if (!a || !p5row) { refused++; details.push(`${acct}: ${!a ? "אין-חשבון-על-השרשרת" : "אין-P5-נאטם"} — כנות, דילוג`); continue; }
    const p5 = openSecret(p5row as never);
    for (const role of KEY_ROLES) {
      const liveRaws = role === "memo"
        ? [wireRaw(String((a as unknown as { memo_key?: string }).memo_key ?? ""))].filter(Boolean)
        : (((a as unknown as Record<string, { key_auths?: Array<[string]> }>)[role]?.key_auths ?? []) as Array<[string]>).map((k) => wireRaw(String(k[0]))).filter(Boolean);
      const privHex = deriveRolePrivHex(acct, role, p5);
      const wif = privHexToWif(privHex);
      const pub = wifToChainPub(wif).replace(/^STM/, "BLT");
      const raw = wireRaw(pub);
      if (!raw || !liveRaws.includes(raw)) {
        refused++;
        details.push(`${acct}@${role}: הגזירה אינה הסמכות-החיה (fail-closed)`);
        continue;
      }
      const exists = await db.vaultEntry.findFirst({ where: { kind: "steem-key", chain: "blurt", account: acct, role, pub } });
      if (exists) { already++; continue; }
      await db.vaultEntry.create({
        data: {
          kind: "steem-key", chain: "blurt", account: acct, role, pub, ...sealSecret(wif),
          status: "verified", verifiedAt: new Date(),
          source: "r20: גזירת-D1 (SHA256(חשבון+תפקיד+P5)) — הוכחה-חי מול הסמכות על blurt באותה-קריאה",
          verifyNote: `r20 2026-09-10: מפתח-D1 של ${acct}@blurt — השרשרת עצמה אישרה שהחומר הנאטם הוא הסמכות-החיה של ה-${role}`,
        },
      });
      sealed++;
    }
  }
  return { sealed, already, refused, details: details.slice(0, 20) };
}
