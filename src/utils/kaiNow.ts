// src/utils/kaiNow.ts
// Deterministic Kai “now” (Chronos-free)
// Uses a breath anchor (if provided) plus monotonic performance time to avoid
// wall-clock jumps. All consumers should import from here instead of Date.now().

type KaiNowGlobals = typeof globalThis & {
  __kai_breath_anchor?: number;
  __kai_now_override_ms?: number;
};

const g = globalThis as KaiNowGlobals;

const PERF_HAS_NOW = typeof performance !== "undefined" && typeof performance.now === "function";
const PERF_TIME_ORIGIN =
  typeof performance !== "undefined" && typeof performance.timeOrigin === "number"
    ? performance.timeOrigin
    : 0;

// Capture the perf baseline when this module loads so every call uses a
// monotonic delta from the same origin.
const PERF_ZERO = PERF_HAS_NOW ? performance.now() : 0;

const resolveAnchor = (): number => {
  if (typeof g.__kai_now_override_ms === "number") return g.__kai_now_override_ms;
  if (typeof g.__kai_breath_anchor === "number") return g.__kai_breath_anchor;
  return PERF_TIME_ORIGIN;
};

const ANCHOR_MS = resolveAnchor();

/** Chronos-free “now” in milliseconds (deterministic, pulse-locked). */
export const kaiNowMs = (): number => {
  const delta = PERF_HAS_NOW ? performance.now() - PERF_ZERO : 0;
  return ANCHOR_MS + delta;
};

/** BigInt version of kaiNowMs (ms). */
export const kaiNowBigInt = (): bigint => BigInt(Math.trunc(kaiNowMs()));

/** Convenience: Date object from the Kai now (never Date.now()). */
export const kaiNowDate = (): Date => new Date(kaiNowMs());
