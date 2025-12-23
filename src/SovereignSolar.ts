// SovereignSolar.ts — offline sunrise anchor + solar + eternal mapping (no geolocation, no network)
// Engine: exact integers in μpulses + φ bridge via decimal.js (no drift; no float rounding in core)

import Decimal from "decimal.js";
import { epochMsFromKaiNow } from "./utils/kai_pulse";

// ──────────────────────────────────────────────────────────────
// Canon constants (Kai-Klok KKS-1.0)
// ──────────────────────────────────────────────────────────────
export const HARMONIC_DAY_PULSES = 17491.270421 as const; // pulses per day (closure-true)
export const ETERNAL_BEATS_PER_DAY = 36 as const;
export const ETERNAL_STEPS_PER_BEAT = 44 as const;

// φ-exact breath (arbitrary precision)
Decimal.set({ precision: 64, rounding: Decimal.ROUND_HALF_EVEN });
const SQRT5 = new Decimal(5).sqrt();
export const BREATH_SEC_DEC = new Decimal(3).plus(SQRT5); // 3 + √5 (exact in Decimal)
export const BREATH_SEC = Number(BREATH_SEC_DEC);         // convenience for display-only comments

// Genesis epoch (Sun-origin anchor) in Unix ms (UTC).
export const GENESIS_TS = 1715323541888 as const; // 2024-05-10T06:45:41.888Z

// (Informative) Greenwich sunrise after the flare; NOT used by engine logic.
export const SOLAR_GENESIS_UTC_TS = 1715400806000 as const; // 2024-05-11T04:13:26.000Z

// Labels
export const SOLAR_DAY_NAMES = [
  "Solhara",
  "Aquaris",
  "Flamora",
  "Verdari",
  "Sonari",
  "Kaelith",
] as const;

export const MONTHS = [
  "Aethon",
  "Virelai",
  "Solari",
  "Amarin",
  "Kaelus",
  "Umbriel",
  "Noctura",
  "Liora",
] as const;

// ──────────────────────────────────────────────────────────────
// Documentation helpers (derived φ-day length; not used in core math)
// ──────────────────────────────────────────────────────────────
export const DAY_SECONDS_DEC = new Decimal(HARMONIC_DAY_PULSES).mul(BREATH_SEC_DEC); // ≈ 91585.4813037121234755…
export const DAY_MILLISECONDS_DEC = DAY_SECONDS_DEC.mul(1000);
const kaiNowDate = () => new Date(epochMsFromKaiNow());

// ⬇️ ADD near the other exports in SovereignSolar.ts

// --- internal: μpulse-in-day from an absolute pulse (floor to whole pulse) ---
function muPosInDayFromPulse(pulse: number): bigint {
  const muAbs = BigInt(Math.max(0, Math.floor(pulse))) * MU_PER_PULSE;
  return imod(muAbs, MU_PER_DAY);
}

// Beat index (0..35) from absolute pulse (grid-scaled, exact integers)
export function beatIndexFromPulse(pulse: number): number {
  const muInDay = muPosInDayFromPulse(pulse);
  const muGrid  = (muInDay * MU_PER_GRID_DAY) / MU_PER_DAY;
  return Number(muGrid / MU_PER_GRID_BEAT);
}

// Step index (0..43) from absolute pulse (grid-scaled, exact integers)
export function stepIndexFromPulse(
  pulse: number,
  stepsPerBeat: number = ETERNAL_STEPS_PER_BEAT
): number {
  const muInDay = muPosInDayFromPulse(pulse);
  const muGrid  = (muInDay * MU_PER_GRID_DAY) / MU_PER_DAY;
  const muInBeat = muGrid % MU_PER_GRID_BEAT;
  const idx = Number(muInBeat / MU_PER_GRID_STEP);
  return Math.min(Math.max(0, idx), Math.max(1, stepsPerBeat) - 1);
}

// 0..1 progress into current step (exact)
export function percentIntoStepFromPulse(pulse: number): number {
  const muInDay = muPosInDayFromPulse(pulse);
  const muGrid  = (muInDay * MU_PER_GRID_DAY) / MU_PER_DAY;
  const muInBeat = muGrid % MU_PER_GRID_BEAT;
  const muInStep = muInBeat % MU_PER_GRID_STEP;
  return Number(muInStep) / Number(MU_PER_GRID_STEP);
}

