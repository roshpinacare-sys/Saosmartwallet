# R41 FACT SHEET — Console Stability ("jumps every second") — Root Cause & Fix

Date: 2026-09-13 · Operator report: "still feeling jumps every second — it pops, falls, moves, doesn't rise as it should"

## Measured, not guessed
- Live PerformanceObserver on the console: **3 CLS=1.0 events (full-page replacement) within 75s**; later windows showed 26–56 major shifts, totalCLS up to **56.38**.
- Browser console named the initiator verbatim: `Failed to fetch RSC payload for http://localhost:3000/. Falling back to browser navigation.` at `next/dist/client/dev/hot-reloader/app/web-socket.js:95`.

## The causal chain (four independent causes, all fixed)
1. **DB-watcher churn (the main jump engine):** webpack's watcher did not ignore `db/custom.db` (+ `-wal`/`-shm`). The heart and every session write to SQLite every few seconds → each write fired a full Fast Refresh → the dev client re-rendered the whole page and reset scroll = a CLS=1.0 "jump" every few seconds. FIX: `watchOptions.ignored += "**/db/**"` in next.config.ts.
2. **RSC-fallback full reloads:** when the dev client's RSC payload fetch raced a rebuild it fell back to a full browser navigation. With (1) firing rebuilds continuously this produced periodic full reloads. FIX: (1) removes the rebuild storm; `serverExternalPackages: ["steem","bytebuffer"]` stops the heavy node-oriented chain from being re-resolved per request.
3. **Stale heart closure + easy heap ceiling:** the running heart-service kept a pre-edit interval closure pinging the HEAVY `/` page every 15s (4 logged rival `next dev` spawns, all EADDRINUSE) and spawned servers with `--max-old-space-size=2048` (self-restart at 1638MB heap — reachable in ordinary compile storms). FIX: ping `/api/system/health`, spawn with **2560MB** (same as the supervisor), clean restart so only the new closure runs.
4. **Missing optional dep `memcpy`:** bytebuffer emitted `Module not found: Can't resolve 'memcpy'` on EVERY compile of any steem-importing route, feeding the rebuild noise. FIX: `bun add memcpy`.

## Console UI hardening (defense in depth)
- `rise` animation (whileInView + y:28 → invisible-below-fold, slide-in pops) replaced with a mount-only opacity fade — data updates can no longer move layout.
- Removed `overflow-x-hidden` from the root wrapper: per CSS spec it computed overflow-y to auto, making the wrapper the sticky scrollport — the console header and desktop sidebar silently lost `position: sticky`. Sticky verified live again (headerTop=0 while scrolled).
- Section switch scroll is now `behavior: "instant"`; KPI sub-lines and the heart counters row render in reserved slots (min-height) so polls can't grow cards and push the page; removed `background-attachment: fixed` (scroll jank).
- Autonomy section polling demilitarized: was 6 endpoints every 8s (7–14s each under dev compiles — the compile storm that starved the server), now heart 20s + five heavy feeds 60s staggered 5s apart.

## Guardian proven live
- During the work the portal died twice (operator-side process kills); the fixed heart-service revived it both times automatically (verified 2560MB ceiling in /proc environ, health-ping cadence, lock dedup working).

## Final verification (zero-touch, dual-window, agent-browser)
- **5.5 minutes observation: shifts=0, big=0, totalCLS=0.0000, reloads=1 (initial only).**
- Sticky header pinned at top:0 while scrolled; section nav resets scroll to 0; no horizontal overflow at 390px; lint clean; all endpoints 200.
