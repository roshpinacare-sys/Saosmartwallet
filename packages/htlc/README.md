# packages/htlc — SAOS-HTLC/1 atomic-swap core

Production-grade **Hash-Time-Locked-Contract** deterministic core for
cross-chain atomic swaps (master directive §3): state machine, canonical
codec, sha256-chained receipts, dual-view session orchestration, vault
sealing, and an honestly-marked simulated chain adapter.

**Zero third-party dependencies** — `node:crypto` only. TypeScript strict.

---

## Honest scope boundary

| In this package (shipped, tested)                                  | NOT in this package (future work)                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------ |
| HTLC state machine (`Initiated → Locked → Redeemed/Refunded`)       | Real on-chain contract deployment (Ethereum HTLC, SPL HTLP…) |
| Canonical `SAOS-HTLC/1` message codec (byte-deterministic JSON)     | Real per-chain signing / broadcast adapters                  |
| sha256-chained receipt records (`prev→hash`, tamper-evident)        | Chain RPC, fee estimation, block confirmation watching       |
| Dual-view `SwapSession` + vault sealing of the receipt chain hash   | Counterparty discovery / swap negotiation networking         |
| `ChainAdapter` interface + `SimulatedChainAdapter` (in-memory)      | Cross-chain watcher daemons                                  |

**The only adapter shipped today is `SimulatedChainAdapter`** — a
deterministic in-memory ledger marked `simulated: true`, for tests and
dry-run orchestration. It never touches a network, never signs, never
broadcasts. Real per-chain adapters (ETH, SOL, HIVE, STEEM) plug into the
`ChainAdapter` seam in `src/chains.ts` without touching the machine, codec,
or session; they must report `simulated: false`. This boundary is deliberate
and recorded here so nobody mistakes simulated books for chain truth.

---

## Protocol diagram

```
 initiator (gives assetGive)                    redeemer (gives assetWant)
 ─────────────────────────────                 ─────────────────────────────
 generateSecret() ──► secret S
 hashSecret(S) ──► H = sha256(S)
                                                ◄── Offer{H, timelocks} ──
 Offer{H, timelocks}
        │
        ▼
 ┌─────────────────────────────── PHASES (injected clock) ───────────────┐
 │  pre-funding   : now < fundedAt                    (fundedAt optional)│
 │  claim-window  : fundedAt ≤ now < redeemerClaimAt  (redeemer claims)  │
 │  refund-window : redeemerClaimAt ≤ now < initiatorRefundAt            │
 │  expired       : now ≥ initiatorRefundAt           (terminal-no-move) │
 └───────────────────────────────────────────────────────────────────────┘
 GENESIS INVARIANT (fail-closed):
   initiatorRefundAt − redeemerClaimAt ≥ MIN_SAFETY_MARGIN_MS

 lock(S) on chain A ──► Lock{swapId}          (initiator funds chain A)
                              │
                              ▼
                              SwapSession (both views, lockstep)
                              receipts: offer → lock → claim/refund
                              chainHash = sha256-chained final hash
                              │
        ┌─────────────────────┴──────────────────────┐
        ▼ claim path                                 ▼ refund path
 redeemer learns S, claims                    claim window closed
 Claim{swapId, secret}                        Refund{swapId}
        │                                            │
        ▼                                            ▼
 verifySecret(S, H) ✓ → Redeemed             initiator refunds → Refunded
 (same S now unlocks chain B —               (initiator recovers assetGive;
  the atomic swap completes)                  redeemer walks away, no loss)

 final receipt chain hash ──► sealSessionReceipt(vault, id, session)
                              (AES-256-GCM opaque secret via packages/vault;
                               also Ed25519-signable via vault.signEd25519)
```

Why the margin matters: the redeemer's claim window closes
`MIN_SAFETY_MARGIN_MS` **before** the initiator can refund, so there is no
instant at which both sides can move — the classic atomic-swap safety
property, enforced at genesis, fail-closed.

---

## State machine

```
 Initiated ──lock(initiator, claim-window)──► Locked
 Locked   ──claim(redeemer, claim-window, sha256(secret)==hashSecret)──► Redeemed
 Locked   ──refund(initiator, refund-window)──► Refunded
```

Refusal matrix (every refusal is a typed `HtlcError`; state never changes):

