# r49 — Claims audit R7: three published claims corrected against live measurements, XRPL wired into the live network map, and a real supervision finding: multiple supervisors inside one heart through the hot-reload door

**Date:** 2026-09-13 · **Scope:** fact-sheet claims vs live truth, eco-registry/probe, heart-service hot-reload hygiene · **Secrets:** zero

## The claims audit (R7)

The public fact-sheet (private ads repo, 92K chars, 64 sections) was re-audited section by section against today's live measurements. The language contract holds (zero hebrew / em-dash / smart quotes / exclamations / emoji). Most claims stood: rails online, the r47-corrected sections 10.59/11/12 match today's live anchor measurement (drift honestly reported), the Identity API is live and gated (honest 401), 7 chains healthy.

Three claims did not survive the measurement, fixed per the disclosure policy in adsmarket `a8e5ea99`:

1. **§1 "security rented from 7 public networks"** — the headline count had no named list, so no third party could verify it. Fixed: the 7 are now named (STEEM · HIVE · BLURT · TRON · ETHEREUM · SOLANA · XRPL), each with a live receipt in sections 3, 10.19 and 10.30.
2. **§2 throughput was 6 days stale** — "32,603 tx/s (measured 2026-09-07)" while the platform's own live hub bench says **722,251 tx/s** (kernel applyTx replay of real archive txs on cloned state, measured 2026-09-12). Fixed with the current bench and an honest relabel of the ceiling (~62.4B/day extrapolated at the measured rate; sustained-live trade rate is economy/budget-bound and reported separately). Understating yourself by 22x is still a claims defect.
3. **§8 "13/13 soldiers live on Steem"** — the live dashboard measures **12/12 soldiers above the RC floor** (the roster tracks the 12 non-commander accounts). Fixed: 13 accounts = the commander @headcorner + 12 soldiers; live re-measure 2026-09-13 attached.

## The platform now monitors what it publishes

The audit found the live eco map (`/api/eco/networks`) did not monitor XRPL at all — while the published claim counts XRPL among the rented rails. Fixed: an honest `server_state` probe (xrplcluster + s1.ripple raced via `Promise.any`, age derived from ripple-epoch `close_time` or the direct `age` field, headId from the ledger hash). Measured live: **xrpl online, head 106,961,641, lag 5s** — the map is now 8 chains, all count-agnostic consumers unaffected.

## Live finding: the supervision farm came back through the hot-reload door

Editing `src/lib` during this round lit up a full EADDRINUSE farm (16:37-16:57). Root cause, measured, not guessed:

- heart-service runs `bun --hot`, and its import graph reaches deep into the app: heart → harness/heart → modules → **eco-server**.
- One edit to eco-server hot-reloads the heart entry. **13 re-evaluations counted in the log** ("health on" x13). Each re-run of `main()` armed a fresh supervision `setInterval` with fresh backoff state while the old interval kept firing.
- Several independent supervisors then spawned rival `next dev` servers into the same port within seconds (4 spawns in one second measured). r48 closed the crash door; the reload door was open.

**Fix:** a `globalThis` sentinel (survives module re-evaluation inside the same process) makes every re-run of `main()` a no-op — one supervisor per process, forever, even under `--hot`. Clean restart proven live: stale lock taken over honestly, one boot line, supervision armed once, server ready in 2.8s, all six core endpoints 200, console renders live (secrets 248 · agents 9 · msgs 757 · 177 key verifications / 0 failures), mobile 390 no overflow.

**Lesson for every agent:** an edit under `src/lib` reloads the heart; after edits, do not probe the portal during the cold compile window — and before r49, such an edit silently multiplied supervisors.

## Honest notes

- `saos-net` reports **stale** (no state push since 15:35Z): the pusher lives in the sister steem-repo flow (state is read from GitHub), so this is an honest signal to that flow, not a local defect.
- Three empty transport-artifact page errors in the browser (no content) — known from r48, unchanged.
- Section 12's measured authority drift remains open by design until a fresh anchor is signed (operator-gated signing action).

## Files

- `mini-services/heart-service/index.ts` — hot-reload sentinel (one supervisor per process)
- `src/lib/eco-server.ts` — XRPL probe (honest online/stale/offline)
- `src/lib/eco-registry.ts` — XRPL registry entry
- `tools/r49-*` — audit receipts (fetch, fix with fail-closed edits + round-trip, verify)
- `worklog.md` + this broadcast · adsmarket `a8e5ea99`

**Next:** the sister flow's SAOS-NET state pusher (stale since 15:35Z); the fresh-identity-anchor signing action remains the operator gate that closes the measured drift.
