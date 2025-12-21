// src/kai/KaiNow.ts
// STRICT: no any, browser/SSR-safe (guards), no empty catches.

import { STEPS_BEAT } from "../utils/kai_pulse";
import { sovereignPulseNow, PULSE_MS } from "../utils/sovereign_pulse";
import type { ChakraName } from "../utils/sigilCapsule";

export type KaiNow = {
  pulse: number;
  beat: number;
  stepIndex: number;
  stepPct: number;
  chakraDay: ChakraName;
};

/** Local mapping of weekday → chakra (tweak as desired). */
const CHAKRAS: readonly ChakraName[] = [
  "Root",         // Sunday    (0)
  "Sacral",       // Monday    (1)
  "Solar Plexus", // Tuesday   (2)
  "Heart",        // Wednesday (3)
  "Throat",       // Thursday  (4)
  "Third Eye",    // Friday    (5)
  "Crown",        // Saturday  (6)
] as const;

/** Compute the current Kai cadence from sovereign pulse (no Chronos). */
export function getKaiNow(source?: Date | number): KaiNow {
  const resolvedPulse =
    typeof source === "number" && Number.isFinite(source) ? Math.floor(source) : sovereignPulseNow();

  // Distribute steps within a beat, then beats cyclically (12-beat cycle by convention)
  const stepIndex = ((resolvedPulse % STEPS_BEAT) + STEPS_BEAT) % STEPS_BEAT;
  const stepPct = Math.min(1, Math.max(0, stepIndex / Math.max(1, STEPS_BEAT - 1)));
  const beat = Math.floor(resolvedPulse / STEPS_BEAT) % 12;

  // Deterministic chakra day derived from pulse to avoid wall-clock dependence.
  const chakraDay = CHAKRAS[((resolvedPulse % CHAKRAS.length) + CHAKRAS.length) % CHAKRAS.length];

  return { pulse: resolvedPulse, beat, stepIndex, stepPct, chakraDay };
}
