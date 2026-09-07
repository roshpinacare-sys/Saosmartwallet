/**
 * Saosmartwallet — bridges/inject
 * ===============================
 * Type-only shim: the structural subset of the app's eco-server payloads the
 * bridge monitor consumes. Declared here (instead of importing app code) so
 * packages/ stays dependency-free while remaining compile-checked against
 * the real shapes at the call site (src/app/api/bridge/status/route.ts).
 */

export interface AnchorRecordLike {
  id: string;
  kind: "checkpoint-anchor" | "tron-anchor" | "soldier-attest";
  chain: "steem" | "hive" | "tron" | "internal";
  cpHeight: number;
  txid: string | null;
  detail: string;
  explorer: string | null;
}

export interface EcoAnchors {
  ok: true;
  anchors: AnchorRecordLike[];
  attests: AnchorRecordLike[];
  lastCheckpoint: {
    height: number | null;
    checkpointHash: string | null;
    stateRoot: string | null;
  } | null;
  fetchedAt: string;
}

export interface SaosNetSnapshotLike {
  ok: true;
  fetchedAt: string;
  core: {
    height: number | null;
    checkpointCount: number;
    verifiedCount: number;
  };
  tronBridge: {
    address: string | null;
    anchors: number | null;
    lastAnchor: { cpHeight: number | null; txid: string | null; tronBlock: number | null; at: string | null } | null;
    pulse: { tronHeight: number | null; at: string | null } | null;
  };
  wrapped: Array<{ asset: string; supply: number; locked: number; holders: number }>;
}
