# Saosmartwallet — System Status Report

Generated: `2026-09-09T04:06:40.392Z` · git `5b3703a` · source: live `/api/system/health`

**Summary:** networks `7/7` · rails live `1` · rails gated `4` · critical issues `0`

## Networks

| Network | Status | Head | Lag/State | Version/Evidence |
|---------|--------|------|-----------|------------------|
| STEEM | UP | 109,418,797 | 2s lag | live probe via M0/M1 SteemMarketClient |
| HIVE | UP | 109,753,323 | 2s lag | live probe api.hive.blog |
| BLURT | UP | 63,482,163 | 2s lag | live probe blurt-rpc.saboin.com |
| TRON | UP | 86,084,947 | 2s lag | live probe api.trongrid.io |
| SAOS-NET | UP | 72,958 | state 17m old | saos-net/0 |
| ETHEREUM | UP | 25,937,316 | 6s lag | 0.091401532 gwei baseFee |
| SOLANA | UP | 445,515,822 | — | epoch 1031 · slot 123822/432000 |

## Bridge rails

| Rail | Status | Evidence |
|------|--------|----------|
| SAOS-NET → STEEM | OFFLINE | no anchors in current feed |
| SAOS-NET ⇄ TRON | LIVE | cp#33612 → 1db5006b8dbb305e… @ TRON blk 86019974 · anchors measured: 4 |
| SAOS-NET → HIVE | GATED | verified historically (d4cf936b… @ blk 10,970,856) — currently RC-regen wait |
| SAOS-NET → BLURT | GATED | anchored on-chain before (e3201815…, bfce11c8…) · RPC live now (blurt-rpc.saboin.com) — anchors resume when the fleet gate reopens |
| STEEM → ETHEREUM | GATED | ADAPTER LIVE (M3, eip155:1) · BRIDGE_ABI defined · no contract deployed on mainnet — lock op defined, mint awaits deployment |
| STEEM → SOLANA | GATED | ADAPTER LIVE (M3, solana:mainnet-beta) · program IDs staged · no program deployed — mint awaits deployment |

## Direct bridge routes (live router quotes)

- **steemEthereum** — `gated` — No bridge contract deployed on Ethereum mainnet — lock op defined, mint leg awaits verified contract (BRIDGE_ABI ready) · fee: 0 STEEM + 0.00001463224512 ETH · ETA 783s
- **steemSolana** — `gated` — No bridge program deployed on Solana mainnet — lock op defined, mint leg awaits deployed program (program IDs staged) · fee: 0 STEEM + 0.000005 SOL + 0.00203928 SOL · ETA 16s

## Vault

```json
{
  "latencyMs": 13,
  "reachable": true,
  "initialized": true,
  "locked": true,
  "networks": 7,
  "soldiers": 13,
  "securityScore": 50,
  "auditIntegrityOk": true,
  "findings": [
    "no keys sealed yet — add at least one network key",
    "all keys are hot-stored — seal at least one cold or air-gapped key",
    "no backup created yet — export the state doc via exportState()",
    "social recovery is not configured — register recovery contacts up to a threshold",
    "dead-man switch is disabled — configure beneficiaries and an inactivity window"
  ]
}
```

## DEX (STEEM/SBD internal market)

```json
{
  "latencyMs": 650,
  "reachable": true,
  "bids": 19,
  "asks": 50,
  "latest": "0.09713049029224470",
  "spreadPercent": 0.2412196063296015,
  "headBlock": 109418797,
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
| vault | notice | vault initialized but locked | unlock to sign |

## Self-healing posture

- **rpcFailover** — adapters hold ordered endpoint books; a failed probe advances to the next endpoint automatically
- **vault** — fail-closed everywhere: locked/missing-key/policy-deny all block signing; audit chain is tamper-evident
- **broadcast** — broadcast is capability-gated per adapter — disabled by default, never enabled implicitly
- **stateAgePolicy** — SAOS-NET state age is surfaced (stateAgeSeconds) and degrades honestly — never hidden

---

*Every number in this report was measured live at generation time. What cannot be measured is reported as failed/null with the reason — never fabricated.*
