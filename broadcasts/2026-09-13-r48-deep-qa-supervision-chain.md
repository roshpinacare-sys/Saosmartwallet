# R48 — Deep QA: the supervision chain itself was the patient

Date: 2026-09-13 · Operator directive: "תמשיך עוד יותר עמוק ודחוף" (go deeper and push)

## What this round actually tested
Not the pages again — the layer UNDER the pages: the supervision chain (heart-service → next dev → portal), the type contracts, and a live fleet run with the r47 brain fixes armed.

## The heart had three real defects (all live-proven, all fixed)
1. **Quiet abandoned clean crashes.** After 6 spawn attempts into a lingering port (EADDRINUSE), the heart rested 10 minutes — and during that window a CLEAN crash (portal dead, port free) was ignored for the whole rest. Live proof: portal killed, heart silent 90s+. Fix: a free port resets the backoff ladder. Measured after the fix: full heal in ~49s, then ~17s.
2. **Busy port got farmed.** A cold-compiling server answers health in >25s; the heart declared false death and spawned rival `next dev` instances into the busy port ("spawning anyway" after 20s) — the entire EADDRINUSE-noise class. Fix: a busy port is NEVER spawned into (skip the tick, don't count a failure); ping patience 8s→12s. Verified: zero EADDRINUSE growth across long compile windows.
3. **Stale closure + fd leak.** The running interval kept pre-edit code alive across `bun --hot` reloads (the exact r41 lesson), and every historical spawn left a pair of leaked fds to dev.log in the heart's table (hundreds found). Fix: clean restarts via the dae.py double-fork (plain `setsid` gets reaped by the sandbox — verified twice).

## Heap ceiling: 1792 tried honestly, 2048 kept
A 1792MB ceiling crashed the big console compile into a restart loop; reverted to the proven 2048. The tradeoff is documented in code: a kernel kill at ~2.14GB RSS costs only the server (the heart survives and respawns); an unfinishable compile costs everything. dae.py's stale 1536 was aligned to 2048 and got a health-probe so it can never farm EADDRINUSE if invoked.

## Type contract leaks (tsc went from errors to zero)
- `SituationData`/`DigestData` lacked the top-level `ok` the API really returns (live-proven via curl; overview.tsx gates on it).
- `anchorCache` read `cached.scanned` without storing it — every cache hit silently reported `scanned: undefined`. Now stored at all three write sites.
- mini-services excluded from the app's tsc (independent bun project).

## Loading dead-end fixed (ConsoleGate)
The console is a giant chunk with no persistent build cache in this sandbox — every server restart froze the operator on "טוען קונסולה…" for minutes with zero feedback. New gate: honest hint at 8s, refresh escape at 40s.

## Live fleet run — the r47 brain fixes held under fire
Real run of agent `zai-code`, brain `zai:default`, checker `nvidia:openai/gpt-oss-20b`, read-only modules only: **done**. Four live module calls (vault.stats 248/177 · fleet.status 12/12 soldiers above the RC floor · net.health 7 chains online), the independent checker REJECTED once honestly (no final report in trace) → maker repaired → all criteria passed with evidence. The failure path was also exercised: a run orphaned by the OOM was failed honestly by the watchdog ("crashed twice — failed honestly"), no masking.

## Tooling note for future agents
A transport artifact mangles `[x` sequences in our own tool I/O (`const [meta` displayed as `const eta`, `[heart-service]` as `eart-service]`). A "broken line" in api-console.tsx was hunted as a bug until tsc proved the file perfectly valid. Rule: when a display shows impossible syntax, trust the compiler, not the display.

## Verification
- Interactive browser sweep: all visited sections render live data (connections 716 · vault 1250 · agents 1240 · autonomy 1993 · command 431 · terminal 26K when fully loaded), zero page errors, navigation works.
- tsc: 0 errors. Heart chain: heart 31514 → next dev → server with 2048 ceiling confirmed in /proc environ.
- Open item (unchanged from r47, narrowed): brain failover layer-3 (zai→nvidia on gateway 401) is armed and code-audited but was never triggered naturally this round — the gateway was healthy in every measured window.

Zero secrets. Push of this commit = live write test.
