/**
 * SAOS SOVEREIGN VAULT — console types (r38).
 * כל הצורות כאן הן הצורות האמיתיות של ה-APIs ב-src/app/api/gate — אפס המצאה.
 * הועבר מ-page.tsx כמות-שהוא (r38 · סדר-הקונסולה).
 */

export interface GateStatus {
  ok: boolean; initialized: boolean; unlocked: boolean; hint: string | null;
  unlockedAt: string | null; keySeals: number;
  session: { kind: string; name: string; scopes: string[] } | null;
  counts: { vaultEntries: number; activeAgents: number; messages: number };
  // r18 — fleet employment health, live from /api/gate/status (aggregated 24h)
  employment?: {
    runs24h: number; done: number; blocked: number; failed: number; running: number;
    doneRate: number | null;
    blockedTaxonomy: { fair: number; vaultLocked: number; rate429: number; watchdog: number; other: number };
    idleRuns24h: number; agentsActive: number;
  } | null;
}
export interface Entry {
  id: string; kind: string; chain: string | null; account: string | null;
  role: string | null; pub: string | null; status: string;
  liveOk: boolean | null; chains: string[]; detail: string;
}
export interface Inventory {
  ok: boolean; locked: boolean; entries: Entry[];
  summary?: { total: number; verified: number; failed: number; rotatedOut?: number; noLive: number; rails: Record<string, number> };
  chains?: { steemOk: boolean; hiveOk: boolean; blurtOk: boolean; githubOk: boolean | null };
  // r13 gap-54 — the LIVE status of the steemauto door-closure proposal;
  // the custody banner's "awaiting operator" claim is computed from it,
  // never hardcoded (the old hardcoded "open" claim outlived its truth:
  // the r12 filing was auto-expired by policy and the page kept lying).
  steemautoProposal?: { status: string; decidedBy: string | null; createdAt: string; runId?: string | null; runStatus?: string | null } | null;
  // r20 — the multi-rail anchor plane, live-verified by the API
  anchors?: Array<{ chain: string; txId: string; blockNum: number | null; round: string | null; at: string; onChain: boolean; digest: string | null }> | null;
  // r16 — rotation plane readiness, computed live by the API (never stored)
  rotation?: { targets: Array<{ account: string; hasOwnerKey: boolean; hasP5Root: boolean; ready: boolean; rotated?: boolean }>; readyCount: number; rotatedCount?: number } | null;
}
export interface AgentRow {
  id: string; name: string; memo: string | null; active: boolean;
  createdAt: string; lastSeenAt: string;
  modules?: string[] | null; brain?: string | null; autonomy?: boolean;
  finTier?: string; finCaps?: Record<string, number> | null;
}
export interface ModuleDef { id: string; name: string; kind: "skill" | "connector" | "actor"; desc: string; args: string; needsVault: boolean }
export interface TraceStep { i: number; side: "maker" | "checker"; thought?: string; tool?: string; args?: Record<string, unknown>; ok?: boolean; result?: unknown; error?: string; ms?: number; cached?: boolean; rescued?: boolean; repair?: boolean; at: string }
export interface CheckerVerdict { done: boolean; checks: { criterion: string; pass: boolean; evidence: string }[]; gaps: string; notes: string }
export interface RunRow { id: string; agentName: string; goal: string; brain: string; checker: string; budget: number; status: string; createdAt: string; finishedAt: string | null; report?: string | null; makerSteps?: number; durationMs?: number | null; tokens?: string | null; origin?: string; attempt?: number; meta?: string | null }
// ROAST r4: RunDetail no longer extends RunRow blindly — the detail API parses
// `tokens` into an object while the list API ships the raw DB string, so the
// old interface-extension was a live type contradiction.
export interface RunDetail extends Omit<RunRow, "tokens"> {
  doneMeans: string[]; modules: string[];
  steps: TraceStep[]; verdict: CheckerVerdict | null; error?: string | null;
  lessons?: string[]; durationMs?: number | null; tokens?: { prompt: number; completion: number } | null;
}
export interface AgentStat { agent: string; runs: number; done: number; blocked: number; failed: number; avgSteps: number; avgMs: number | null }
export interface DeviceRow { id: string; label: string; createdAt: string; lastUsedAt: string; expiresAt: string; revoked: boolean; live: boolean; daysLeft: number; expiringSoon?: boolean }
export interface Msg { id: string; channel: string; fromKind: string; fromName: string; body: string; createdAt: string }
export interface ActionRow { id: string; agentName: string; action: string; params: string; ok: boolean; result: string; createdAt: string }
export interface ScheduleRow { id: string; label: string; agentName: string; goal: string; kind: string; everyMs: number | null; hourUtc: number | null; budget: number; maxPerDay: number; dayCount: number; dayKey: string | null; enabled: boolean; lastRunAt: string | null; nextRunAt: string }
export interface EventRow { id: string; type: string; payload: { agent?: string; body?: string; goal?: string; gaps?: string; by?: string } | null; source: string; consumed: boolean; createdAt: string }
export interface TriggerRow { id: string; on: string; agentName: string; goalTemplate: string; budget: number; cooldownMs: number; maxPerDay: number; dayCount: number; enabled: boolean }
export interface ProposalRow { id: string; agentName: string; goal: string; rationale: string | null; doneMeans: string; budget: number; kind?: string; status: string; decidedBy: string | null; runId: string | null; createdAt: string; decidedAt: string | null }
export interface ProposalPolicyRow { autoApprove: boolean; maxAutoPerDay: number; maxBudget: number }
export interface CheckerStatsRow { verdicts: number; firstPass: number; repairPass: number; blocked: number; errors: number }
export interface MemoryRow { id: string; key: string; kind: string; body: string; source: string; refCount: number; updatedAt: string }
export interface PulseRow { startedAt: string; lastTickAt: string; beats: number; enabled: boolean; counters: { dispatched: number; reaped: number; recovered: number; schedulesFired: number; schedulesDeferred: number; triggersFired: number; proposalsFired: number; eventsSeen: number; ordersExpired?: number; marketMoves?: number; idleFired?: number }; loops: Record<string, { lastAt: string; ok: boolean; fired?: number }>; error?: string }
export interface HeartData { ok: boolean; pulse: PulseRow | null; counts: { queued: number; running: number }; autonomyEnabled: boolean; schedules: ScheduleRow[]; triggers: TriggerRow[]; events: EventRow[]; agents: { name: string; autonomy: boolean; lastSeenAt: string; brain: string | null }[]; proposals?: ProposalRow[]; proposalPolicy?: ProposalPolicyRow; checkerStats?: CheckerStatsRow | null }
export interface OrderRow { id: string; agentName: string; runId: string | null; op: string; account: string; spec: string; preview: string; notionalSteem: number; status: string; decidedBy: string | null; previewTxId: string | null; broadcastId: string | null; blockNum: number | null; error: string | null; createdAt: string; decidedAt: string | null }
export interface OrderRowTier { finTier: string; finCaps: Record<string, number> | null }
export interface OrdersData { ok: boolean; orders: OrderRow[]; rails: { maxNotionalSteem: number; maxSignedPerDay: number; pendingExpiryMs: number; defaultTtlSeconds: number }; account: string; signedToday: number; vaultOpen: boolean; tiers?: Record<string, OrderRowTier>; error?: string }
export interface TreasuryRow { account: string; liquid: string; debt: string; vesting: string | null; liquidNum: number; debtNum: number }
export interface TreasuryRail { rail: string; ok: boolean; liquidSymbol: string; debtSymbol: string; accounts: TreasuryRow[]; totals: { liquid: number; debt: number }; error?: string }
export interface TreasurySnapshot { measuredAt: string; rails: TreasuryRail[]; fleet: Record<string, number>; cached: boolean }
export interface SituationRepoRow { name: string; language: string | null; sizeKB: number; pushedAt: string; pushedMinutesAgo: number | null; ours: boolean; fresh: boolean }
export interface SituationData {
  measuredAt: string; cached: boolean;
  treasury: { rails: TreasuryRail[]; measuredAt: string; error?: string };
  evm: { ethereum: { ok: boolean; wallets: number; okWallets: number; total: string; block: number | null; error?: string }; solana: { ok: boolean; wallets: number; okWallets: number; total: string; slot: number | null; error?: string } };
  rewards: { ok: boolean; accounts: number; pendingAccounts: { account: string; steemEquiv: number }[]; totalPendingSteemEquiv: number; error?: string };
  repos: { ok: boolean; org: string; scannedAt: string | null; ageMinutes: number | null; count: number; freshCount: number; repos: SituationRepoRow[]; broadcasts?: { repo: string; count: number; latest: string | null; ours: boolean }[]; broadcastTotal?: number; error?: string };
  vault: { ok: boolean; total: number; verified: number; unverified: number; imported: number; operatorCustody: number; rotatedOut: number; chains: Record<string, number>; error?: string };
  fleet: { ok: boolean; agents: number; autonomous: number; activeRuns: number; error?: string };
  anchors: { ok: boolean; count: number; latest: { chain: string; txId: string; blockNum: number | null; at: string; round: string; signedBy: string }[]; error?: string };
}
export interface DigestItemRow { repo: string; file: string; ours: boolean; ok: boolean; error?: string; bytes: number; hash8: string; echo: boolean; isNew: boolean; lang: string; kind: string; headline: string; asks: string[]; mentionsUs: boolean }
export interface DoorVoiceRow { file: string; ok: boolean; error?: string; bytes: number; hash8: string; isNew: boolean; selfEcho?: boolean; kind: string; headline: string; asks: string[]; mentionsUs: boolean }
export interface RootVoiceRow { file: string; ok: boolean; error?: string; hash8: string; looksLikeReport: boolean; isNew: boolean; headline: string; mentionsUs: boolean }
export interface DigestData { measuredAt: string; cached: boolean; scannedRepos: number; fetched: number; failed: number; uniqueContents: number; echoesOfOurs: number; newPartnerContents: number; partnerVoices: number; items: DigestItemRow[]; door: { checked: boolean; error?: string; files: number; oursFiles: number; selfEchoVoices?: number; incoming: number; voices: DoorVoiceRow[] }; rootVoices: { checked: boolean; error?: string; scanned: number; voices: RootVoiceRow[] }; suggestedResponse: { needed: boolean; reason: string; toRepo?: string; draft?: string[] }; error?: string }
export interface KeyReport {
  kind: string; liveChecked: boolean; label?: string; notes?: string[];
  controls: { chain: string; account: string | null; role: string; pub: string | null }[];
  pubs: string[];
}
/* r39 · key intake — the ready door for the next batch of keys (text or zip) */
export interface KeyBatchItem {
  hash: string; kind: string; preview: string; from: string;
  liveChecked: boolean; label: string;
  controls: { chain: string; account: string | null; role: string; pub: string | null }[];
  notes: string[]; dupOf: string | null;
}
export interface KeyBatchResult {
  ok: boolean; mode: string; found: number; created?: number;
  items?: KeyBatchItem[];
  sealed?: { hash: string; id: string; chain: string | null; account: string | null; role: string | null; status: string }[];
  note?: string; error?: string; code?: string;
  meta?: Record<string, unknown>;
}
export interface Ep { method: "GET" | "POST" | "PATCH" | "PUT"; path: string; desc: string; auth: "public" | "operator"; body?: string }

/* ── r37 · restore drill — the standing proof that every key the vault holds can actually be restored ── */
export interface DrillResult {
  at: string; total: number; restored: number; failed: number; placeholders?: number;
  verdict: "pass" | "fail"; meaning: string;
  seals?: { count: number; operatorPrimary: boolean; roles: string[] };
  backup?: Record<string, unknown> | null;
}

/* ── r38 · module stats shape (modules API) ── */
export type ModStats = Record<string, { calls: number; cached: number; failed: number; msTotal: number }>;
