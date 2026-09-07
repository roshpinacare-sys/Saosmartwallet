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
  core/            ⬜ SCAFFOLD — keystore (AES-256-GCM) + Policy Engine (next milestone)
  chains/
    chain-adapter.ts  ✅ frozen seam (unchanged)
    steem/            ✅ IMPLEMENTED — binary serializer (varint/asset/ops/tx incl.
                      limit_order_create), SteemAdapter (broadcast hard-gated),
                      SteemMarketClient (read-only market data), evidence-annotated
```

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