| Attempt                                        | Error code                |
| ---------------------------------------------- | ------------------------- |
| claim/refund/lock by the wrong party            | `HTLC_E_BAD_PARTY`        |
| claim before lock, double-lock, post-terminal   | `HTLC_E_INVALID_TRANSITION` |
| claim in refund-window/expired, refund in claim-window/expired, lock in pre-funding | `HTLC_E_WRONG_PHASE` |
| wrong or malformed claim secret                 | `HTLC_E_BAD_SECRET`       |
| message for another swap                        | `HTLC_E_SWAP_MISMATCH`    |
| timelock margin violated at genesis             | `HTLC_E_TIMELOCK_MARGIN`  |
| codec/schema violation (strict, no extra fields)| `HTLC_E_BAD_MESSAGE`      |
| the two session views ever disagree             | `HTLC_E_DIVERGENCE` (session poisoned) |

Guard order is deterministic: **party → state → phase → secret** (a
wrong-phase claim never leaks whether the secret was right). Secrets are
verified in **constant time** (`crypto.timingSafeEqual`) and are **never
echoed** in any error message.

---

## Usage

```ts
import {
  SwapSession, makeOffer, makeLock, makeClaim, makeRefund,
  createTimelocks, generateSecret, hashSecret, verifyChain,
  sealSessionReceipt, openSessionReceipt,
  SimulatedChainAdapter,
} from "@saos/htlc"; // or relative paths in-repo

// 1. the secret is born on the claim side (or any trusted side)
const secret = generateSecret();               // 32 random bytes
const hashSecretHex = hashSecret(secret);      // goes into the offer

// 2. canonical offer — timelock margin enforced HERE, fail-closed
const offer = makeOffer({
  swapId: "swap-0001",
  initiator: "initiator.alice",
  redeemer: "redeemer.bob",
  assetGive: { chain: "ethereum", symbol: "ETH" },
  assetWant: { chain: "steem", symbol: "STEEM" },
  amountGive: "100",                            // decimal STRING, never a float
  hashSecret: hashSecretHex,
  timelocks: createTimelocks(refundAt, claimAt, fundedAt),
});

// 3. dual-view session — deterministic clock is injected, not wall time
let now = fundedAt;
const clock = () => now;
const session = new SwapSession(offer, clock);

session.submit(makeLock(offer.swapId));        // initiator funds
now = claimAt - 1;                             // inside the claim window
session.submit(makeClaim(offer.swapId, Buffer.from(secret).toString("hex")));
session.state;                                 // "Redeemed" on BOTH views

// 4. tamper-evident receipts (sha256 prev→hash chain)
verifyChain(session.receipts());               // true
session.chainHash();                           // final chain hash

// 5. seal the chain hash in the vault (SAOS_VAULT_MASTER_KEY required)
await sealSessionReceipt(vault, "htlc/receipt/swap-0001", session);
const sealed = await openSessionReceipt(vault, "htlc/receipt/swap-0001");
sealed.chainHash === session.chainHash();      // tamper probe across time

// 6. dry-run the give-side chain against the simulated adapter
const eth = new SimulatedChainAdapter({ id: "sim-ethereum", assets: [offer.assetGive], clock });
await eth.lock(offer);                         // deterministic tx ids
await eth.claim(makeClaim(offer.swapId, secretHex));
eth.books();                                   // inspectable ledger
```

Run the selftest (no network, no real keys):

```sh
bun test packages/htlc
```

---

## Design notes

- **Determinism** — the clock is injected everywhere (`() => epochMs`);
  tests drive time explicitly. Adapter tx ids hash `{adapter, op, swapId,
  counter}` — no wall clock, so identical replays give identical receipts.
- **Canonical JSON** — sorted keys, recursive, arrays ordered; floats,
  `NaN`, `Infinity`, `undefined`, functions, bigints and non-plain objects
  refuse. Amounts travel as decimal strings, timestamps as safe integers.
- **Strict schema** — decoding requires the exact field set; forward
  compatibility is a protocol-version bump (`SAOS-HTLC/1` → `/2`), never a
  silent extra field.
- **Receipts** — `hash_i = sha256(canonical({seq, kind, at, swapId,
  payload, result, prev}))`, `prev₀ = "0"×64`, `prev_i = hash_{i-1}`.
  `verifyChain()` is total: tampering returns `false`, never throws.
- **Vault integration is structural** — `VaultLike` is a minimal local type
  satisfied by `packages/vault`'s `Vault`; the htlc package keeps zero
  package-level dependencies.
- **Divergence law** — the session runs two `SwapMachine`s (initiator view,
  redeemer view). If they ever disagree, the session is poisoned: every
  further operation throws `HTLC_E_DIVERGENCE`. No silent drift, ever.