// Whole pulses into the current beat (0..483)
export function pulsesIntoBeatFromPulse(pulse: number): number {
  const muInDay = muPosInDayFromPulse(pulse);
  const muGrid  = (muInDay * MU_PER_GRID_DAY) / MU_PER_DAY;
  const muInBeat = muGrid % MU_PER_GRID_BEAT;
  return Number(muInBeat / MU_PER_PULSE);
}

// Kai calendar from absolute pulse (exact integer math; abs day is 1-based)
export function kaiCalendarFromPulse(pulse: number) {
  const muAbs = BigInt(Math.trunc(pulse)) * MU_PER_PULSE;
  const absDayIdxBI = muAbs / MU_PER_DAY;          // 0..∞
  const absDayIdx   = Number(absDayIdxBI) + 1;     // 1..∞

  const DAYS_PER_WEEK = 6, WEEKS_PER_MONTH = 7, MONTHS_PER_YEAR = 8;
  const DAYS_PER_MONTH = DAYS_PER_WEEK * WEEKS_PER_MONTH; // 42
  const DAYS_PER_YEAR  = DAYS_PER_MONTH * MONTHS_PER_YEAR; // 336

  const dYear = Number(((absDayIdxBI % BigInt(DAYS_PER_YEAR)) + BigInt(DAYS_PER_YEAR)) % BigInt(DAYS_PER_YEAR)); // 0..335
  const yearIdx  = Math.floor(Number(absDayIdxBI) / DAYS_PER_YEAR);
  const monthIdx = Math.floor(dYear / DAYS_PER_MONTH);     // 0..7
  const dayInMonth = (dYear % DAYS_PER_MONTH) + 1;         // 1..42
  const weekOfYear = Math.floor(dYear / DAYS_PER_WEEK);    // 0..55
  const weekOfMonth = Math.floor((dayInMonth - 1) / DAYS_PER_WEEK); // 0..6
  const dayOfWeek = (dYear % DAYS_PER_WEEK) + 1;           // 1..6

  return { absDayIdx, yearIdx, monthIdx, weekOfYear, weekOfMonth, dayInMonth, dayOfWeek };
}

// Φ-spiral level (document/display helper)
export function phiSpiralLevelFromPulse(pulse: number): number {
  const PHI = (1 + Math.sqrt(5)) / 2;
  return Math.floor(Math.log(Math.max(pulse, 1)) / Math.log(PHI));
}

// ──────────────────────────────────────────────────────────────
// Engine constants — exact integers in μpulses (1 pulse = 1_000_000 μpulses)
// ──────────────────────────────────────────────────────────────
const MU_PER_PULSE = 1_000_000n as const;

// Exact micro-pulses per day (17,491.270421 pulses/day)
const MU_PER_DAY = 17_491_270_421n as const;

// Semantic grid (36 beats × 44 steps × 11 pulses)
const GRID_PULSES_PER_STEP = 11n;                                                   // pulses
const GRID_PULSES_PER_BEAT = GRID_PULSES_PER_STEP * BigInt(ETERNAL_STEPS_PER_BEAT); // 484
const GRID_PULSES_PER_DAY  = GRID_PULSES_PER_BEAT * BigInt(ETERNAL_BEATS_PER_DAY);  // 17,424

// Micro-pulse versions (exact integers)
const MU_PER_GRID_STEP = GRID_PULSES_PER_STEP * MU_PER_PULSE; // 11e6
const MU_PER_GRID_BEAT = GRID_PULSES_PER_BEAT * MU_PER_PULSE; // 484e6
const MU_PER_GRID_DAY  = GRID_PULSES_PER_DAY  * MU_PER_PULSE; // 17,424e6

// ──────────────────────────────────────────────────────────────
// Behavior toggle — DAILY anchor vs GENESIS tiling
// Default: DAILY to match “UTC-midnight + offset” feel
// ──────────────────────────────────────────────────────────────
const USE_DAILY_ANCHOR = true as const;

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const imod = (x: bigint, m: bigint) => ((x % m) + m) % m;

