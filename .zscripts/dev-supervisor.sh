#!/bin/bash
# dev-supervisor — keeps `next dev` alive across its own memory-threshold restarts.
#
# Why this exists (r34 bug-hunt, 2026-09-13):
#   Next dev (start-server.js) calls process.exit(RESTART_EXIT_CODE=77) whenever
#   used_heap > 80% of heap_size_limit right after a request. Nothing respawns it:
#   the boot wrapper is a fire-and-forget chain and the heart-service only pings
#   every 15s with a 45s spawn backoff. Every memory episode therefore cost
#   45-90 seconds of dead portal (and during heavy dev compiles: back-to-back).
#   This supervisor closes the gap: respawn within ~1-2s, port-release aware,
#   crash-loop protected, and it never fights a healthy foreign instance.
#
# Contract:
#   - `bun run dev` stays the single entry point (boot wrapper unchanged).
#   - SIGTERM/SIGINT (exit 143/130) or exit 0  -> supervisor stops (maintenance).
#   - touch .zscripts/supervisor.stop         -> supervisor stops too.
#   - anything else (77, 1, ...)              -> release-wait + respawn.

cd "$(cd "$(dirname "$0")/.." && pwd)" || exit 1

PORT=3000
STOP_FLAG=".zscripts/supervisor.stop"
crash_streak=0

log() { echo "[supervisor] $*" >> dev.log; }

port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; }

http_alive() { curl -s -o /dev/null --max-time 3 "http://127.0.0.1:$PORT/" 2>/dev/null; }

wait_port_release() {
	# port can linger briefly after a crash (TIME_WAIT); wait up to ~15s
	for _ in $(seq 1 30); do
		port_busy || return 0
		sleep 0.5
	done
	return 1
}

log "supervisor armed (port $PORT, pid $$)"

while true; do
	[ -e "$STOP_FLAG" ] && { log "stop flag present — stepping down"; rm -f "$STOP_FLAG"; exit 0; }

	t0=$(date +%s)
	NODE_OPTIONS="--max-old-space-size=2048" bun ./node_modules/next/dist/bin/next dev -p 3000 --webpack 2>&1 | tee -a dev.log
	code=${PIPESTATUS[0]}
	dur=$(( $(date +%s) - t0 ))

	log "next dev exited code=$code uptime=${dur}s at $(date '+%F %T')"

	# intentional stop paths
	if [ "$code" -eq 0 ] || [ "$code" -eq 143 ] || [ "$code" -eq 130 ]; then
		log "clean/stop exit (code=$code) — stepping down"
		exit 0
	fi
	[ -e "$STOP_FLAG" ] && { log "stop flag present — stepping down"; rm -f "$STOP_FLAG"; exit 0; }

	# if some other healthy server owns the port, never fight it
	if http_alive; then
		log "port $PORT already served by another healthy instance — stepping down"
		exit 0
	fi

	wait_port_release || log "port still busy 15s after exit — trying anyway"

	# crash-loop protection: 5 rapid deaths -> one 60s rest, then continue
	if [ "$dur" -lt 10 ]; then
		crash_streak=$((crash_streak + 1))
	else
		crash_streak=0
	fi
	if [ "$crash_streak" -ge 5 ]; then
		log "crash-loop detected (${crash_streak} rapid deaths) — resting 60s"
		sleep 60
		crash_streak=0
	fi
done
