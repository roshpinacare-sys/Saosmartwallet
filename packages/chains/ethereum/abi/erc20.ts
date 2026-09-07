/**
 * Saosmartwallet — minimal ERC-20 ABI (M3)
 * ========================================
 * The smallest human-readable surface the wallet actually needs. Kept as a
 * const array of signatures (ethers v6 accepts this form directly) so no
 * generated artifacts live in-tree.
 */

export const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
] as const;

/** The three functions the wallet's ERC-20 read path touches. */
export const ERC20_READ_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
] as const;

/** Token lists are runtime configuration (`trackedTokens`), never hardcoded here. */
