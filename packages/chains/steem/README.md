# packages/chains/steem — Steem Protocol Adapter

**STATUS: M0+M1 IMPLEMENTED & CHAIN-VERIFIED** (2026-09-07)
— `bun tools/serialize-test.ts` → 30/30 PASS (transfer envelope, M0)
— `bun tools/m1-op-test.ts` → 27/27 PASS (`limit_order_create`, M1)
— M1 end-to-end: an order built through the Next.js API route serialized
  BIT-EXACT against the node's own serializer (oracle re-check on the wire).

## Contents

| File | Purpose |
|---|---|
| `src/serializer.ts` | Byte-exact graphene wire primitives: `ByteWriter`/`ByteReader` (u8/u16/u32/i64/varint/string), `Asset` pack/unpack (16-byte fixed layout), float-free `parseAsset`/`formatAsset` |
| `src/operations.ts` | Standard op-id registry; `transfer` (M0) + `limit_order_create` (M1) pack/unpack; unknown ops fail loudly |
| `src/transaction.ts` | Transaction envelope serialize/deserialize, `transactionDigest` (sha256(chain_id‖tx)), `transactionId`, `appendSignatures` wire form |
| `src/adapter.ts` | `SteemAdapter implements ChainAdapter`: health/accounts/RC reads, `buildOperations` (transfer + limit_order_create, fresh ref-block fields), role-policy signing, **broadcast hard-gated** |
| `src/market.ts` | `SteemMarketClient` (read-only): order book, ticker, trade history, chain status, open orders — empirically-shaped (see header notes) |

## Wire-format evidence (captured live, 2026-09-07)

Every layout decision below is anchored to bytes fetched from
`https://api.steemit.com` — not to memory or third-party code:

1. **Asset = 16 bytes**: `int64 amount (LE) ‖ uint8 precision ‖ ASCII symbol zero-padded to an 8-byte field`.
   Canonical hex of a real `0.001 STEEM` transfer ends with
   `01 00 00 00 00 00 00 00 | 03 53 54 45 45 4d 00 00` (two padding bytes → 8-byte symbol field).
2. **Strings** = `varint(byteLen) ‖ UTF-8`; **varint** = LEB128.
3. **Empty extensions** = single `0x00`. The node's `get_transaction_hex` output for an
   unsigned tx additionally carries the empty signature vector byte (`0x00`) —
   digest covers only the transaction bytes.
4. **transaction_id** = first 20 bytes of `sha256(serialized_tx)` — reproduced on 10/10 live transfers.
5. **Signing digest** = `sha256(chain_id ‖ serialized_tx)` with chain id = 32 zero bytes on Steem mainnet
   (proven by authority recovery — see below).
6. **Signatures** = 65-byte compact `[31+recid, r(32), s(32)]`; headers `0x1f/0x20` observed live.
   Recovery of real signatures lands exactly on the signer's on-chain active/owner keys.
7. **Account names**: allow dots and hyphens (`wakeupkittty.pal` observed);
   adapter validates 3..16 chars, segments ≤ 13 (chain remains final arbiter).
8. **limit_order_create (M1)** = `varint(5) ‖ owner ‖ u32 orderid ‖ asset amount_to_sell ‖
   asset min_to_receive ‖ u8 fill_or_kill ‖ u32 expiration(unix)` — verified bit-exact
   against `condenser_api.get_transaction_hex` on 3 oracle vectors (incl. `orderid = 0xffffffff`,
   `fill_or_kill = true`); see `tools/m1-op-test.ts`.
9. **RC manabar (bug fixed in M1)**: `max_rc` sits on the rc_account level, `current_mana`
   inside `rc_manabar` — reading `rc_manabar.max_rc` yields `undefined` (M0 computed percent 0
   for every account; surfaced by the M1 dashboard).

## Usage

```ts
import { SteemAdapter } from "./packages/chains/steem/src/adapter";
import { SteemMarketClient } from "./packages/chains/steem/src/market";
import { PrivateKey } from "./packages/crypto/src/index";

const adapter = new SteemAdapter({ rpcUrl: "https://api.steemit.com" });
const tx = await adapter.buildOperations([
  { type: "transfer", payload: { from: "alice", to: "bob", amount: "1.000 STEEM", memo: "" } },
  // M1 DEX — buy 100 STEEM at 0.098 SBD/STEEM:
  { type: "limit_order_create", payload: {
      owner: "alice", orderid: 77, amount_to_sell: "9.800 SBD",
      min_to_receive: "100.000 STEEM", fill_or_kill: false,
      expiration: Math.floor(Date.now() / 1000) + 21600 } },
]);
const signed = await adapter.sign(tx, { byRole: { active: PrivateKey.fromWif(wif) } }, ["active"]);
// signed.signatures[0] — broadcast is disabled unless allowBroadcast:true was passed.

const market = new SteemMarketClient("https://api.steemit.com");
const book = await market.orderBook(25); // normalized bids/asks, SBD per STEEM
```

## Safety model

- `broadcast()` **fails closed** unless the adapter was constructed with `allowBroadcast: true`.
- Transfer/limit-order with a posting key is refused (least-privilege policy, per Aurora Modes direction).
- Limit orders accept STEEM/SBD only, opposite sides required, client guard caps order lifetime at 7 days (the chain remains the final arbiter).
- `verify()` = recovery-and-compare — the same semantics the chain uses.
