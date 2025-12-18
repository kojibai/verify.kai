// src/lib/sync/nopAdapter.ts
// ────────────────────────────────────────────────────────────────
// Noop IPFS Adapter — "offline / sovereign" path
// Implements IpfsLike but discards data (never publishes).
// Useful for production builds where no external network is allowed.
// ────────────────────────────────────────────────────────────────

export type PublishResult = { headCid: string };

export interface IpfsLike {
  publish(buf: Uint8Array): Promise<PublishResult>;
}

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
