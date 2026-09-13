# R44 — New-chat attach protocol: Git auth that works in EVERY chat, guaranteed

Date: 2026-09-13 · Operator request: "how will I attach new chats? arrange it well so it works easily and certainly."

## The question

GitGate lives at `~/.gitgate` + global git config. How does a brand-new chat
(a fresh agent session) get git auth working immediately — and what if the
environment resets?

## The answer — three layers of certainty

### Layer 1 — automatic (nothing to do)
`~/.gitgate` and the global git config live under `/home/z`, which persists
across sessions. A brand-new chat can fetch/push immediately; the credential
helper is already registered for `https://github.com` and works for every
repo — existing and future.

### Layer 2 — guaranteed agent knowledge
`worklog.md` is the one file every agent MUST read at the start of every
chat. Its top now carries a mandatory header: run
`~/.gitgate/bin/gitgate ensure` before the first push; never expose the
token; `git pull --rebase origin main` before pushing (the app's automation
pushes continuously); the rotation recipe; pointers to full docs.

### Layer 3 — self-heal after a full environment wipe
The canonical scripts are version-controlled in `gitgate/` (already on
GitHub). One command restores the entire mechanism:
`bash /home/z/my-project/gitgate/install.sh`. If the token store was wiped
too, the operator supplies a token file and `gitgate set-token --from <file>`
re-seeds it.

## New CLI command: `gitgate ensure`

One-shot for any new chat: setup-if-missing (idempotent) + live doctor.
Verified this session: ends `ALL GREEN` (API identity + private-repo
ls-remote + clean remote). Exits non-zero with exact repair instructions if
anything is missing.

## Verification

- `gitgate ensure` → **ALL GREEN** (freshly reinstalled from the repo copy).
- Worklog header inserted at the top of the mandatory-read file.
- This push = live write test through the new-token-only chain.

Hebrew operator guide updated (`~/.gitgate/GUIDE-HE.md`, local-only):
"opening a new chat usually requires doing nothing at all."
