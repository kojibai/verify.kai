// src/sigilstream/core/kai_time.ts
// Eternal-Klok core (μpulse math): constants + conversions

import type { LocalKai, KaiMomentStrict } from "./types"; // ✅ type-only import
import {
  WEEKDAY,
  DAY_TO_CHAKRA,
  DAYS_PER_WEEK,
  DAYS_PER_MONTH,
  MONTHS_PER_YEAR,
  ETERNAL_MONTH_NAMES,
  WEEK_TITLES,
} from "./types";
import { pad2, imod, floorDiv, roundTiesToEvenBigInt } from "./utils";

/** Genesis (bridge) — 2024-05-10 06:45:41.888 UTC */
export const GENESIS_TS = Date.UTC(2024, 4, 10, 6, 45, 41, 888);

/** Breath period (seconds) — exact φ form */
export const KAI_PULSE_SEC = 3 + Math.sqrt(5); // ≈ 5.236s

/** One pulse in milliseconds (for UI timing) */
export const PULSE_MS = KAI_PULSE_SEC * 1000;

/** Micro-pulses per pulse (exact) */
export const ONE_PULSE_MICRO = 1_000_000n;

/** Exact daily closure in micro-pulses (canonical) */
export const N_DAY_MICRO = 17_491_270_421n;

/** Steps per beat (exact) */
export const STEPS_BEAT = 44 as const;

/** Micro-pulses per step (11 pulses/step × 1e6) */
export const PULSES_PER_STEP_MICRO = 11_000_000n;

/**
 * Micro-pulses per beat. N_DAY_MICRO / 36 with half-step rounding.
 * (For canonical parity with existing clients; “ties-to-even” retained.)
 */
export const MU_PER_BEAT_EXACT = (N_DAY_MICRO + 18n) / 36n;

/** Convert a JS Date to absolute micro-pulses since Genesis (ties-to-even) */
export function microPulsesSinceGenesis(date: Date): bigint {
  const deltaSec = (date.getTime() - GENESIS_TS) / 1000;
  const pulses = deltaSec / KAI_PULSE_SEC;
  const micro = pulses * 1_000_000;
  return roundTiesToEvenBigInt(micro);
}

export function computeLocalKaiFromMicroPulses(pμ_total: bigint): LocalKai {
  const pμ_in_day = imod(pμ_total, N_DAY_MICRO);
  const dayIndex = floorDiv(pμ_total, N_DAY_MICRO);

  const beat = Number(floorDiv(pμ_in_day, MU_PER_BEAT_EXACT));
  const _pμ_in_beat = pμ_in_day - BigInt(beat) * MU_PER_BEAT_EXACT;

  const rawStep = Number(_pμ_in_beat / PULSES_PER_STEP_MICRO);
  const step = Math.min(Math.max(rawStep, 0), STEPS_BEAT - 1);
  const pμ_in_step = _pμ_in_beat - BigInt(step) * PULSES_PER_STEP_MICRO;
  const stepPct = Number(pμ_in_step) / Number(PULSES_PER_STEP_MICRO);

  const pulse = Number(floorDiv(pμ_total, ONE_PULSE_MICRO));
  const pulsesIntoBeat = Number(_pμ_in_beat / ONE_PULSE_MICRO);
  const pulsesIntoDay = Number(pμ_in_day / ONE_PULSE_MICRO);

  const harmonicDayIndex = Number(imod(dayIndex, BigInt(DAYS_PER_WEEK)));
  const harmonicDay = WEEKDAY[harmonicDayIndex]!;
  const chakraDay = DAY_TO_CHAKRA[harmonicDay];

  const dayIndexNum = Number(dayIndex);
  const dayOfMonth =
    ((dayIndexNum % DAYS_PER_MONTH) + DAYS_PER_MONTH) % DAYS_PER_MONTH + 1;

  const monthsSinceGenesis = Math.floor(dayIndexNum / DAYS_PER_MONTH);
  const monthIndex0 =
    ((monthsSinceGenesis % MONTHS_PER_YEAR) + MONTHS_PER_YEAR) %
    MONTHS_PER_YEAR;
  const monthIndex1 = monthIndex0 + 1;
  const monthName = ETERNAL_MONTH_NAMES[monthIndex0]!;

  const yearIndex = Math.floor(dayIndexNum / (DAYS_PER_MONTH * MONTHS_PER_YEAR));
  const weekIndex = Math.floor((dayOfMonth - 1) / DAYS_PER_WEEK);
  const weekName = WEEK_TITLES[weekIndex]!;

  const chakraStepString = `${beat}:${pad2(step)}`;

  return {
    pulse,
    beat,
    step,
    stepPct,
    pulsesIntoBeat,
    pulsesIntoDay,
    harmonicDay,
    chakraDay,
    chakraStepString,
    dayOfMonth,
    monthIndex0,
    monthIndex1,
    monthName,
    yearIndex,
    weekIndex,
    weekName,
    _pμ_in_day: pμ_in_day,
    _pμ_in_beat,
  };
}

/** Compute LocalKai (display/state) at a Date — μpulse-true */
export function computeLocalKai(date: Date): LocalKai {
  const pμ_total = microPulsesSinceGenesis(date);
  return computeLocalKaiFromMicroPulses(pμ_total);
}

/** Build a strict Kai label from an absolute pulse index */
export function kaiMomentFromAbsolutePulse(pulse: number): KaiMomentStrict {
  const pμ_total = BigInt(pulse) * ONE_PULSE_MICRO;
  const pμ_in_day = imod(pμ_total, N_DAY_MICRO);
  const dayIndex = floorDiv(pμ_total, N_DAY_MICRO);

  const beat = Number(floorDiv(pμ_in_day, MU_PER_BEAT_EXACT));
  const pμ_in_beat = pμ_in_day - BigInt(beat) * MU_PER_BEAT_EXACT;

  const stepIndex = Number(pμ_in_beat / PULSES_PER_STEP_MICRO);
  const stepClamped = Math.min(Math.max(stepIndex, 0), STEPS_BEAT - 1);

  const weekday = WEEKDAY[Number(imod(dayIndex, 6n)) as 0 | 1 | 2 | 3 | 4 | 5];
  const chakraDay = DAY_TO_CHAKRA[weekday];

  return { beat, stepIndex: stepClamped, weekday, chakraDay };
}