// Typed union + helper to avoid `any`
type OffsetInput = number | string | Decimal;
function toDecimal(v: OffsetInput): Decimal {
  return v instanceof Decimal ? v : new Decimal(v as number | string);
}

// φ-bridge: Chronos (Unix ms) → μpulses since GENESIS, exact to 1 μpulse
function muSinceGenesis(unixMs: number): bigint {
  const deltaS = new Decimal(unixMs).minus(GENESIS_TS).div(1000);
  const pulses = deltaS.div(BREATH_SEC_DEC);            // (s) / (3+√5) ⇒ pulses (Decimal)
  const micro  = pulses.mul(1_000_000);                 // ⇒ μpulses (Decimal)
  const floored = micro.toDecimalPlaces(0, Decimal.ROUND_FLOOR);
  return BigInt(floored.toString());                   // exact integer μpulses
}

// μpulses → Unix ms (for UI-only timestamps; rounded to nearest ms, ties-to-even)
function unixMsFromMu(mu: bigint): number {
  const pulses = new Decimal(mu.toString()).div(1_000_000); // pulses (Decimal)
  const seconds = pulses.mul(BREATH_SEC_DEC);               // seconds (Decimal)
  const ms = seconds.mul(1000).plus(GENESIS_TS);
  return Number(ms.toNearest(1, Decimal.ROUND_HALF_EVEN).toString());
}

// ──────────────────────────────────────────────────────────────
/** Local storage (sunrise offset model) — store exact value as string */
// ──────────────────────────────────────────────────────────────
const KEY_OFFSET_SEC = "kai.sunrise.offsetSec"; // seconds after UTC midnight (may be fractional)
const KEY_ANCHOR_ISO = "kai.sunrise.anchorISO"; // optional: last tap time for reference

/** Read persisted sunrise offset (seconds after UTC midnight) as Decimal. */
function getSunriseOffsetSecDec(): Decimal {
  const raw = localStorage.getItem(KEY_OFFSET_SEC);
  try {
    return raw ? new Decimal(raw) : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

/** Public compat: read sunrise offset as number (display only). */
export function getSunriseOffsetSec(): number {
  return Number(getSunriseOffsetSecDec());
}

/** Persist sunrise offset (seconds after UTC midnight, normalized to [0,86400)) — exact string. */
export function setSunriseOffsetSec(sec: OffsetInput) {
  const d = toDecimal(sec);
  // Only for wall-clock offset relative to *UTC midnight* (human input); Kai math does not use 24h.
  const normalized = d.mod(86400).plus(86400).mod(86400); // ((sec % 86400)+86400)%86400
  localStorage.setItem(KEY_OFFSET_SEC, normalized.toString());
  localStorage.setItem(KEY_ANCHOR_ISO, kaiNowDate().toISOString());
}

/** Convenience: set offset so that "sun rose now". */
export function tapSunroseNow(now = kaiNowDate()) {
  const utcMid = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // Date gives ms resolution; fine for an *offset*.
  const sec = new Decimal(now.getTime() - utcMid.getTime()).div(1000);
  setSunriseOffsetSec(sec);
}

/** Convenience: set offset from HH:MM[:SS[.fff…]] local wall time. */
export function setSunriseFromLocalHHMM(hhmm: string, now = kaiNowDate()) {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/);
  if (!m) return;
  const hh = Math.min(23, Math.max(0, Number(m[1])));
  const mm = Math.min(59, Math.max(0, Number(m[2])));
  const ss = m[3] ? Math.min(59, Math.max(0, Number(m[3]))) : 0;
  const frac = m[4] ? new Decimal("0." + m[4]) : new Decimal(0);

  const localMid = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const localCandidate = new Date(localMid.getTime());
  localCandidate.setHours(hh, mm, ss, 0);

  const candidateMs = new Decimal(localCandidate.getTime()).plus(frac.mul(1000));
  const utcMid = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const offsetSec = candidateMs.minus(utcMid.getTime()).div(1000);
  setSunriseOffsetSec(offsetSec);
}

// ──────────────────────────────────────────────────────────────
// Exact φ-day tiling windows (μpulse); choose daily or genesis anchor
// ──────────────────────────────────────────────────────────────

/** Genesis-anchored: first local sunrise ≥ GENESIS_TS (exact). */
function muGenesisFirstSunriseLocal(): bigint {
  const offSec = getSunriseOffsetSecDec();
  const g = new Date(GENESIS_TS);
  const utcMid0 = Date.UTC(g.getUTCFullYear(), g.getUTCMonth(), g.getUTCDate());

  const candidateMu = muSinceGenesis(
    new Decimal(utcMid0).plus(offSec.mul(1000)).toNumber()
  );
  const genesisMu = muSinceGenesis(GENESIS_TS);

  return (candidateMu <= genesisMu) ? candidateMu + MU_PER_DAY : candidateMu;
}

/** GENESIS-tiling window: phase-locked to muGenesisFirstSunriseLocal. */
function muSolarWindowGenesis(now = kaiNowDate()) {
  const muFirst = muGenesisFirstSunriseLocal();
  const muNow = muSinceGenesis(now.getTime());
  const diff = muNow - muFirst;
  const k = diff >= 0n ? diff / MU_PER_DAY : -(((-diff) + MU_PER_DAY - 1n) / MU_PER_DAY);
  const muLast = muFirst + k * MU_PER_DAY;
  const muNext = muLast + MU_PER_DAY;
  return { muLast, muNext, muNow };
}

/** DAILY-anchored window: today’s UTC-midnight + stored offset (feels like old impl). */
function muSolarWindowDaily(now = kaiNowDate()) {
  const offSec = getSunriseOffsetSecDec();
  const muNow  = muSinceGenesis(now.getTime());

  const utcMidTodayMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );

  const candMs = new Decimal(utcMidTodayMs).plus(offSec.mul(1000));
  const muCand = muSinceGenesis(candMs.toNumber());

  let muLast = muCand;
  let muNext = muCand + MU_PER_DAY;
  if (muNow < muCand) {
    muLast = muCand - MU_PER_DAY;
    muNext = muCand;
  }
  return { muLast, muNext, muNow };
}

