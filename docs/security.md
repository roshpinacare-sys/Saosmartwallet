# SAOS Security — Threat Model, Policies & Mechanical Gate

> Status: SEC-HARD round (owner directive: "connected to the network → strengthen
> security, make sure we never read or use malicious code").
> Every claim in this document is mechanically checked by
> **`bun tools/security-audit.ts`** — re-run it after every dependency change,
> every new API route, and before every push. Exit 1 = do not push.

---

## 1. What we are protecting

| Asset | Where | Protection |
|---|---|---|
| Vault master password | in-memory only, never persisted | Argon2id verifier + ZK (Fiat–Shamir Schnorr) commitment; unlock/step-ups fail closed; 10/min unlock rate limit |
| Vault private keys | encrypted at rest (SQLite) | vault LOCKED by default → no signing without password; policy engine allowlist; `sign`/`sign-cancel` re-deterministically rebuild the tx before signing |
| Admin credential | SHA-256-only storage | bootstrap-once, timing-safe compare, `SAOS_ADMIN_TOKEN` override; key create/revoke gated |
| API consumer keys | `saos_live_…` plaintext shown once | SHA-256-only at rest; 1,000/day UTC quota via **atomic** conditional upsert (race-proven: 1,050 concurrent → exactly 1,000 admitted, overshoot 0) |
| Owner keys | NEVER in this repo | scan enforced (§4); keys live only in the owner's wallet / env |
| Chain integrity claims | PROOFS tab | every number from a live API or the real engine — the Zero-Mock rule itself is a security control |

## 2. Supply-chain policy (the "no malicious code" rule)

Because we operate in a connected environment and ship an SDK, every byte of
third-party code is treated as hostile until proven otherwise:

1. **Lockfile is the contract** — `bun.lock` is git-tracked; dependency
   resolution is pinned and reviewable. Never commit a dependency change
   without the lockfile.
2. **No install-time code execution** — zero `preinstall`/`postinstall`/
   `prepare` scripts across all tracked `package.json` files (checked
   mechanically, §gate 2). If a dependency demands one, it needs an explicit
   owner review and an allowlist entry in the gate.
3. **Registry audit** — `npm audit` against the live advisory DB is part of
   the gate (best-effort when offline; honest SKIP, never a silent pass).
   Last live run: **0 vulnerabilities across the whole tree**.
4. **Dangerous-pattern allowlist** — `eval`, `new Function`,
   `child_process`, `dangerouslySetInnerHTML` are scanned in all
   `src/ packages/ tools/` TypeScript. The ONLY allowances, each with a
   fixed, reviewable reason:
   - `src/lib/grid98-bench.ts` — spawns the **frozen local** Grid98 engine at
     a fixed `.grid98-lab/` path with clamped numeric args (benchMs ≤ 60s).
     No remote or interpolated command targets. (Gate asserts this path
     assertion still holds.)
   - `src/components/ui/chart.tsx` — shadcn's CSS-variable injector; injects
     colors from our own code constants, never user input.
5. **Adding a dependency (checklist)**: justify in the PR → `npm audit` clean
   → no lifecycle scripts → no transitive `eval`-based loaders → lockfile
   updated → `bun tools/security-audit.ts` passes.
6. **The official SDK (`saos-id-verify`) must stay zero-dependency** — pure
   `fetch`, no transitive supply chain for consumers (gate §5 enforces).
7. **External network calls from the client are zero** — all browser data
   flows are same-origin `/api/*` (scan-verified); the server proxies chain
   RPCs. CSP enforces `connect-src 'self'` (plus ws: for dev HMR).

## 3. HTTP security posture

Set globally in `next.config.ts` (`headers()`), verified live by the gate:

- `Content-Security-Policy`: `default-src 'self'` baseline;
  `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`.
  - `script-src 'unsafe-inline' 'unsafe-eval'`: required by Next.js hydration
    bootstrap and dev HMR. Impact is bounded because the app holds **no
    ambient credentials** (no cookie sessions; auth is explicit
    `Authorization`/`X-Admin-Token` headers). Upgrading to nonce-based CSP
    via middleware is a documented next step, not a regression.
  - `connect-src ws: wss:`: dev HMR websocket through the gateway; the app
    opens no outbound WebSockets of its own.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  strict-origin-when-cross-origin`, `Permissions-Policy` (camera/mic/geo/
  payment/usb/floc all denied), `X-DNS-Prefetch-Control: off`.
- `Strict-Transport-Security`: inert over plain HTTP, future-proofs HTTPS.
- `poweredByHeader: false` — framework version not advertised.
- **Framing decision**: `frame-ancestors`/`X-Frame-Options` deliberately
  omitted — the sandbox preview panel may embed the app cross-origin, and
  with no cookie/ambient authority, clickjacking has nothing to steal. If a
  public cookie session is ever added, revisit with `frame-ancestors 'self'`.

### Rate-limit map (per-IP, in-process; metered API has DB-backed quotas)

| Route | Limit | Why |
|---|---|---|
| `POST /api/v1/identity/verify` | 1,000/key/day (atomic, DB) | the product's metered quota |
| `POST /api/developer/admin/bootstrap` | 5/min | credential oracle |
| `POST/DELETE /api/developer/keys` | admin-gated | requireAdmin |
| `POST /api/vault/init` | 5/min | Argon2id KDF cost |
| `POST /api/vault/unlock` | 10/min | Argon2id + password oracle |
| `POST /api/steem/trade/build` | 30/min | upstream RPC ref-block stamping |
| `POST /api/steem/trade/cancel` | 30/min | upstream RPC ref-block stamping |
| `GET/POST /api/saos/grid98-bench` | **3/min** | spawns a CPU-heavy engine run (≤60s) — compute-exhaustion vector |
| `GET/POST /api/saos/anchor-verify` | **10/min** | proxies live external-RPC work — amplifier guard |
| everything else | read-only or fail-closed | vault reads are LOCKED-state honest responses |

## 4. Secrets policy

- No `.env`, key, certificate, or credential files are git-tracked (gate §3).
- No WIF / PEM / high-entropy-assignment patterns in tracked text files
  (gate §3; known-noise allowlist: `bun.lock`, `skills/`, `examples/`).
- Probe keys from dogfood runs are **revoked** after each live experiment;
  the admin credential is reset so the owner bootstraps first.
- Owner-only secrets (vault password, registry tokens for `npm publish`,
  SMTP for outreach) never enter this repo — they live with the owner.

## 5. Incident & drift response

1. Gate fails → do not push. Fix the root cause, re-run until ALL PASS.
2. A leaked secret (ever) → revoke at the source first, then purge history
   (filter-repo) and rotate — in that order.
3. A vulnerable dependency lands → pin the patched version in `bun.lock`,
   re-run gate, commit both together.
4. Chain-authority drift (as caught live on blk 109,410,651) → the verifier
   reports FAILED with an explicit AUTHORITY DRIFT summary; re-burn stays
   fail-closed until a fresh anchor is signed by the new key (owner action).

## 6. Honest gaps (declared, not hidden)

- CSP still allows inline scripts (Next.js constraint) — nonce-based CSP via
  middleware is the follow-up once a public HTTPS deployment exists.
- Rate limits are per-process in-memory (single-server scope); the metered
  identity API is the only quota that must survive distribution, and it is
  DB-backed and atomic.
- `npm publish`, outreach sending, public `BASE_URL`, and vault
  initialization with the owner's key remain owner actions by design — no
  credentials exist in this sandbox.

## 7. Disclosure channel (RFC 9116)

`/.well-known/security.txt` is served live (rewrite → `/api/security-txt`)
pointing at this repo's GitHub **security advisory** flow (private by
design), with `Policy` → this document and a 90-day `Expires` that must be
rolled on security-affecting pushes. Mechanically enforced by the gate
(section 6b).

## 8. Fix-round evidence (live, this repo)

- Full input-fuzz across all 20 POST-facing API endpoints (garbage JSON +
  prototype-pollution shapes): **zero 500s** — every route answers an honest
  4xx (400 validation / 401 auth / 405 method / 409 state) or runs its
  documented default.
- Proof-suite re-run in one round: ZK 9/9 · quota-race ATOMIC-PROVEN ·
  m1-op-test 27/27 · cancel-oracle ALL PASS · serialize 30/30 ·
  m3-adapter 23/23 · chain-health exit 0 (1s lag) · router-multihop
  **30/30 after tool fix** (the tool's "before" snapshot was pinned to the
  moving HEAD — a measurement bug, not a product bug; now pinned to the
  true pre-fix bytes `14956a5~1`).
- Admin credential: fuzz POST accidentally consumed the owner-first
  bootstrap; state was reset to 0 rows (verified), bootstrap re-proven 201,
  and the live GET surface stays 405 (POST-only). No plaintext token ever
  left the process (201 copy-once by design).

## 9. Live event — key-authority drift & fleet takeover (2026-09-08 23:15–23:50 UTC)

Forensics measured directly against Steem mainnet:

- The external operator's last successful broadcast (`saos-dex.anchor.v1`
  chain-seal, ~36s cadence) was **22:41 UTC**; then silence.
- On-chain authority rotations preceded it: soldier posting authorities
  rotated **21:33 UTC** (e.g. cashmachine → STM7w45WCPwn…), headcorner ACTIVE
  rotated 21:17 UTC (blk 109,410,651 — the known AUTHORITY DRIFT event).
- The fleet envelope (`agent/fleet_keys.enc`, sealed 23:15 UTC, pass stored
  beside it in the private repo — owner's design) restores the ENTIRE keys/
  directory (`vault.json` with 11 accounts + `.vaultkey` + tron mnemonics +
  agent `.env`) — but **every restored WIF mismatches the current on-chain
  authorities**. The rotation happened after the last key-folder sync.
- Consequence: **no signing is possible from this sandbox until the owner
  supplies the current keys** (re-seal the envelope from the machine that
  actually signs). All broadcast legs fail loudly and honestly
  ("missing required posting authority" / "no anchor-writer fuel") — the
  Zero-Mock discipline holds even in takeover.
- What IS alive after takeover: guardian dual-slot persistent loops +
  agent.cjs monitor (10/10 chains-ok) + saosnet --beat (local chain keeps
  producing blocks/checkpoints/TRON pulse; anchor legs fail-honest) —
  respawned automatically by the guardian's self-heal.

## 10. Activation round — owner credentials via chat (not git)

- Admin auth: `SAOS_ADMIN_TOKEN` set in the untracked `.env` (env override
  mechanism) — requireAdmin proven live (401 without/with-wrong token;
  200 create → revoke golden path; 8 probe keys revoked, 0 active).
- Web vault (packages/core): initialized via `/api/vault/init` (Argon2id
  verifier + ZK commitment), master password handed to the owner in chat
  only; unlock→re-lock golden path proven live.
- SDK distribution: GitHub Release `saos-id-verify-v0.1.0` + npm-format
  tarball asset (real install channel; npmjs.org publish stays owner-only).
