// src/components/verifier/utils/childExpiry.ts
/* ────────────────────────────────────────────────────────────────
   childExpiry.ts
   • Expiry + lock rules for SEND children + open parent links
   • KKS v1: 11 steps, 11 pulses/step → 121 pulses
────────────────────────────────────────────────────────────────── */

import type { SigilMetadata } from "../../VerifierStamper/types";
import type { SigilMetadataWithOptionals } from "../types/local";

export const PULSES_PER_STEP = 11; // Kai canon
export const CLAIM_STEPS = 7;     // claimable steps
export const CLAIM_PULSES = CLAIM_STEPS * PULSES_PER_STEP;

/**
 * Info for a child (SEND link / derivative file).
 * - used: lock consumed
 * - expired: claim window over
 * - expireAt: pulse deadline
 */
export function getChildLockInfo(
  m: SigilMetadata | null,
  nowPulse: number
): { used: boolean; expired: boolean; expireAt?: number } {
  const mm = m as SigilMetadataWithOptionals | null;
  if (!mm) return { used: false, expired: false };

  const used = !!mm.sendLock?.used;

  let expireAt = mm.childClaim?.expireAtPulse;
  if (typeof expireAt !== "number" || !Number.isFinite(expireAt)) {
    const last = mm.transfers?.slice(-1)[0];
    const issued = last?.senderKaiPulse;
    if (typeof issued === "number") expireAt = issued + CLAIM_PULSES;
  }

  const expired =
    typeof expireAt === "number"
      ? nowPulse > expireAt
      : false;

  return { used, expired, expireAt };
}

/**
 * Parent open-link expiry (the live SEND window sitting on parent).
 * Tells us if the last open transfer is still receivable.
 */
export function getParentOpenExpiry(
  m: SigilMetadata | null,
  nowPulse: number
): { expired: boolean; expireAt?: number } {
  if (!m) return { expired: false };
  const last = m.transfers?.slice(-1)[0];
  const open = !!last && !last.receiverSignature;
  if (!open) return { expired: false };

  const issued = last?.senderKaiPulse;
  if (typeof issued !== "number") return { expired: false };

  const expireAt = issued + CLAIM_PULSES;
  return { expired: nowPulse > expireAt, expireAt };
}
