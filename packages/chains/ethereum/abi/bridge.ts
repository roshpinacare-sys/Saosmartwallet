/**
 * Saosmartwallet — bridge interface ABI (M3)
 * ==========================================
 * The contract surface a Steem→Ethereum bridge rail WILL use (lock on the
 * sovereign side via custom_json, mint a wrapped asset here). HONEST STATUS:
 * no bridge contract is deployed on Ethereum mainnet yet — the adapter
 * refuses bridge operations until a verified contract address is configured.
 * This file is the interface spec, not a claim of existing infrastructure.
 */

export const BRIDGE_ABI = [
  "function verifyProof(bytes32 txId, uint256 blockHeight, bytes merkleProof) view returns (bool)",
  "function mint(address to, uint256 amount) returns (bool)",
  "function lock(address targetAddress) payable returns (bytes32 lockId)",
  "function bridgeStatus(bytes32 lockId) view returns (uint8 status, uint256 amount)",
] as const;

export const BRIDGE_MINT_ABI = [
  "function verifyProof(bytes32 txId, uint256 blockHeight, bytes merkleProof) view returns (bool)",
  "function mint(address to, uint256 amount) returns (bool)",
] as const;

export const BRIDGE_LOCK_ABI = [
  "function lock(address targetAddress) payable returns (bytes32 lockId)",
] as const;

export const BRIDGE_STATUS_ABI = [
  "function bridgeStatus(bytes32 lockId) view returns (uint8 status, uint256 amount)",
] as const;
