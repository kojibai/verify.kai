// src/lib/sync/nopAdapter.ts
// ────────────────────────────────────────────────────────────────
// Noop IPFS Adapter — "offline / sovereign" path
// Implements IpfsLike but discards data (never publishes).
// Useful for production builds where no external network is allowed.
// ────────────────────────────────────────────────────────────────

import type { IpfsLike, PublishResult } from "./ipfsAdapter";

// Re-export the interface/types so consumers can import from this module too.
export type { IpfsLike, PublishResult } from "./ipfsAdapter";

/**
 * A no-op implementation of the IpfsLike interface.
 * It satisfies the interface but never actually publishes.
 */
export const NoopIpfs: IpfsLike = {
  async publish(_buf: Uint8Array): Promise<PublishResult> {
    void _buf;
    return { headCid: "" };
  },
};
