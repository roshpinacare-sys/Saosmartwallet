/**
 * SAOS JUMPPER — TS port of the EIP-7623-aware anchor gas model.
 * Faithful mirror of saos-jumpper/src/jumpper/anchor.py (Python original),
 * which was validated EXACTLY against real mainnet tx
 * 0x94f4cb4f…37813 (model 30,920 == actual gasUsed 30,920).
 *
 * Two rules apply and the tx pays the MAXIMUM:
 *   EIP-2028  calldataGas = 16*nonzero + 4*zero
 *   EIP-7623  tokens = zero + 4*nonzero; floor = 10*tokens
 *             gasUsed = max(21000 + calldataGas, 21000 + floor)
 */

export const BASE_GAS = 21_000n;
const GAS_NONZERO = 16n;
const GAS_ZERO = 4n;
const FLOOR_TOKEN_MULTIPLIER = 4n;
const FLOOR_COST_PER_TOKEN = 10n;

export function calldataTokens(payload: Uint8Array): bigint {
  let nonzero = 0n;
  for (const b of payload) if (b !== 0) nonzero++;
  const zero = BigInt(payload.length) - nonzero;
  return zero + FLOOR_TOKEN_MULTIPLIER * nonzero;
}

export function calldataGasEip2028(payload: Uint8Array): bigint {
  let nonzero = 0n;
  for (const b of payload) if (b !== 0) nonzero++;
  const zero = BigInt(payload.length) - nonzero;
  return nonzero * GAS_NONZERO + zero * GAS_ZERO;
}

export function calldataGasFloor(payload: Uint8Array): bigint {
  return FLOOR_COST_PER_TOKEN * calldataTokens(payload);
}

/** Effective calldata gas: whichever rule binds. */
export function calldataGas(payload: Uint8Array): bigint {
  return calldataGasEip2028(payload) > calldataGasFloor(payload)
    ? calldataGasEip2028(payload)
    : calldataGasFloor(payload);
}

export function totalGas(payload: Uint8Array): bigint {
  return BASE_GAS + calldataGas(payload);
}
