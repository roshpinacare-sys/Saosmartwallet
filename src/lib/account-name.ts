/**
 * account-name.ts — THE one account-name validator (client + server)
 * ================================================================================
 * Single source of truth for Steem/Hive/Blurt-style account names, mirroring
 * the chain adapter's `validateAccountName` (packages/chains/steem — observed
 * chain rules, the chain itself remains the final arbiter):
 *
 *   · total length 3..16
 *   · dot-separated segments; each segment ≥ 3 chars
 *   · each segment starts [a-z], continues [a-z0-9-], ends [a-z0-9]
 *
 * History: the UI panels each carried a loose regex
 * (`/^[a-z0-9.\-]{3,16}$/`) that accepted names the network rejects —
 * "1abc", "ab", "a.b", "abc-", "abc." — which failed only at the server
 * (fail-closed but bad UX). Both panels now import THIS validator; the wire
 * adapter keeps its throwing variant so serialization semantics are untouched.
 */

export const ACCOUNT_NAME_PATTERN =
  /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;

/** Human-readable reason the name is invalid, or null when valid. */
export function accountNameError(name: string): string | null {
  if (name.length < 3 || name.length > 16) {
    return `account name length must be 3..16 (got ${name.length})`;
  }
  for (const segment of name.split(".")) {
    if (segment.length < 3) return `segment "${segment}" too short (min 3 chars)`;
    if (!/^[a-z][a-z0-9-]*$/.test(segment) || !/[a-z0-9]$/.test(segment)) {
      return `segment "${segment}" must start [a-z], end [a-z0-9], contain only a-z0-9-`;
    }
  }
  if (!ACCOUNT_NAME_PATTERN.test(name)) return `invalid account name: "${name}"`;
  return null;
}

/** Boolean convenience for UI guards. */
export function isValidAccountName(name: string): boolean {
  return accountNameError(name) === null;
}
