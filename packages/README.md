# packages/ — Saosmartwallet Monorepo Core

**STATUS: M0+M1 CORE IMPLEMENTED & CHAIN-VERIFIED** (2026-09-07).

M0 gate is OPEN: the owner confirmed the target network (**Steem Protocol**) —
D2 resolved, D1 dev endpoint = `https://api.steemit.com` (health-checked).
All M0 acceptance criteria pass: `bun tools/serialize-test.ts` → **30/30 PASS**
including bit-identical serialization against the node's own serializer and
signature-recovery matching live on-chain authorities.

M1 adds the DEX surface: `limit_order_create` serialization
(`bun tools/m1-op-test.ts` → **27/27 PASS**, bit-exact vs the node oracle),
the read-only `SteemMarketClient`, and the live terminal UI (apps layer —
Next.js at `src/app/page.tsx` + `/api/steem/*` routes).

## Layout

```
packages/
  crypto/          ✅ IMPLEMENTED — PrivateKey/PublicKey/signatures, WIF + "STM" encodings,
                   password & brain-key derivations (verified vs chain authorities)
  core/            ✅ SHIPPED (M2) — Sovereign Key Vault: Argon2id KDF, AES-256-GCM
                   envelope cipher (+ ChaCha20-Poly1305 fallback), Shamir sharded
                   backups + social recovery + dead-man switch, Policy Engine
                   (static/dynamic/contextual/composite), SigningOrchestrator,
                   hash-chained AuditSystem (+ PDF/CSV reports), Fiat–Shamir ZK
                   module (implemented; wiring pending — see below)
  chains/
    chain-adapter.ts  ✅ frozen seam (unchanged)
    steem/            ✅ IMPLEMENTED — binary serializer (varint/asset/ops/tx incl.
                      limit_order_create), SteemAdapter (broadcast hard-gated),
                      SteemMarketClient (read-only market data), evidence-annotated
    ethereum/         ✅ IMPLEMENTED (M3) — reads live (gas/balances/nonce via RPC),
                      sign-capable, broadcast fail-closed; bridge ABI is an
                      interface spec — no contract deployed (rails gated honestly)
    solana/           ✅ IMPLEMENTED (M3) — reads live, sign-capable (ed25519 verified
                      in tools/m3-adapter-check.ts), broadcast fail-closed
  bridges/         ✅ IMPLEMENTED — path router (live ETH fee legs, gated legs with
                   explicit reasons) + rail monitor over daemon-pushed state;
                   serving /api/bridge/routes + /api/bridge/status
  saos-id-verify/  ✅ SHIPPED — official zero-dependency TypeScript SDK for
                   POST /api/v1/identity/verify (live-dogfooded incl. dist)
  hsm-runtime/     ✅ DEPLOYED (wave 20.1 / G77-d) — production HSM signing
                   runtime: token-gated SIGN-ONLY API over the vault store
                   (0600, master key never copied, keys only via vault
                   scoped-unseal), steem-family + ed25519 signing with
                   wire-digest receipts, deny-by-default, structural
                   no-broadcast law, honest READY/NO-KEYS/SEALED verdicts;
                   lives on sovereign-runner-kit :3155 (systemd
                   saos-hsm-runtime.service; receipts/hsm-runtime/boot-proof)
```

Known honest gaps inside packages: the ZK module (core/src/crypto/zk.ts) is
real math but wired to nothing yet; `multiSign/batchSign/crossChainSign`
orchestrator paths are implemented but unwired; hsm-runtime holds no real
custody keys (owner custody flow) and reports NO-KEYS honestly until loaded.

Dependency rule (from `wallet-design/wallet-architecture.md`):
`apps → core → crypto` and `apps → chains`. **`core` never imports `chains`** —
the adapter is injected, which is what keeps the core network-agnostic.

## Chain-verified evidence (summary)

| Fact | Evidence |
|---|---|
| Asset wire = 16B (int64 + precision byte + 7-char zero-padded symbol field) | canonical hex from `condenser_api.get_transaction_hex` |
| `transaction_id` = sha256(serialized_tx)[0:20] | 10/10 live transfers reproduced |
| Signature digest = sha256(32-zero-chain-id ‖ tx bytes) | recovery matches on-chain authority keys |
| Signature wire = `[31+recid, r(32), s(32)]` (header 0x1f/0x20) | observed on real signatures + recovery match |
| Public-key string checksum = `ripemd160(pub33)[0:4]` | decoded a live on-chain key and matched bytes |
| `condenser_api` takes positional (array) params | live probe (Bad Cast otherwise) |
| `limit_order_create` = op id 5, u32 orderid, two assets, u8 fok, u32 expiration | 3 oracle vectors bit-exact (`tools/m1-op-test.ts`) |
| order book/trade-history/open-orders response shapes | live-captured 2026-09-07 (`src/market.ts` header notes) |
| RC `max_rc` sits on the account level (not inside `rc_manabar`) | live probe; M0 percent bug fixed in M1 |

Run the proof yourself (read-only, sends nothing):

```bash
bun tools/serialize-test.ts --rpc https://api.steemit.com --samples 10   # M0: transfer envelope
bun tools/m1-op-test.ts                                                  # M1: limit_order_create vs oracle
```

## ASSUMPTION marker

All Steem-family semantics above are now anchored to live mainnet evidence,
EXCEPT the chain-id-all-zeros constant which is reference-confirmed
(steem-js/dhive hardcode) AND proven by the authority-recovery test — it could
not pass with any other chain id.
