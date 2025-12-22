// valuation/constants.ts
// Shared visual + Kai timing constants (strict types, no `any`).

import { kairosEpochNow } from "../../utils/kai_pulse";

export const COLORS = ["#37ffe4", "#a78bfa", "#5ce1ff", "#11d7ff"] as const;
export type Palette = readonly string[];

/**
 * φ-exact breath duration as an IEEE-754 double (NOT rounded to 5236).
 * T = 3 + √5 seconds ⇒ ms = (3 + √5) * 1000
 *
 * Use `Math.round(BREATH_MS)` only where an integer ms is required for UI timers.
 */
export const BREATH_MS: number = (3 + Math.sqrt(5)) * 1000;

/** JSON-LD context for Kai-Sigil metadata */
export const SIGIL_CTX = "https://schema.phi.network/sigil/v1" as const;

/** Canonical type tag stored in metadata */
export const SIGIL_TYPE = "Sigil" as const;
/** Size of valuation segments (in bytes) */
export const SEGMENT_SIZE = 2000 as const;

// ─────────────────────────────────────────────────────────────
// Kai "now" helpers (BigInt-safe)
// ─────────────────────────────────────────────────────────────

const MAX_SAFE_BI = BigInt(Number.MAX_SAFE_INTEGER);

/** Convert bigint → number safely (clamped to JS safe integer range). */
function toSafeNumber(x: bigint): number {
  if (x > MAX_SAFE_BI) return Number.MAX_SAFE_INTEGER;
  if (x < -MAX_SAFE_BI) return Number.MIN_SAFE_INTEGER;
  return Number(x);
}

/**
 * Epoch ms "now" as BigInt.
 * Prefers `performance.timeOrigin + performance.now()` (monotonic-ish) when available,
 * falls back to `Date.now()` when not.
 */
function epochMsNowBI(): bigint {
  const g = globalThis as unknown as { performance?: Performance };
  const p = g.performance;

  const origin = p && typeof p.timeOrigin === "number" ? p.timeOrigin : Number.NaN;
  const now = p ? p.now() : Number.NaN;
  const ms = origin + now;

  if (Number.isFinite(ms)) return BigInt(Math.floor(ms));
  return BigInt(Date.now());
}

/**
 * Current Kai pulse index (integer).
 * NOTE: `kairosEpochNow()` returns μpulses since GENESIS (BigInt).
 * 1 pulse = 1_000_000 μpulses.
 */
export const kaiPulseNow = (): number => {
  const pμ = kairosEpochNow(epochMsNowBI());
  const pulse = pμ / 1_000_000n;
  return toSafeNumber(pulse);
};
