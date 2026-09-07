/**
 * Saosmartwallet — Steem operations registry
 * ==========================================
 * Wire-exact operation packing. M0 implements `transfer` end-to-end (the op a
 * wallet must never get wrong); the registry documents standard op ids so the
 * deserializer can fail loudly on everything else instead of corrupting bytes.
 *
 * The transfer body layout { from, to, amount, memo } was validated against
 * live-chain canonical hex (see serializer.ts evidence notes).
 */

import { ByteReader, ByteWriter, type Asset, packAsset, unpackAsset } from "./serializer.js";

/** Standard Steem operation ids (graphene op tag order). */
export const OP_IDS = {
  vote: 0,
  comment: 1,
  transfer: 2,
  transfer_to_vesting: 3,
  withdraw_vesting: 4,
  limit_order_create: 5,
  limit_order_cancel: 6,
  feed_publish: 7,
  convert: 8,
  account_create: 9,
  account_update: 10,
  witness_update: 11,
  account_witness_vote: 12,
  account_witness_proxy: 13,
  custom: 15,
  report_over_production: 16,
  delete_comment: 17,
  custom_json: 18,
  comment_options: 19,
  set_withdraw_vesting_route: 20,
  limit_order_create2: 21,
  claim_account: 22,
  create_claimed_account: 23,
  request_account_recovery: 24,
  recover_account: 25,
  change_recovery_account: 26,
  escrow_transfer: 27,
  escrow_dispute: 28,
  escrow_release: 29,
  pow2: 30,
  escrow_approve: 31,
  transfer_to_savings: 33,
  transfer_from_savings: 34,
  cancel_transfer_from_savings: 35,
  custom_binary: 36,
  decline_voting_rights: 37,
  reset_account: 38,
  set_reset_account: 39,
  claim_reward_balance: 40,
  delegate_vesting_shares: 41,
  account_create_with_delegation: 42,
  witness_set_properties: 43,
  account_update2: 44,
  create_proposal: 45,
  update_proposal_votes: 46,
  remove_proposal: 47,
  update_proposal: 48,
  collateralized_convert: 49,
  recurrent_transfer: 50,
} as const;

export type OperationId = (typeof OP_IDS)[keyof typeof OP_IDS];

export interface TransferOperation {
  from: string;
  to: string;
  amount: Asset;
  /** Plain string for M0. Encrypted memos ("#…") are a Memo Vault (M2) concern. */
  memo?: string;
}

export type SteemOperationBody = TransferOperation;
export type SteemOperationName = "transfer";

export function packOperation(w: ByteWriter, name: SteemOperationName, body: SteemOperationBody): void {
  switch (name) {
    case "transfer": {
      const t = body as TransferOperation;
      w.varint(OP_IDS.transfer);
      w.string(t.from);
      w.string(t.to);
      packAsset(w, t.amount);
      w.string(t.memo ?? "");
      return;
    }
    default: {
      // Exhaustiveness guard — TypeScript rejects unhandled names at compile time.
      const _never: never = name;
      throw new Error(`unreachable operation: ${String(_never)}`);
    }
  }
}

export interface UnpackedOperation {
  id: number;
  name?: SteemOperationName;
  body?: SteemOperationBody;
}

/** Unpacks one operation; unknown ids are returned structurally, never guessed. */
export function unpackOperation(r: ByteReader): UnpackedOperation {
  const id = r.varint();
  if (id === OP_IDS.transfer) {
    const from = r.string();
    const to = r.string();
    const amount = unpackAsset(r);
    const memo = r.string();
    return { id, name: "transfer", body: { from, to, amount, memo } };
  }
  throw new Error(
    `unsupported operation id ${id} — deserializer implements "transfer" (2) only in M0; ` +
      `extend packOperation/unpackOperation before parsing other op types`,
  );
}
