/**
 * KaiKlock — Canon + shared types/constants (NO React exports)
 * Keep this file “plain TS” so Fast Refresh stays perfect in KaiKlock.tsx.
 */

export const HARMONIC_DAY_PULSES = 17491.270421 as const;

/* ─── Arc model (IDs never change) ───────────────────────────── */
export type ArcName =
  | "Ignition Ark"
  | "Integration Ark"
  | "Harmonization Ark"
  | "Reflektion Ark"
  | "Purifikation Ark"
  | "Dream Ark";

export const ARCS: readonly ArcName[] = [
  "Ignition Ark",
  "Integration Ark",
  "Harmonization Ark",
  "Reflektion Ark",
  "Purifikation Ark",
  "Dream Ark",
] as const;

/* HEX neons for hardware/orb/needle */
export const ARC_COLORS: Readonly<Record<ArcName, string>> = {
  "Ignition Ark": "#ff1559",
  "Integration Ark": "#ff6d00",
  "Harmonization Ark": "#ffd900",
  "Reflektion Ark": "#00ff66",
  "Purifikation Ark": "#05e6ff",
  "Dream Ark": "#c300ff",
} as const;

/* UI-friendly captions */
export const ARC_SHORT: Readonly<Record<ArcName, string>> = {
  "Ignition Ark": "Ignite",
  "Integration Ark": "Integrate",
  "Harmonization Ark": "Harmony",
  "Reflektion Ark": "Reflekt",
  "Purifikation Ark": "Purify",
  "Dream Ark": "Dream",
} as const;

/* ─── Eternal beat/step canon (continuous) ───────────────────── */
export const ETERNAL_BEATS_PER_DAY = 36 as const;
export const ETERNAL_STEPS_PER_BEAT = 44 as const;

export const ETERNAL_PULSES_PER_BEAT =
  HARMONIC_DAY_PULSES / ETERNAL_BEATS_PER_DAY;

export const ETERNAL_PULSES_PER_STEP =
  ETERNAL_PULSES_PER_BEAT / ETERNAL_STEPS_PER_BEAT;

/* ─── φ-exact breath unit ──────────────────────────────────────
   T = 3 + √5 seconds; also provide ms for timers and Hz for reference. */
export const BREATH_SEC = 3 + Math.sqrt(5);              // ≈ 5.2360679775…
export const BREATH_MS = Math.round(BREATH_SEC * 1000);  // 5236 ms (rounded)
export const BREATH_HZ = 1 / BREATH_SEC;                 // ≈ 0.1909830056…

/* ─── Props ─────────────────────────────────────────────────── */
export type KaiKlockProps = {
  hue: string;
  pulse: number;                      // local solar-aligned pulses today
  harmonicDayPercent: number;         // 0–100
  microCyclePercent: number;          // 0–100
  dayLabel: string;
  monthLabel: string;
  monthDay: number;
  kaiPulseEternal: number;            // global eternal pulses
  glowPulse?: boolean;
  rotationOverride?: number;
  pulseIntervalSec?: number;          // defaults to BREATH_SEC
  rimFlash?: boolean;

  solarSpiralStepString?: string;
  solarSpiralStep?: {
    percentIntoStep: number;
    stepIndex: number;    // 0–43
    stepsPerBeat: number; // 44
    beatIndex: number;    // 0–35
  };

  eternalBeatIndex?: number; // 0..35
  eternalStepIndex?: number; // 0..43

  eternalWeekDescription?: string;
};
