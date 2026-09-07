# packages/ — Saosmartwallet Monorepo Core

**STATUS: M0 CORE IMPLEMENTED & CHAIN-VERIFIED** (2026-09-07).

M0 gate is OPEN: the owner confirmed the target network (**Steem Protocol**) —
D2 resolved, D1 dev endpoint = `https://api.steemit.com` (health-checked).
All M0 acceptance criteria pass: `bun tools/serialize-test.ts` → **30/30 PASS**
including bit-identical serialization against the node's own serializer and
signature-recovery matching live on-chain authorities.

## Layout

```
packages/
  crypto/          ✅ IMPLEMENTED — PrivateKey/PublicKey/signatures, WIF + "STM" encodings,
                   password & brain-key derivations (verified vs chain authorities)
  core/            ⬜ SCAFFOLD — keystore (AES-256-GCM) + Policy Engine (next milestone)
  chains/
    chain-adapter.ts  ✅ frozen seam (unchanged)
    steem/            ✅ IMPLEMENTED — binary serializer (varint/asset/ops/tx),
                      SteemAdapter (broadcast hard-gated), evidence-annotated
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

Run the proof yourself (read-only, sends nothing):

```bash
bun tools/serialize-test.ts --rpc https://api.steemit.com --samples 10
```

## ASSUMPTION marker

All Steem-family semantics above are now anchored to live mainnet evidence,
EXCEPT the chain-id-all-zeros constant which is reference-confirmed
(steem-js/dhive hardcode) AND proven by the authority-recovery test — it could
not pass with any other chain id.
