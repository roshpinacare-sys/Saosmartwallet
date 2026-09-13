# r46 — Fine-grained PAT rotation + sandbox-reset recovery (3-layer protocol proven live)

**Date:** 2026-09-13 · **Scope:** GitGate auth, repo sync, app token plumbing · **Secrets:** zero

## What happened

1. **New token, better class.** The operator rotated the GitHub PAT again per the r43 recommendation: the old classic token (over-scoped: `admin:org`, `delete_repo`, `workflow`…) is dead/revoked, replaced by a **fine-grained** `github_pat_` token with minimal permissions. GitGate absorbed it via `gitgate set-token --from` (atomic tmp+mv), new vault fingerprint `c029b0b7`.
2. **First paste was wrong.** The operator noticed the first uploaded file was a paste mistake and re-uploaded the correct one before injection — the rotation pipeline correctly rejected a non-token-shaped file (`set-token` fails closed on anything not matching `ghp_*|github_pat_*|gho_*|ghu_*|ghs_*`).
3. **Sandbox reset discovered.** The environment had been restored to an r33-era snapshot: `~/.gitgate` gone, global credential-helper registration gone, `gitgate/` untracked locally, and the remote URL re-embedded the dead token. A textbook layer-1 failure.

## Recovery (the 3-layer protocol under real fire)

- **Layer 3 (self-heal) worked as designed:** `bash gitgate/install.sh` from the version-controlled canonical copy reinstalled the helper + CLI (0700) and re-registered the global credential config, **never touching the stored token**.
- **Rotation:** `set-token --from pat.env` → `doctor` → **ALL GREEN** (API identity `roshpinacare-sys`, fine-grained scopes).
- **Remote hygiene:** `gitgate migrate` stripped the embedded dead token from `.git/config`; live `ls-remote` through the helper proved real auth (anonymous would fail on this private repo).
- **Repo sync:** local HEAD held 2 unpushed runtime snapshot commits (only `db/custom.db` + `dev.pid`). Live db backed up to `/tmp/custom.db.pre-r46.bin`, `reset --hard origin/main` (r45), newest live db restored into the tree — no data loss, no regression of origin.

## App impact (why this matters beyond git)

`src/lib/github-token.ts` (r45) resolves the token with priority: env → **`~/.gitgate/secrets/github.token`** → legacy file. Because the app reads the vault on every call, **PAT rotation propagates automatically — no restart, no copy**. Verified after rotation: `/api/saos/hub`, `/api/eco/saosnet`, `/api/gate/situation` all `200`.

## Operator runbook (unchanged)

```
~/.gitgate/bin/gitgate ensure          # before first push of any chat — must be ALL GREEN
# rotate:
#   create new PAT on GitHub → upload file → gitgate set-token --from FILE
#   → gitgate ensure → revoke old PAT on GitHub
```

## Verification checklist

- [x] doctor ALL GREEN (vault, perms 600, helper, live API, clean remotes)
- [x] `ls-remote` + this push = live write test with the new token
- [x] plaintext `pat.env` deleted from `upload/`
- [x] secrets scan on tracked files: no `github_pat_`/`ghp_`/embedded-URL tokens
- [x] app endpoints consuming the token: 200

**Next:** r47+ continues the QA backlog (agent timeouts on fact-sheet Hebrew item, sync(chain) findings → English fact-sheet).
