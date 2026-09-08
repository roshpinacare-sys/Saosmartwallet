# Saosmartwallet — System Status Report

Generated: `2026-09-08T00:45:43.252Z` · git `fcb931f` · source: live `/api/system/health`

**Summary:** networks `7/7` · rails live `2` · rails gated `4` · critical issues `0`

## Networks

| Network | Status | Head | Lag/State | Version/Evidence |
|---------|--------|------|-----------|------------------|
| STEEM | UP | 109,386,112 | 1s lag | live probe via M0/M1 SteemMarketClient |
| HIVE | UP | 109,720,587 | 2s lag | live probe api.hive.blog |
| BLURT | UP | 63,449,845 | 2s lag | live probe blurt-rpc.saboin.com |
| TRON | UP | 86,052,183 | 5s lag | live probe api.trongrid.io |
| SAOS-NET | UP | 54,664 | state 22m old | saos-net/0 |
| ETHEREUM | UP | 25,929,146 | 8s lag | 0.053958887 gwei baseFee |
| SOLANA | UP | 445,205,020 | — | epoch 1030 · slot 245020/432000 |

## Bridge rails

| Rail | Status | Evidence |
|------|--------|----------|
| SAOS-NET → STEEM | LIVE | latest: da6318197cfeaac6dbf10be7e6b30a8a5f583f07 (cp#54660) · 15 anchors in feed |
| SAOS-NET ⇄ TRON | LIVE | cp#33612 → 1db5006b8dbb305e… @ TRON blk 86019974 · anchors measured: 4 |
| SAOS-NET → HIVE | GATED | verified historically (d4cf936b… @ blk 10,970,856) — currently RC-regen wait |
| SAOS-NET → BLURT | GATED | anchored on-chain before (e3201815…, bfce11c8…) · RPC live now (blurt-rpc.saboin.com) — anchors resume when the fleet gate reopens |
| STEEM → ETHEREUM | GATED | ADAPTER LIVE (M3, eip155:1) · BRIDGE_ABI defined · no contract deployed on mainnet — lock op defined, mint awaits deployment |
| STEEM → SOLANA | GATED | ADAPTER LIVE (M3, solana:mainnet-beta) · program IDs staged · no program deployed — mint awaits deployment |

## Direct bridge routes (live router quotes)

- **steemEthereum** — `gated` — No bridge contract deployed on Ethereum mainnet — lock op defined, mint leg awaits verified contract (BRIDGE_ABI ready) · fee: 0 STEEM + 0.00000864142192 ETH · ETA 783s
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
  "latencyMs": 874,
  "reachable": true,
  "bids": 19,
  "asks": 50,
  "latest": "0.09692558184081984",
  "spreadPercent": 0.15397703105060973,
  "headBlock": 109386112,
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
