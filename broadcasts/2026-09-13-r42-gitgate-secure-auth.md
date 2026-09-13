# R42 — GitGate: secure, central, rotatable GitHub auth (every folder, every chat)

Date: 2026-09-13 · Operator request: "fix the GitHub connection securely, valid for ALL our git folders, so I can replace the PAT — the previous approach didn't really work. Here's my app (devgate) — do it the right way."

## What was wrong (the old approach, retired today)

- The PAT was embedded **inside each repo's remote URL**
  (`https://x-access-token:<PAT>@github.com/...`) — the only credential store
  on the machine.
- Consequences: rotation meant editing `.git/config` in every repo; the token
  sat in plaintext config files; tooling had to scrape it back out of URLs;
  fresh checkouts had no credentials.

## What was built — GitGate (secret-broker pattern, taken from the operator's own devgate)

The implementation deliberately mirrors devgate's `SecretBroker`/`Redactor`
contract: **one store, outside every repo, 0600/0700, injected only at the
I/O boundary, all output redacted to a non-reversible fingerprint.**

```
~/.gitgate/
├── bin/git-credential-gitgate   # git credential helper — only git-side token reader
├── bin/gitgate                  # operator CLI (setup/set-token/doctor/status/migrate/whoami/fingerprint)
├── secrets/github.token         # THE token (0600, dir 0700)
└── GUIDE-HE.md                  # Hebrew operator guide (local-only)
```

Version-controlled canonical copy: `gitgate/` in this repo (scripts contain no
secrets) → reinstall from any session with `bash gitgate/install.sh`
(idempotent).

Global git config registered by the installer:

- `credential.https://github.com.helper = ~/.gitgate/bin/git-credential-gitgate`
- `safe.directory = *`

Every repo on the machine — current and future — authenticates through the
helper. Remote URLs are now clean
(`https://github.com/roshpinacare-sys/Saosmartwallet.git`), verified.

## Security properties

- Remote URLs carry **zero credentials** (`gitgate migrate --all` stripped the
  embedded token; no `ghp_` residue in `.git/config` — checked).
- `set-token` validates the token shape, writes atomically (temp file + `mv`,
  0600), and never echoes the value — output is the sha256 fingerprint only.
- `whoami` calls the GitHub API passing the token via a temp **0600 header
  file** (`curl -H @file`), never as a shell argument.
- `store`/`erase` are no-ops: git cannot inject or delete the credential —
  only `set-token` mutates the store (devgate: the broker is authoritative).
- No `~/.git-credentials`, no plaintext token anywhere outside the store.

## Verification (live, this session)

- `gitgate doctor` → **ALL GREEN**:
  - store present (0600), helper registered for `https://github.com`;
  - GitHub API authenticated (`whoami` → `roshpinacare-sys`, scopes printed);
  - live `ls-remote` on the private repo succeeded through the clean URL +
    helper (anonymous access would fail — the repo is `private: true`, proven
    via API), i.e. the authenticated read path is genuinely exercised;
  - remote clean, no embedded credentials.
- The closing `git push` of this commit is itself the end-to-end write test
  through the new mechanism.

## PAT replacement procedure (what the operator can now do at any time)

1. Create the new PAT on GitHub.
2. `~/.gitgate/bin/gitgate set-token --from <token-file>` (or paste it in chat;
   stdin path hides input).
3. `~/.gitgate/bin/gitgate doctor` → must print `ALL GREEN`.
4. Revoke the old PAT on GitHub. Nothing else changes — no repo edits.

Hebrew operator guide persisted at `~/.gitgate/GUIDE-HE.md` (local-only).
