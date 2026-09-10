#!/usr/bin/env bun
export {}; // module scope — global-script tools collide on rpc/main (tsc TS2393, roast r6)
/**
 * Saosmartwallet — Chain Health Check
 * ===================================
 * M0 prerequisite tool (M0 gate is defined in wallet-design/final-proposal.md,
 * architecture rationale in wallet-design/wallet-architecture.md).
 *
 * WHAT IT DOES
 *   Probes a candidate RPC endpoint and produces a structured health report:
 *     1. Node reachability + supported API namespaces (jsonrpc / condenser_api / rc_api)
 *     2. Blockchain version + chain id (fork identification)
 *     3. Head block number + sync lag vs local clock
 *     4. Optional (--account): account lookup + Resource-Credits manabar probe
 *
 * ASSUMPTION (explicitly marked — do not remove without an approved decision)
 *   Defaults target a Steem-family node: JSON-RPC 2.0 over HTTP(S) with appbase
 *   namespaces. The exact target network (decision D2) and endpoint (decision D1)
 *   are OPEN decisions owned by the project owner — see
 *   wallet-design/final-proposal.md section "Decision Points D1–D5".
 *   This script is parameterized: a confirmed endpoint is testable with ZERO code
 *   changes. If D2 resolves to a different API flavor, only this file changes.
 *
 * USAGE
 *   bun tools/chain-health-check.ts --rpc https://api.steemit.com \
 *       [--account <name>] [--timeout-ms 8000] [--json]
 *
 * EXIT CODES
 *   0 = healthy   1 = degraded   2 = unreachable   3 = usage error
 *
 * SECURITY
 *   Strictly read-only: no keys, no secrets, no signed payloads are sent.
 *   Safe to run against any endpoint — worst case it times out. The tool never
 *   reads wallet keystores and never writes to disk.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  latencyMs?: number;
  detail?: unknown;
  error?: string;
}

export interface HealthCheckReport {
  rpc: string;
  checkedAt: string; // ISO-8601
  overall: 'healthy' | 'degraded' | 'unreachable';
  checks: CheckResult[];
  summary: {
    headBlock?: number;
    headBlockTime?: string;
    lagSeconds?: number; // local-clock based; subject to clock skew
    chainId?: string;
    blockchainVersion?: string;
    hardforkVersion?: string;
    namespaces: string[]; // namespaces that answered successfully
    account?: string;
    rcPercent?: number; // 0..100 of max RC
  };
  notes: string[];
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc?: string;
  id?: number;
  result?: T;
  error?: { code?: number | string; message?: string; data?: unknown };
}

// ---------------------------------------------------------------------------
// CLI parsing (hand-rolled — zero dependencies by design)
// ---------------------------------------------------------------------------

interface CliArgs {
  rpc?: string;
  account?: string;
  timeoutMs: number;
  json: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { timeoutMs: 8000, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--rpc':
        if (!next) usageError('--rpc requires a value');
        args.rpc = next;
        i++;
        break;
      case '--account':
        if (!next) usageError('--account requires a value');
        args.account = next;
        i++;
        break;
      case '--timeout-ms': {
        const n = Number(next);
        if (!Number.isFinite(n) || n <= 0) usageError('--timeout-ms requires a positive number');
        args.timeoutMs = n;
        i++;
        break;
      }
      case '--json':
        args.json = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break; // unreachable
      default:
        usageError(`unknown argument: ${a}`);
    }
  }
  if (!args.rpc) usageError('--rpc is required');
  if (!/^https?:\/\//.test(args.rpc)) usageError('--rpc must start with http:// or https://');
  return args;
}

function printUsage(): void {
  console.log(`Saosmartwallet chain health check

USAGE
  bun tools/chain-health-check.ts --rpc <url> [--account <name>] [--timeout-ms 8000] [--json]

EXAMPLE
  bun tools/chain-health-check.ts --rpc https://api.steemit.com --account someaccount

Read-only probe. Sends no keys or secrets. Exit codes: 0 healthy, 1 degraded, 2 unreachable, 3 usage error.`);
}

function usageError(msg: string): never {
  console.error(`usage error: ${msg}`);
  printUsage();
  process.exit(3);
}

// ---------------------------------------------------------------------------
// JSON-RPC transport
// ---------------------------------------------------------------------------

async function rpcCall<T>(
  endpoint: string,
  method: string,
  params: unknown,
  timeoutMs: number,
): Promise<JsonRpcResponse<T>> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as JsonRpcResponse<T>;
  if (body.error) {
    throw new Error(`RPC error: ${body.error.message ?? JSON.stringify(body.error)}`);
  }
  return body;
}

/** Runs a probe, converting any throw into a failed CheckResult. */
async function probe(
  id: string,
  label: string,
  endpoint: string,
  method: string,
  params: unknown,
  timeoutMs: number,
): Promise<{ check: CheckResult; body?: JsonRpcResponse<unknown> }> {
  const t0 = Date.now();
  try {
    const body = await rpcCall<unknown>(endpoint, method, params, timeoutMs);
    return {
      check: { id, label, status: 'pass', latencyMs: Date.now() - t0, detail: body.result },
      body,
    };
  } catch (err) {
    return {
      check: {
        id,
        label,
        status: 'fail',
        latencyMs: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Main probe sequence
// ---------------------------------------------------------------------------

async function run(args: CliArgs): Promise<HealthCheckReport> {
  const { rpc, timeoutMs } = args;
  const checks: CheckResult[] = [];
  const notes: string[] = [];
  const namespaces = new Set<string>();
  const summary: HealthCheckReport['summary'] = { namespaces: [], account: args.account };
  const rpc_ = rpc as string;

  // 1. Node version — also proves base reachability + JSON-RPC shape.
  //    NOTE: condenser_api methods take POSITIONAL (array) params on appbase nodes;
  //    sending {} yields "Bad Cast: Invalid cast from object_type to Array".
  //    Empirically verified against api.steemit.com — see worklog.
  const versionProbe = await probe(
    'version',
    'Node version (condenser_api.get_version)',
    rpc_,
    'condenser_api.get_version',
    [],
    timeoutMs,
  );
  checks.push(versionProbe.check);
  if (versionProbe.check.status === 'pass') {
    namespaces.add('condenser_api');
    const v = versionProbe.check.detail as
      | { blockchain_version?: string; hardfork_version?: string; node_version?: string }
      | undefined;
    if (v?.blockchain_version) summary.blockchainVersion = v.blockchain_version;
    if (v?.hardfork_version) summary.hardforkVersion = v.hardfork_version;
  } else {
    notes.push('condenser_api.get_version failed — endpoint may not be an appbase/condenser node, or requires a different API flavor (decision D2).');
  }

  // 2. Chain id — primary fork identifier. Nodes differ in namespace support:
  //    database_api takes named params; condenser_api takes positional (array) params.
  let chainId: string | undefined;
  for (const [method, params] of [
    ['database_api.get_chain_id', {}],
    ['condenser_api.get_chain_id', []],
  ] as Array<[string, unknown]>) {
    const p = await probe(`chain-id:${method}`, `Chain id (${method})`, rpc_, method, params, timeoutMs);
    if (p.check.status === 'pass') {
      chainId = typeof p.body?.result === 'string' ? p.body.result : JSON.stringify(p.body?.result);
      p.check.detail = chainId;
      namespaces.add(method.split('.')[0]);
      checks.push(p.check);
      break;
    }
    // record the fallback failure only if it is the last attempt
    if (method === 'condenser_api.get_chain_id') {
      const msg = p.check.error ?? '';
      if (/could not find method|unknown method|method not found/i.test(msg)) {
        // The node is healthy — it simply does not expose chain id on these
        // namespaces. Capability note, not degradation. Fork owners running
        // their own node can enable database_api.get_chain_id.
        p.check.status = 'warn';
        p.check.error = 'chain id not exposed by this node on either namespace';
        notes.push('chain id unavailable via database_api/condenser_api on this node — required for fork identification (affects D2 evidence).');
      }
      checks.push(p.check);
    }
  }
  if (chainId) summary.chainId = chainId;

  // 3. Dynamic global properties — head block + sync lag.
  const dgp = await probe(
    'dgp',
    'Head block (condenser_api.get_dynamic_global_properties)',
    rpc_,
    'condenser_api.get_dynamic_global_properties',
    [],
    timeoutMs,
  );
  checks.push(dgp.check);
  if (dgp.check.status === 'pass') {
    namespaces.add('condenser_api');
    const d = dgp.check.detail as
      | { head_block_number?: number; head_block_time?: string; time?: string }
      | undefined;
    if (typeof d?.head_block_number === 'number') summary.headBlock = d.head_block_number;
    // appbase quirk: some nodes expose head time as `time` rather than `head_block_time` (verified against api.steemit.com).
    const headTime = d?.head_block_time ?? d?.time;
    if (headTime) {
      summary.headBlockTime = headTime;
      const headMs = Date.parse(headTime.endsWith('Z') ? headTime : `${headTime}Z`);
      if (Number.isFinite(headMs)) {
        const lagSeconds = Math.round((Date.now() - headMs) / 1000);
        summary.lagSeconds = lagSeconds;
        if (lagSeconds > 60) {
          notes.push(`Sync lag ${lagSeconds}s > 60s — node may be out of sync, or the local clock is skewed (lag is local-clock based).`);
        }
      }
    }
  }

  // 4. Optional account + RC manabar (only with --account, to avoid pointless load).
  if (args.account) {
    const acc = await probe(
      'account',
      `Account lookup (condenser_api.get_accounts [${args.account}])`,
      rpc_,
      'condenser_api.get_accounts',
      [[args.account]],
      timeoutMs,
    );
    checks.push(acc.check);
    if (acc.check.status === 'pass') {
      const list = acc.body?.result as Array<{ name?: string }> | undefined;
      if (!Array.isArray(list) || list.length === 0) {
        acc.check.status = 'warn';
        acc.check.error = 'account not found on this chain';
      }
    }

    const rc = await probe(
      'rc',
      `RC manabar (rc_api.find_rc_accounts [${args.account}])`,
      rpc_,
      'rc_api.find_rc_accounts',
      { accounts: [args.account] },
      timeoutMs,
    );
    checks.push(rc.check);
    if (rc.check.status === 'pass') {
      namespaces.add('rc_api');
      const rcAccounts = (rc.body?.result as { rc_accounts?: Array<{ rc_manabar?: { current_mana?: string | number; max_rc?: string | number } }> } | undefined)?.rc_accounts;
      const mana = rcAccounts?.[0]?.rc_manabar;
      if (mana && mana.max_rc) {
        const cur = Number(mana.current_mana ?? 0);
        const max = Number(mana.max_rc);
        if (Number.isFinite(cur) && Number.isFinite(max) && max > 0) {
          summary.rcPercent = Math.round((cur / max) * 1000) / 10;
        }
      }
    }
  } else {
    checks.push({ id: 'account', label: 'Account lookup', status: 'skip', error: 'no --account provided' });
    checks.push({ id: 'rc', label: 'RC manabar', status: 'skip', error: 'no --account provided' });
  }

  // ---------------------------------------------------------------------------
  // Verdict
  // ---------------------------------------------------------------------------
  summary.namespaces = [...namespaces].sort();
  const baseAlive = checks.find((c) => c.id === 'version')?.status === 'pass'
    || checks.find((c) => c.id === 'dgp')?.status === 'pass';
  const anyFail = checks.some((c) => c.status === 'fail');
  const lagBad = (summary.lagSeconds ?? 0) > 60;
  const lagUnknown = checks.find((c) => c.id === 'dgp')?.status !== 'pass';

  let overall: HealthCheckReport['overall'];
  if (!baseAlive) {
    overall = 'unreachable';
  } else if (anyFail || lagBad) {
    overall = 'degraded';
  } else {
    overall = 'healthy';
  }
  if (lagUnknown && baseAlive) {
    notes.push('Head block probe failed while node answered version — treat as degraded until explained.');
  }

  return {
    rpc: rpc_,
    checkedAt: new Date().toISOString(),
    overall,
    checks,
    summary,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function printHuman(r: HealthCheckReport): void {
  const mark: Record<CheckStatus, string> = { pass: '✓', warn: '!', fail: '✗', skip: '-' };
  console.log(`\nSaosmartwallet chain health check — ${r.overall.toUpperCase()}`);
  console.log(`endpoint: ${r.rpc}`);
  console.log(`checked:  ${r.checkedAt}`);
  console.log('');
  for (const c of r.checks) {
    const lat = c.latencyMs !== undefined ? ` (${c.latencyMs}ms)` : '';
    const err = c.error ? ` — ${c.error}` : '';
    console.log(`  [${mark[c.status]}] ${c.label}${lat}${err}`);
  }
  console.log('');
  if (r.summary.chainId) console.log(`  chain id:       ${r.summary.chainId}`);
  if (r.summary.blockchainVersion) console.log(`  blockchain ver: ${r.summary.blockchainVersion}`);
  if (r.summary.hardforkVersion) console.log(`  hardfork:       ${r.summary.hardforkVersion}`);
  if (r.summary.headBlock !== undefined) console.log(`  head block:     ${r.summary.headBlock}`);
  if (r.summary.lagSeconds !== undefined) console.log(`  sync lag:       ${r.summary.lagSeconds}s (local clock)`);
  if (r.summary.rcPercent !== undefined) console.log(`  RC available:   ${r.summary.rcPercent}%`);
  console.log(`  namespaces:     ${r.summary.namespaces.join(', ') || '(none answered)'}`);
  if (r.notes.length) {
    console.log('\n  notes:');
    for (const n of r.notes) console.log(`   • ${n}`);
  }
  console.log('');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = await run(args);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }
  process.exit(report.overall === 'healthy' ? 0 : report.overall === 'degraded' ? 1 : 2);
}

// Exported for future reuse by the (future) ChainAdapter test harness; the M0
// gate blocks wiring this into any package until D1/D2 are approved.
export { run as runHealthCheck, rpcCall };

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(2);
});
