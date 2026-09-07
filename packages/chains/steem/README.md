# packages/chains/steem — Steem Protocol Adapter

**STATUS: M0 IMPLEMENTED & CHAIN-VERIFIED** (2026-09-07) — `bun tools/serialize-test.ts` → 30/30 PASS.

## Contents

| File | Purpose |
|---|---|
| `src/serializer.ts` | Byte-exact graphene wire primitives: `ByteWriter`/`ByteReader` (u8/u16/u32/i64/varint/string), `Asset` pack/unpack (16-byte fixed layout), float-free `parseAsset`/`formatAsset` |
| `src/operations.ts` | Standard op-id registry; `transfer` pack/unpack implemented end-to-end; unknown ops fail loudly |
| `src/transaction.ts` | Transaction envelope serialize/deserialize, `transactionDigest` (sha256(chain_id‖tx)), `transactionId`, `appendSignatures` wire form |
| `src/adapter.ts` | `SteemAdapter implements ChainAdapter`: health/accounts/RC reads, `buildOperations` (fresh ref-block fields), role-policy signing, **broadcast hard-gated** |

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

## Usage

```ts
import { SteemAdapter } from "./packages/chains/steem/src/adapter.js";
import { PrivateKey } from "./packages/crypto/src/index.js";

const adapter = new SteemAdapter({ rpcUrl: "https://api.steemit.com" });
const tx = await adapter.buildOperations([
  { type: "transfer", payload: { from: "alice", to: "bob", amount: "1.000 STEEM", memo: "" } },
]);
const signed = await adapter.sign(tx, { byRole: { active: PrivateKey.fromWif(wif) } }, ["active"]);
// signed.signatures[0] — broadcast is disabled unless allowBroadcast:true was passed.
```

## Safety model

- `broadcast()` **fails closed** unless the adapter was constructed with `allowBroadcast: true`.
- Transfer with a posting key is refused (least-privilege policy, per Aurora Modes direction).
- `verify()` = recovery-and-compare — the same semantics the chain uses.
