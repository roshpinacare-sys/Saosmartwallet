# Saosmartwallet — System Status Report

Generated: `2026-09-08T22:04:20.154Z` · git `14956a5` · source: live `/api/system/health`

**Summary:** networks `7/7` · rails live `2` · rails gated `4` · critical issues `0`

## Networks

| Network | Status | Head | Lag/State | Version/Evidence |
|---------|--------|------|-----------|------------------|
| STEEM | UP | 109,411,581 | 3s lag | live probe via M0/M1 SteemMarketClient |
| HIVE | UP | 109,746,096 | 3s lag | live probe api.hive.blog |
| BLURT | UP | 63,475,031 | 3s lag | live probe blurt-rpc.saboin.com |
| TRON | UP | 86,077,708 | 3s lag | live probe api.trongrid.io |
| SAOS-NET | UP | 63,638 | state 7m old | saos-net/0 |
| ETHEREUM | UP | 25,935,512 | 21s lag | 0.057420735 gwei baseFee |
| SOLANA | UP | 445,447,241 | — | epoch 1031 · slot 55241/432000 |

## Bridge rails

| Rail | Status | Evidence |
|------|--------|----------|
| SAOS-NET → STEEM | LIVE | latest: 867fe4dd6ca8f6f223576e3caf40fc2eb2350408 (cp#63348) · 6 anchors in feed |
| SAOS-NET ⇄ TRON | LIVE | cp#33612 → 1db5006b8dbb305e… @ TRON blk 86019974 · anchors measured: 4 |
| SAOS-NET → HIVE | GATED | verified historically (d4cf936b… @ blk 10,970,856) — currently RC-regen wait |
| SAOS-NET → BLURT | GATED | anchored on-chain before (e3201815…, bfce11c8…) · RPC live now (blurt-rpc.saboin.com) — anchors resume when the fleet gate reopens |
| STEEM → ETHEREUM | GATED | ADAPTER LIVE (M3, eip155:1) · BRIDGE_ABI defined · no contract deployed on mainnet — lock op defined, mint awaits deployment |
| STEEM → SOLANA | GATED | ADAPTER LIVE (M3, solana:mainnet-beta) · program IDs staged · no program deployed — mint awaits deployment |

## Direct bridge routes (live router quotes)

- **steemEthereum** — `gated` — No bridge contract deployed on Ethereum mainnet — lock op defined, mint leg awaits verified contract (BRIDGE_ABI ready) · fee: 0 STEEM + 0.00000919347616 ETH · ETA 783s
- **steemSolana** — `gated` — No bridge program deployed on Solana mainnet — lock op defined, mint leg awaits deployed program (program IDs staged) · fee: 0 STEEM + 0.000005 SOL + 0.00203928 SOL · ETA 16s

## Vault

```json
{
  "latencyMs": 2,
  "reachable": true,
  "initialized": false,
  "locked": true,
  "networks": 0,
  "soldiers": 0,
  "securityScore": 0,
  "auditIntegrityOk": true,
  "findings": [
    "vault is not initialized — run initialize() to set a master password verifier"
  ]
}
```

## DEX (STEEM/SBD internal market)

```json
{
  "latencyMs": 648,
  "reachable": true,
  "bids": 19,
  "asks": 50,
  "latest": "0.09713049029224470",
  "spreadPercent": 0.5799331510656447,
  "headBlock": 109411581,
  "lagSeconds": 3
}
```

## Issues & actions

| Component | Severity | Detail | Action |
|-----------|----------|--------|--------|
| bridge:relay-hive | notice | SAOS-NET → HIVE gated — verified historically (d4cf936b… @ blk 10,970,856) — currently RC-regen wait | resume/undeploy per rail gate (honest state, no fabrication) |
| bridge:relay-blurt | notice | SAOS-NET → BLURT gated — anchored on-chain before (e3201815…, bfce11c8…) · RPC live now (blurt-rpc.saboin.com) — anchors resume when the fleet gate reopens | resume/undeploy per rail gate (honest state, no fabrication) |
| bridge:bridge-steem-ethereum | notice | STEEM → ETHEREUM gated — ADAPTER LIVE (M3, eip155:1) · BRIDGE_ABI defined · no contract deployed on mainnet — lock op defined, mint awaits deployment | resume/undeploy per rail gate (honest state, no fabrication) |
| bridge:bridge-steem-solana | notice | STEEM → SOLANA gated — ADAPTER LIVE (M3, solana:mainnet-beta) · program IDs staged · no program deployed — mint awaits deployment | resume/undeploy per rail gate (honest state, no fabrication) |
| route:steem->ethereum | notice | No bridge contract deployed on Ethereum mainnet — lock op defined, mint leg awaits verified contract (BRIDGE_ABI ready) | deploy the bridge contract/program on the target chain |
| route:steem->solana | notice | No bridge program deployed on Solana mainnet — lock op defined, mint leg awaits deployed program (program IDs staged) | deploy the bridge contract/program on the target chain |
| vault | notice | vault not initialized — first-boot ceremony pending (clean handoff state) | run the VAULT tab setup wizard |

## Self-healing posture

- **rpcFailover** — adapters hold ordered endpoint books; a failed probe advances to the next endpoint automatically
- **vault** — fail-closed everywhere: locked/missing-key/policy-deny all block signing; audit chain is tamper-evident
- **broadcast** — broadcast is capability-gated per adapter — disabled by default, never enabled implicitly
- **stateAgePolicy** — SAOS-NET state age is surfaced (stateAgeSeconds) and degrades honestly — never hidden

---

*Every number in this report was measured live at generation time. What cannot be measured is reported as failed/null with the reason — never fabricated.*