/** Active window selector (daily by default). */
function muSolarWindow(now = kaiNowDate()) {
  return USE_DAILY_ANCHOR ? muSolarWindowDaily(now) : muSolarWindowGenesis(now);
}

/** UI helper: Date window (rounded to nearest ms, UI-only). */
export function getSolarWindow(now = kaiNowDate()) {
  const { muLast, muNext } = muSolarWindow(now);
  return {
    lastSunrise: new Date(unixMsFromMu(muLast)),
    nextSunrise: new Date(unixMsFromMu(muNext)),
  };
}

// ──────────────────────────────────────────────────────────────
// Eternal pulses (GENESIS-anchored) — integer UI (whole numbers only)
// ──────────────────────────────────────────────────────────────

/** Exact eternal micro-pulses since GENESIS (engine). */
export function getKaiMicroPulseEternal(now = kaiNowDate()): bigint {
  return muSinceGenesis(now.getTime());
}

/** Eternal pulses (whole number for frontend; no decimals). */
export function getKaiPulseEternalInt(now = kaiNowDate()): number {
  const mu = getKaiMicroPulseEternal(now);
  return Number(mu / MU_PER_PULSE); // floor (safe for ≥ genesis)
}

/** Alias kept for callers importing `getKaiPulseEternal`. */
export function getKaiPulseEternal(now = kaiNowDate()): number {
  return getKaiPulseEternalInt(now);
}

// ──────────────────────────────────────────────────────────────
// Map now → pulses/beat/step (solar-aligned) with exact integer grid mapping
// ──────────────────────────────────────────────────────────────

