# R45 — Full-stack QA sweep: pages, tasks, agents, efficiency — found & fixed

Date: 2026-09-13 · Operator directive: "test everything you've built — pages, tasks, efficiency, agents. Whatever you find — fix and push."

## Measured findings (HTTP sweep + kernel evidence + live browser)

1. **Kernel OOM kills (the real "jumps & falls"):** dmesg proves the dev server
   was SIGKILLed at `anon-rss:2904444kB` (2.9GB) — pages die mid-session and
   feeds break. Two independent deaths observed during this QA cycle.
2. **Thundering-herd cold computes:** `withCache` had NO single-flight — every
   caller arriving during a cold 16-30s probe spawned its OWN full recompute
   (heart + console + N tabs = Nx memory, Nx upstream load). The multiplier
   that pushed RSS into the kernel OOM line.
3. **Sequential external probes:** STEEM market client walked up to 3 RPC URLs
   sequentially x 15s (45s worst case); ETH/SOL/graphene probes likewise
   retried their endpoint lists sequentially x 6s. Cold recompute: 16-30s.
4. **The GitHub-token facility was orphaned:** 4 libs + 2 routes read
   `upload/Roshcaregt.txt` — the file deleted in the r43 rotation (and its
   token revoked anyway). Result: SAOS-NET state unavailable → raw 503s from
   /api/saos/hub + /api/eco/saosnet; digest/situation planes degraded.
5. **Contract violations:** /api/code/bundle returned a raw 500
   ("missing entry" as internal error — its catch wrapped typed GateErrors
   into generic Errors); both SAOS-NET endpoints returned raw 503s (r32
   contract: degraded state is DATA, never an exposed 5xx).
6. **SQLite was NOT in WAL mode** (`journal_mode=delete`): the heart's constant
   writes blocked the auth reads every request performs — the erratic
   2-23s latencies on trivial 400s.
7. **Per-query Prisma logging** (`log:['query']`) piped every query through
   the dev console on a write-heavy system.

## Fixes shipped

- **Single-flight withCache** (eco-server): concurrent cold callers now share
  one in-flight promise — the herd is gone.
- **Parallel endpoint racing:** SteemMarketClient.rpc races all RPC URLs
  (read-only; sticky winner tracking kept); ETH/SOL/graphene probes race
  their endpoint lists via Promise.any; githubRaw timeout 10s→6s; steem read
  timeouts 15s→8s (write path deliberately keeps 15s).
- **Cache TTLs matched to poller cadence:** eco-networks 6s→60s (pollers poll
  at 60s — the old 6s TTL meant every poll paid full cold price), saosnet
  15s→45s.
- **Unified GitHub-token resolver** (`src/lib/github-token.ts`): env
  GITHUB_TOKEN → **GitGate store** (`~/.gitgate/secrets/github.token`) →
  legacy upload file. All 4 libs now delegate to it. Rotation via
  `gitgate set-token` now propagates to the app automatically — single
  source of truth, no copies.
- **Contract repairs:** code/bundle passes typed GateErrors through (400 +
  bad-request, verified); saos/hub + eco/saosnet always 200 with ok:false +
  reason in the payload (verified).
- **WAL enabled** on the SQLite file (persistent — readers no longer blocked
  by writers).
- **Prisma per-query logging removed.**
- **Heap ceiling 2560MB → 2048MB** (supervisor + heart spawn): RSS ≈ heap +
  500-700MB webpack/native overhead, so 2560 let RSS reach the kernel OOM
  line BEFORE V8's own threshold fired. At 2048 the graceful self-restart
  (exit 77 → supervisor respawn ~2s) is the first line of defense. The storm
  sources that made 2048 feel tight in r40 (sequential probes, herd cold
  computes) are exactly what r45 removed.

## Verified live

- Sweep (steady state): eco/networks 15.9s→1.3s · bridge/status 15.4s→1.0s ·
  banker 13s→0.9s · auth-400s 23s→0.9-2.9s · zero 5xx anywhere.
- SAOS-NET state: 503 → 200 (raw private fetch with the GitGate token proven
  200 in 0.5s).
- Browser: console loads, session restored to the operator's last section,
  44 heuristic modules with live stats, autonomy heart beating (beat 28,
  21s ago), 33-run feed live, zero page errors.
- Lint clean. The supervisor's revival chain proven twice this cycle (both
  kernel-OOM deaths recovered automatically).
