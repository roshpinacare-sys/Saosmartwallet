#!/usr/bin/env bash
# ROAST r7 — dev-server watchdog.
# The sandbox environment silently SIGKILLs the whole dev-server process group
# (bash wrapper included — no exit code, no log, no core). This is environmental,
# documented since r2 and re-proven live three times in r7. The watchdog revives
# the server so the heart's queue drains; sessions and leases are DB-backed, so
# a revive is crash-safe by design (the reaper returns in-flight runs to the queue).
# Usage: setsid bash tools/dev-watchdog.sh &   (fully detached)
LOG=/tmp/dev-watchdog.log
cd /home/z/my-project || exit 1
echo "[wd] started at $(date -u +%H:%M:%S)" >> "$LOG"
while true; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 6 http://localhost:3000/ 2>/dev/null)
  if [ "$code" != "200" ]; then
    echo "[wd] down (code=$code) at $(date -u +%H:%M:%S) — reviving" >> "$LOG"
    pkill -f "next dev -p 3000" 2>/dev/null
    sleep 2
    setsid bun run dev >> dev.log 2>&1 < /dev/null &
    sleep 18
    code2=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://localhost:3000/ 2>/dev/null)
    echo "[wd] revive result: $code2" >> "$LOG"
  fi
  sleep 20
done