export function getKaiPulseToday(now = kaiNowDate()): {
  // Back-compat & UI fields:
  kaiPulseToday: number;           // whole-number pulses in the φ-day (kept for callers)
  kaiPulseTodayInt: number;        // same integer (explicit)
  kaiPulseTodayContinuous: number; // fractional within-day pulses (for diagnostics/graphs)
  beatIndex: number;               // 0..35
  stepIndex: number;               // 0..43
  dayPercent: number;              // 0..100 (soft display)
  percentIntoStep: number;         // 0..100 (soft display)
} {
  const { muLast, muNext, muNow } = muSolarWindow(now);
  const muSpan = muNext - muLast; // == MU_PER_DAY
  const muInto = muNow - muLast;  // 0..μSpan

  // Integer pulses in day (whole number for UI; also returned as kaiPulseToday)
  const kaiPulseTodayInt = Number(muInto / MU_PER_PULSE);
  const kaiPulseToday = kaiPulseTodayInt;

  // Continuous pulses in day (for charts/debug) — exact ratio using Decimal, then to JS number
  const cont = new Decimal(muInto.toString())
    .div(new Decimal(MU_PER_DAY.toString()))
    .mul(HARMONIC_DAY_PULSES);
  const kaiPulseTodayContinuous = Number(cont.toString());

  // Semantic grid: exact proportional mapping to 17,424-grid (integer math)
  const muGrid = (muInto * MU_PER_GRID_DAY) / MU_PER_DAY;
  const beatIndex = Number(muGrid / MU_PER_GRID_BEAT);                // 0..35
  const muInBeat = muGrid - BigInt(beatIndex) * MU_PER_GRID_BEAT;     // 0..(484e6-1)
  const stepIndex = Number(muInBeat / MU_PER_GRID_STEP);              // 0..43
  const muInStep = muInBeat - BigInt(stepIndex) * MU_PER_GRID_STEP;   // 0..(11e6-1)

  // Soft-display percentages (clamped; not used for indexes)
  const dayPercent = clamp01((Number(muInto) / Number(muSpan)) * 100);
  const percentIntoStep = clamp01((Number(muInStep) / Number(MU_PER_GRID_STEP)) * 100);

  return {
    kaiPulseToday,
    kaiPulseTodayInt,
    kaiPulseTodayContinuous,
    beatIndex,
    stepIndex,
    dayPercent,
    percentIntoStep,
  };
}

// ──────────────────────────────────────────────────────────────
// Solar-aligned calendar counters (sunrise→sunrise; exact μ math)
// ──────────────────────────────────────────────────────────────
export function getSolarAlignedCounters(now = kaiNowDate()) {
  const { muLast } = muSolarWindow(now);
  const muFirst = muGenesisFirstSunriseLocal();

  // exact integer day count since genesis sunrise (φ-day length)
  const daysSinceGenesis0 = Number((muLast - muFirst) / MU_PER_DAY); // 0..∞
  const solarAlignedDay = daysSinceGenesis0 + 1; // 1..∞

  // Wrap to current Kairos year (336 = 8 × 42)
  const dayInYear0 = ((daysSinceGenesis0 % 336) + 336) % 336; // 0..335
  const monthIndex0 = Math.floor(dayInYear0 / 42);   // 0..7
  const dayInMonth0 = dayInYear0 % 42;               // 0..41
  const weekIndex0  = Math.floor(dayInMonth0 / 6);   // 0..6
  const weekDay0    = dayInMonth0 % 6;               // 0..5

  // 1-based mirrors
  const solarAlignedMonth1        = monthIndex0 + 1;
  const solarAlignedDayInMonth1   = dayInMonth0 + 1;
  const solarAlignedWeekIndex1    = weekIndex0 + 1;
  const solarAlignedWeekDayIndex1 = weekDay0 + 1;
  const solarAlignedDayInYear1    = dayInYear0 + 1;

  return {
    // Friendly (1-based)
    solarAlignedDay,
    solarAlignedMonth: solarAlignedMonth1,
    solarAlignedWeekIndex: solarAlignedWeekIndex1,
    solarAlignedWeekDayIndex1,
    solarAlignedDayInMonth1,
    solarAlignedDayInYear1,

    // Back-compat aliases (0-based)
    solarAlignedWeekDayIndex: weekDay0,
    solarAlignedDayInMonth: dayInMonth0,

    // 0-based (logic)
    solarAlignedDayInMonth0: dayInMonth0,
    solarAlignedWeekDayIndex0: weekDay0,
    solarAlignedWeekIndex0: weekIndex0,
    solarAlignedMonthIndex0: monthIndex0,
    solarAlignedDayInYear0: dayInYear0,

    // Naming helpers (wrapped)
    dayName:   SOLAR_DAY_NAMES[weekDay0],
    monthName: MONTHS[monthIndex0],

    // Window reference (UI-only timestamps)
    lastSunrise: new Date(unixMsFromMu(muLast)),
    genesisSunriseLocal: new Date(unixMsFromMu(muFirst)),
  };
}

