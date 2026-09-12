#!/usr/bin/env bash
# ROAST r7 + r29 — dev-server watchdog (patient edition).
# ==============================================================================
# The sandbox environment silently SIGKILLs the whole dev-server process group
# (bash wrapper included — no exit code, no log, no core). Environmental,
# documented since r2, re-proven live in r7.
#
# r29 LESSON (proven live): a COLD compile of "/" can take 45–300s. The old
# logic (single 6s probe → pkill) murdered the server mid-compile in an
# infinite kill-loop: probe fails → kill → revive → cold compile > probe
# timeout → kill … The fix:
#   · probe max-time 90 (long enough to cover most cold compiles)
#   · revive only after 3 consecutive failed probes (≈4.5 min of downtime)
#   · after a revive, sleep 60s before probing again (compile grace)
# The heart's queue is DB-backed, so a revive stays crash-safe by design.
# Usage: setsid bash tools/dev-watchdog.sh &   (fully detached)
LOG=/tmp/dev-watchdog.log
cd /home/z/my-project || exit 1
echo "[wd] started (patient r29) at $(date -u +%H:%M:%S)" >> "$LOG"
fails=0
while true; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 90 http://localhost:3000/ 2>/dev/null)
  if [ "$code" = "200" ]; then
    fails=0
  else
    fails=$((fails+1))
    echo "[wd] probe fail #$fails (code=$code) at $(date -u +%H:%M:%S)" >> "$LOG"
    if [ "$fails" -ge 3 ]; then
      echo "[wd] down x3 — reviving at $(date -u +%H:%M:%S)" >> "$LOG"
      pkill -f "next dev -p 3000" 2>/dev/null
      sleep 2
      setsid bun run dev >> dev.log 2>&1 < /dev/null &
      sleep 60
      code2=$(curl -s -o /dev/null -w '%{http_code}' --max-time 90 http://localhost:3000/ 2>/dev/null)
      echo "[wd] revive result: $code2 at $(date -u +%H:%M:%S)" >> "$LOG"
      fails=0
    fi
  fi
  sleep 20
done
