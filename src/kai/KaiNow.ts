// src/kai/KaiNow.ts
// STRICT: no any, browser/SSR-safe (guards), no empty catches.

import { ONE_PULSE_MICRO, kairosEpochNow, momentFromMicroPulses } from "../utils/kai_pulse";
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

/** Compute the current Kai cadence from deterministic μpulses. */
export function getKaiNow(): KaiNow {
  const micro = kairosEpochNow();
  const snap = momentFromMicroPulses(micro);
  const pulse = Math.floor(Number(micro / ONE_PULSE_MICRO));
  const beat = snap.beat % 12;
  const stepIndex = snap.stepIndex;
  const chakraDay = CHAKRAS.find((c) => c === snap.chakraDay) ?? snap.chakraDay;
  const stepPct = snap.stepPctAcrossBeat;

  return { pulse, beat, stepIndex, stepPct, chakraDay };
}