// ──────────────────────────────────────────────────────────────
// Eternal (GENESIS-anchored) calendar counters (exact μ math)
// ──────────────────────────────────────────────────────────────
export function getEternalAlignedCounters(now = kaiNowDate()) {
  const muNow = muSinceGenesis(now.getTime());
  const daysSinceGenesis0 = Number(muNow / MU_PER_DAY); // integer division
  const eternalDay = daysSinceGenesis0 + 1;

  const dayInYear0 = ((daysSinceGenesis0 % 336) + 336) % 336; // 0..335
  const monthIndex0 = Math.floor(dayInYear0 / 42);
  const dayInMonth0 = dayInYear0 % 42;
  const weekIndex0  = Math.floor(dayInMonth0 / 6);
  const weekDay0    = dayInMonth0 % 6;

  // 1-based mirrors
  const eternalMonth1        = monthIndex0 + 1;
  const eternalDayInMonth1   = dayInMonth0 + 1;
  const eternalWeekIndex1    = weekIndex0 + 1;
  const eternalWeekDayIndex1 = weekDay0 + 1;
  const eternalDayInYear1    = dayInYear0 + 1;

  return {
    // Friendly (1-based)
    eternalDay,
    eternalMonth: eternalMonth1,
    eternalWeekIndex: eternalWeekIndex1,
    eternalWeekDayIndex1,
    eternalDayInMonth1,
    eternalDayInYear1,

    // 0-based (logic/back-compat)
    eternalMonthIndex0: monthIndex0,
    eternalDayInMonth0: dayInMonth0,
    eternalWeekIndex0: weekIndex0,
    eternalWeekDayIndex0: weekDay0,
    eternalDayInYear0: dayInYear0,

    // Names
    dayName:   SOLAR_DAY_NAMES[weekDay0],
    monthName: MONTHS[monthIndex0],
  };
}

// ──────────────────────────────────────────────────────────────
// Display helper — UI should render Eternal by default
// ──────────────────────────────────────────────────────────────
export function getDisplayAlignedCounters(now = kaiNowDate()) {
  const solar = getSolarAlignedCounters(now);
  const eternal = getEternalAlignedCounters(now);

  return {
    display: {
      dayName: eternal.dayName,
      dayIndex1: eternal.eternalWeekDayIndex1,   // 1..6
      dayInMonth1: eternal.eternalDayInMonth1,   // 1..42
      dayInYear1: eternal.eternalDayInYear1,     // 1..336
      monthIndex1: eternal.eternalMonth,         // 1..8
      monthName: eternal.monthName,
      weekIndex1: eternal.eternalWeekIndex,      // 1..7
    },
    solar,
    eternal,
  };
}

// ──────────────────────────────────────────────────────────────
/** 6 equal solar arcs per day (exact via μ scaling; UI returns name) */
// ──────────────────────────────────────────────────────────────
export function getSolarArcName(now = kaiNowDate()): string {
  const { muLast, muNext, muNow } = muSolarWindow(now);
  const muSpan = muNext - muLast;
  const muInto = imod(muNow - muLast, MU_PER_DAY);
  const arcIndex = Number((muInto * 6n) / muSpan); // exact 0..5
  return [
    "Ignition Ark",
    "Integration Ark",
    "Harmonization Ark",
    "Reflektion Ark",
    "Purifikation Ark",
    "Dream Ark",
  ][Math.min(5, arcIndex)];
}

// ──────────────────────────────────────────────────────────────
// UI helpers — whole-number pulses only (frontend display)
// ──────────────────────────────────────────────────────────────

/** For UI that wants today's solar-aligned integer pulse and grid indices. */
export function uiKaiPulseToday(now = kaiNowDate()) : {
  kaiPulseToday: number; // whole number (no decimals)
  beatIndex: number;     // 0..35
  stepIndex: number;     // 0..43
} {
  const { kaiPulseToday, beatIndex, stepIndex } = getKaiPulseToday(now);
  return { kaiPulseToday, beatIndex, stepIndex };
}

/** For UI counters that want a single integer "Kai Pulse (Eternal)". */
export function uiKaiPulseEternal(now = kaiNowDate()): number {
  return getKaiPulseEternal(now);
}
