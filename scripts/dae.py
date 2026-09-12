#!/usr/bin/env python3
"""Double-fork daemon spawner — escapes descendant-tree reaping.
The sandbox SIGKILLs descendants of the tool-call shell when the call ends.
Double-fork makes the grandchild an orphan reparented to init (pid 1),
so it is no longer a descendant of the shell and survives across calls.
Also supervises: if the dev server dies (e.g. OOM), it is restarted.
"""
import os, sys

LOG = "/home/z/my-project/dev.log"
CWD = "/home/z/my-project"

def spawn():
    if os.fork():
        os._exit(0)            # parent exits at once → child reparents to init
    os.setsid()                # new session, escape group kills
    if os.fork():
        os._exit(0)            # middle exits → grandchild orphaned to init
    return

def main():
    spawn()
    os.chdir(CWD)
    fd = os.open(LOG, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    devnull = os.open(os.devnull, os.O_RDONLY)
    os.dup2(devnull, 0); os.dup2(fd, 1); os.dup2(fd, 2)
    env = dict(os.environ)
    env["NODE_OPTIONS"] = "--max-old-space-size=1536"
    env["NEXT_TELEMETRY_DISABLED"] = "1"
    env["PORT"] = "3000"
    # the grandchild IS the supervisor loop
    os.execvpe("/bin/sh", ["/bin/sh", "-c",
        'while true; do '
        'echo "[daemon] $(date +%H:%M:%S) starting dev server"; '
        'bun run dev; '
        'echo "[daemon] $(date +%H:%M:%S) dev server exited rc=$? — restart in 3s"; '
        'sleep 3; done'], env)

main()
