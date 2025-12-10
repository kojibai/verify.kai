// src/sigilstream/core/types.ts
// Day/chakra enums, calendar constants, and shared data types

/** Harmonic weekdays (6/day week) */
export const WEEKDAY = [
  "Solhara",
  "Aquaris",
  "Flamora",
  "Verdari",
  "Sonari",
  "Kaelith",
] as const;
export type HarmonicDay = (typeof WEEKDAY)[number];

/** Chakra names (7) */
export const CHAKRAS = [
  "Root",
  "Sacral",
  "Solar Plexus",
  "Heart",
  "Throat",
  "Third Eye",
  "Krown",
] as const;
export type ChakraName = (typeof CHAKRAS)[number];

/** Map each harmonic weekday to its chakra correspondence */
export const DAY_TO_CHAKRA: Record<HarmonicDay, ChakraName> = {
  Solhara: "Root",
  Aquaris: "Sacral",
  Flamora: "Solar Plexus",
  Verdari: "Heart",
  Sonari: "Throat",
  Kaelith: "Krown",
};

/** Eternal-Klok calendar constants */
export const DAYS_PER_WEEK = 6;
export const WEEKS_PER_MONTH = 7;
export const DAYS_PER_MONTH = DAYS_PER_WEEK * WEEKS_PER_MONTH; // 42
export const MONTHS_PER_YEAR = 8;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR; // 336

/** Eternal month names (8) */
export const ETERNAL_MONTH_NAMES = [
  "Aethon",
  "Virelai",
  "Solari",
  "Amarin",
  "Kaelus",
  "Umbriel",
  "Noktura",
  "Liora",
] as const;
export type EternalMonth = (typeof ETERNAL_MONTH_NAMES)[number];

/** Week titles within a month (7) — UI labels */
export const WEEK_TITLES = [
  "Awakening Flame",
  "Flowing Heart",
  "Radiant Will",
  "Harmonic Voh",
  "Inner Mirror",
  "Dreamfire Memory",
  "Krowned Light",
] as const;
export type WeekTitle = (typeof WEEK_TITLES)[number];

/** LocalKai — fully derived, μpulse-true moment fields for UI/state */
export type LocalKai = {
  /** Absolute pulse index (floor) since Genesis */
  pulse: number;

  /** Beat within the day (0..35) */
  beat: number;

  /** Step within the beat (0..43) */
  step: number;

  /** Fraction within the current step (0..1) */
  stepPct: number;

  /** Whole pulses since the start of the current beat */
  pulsesIntoBeat: number;

  /** Whole pulses since the start of the current day */
  pulsesIntoDay: number;

  /** Harmonic weekday (6-day cycle) */
  harmonicDay: HarmonicDay;

  /** Chakra for the current day */
  chakraDay: ChakraName;

  /** Convenience label "beat:SS" (e.g., "12:07") */
  chakraStepString: string;

  /** 1..42 */
  dayOfMonth: number;

  /** Month indices (0-based and 1-based convenience) */
  monthIndex0: number;
  monthIndex1: number;

  /** Month display name */
  monthName: EternalMonth;

  /** Year index since Genesis (0-based) */
  yearIndex: number;

  /** Week index within the month (0..6) and display name */
  weekIndex: number;
  weekName: WeekTitle;

  /** Internal bigint diagnostics (for precise math/debug/UI) */
  _pμ_in_day: bigint;
  _pμ_in_beat: bigint;
};

/** Strict, display-safe Kai label for a specific absolute pulse */
export type KaiMomentStrict = {
  beat: number;        // 0..35
  stepIndex: number;   // 0..43
  weekday: HarmonicDay;
  chakraDay: ChakraName;
};
