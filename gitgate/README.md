# GitGate — central GitHub authentication bridge

Machine-level git authentication for **every** repository and folder on this
machine, modeled on devgate's `SecretBroker` + `Redactor`
(`src/devgate/secrets/broker.py`, `redaction.py` in the devgate repo):

> The token lives in exactly ONE place, outside every repository, with
> 0600/0700 permissions. Git reaches it only through a credential helper at
> the I/O boundary. Remote URLs stay clean. Output is always redacted.

## Why

The previous pattern embedded the PAT directly in each repo's remote URL
(`https://x-access-token:<PAT>@github.com/...`). That is fragile and unsafe:

- rotating the PAT required touching every repo's `.git/config`;
- the token leaked into plaintext config files and tool outputs;
- a fresh checkout in a new chat/session had no credentials at all.

## Layout

```
~/.gitgate/
├── bin/git-credential-gitgate   # git credential helper (the only token reader for git)
├── bin/gitgate                  # operator CLI
├── secrets/github.token         # THE token (0600, dir 0700) — never printed
└── GUIDE-HE.md                  # Hebrew operator guide (local-only, not committed)
```

The canonical, version-controlled copy of the scripts lives in this repo
(`gitgate/bin/…`) so any session can reinstall in seconds:

```bash
bash /home/z/my-project/gitgate/install.sh   # idempotent, never touches stored tokens
```

## What the installer registers (global git config)

```
credential.https://github.com.helper = ~/.gitgate/bin/git-credential-gitgate
safe.directory = *
```

Every repo on the machine — current and future — authenticates for
`https://github.com/*` through the helper. No per-repo configuration, ever.

## Operator CLI

| Command | Purpose |
|---|---|
| `gitgate ensure` | **ONE-SHOT for any new chat**: setup-if-missing + live doctor. Run this before the first push of every session |
| `gitgate setup` | (re)install store + helper + global git config (idempotent) |
| `gitgate set-token --from F` | rotate/seed the token from file F (or stdin). Validates shape, writes atomically 0600, prints only a fingerprint |
| `gitgate doctor` | full self-check: perms, helper, git config, clean remotes, live GitHub API identity, live `ls-remote` on every repo |
| `gitgate status` | local state without network |
| `gitgate migrate --all` | strip embedded credentials from every repo remote URL |
| `gitgate whoami` | GitHub identity + scopes of the stored token (via temp 0600 header file) |
| `gitgate fingerprint` | non-reversible fingerprint (first 8 of sha256) for audit logs |

## Replacing the PAT (the "works from any chat" contract)

1. Create the new PAT on GitHub (Settings → Developer settings → Tokens).
   Classic: `repo` scope is enough for private push. Fine-grained
   (`github_pat_…`): Contents = Read/Write on the target repos.
2. On this machine — either upload the token as a `.txt` into
   `my-project/upload/` (gitignored) and run
   `~/.gitgate/bin/gitgate set-token --from upload/<file>.txt`,
   or paste it to the agent and it runs `set-token` for you (stdin is hidden).
3. `~/.gitgate/bin/gitgate ensure` must end with `ALL GREEN`.
4. Revoke the old PAT on GitHub. Nothing else to touch — no repo edits, no
   remote-URL surgery, no `.git/config` exposure.

## The new-chat attach protocol (three layers of certainty)

1. **Automatic (nothing to do):** `~/.gitgate` and the global git config live
   under `/home/z`, which persists across sessions. A brand-new chat can
   fetch/push immediately — the credential helper is already registered.
2. **Agent knowledge (guaranteed):** the mandatory header at the top of
   `worklog.md` (read by every agent in every chat) carries the GitGate
   protocol: run `gitgate ensure` before the first push; never expose the
   token; `pull --rebase` before pushing (the app's automation pushes
   continuously); rotation recipe.
3. **Self-heal (worst case — full environment wipe):** the canonical scripts
   are version-controlled in `gitgate/`, so one command restores everything:
   `bash /home/z/my-project/gitgate/install.sh`. If the token store was also
   wiped, the operator supplies a token file and `set-token` re-seeds it.

Concurrent chats: multiple sessions may push simultaneously — always
`git pull --rebase origin main` before pushing (standard cycle, now part of
the header protocol).

## Security model (aligned with devgate)

- **Single store, outside every repo** (`~/.gitgate/secrets/github.token`,
  0600 in a 0700 directory) — exactly devgate's `<data_dir>/secrets/<ref>`.
- **I/O boundary only** — the credential helper is the only git-side reader;
  nothing writes the token to logs, shells, URLs, or `.git/config`.
- **Redaction** — CLI output shows only `[REDACTED]`-style state and a
  non-reversible fingerprint; `whoami` passes the token via a temp 0600
  header file, never as a shell argument.
- **Atomic rotation** — `set-token` writes to a temp file and `mv`s it, so a
  failed rotation can never destroy the working token.
- **No-op `store`/`erase`** — git cannot inject or delete the credential; the
  store is authoritative and changes only through `set-token`.
