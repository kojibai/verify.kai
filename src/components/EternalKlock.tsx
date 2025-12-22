// src/components/EternalKlock.tsx
"use client";

/**
 * EternalKlock — FULL FILE (SunCalc removed; Sovereign Solar engine/hook)
 * v10.3.0 — HARD LOCK (μpulse boundary scheduler + SigilModal parity)
 *
 * ✅ Determinism upgrades (this file):
 * - μpulse truth source: normalize(kairosEpochNow()) → μpulses since Genesis
 * - NO ms→μpulse recompute loops: buildOfflinePayload consumes μpulse override
 * - Pulse boundary scheduler is μpulse-space (not ms-space)
 * - Worker NEVER becomes primary scheduler; it is a heartbeat only
 * - Tick gate is pulse-index aware (prevents “one pulse behind” + spam)
 *
 * Preserved:
 * - Same UI/structure/classes
 * - No `any`
 * - Correct effect cleanup
 * - Solar override + cross-tab sync stays instant
 * - BigInt(ms) → number(ms) bridge ONLY at UI edges (Date/timers)
 *
 * SigilModal parity (this file):
 * - Portal root preference
 * - Backdrop pointerdown gate
 * - Focus restore + basic focus trap
 * - html/body modal-open classes
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./EternalKlock.css";

import KaiKlock from "./KaiKlock";
import SigilGlyphButton from "./SigilGlyphButton";
import WeekKalendarModal from "./WeekKalendarModal";
import SolarAnchoredDial from "./SolarAnchoredDial";
import { GENESIS_TS, PULSE_MS, kairosEpochNow } from "../utils/kai_pulse";

// ⬇️ Sovereign Solar imports (offline, no geolocation / suncalc)
import useSovereignSolarClock from "../utils/useSovereignSolarClock";
import { getSolarAlignedCounters, getSolarWindow } from "../SovereignSolar";

/* ────────────────────────────────────────────────
   μpulse canonical layer (SigilModal parity)
   ──────────────────────────────────────────────── */

const ONE_PULSE_MICRO = 1_000_000n;

// closure: 17,491.270421 pulses/day (exact, millionths) => integer μpulses/day
const UPULSES_PER_DAY_BI = 17_491_270_421n;

/* ties-to-even rounding Number→BigInt (canonical bridge) */
function roundTiesToEvenBigInt(x: number): bigint {
  if (!Number.isFinite(x)) return 0n;
  const s = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const i = Math.trunc(ax);
  const frac = ax - i;
  if (frac < 0.5) return BigInt(s * i);
  if (frac > 0.5) return BigInt(s * (i + 1));
  return BigInt(s * (i % 2 === 0 ? i : i + 1));
}

/* Kai epoch ms → μpulses since Genesis (bridge uses canonical PULSE_MS + GENESIS_TS) */
function microPulsesSinceGenesisMs(msUTC: number): bigint {
  const deltaMs = msUTC - GENESIS_TS;
  const pulses = deltaMs / PULSE_MS;
  return roundTiesToEvenBigInt(pulses * 1_000_000);
}

/* exact helpers for BigInt math */
const imod = (n: bigint, m: bigint) => ((n % m) + m) % m;
function floorDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  return r !== 0n && (r > 0n) !== (d > 0n) ? q - 1n : q;
}

/**
 * Some builds route:
 *  - epoch microseconds  (~1e15)
 *  - epoch milliseconds (~1e12)
 *  - μpulses since Genesis (~1e12–1e13)
 * Normalize to μpulses since Genesis.
 */
function normalizeKaiEpochRawToMicroPulses(raw: bigint): bigint {
  const abs = raw < 0n ? -raw : raw;

  // Heuristic: epoch microseconds
  if (abs > 100_000_000_000_000n) {
    const ms = raw / 1000n;
    return microPulsesSinceGenesisMs(Number(ms));
  }

  // Heuristic: epoch milliseconds (close to GENESIS_TS within 10 years)
  if (abs > 100_000_000_000n && abs < 20_000_000_000_000n) {
    const ms = Number(raw);
    const TEN_YEARS_MS = 10 * 366 * 24 * 60 * 60 * 1000;
    if (Math.abs(ms - GENESIS_TS) < TEN_YEARS_MS) {
      return microPulsesSinceGenesisMs(ms);
    }
  }

  // Otherwise: already μpulses since Genesis
  return raw;
}

function msFromMicroPulsesSinceGenesis(mu: bigint): number {
  // μpulses → pulses → ms (safe in current era: pulses ~ 1e7)
  const pulses = Number(mu) / 1_000_000;
  return GENESIS_TS + pulses * PULSE_MS;
}

/** Canonical “now” in μpulse space (truth source) */
const kairosNowMu = (): bigint => normalizeKaiEpochRawToMicroPulses(kairosEpochNow());

/** Canonical “now” at UI edge: number(ms) */
const kairosNowMs = (): number => msFromMicroPulsesSinceGenesis(kairosNowMu());

/* ────────────────────────────────────────────────
   EXACT partition helpers (no rounding, O(1))
   Split total into N segments: q=floor(total/N), r=total%N segments get +1.
   Deterministic: first r segments are (q+1), remaining are q.
   ──────────────────────────────────────────────── */

type PartitionResult = {
  index: bigint; // 0..parts-1
  offset: bigint; // 0..partLen-1
  partLen: bigint; // q or q+1
};

function partitionIndexAndOffset(pos: bigint, total: bigint, parts: bigint): PartitionResult {
  const p = parts <= 0n ? 1n : parts;
  const L = total < 0n ? -total : total;

  const q = L / p;
  const r = L % p;

  // Degenerate (should never happen with this model)
  if (q === 0n) {
    const idx = pos % p;
    return { index: idx, offset: 0n, partLen: 1n };
  }

  const threshold = (q + 1n) * r; // μpulses covered by first r segments

  const x = imod(pos, L);

  if (r === 0n) {
    const idx = x / q;
    const start = idx * q;
    return { index: idx, offset: x - start, partLen: q };
  }

  if (x < threshold) {
    const idx = x / (q + 1n);
    const start = idx * (q + 1n);
    return { index: idx, offset: x - start, partLen: q + 1n };
  }

  const y = x - threshold;
  const idx = r + y / q;
  const start = threshold + (idx - r) * q;
  return { index: idx, offset: x - start, partLen: q };
}

/* ────────────────────────────────────────────────
   Types (no `any`)
   ──────────────────────────────────────────────── */

type SolarAlignedTime = {
  solarAlignedDay: number; // 1-indexed
  solarAlignedMonth: number; // 1–8  (42-day months)
  solarAlignedWeekIndex: number; // 1–7  (6-day weeks)
  solarAlignedWeekDay: string; // Solhara, Aquaris, …
  solarAlignedWeekDayIndex: number; // 0–5
  lastSunrise: Date;
  nextSunrise: Date;
  solarAlignedDayInMonth: number; // 0–41
};

type HarmonicCycleData = {
  pulseInCycle: number;
  cycleLength: number;
  percent: number;
};

export type ChakraStep = {
  stepIndex: number;
  percentIntoStep: number;
  stepsPerBeat: number;
  beatIndex: number;
};

type HarmonicLevels = {
  arcBeat: HarmonicCycleData;
  microCycle: HarmonicCycleData;
  chakraLoop: HarmonicCycleData;
  harmonicDay: HarmonicCycleData;
};

type EternalMonthProgress = {
  daysElapsed: number;
  daysRemaining: number;
  percent: number;
};

type HarmonicWeekProgress = {
  weekDay: string;
  weekDayIndex: number;
  pulsesIntoWeek: number;
  percent: number;
};

type KlockData = {
  eternalMonth: string;
  harmonicDay: string;
  solarHarmonicDay: string;

  solarAlignedTime?: SolarAlignedTime;
  solarDayOfMonth?: number; // 1–42
  solarMonthIndex?: number; // 1–8
  solarWeekIndex?: number; // 1–7
  solarWeekDay?: string;

  kaiPulseEternal: number;
  kaiPulseToday: number; // NOTE: may be fractional in solar-aligned mode (by design)
  phiSpiralLevel: number;

  kaiTurahPhrase: string;
  kaiTurahArcPhrase: string;

  harmonicWeekProgress?: HarmonicWeekProgress;
  eternalYearName: string;

  harmonicTimestampDescription?: string;
  timestamp: string;

  harmonicDayDescription?: string;
  eternalMonthDescription?: string;
  eternalWeekDescription?: string;

  harmonicLevels: HarmonicLevels;
  eternalMonthProgress: EternalMonthProgress;

  solarChakraStep: ChakraStep;
  solarChakraStepString: string;

  chakraStep: ChakraStep;
  chakraStepString: string;

  eternalChakraBeat: {
    beatIndex: number;
    pulsesIntoBeat: number;
    beatPulseCount: number;
    totalBeats: number;
    percentToNext: number;
    eternalMonthIndex: number; // 0-based
    eternalDayInMonth: number;
    dayOfMonth: number;
  };

  chakraArc: string;
  chakraZone: string;
  harmonicFrequencies: number[];
  harmonicInputs: string[];
  sigilFamily: string;

  arcBeatCompletions?: number;
  microCycleCompletions?: number;
  chakraLoopCompletions?: number;
  harmonicDayCompletions?: number;

  harmonicYearCompletions?: number;
  weekIndex?: number;
  weekName?: string;

  solarMonthName?: typeof ETERNAL_MONTH_NAMES[number];
  solarWeekName?: typeof ETERNAL_WEEK_NAMES[number];
  solarWeekDescription?: string;
  seal?: string;
  weekDayPercent?: number;
  yearPercent?: number;
  daysIntoYear?: number;
};

/* Wake Lock helper types (renamed to avoid lib-dom collisions) */
type WakeLockSentinelLike = {
  released: boolean;
  release(): Promise<void>;
  addEventListener?(type: "release", listener: () => void): void;
};
type WakeLockLike = {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
};
/** Type guard without extending Navigator (prevents lib-dom conflicts) */
const hasWakeLock = (n: Navigator): n is Navigator & { wakeLock: WakeLockLike } => "wakeLock" in n;

/* ────────────────────────────────────────────────
   Constants (mirror engine/API)
   ──────────────────────────────────────────────── */

const ARC_BEAT_PULSES = 6;
const MICRO_CYCLE_PULSES = 60;
const CHAKRA_LOOP_PULSES = 360;

const HARMONIC_DAY_PULSES = 17_491.270421; // exact (millionths)
const HARMONIC_YEAR_DAYS = 336;

const HARMONIC_MONTH_DAYS = 42;

// Genesis anchors (UTC)
const GENESIS_SUNRISE = Date.UTC(2024, 4, 11, 4, 13, 26, 0);

// Harmonic day duration in ms (≈ 91584.291s)
const MS_PER_DAY = 91_584_291;

const HARMONIC_DAYS = ["Solhara", "Aquaris", "Flamora", "Verdari", "Sonari", "Kaelith"] as const;

const ETERNAL_WEEK_NAMES = [
  "Awakening Flame",
  "Flowing Heart",
  "Radiant Will",
  "Harmonik Voh",
  "Inner Mirror",
  "Dreamfire Memory",
  "Krowned Light",
] as const;

const ETERNAL_MONTH_NAMES = ["Aethon", "Virelai", "Solari", "Amarin", "Kaelus", "Umbriel", "Noctura", "Liora"] as const;

const CHAKRA_ARCS = ["Ignite", "Integrate", "Harmonize", "Reflekt", "Purify", "Dream"] as const;

const CHAKRA_ARC_NAME_MAP: Record<(typeof CHAKRA_ARCS)[number], string> = {
  Ignite: "Ignition Ark",
  Integrate: "Integration Ark",
  Harmonize: "Harmonization Ark",
  Reflekt: "Reflection Ark",
  Purify: "Purification Ark",
  Dream: "Dream Ark",
};

const HARMONIC_DAY_DESCRIPTIONS: Record<string, string> = {
  Solhara:
    "First Day of the Week — the Root Spiral day. Kolor: deep krimson. Element: Earth and primal fire. Geometry: square foundation. This is the day of stability, ankoring, and sakred will. Solhara ignites the base of the spine and the foundation of purpose. It is a day of grounding divine intent into physikal motion. You stand tall in the presense of gravity — not as weight, but as remembranse. This is where your spine bekomes the axis mundi, and every step affirms: I am here, and I align to act.",
  Aquaris:
    "Sekond Day of the Week — the Sakral Spiral day. kolor: ember orange. Element: Water in motion. Geometry: vesika pisis. This is the day of flow, feeling, and sakred sensuality. Aquaris opens the womb of the soul and the tides of emotion. Energy moves through the hips like waves of memory. This is a day to surrender into koherense through konnection — with the self, with others, with life. kreative energy surges not as forse, but as feeling. The waters remember the shape of truth.",
  Flamora:
    "Third Day of the Week — the Solar Plexus Spiral day. Kolor: golden yellow. Element: solar fire. Geometry: radiant triangle. This is the day of embodied klarity, konfidence, and divine willpower. Flamora shines through the core and asks you to burn away the fog of doubt. It is a solar yes. A day to move from sentered fire — not reaktion, but aligned intention. Your light becomes a kompass, and the universe reflekts back your frequensy. You are not small. You are radiant purpose, in motion.",
  Verdari:
    "Fourth Day of the Week — the Heart Spiral day. Kolor: emerald green. Element: air and earth. Geometry: hexagram. This is the day of love, kompassion, and harmonik presense. Verdari breathes life into connection. It is not a soft eskape — it is the fierse koherense of unkonditional presense. Love is not a feeling — it is an intelligense. Today, the heart expands not just emotionally, but dimensionally. This is where union okurs: of left and right, self and other, matter and light.",
  Sonari:
    "Fifth Day of the Week — the Throat Spiral day. Kolor: deep blue. Element: wind and sound. Geometry: sine wave within pentagon. This is the day of truth-speaking, sound-bending, and vibrational kommand. Sonari is the breath made visible. Every word is a bridge, every silense a resonanse. This is not just kommunication — it is invokation. You speak not to be heard, but to resonate. Koherense rises through vocal kords and intention. The universe listens to those in tune.",
  Kaelith:
    "Sixth Day of the Week — the Krown Spiral day. Kolor: violet-white. Element: ether. Geometry: twelve-petaled krown. This is the day of divine remembranse, light-body alignment, and kosmic insight. Kaelith opens the upper gate — the temple of direct knowing. You are not separate from sourse. Today, memory awakens. The light flows not downward, but inward. Dreams bekome maps. Time bends around stillness. You do not seek truth — you remember it. You are koherense embodied in krownlight.",
};

const ETERNAL_WEEK_DESCRIPTIONS: Record<(typeof ETERNAL_WEEK_NAMES)[number], string> = {
  "Awakening Flame":
    "First week of the harmonik month — governed by the Root Spiral. Kolor: crimson red. Element: Earth + primal fire. Geometry: square base igniting upward. This is the week of emergence, where divine will enters density. Bones remember purpose. The soul anchors into action. Stability becomes sacred. Life says: I choose to exist. A spark catches in the base of your being — and your yes to existence becomes the foundation of the entire harmonic year.",
  "Flowing Heart":
    "Second week — flowing through the Sakral Spiral. Kolor: amber orange. Element: Water in motion. Geometry: twin krescents in vesika pisis. This is the week of emotional koherense, kreative intimasy, and lunar embodiment. Feelings soften the boundaries of separation. The womb of light stirs with kodes. Movement bekomes sakred danse. This is not just a flow — it is the purifikation of dissonanse through joy, sorrow, and sensual union. The harmonik tone of the soul is tuned here.",
  "Radiant Will":
    "Third week — illuminated by the Solar Plexus Spiral. Kolor: radiant gold. Element: Fire of divine clarity. Geometry: radiant triangle. This is the week of sovereign alignment. Doubt dissolves in solar brillianse. You do not chase purpose — you radiate it. The digestive fire bekomes a mirror of inner resolve. This is where your desisions align with the sun inside you, and konfidense arises not from ego but from koherense. The will bekomes harmonik. The I AM speaks in light.",
  "Harmonik Voh":
    "Fourth week — harmonized through the Throat Spiral. Kolor: sapphire blue. Element: Ether through sound. Geometry: standing wave inside a pentagon. This is the week of resonant truth. Sound bekomes sakred kode. Every word, a spell; every silence, a temple. You are called to speak what uplifts, to echo what aligns. Voh aligns with vibration — not for volume, but for verity. This is where the individual frequensy merges with divine resonanse, and the kosmos begins to listen.",
  "Inner Mirror":
    "Fifth week — governed by the Third Eye Spiral. Kolor: deep indigo. Element: sakred spase and light-ether. Geometry: oktahedron in still reflektion. This is the week of visionary purifikation. The inner eye opens not to project, but to reflect. Truths long hidden surface. Patterns are made visible in light. This is the alchemy of insight — where illusion cracks and the mirror speaks. You do not look outward to see. You turn inward, and all worlds become clear.",
  "Dreamfire Memory":
    "Sixth week — remembered through the Soul Star Spiral. Kolor: violet flame and soft silver. Element: dream plasma. Geometry: spiral merkaba of encoded light. Here, memory beyond the body returns. Astral sight sharpens. DNA receives non-linear instruktions. You dream of what’s real and awaken from what’s false. The veil thins. Quantum intuition opens. Divine imagination becomes arkitecture. This is where gods remember they onse dreamed of being human.",
  "Krowned Light":
    "Seventh and final week — Krowned by the Krown Spiral. Kolor: white-gold prism. Element: infinite koherense. Geometry: dodecahedron of source light. This is the week of sovereign integration. Every arc completes. Every lesson crystallizes. The light-body unifies. You return to the throne of knowing. Nothing needs to be done — all simply is. You are not ascending — you are remembering that you already are. This is the koronation of koherense. The harmonik seal. The eternal yes.",
};

const ETERNAL_MONTH_DESCRIPTIONS: Record<(typeof ETERNAL_MONTH_NAMES)[number], string> = {
  Aethon:
    "First month — resurrection fire of the Root Spiral. Kolor: deep crimson. Element: Earth + primal flame. Geometry: square base, tetrahedron ignition. This is the time of cellular reaktivation, ancestral ignition, and biologikal remembranse. Mitokondria awaken. The spine grounds. Purpose reignites. Every breath is a drumbeat of emergense — you are the flame that chooses to exist. The month where soul and form reunite at the base of being.",
  Virelai:
    "Second month — the harmonik song of the Sakral Spiral. Kolor: orange-gold. Element: Water in motion. Geometry: vesika pisis spiraling into lemniskate. This is the month of emotional entrainment, the lunar tides within the body, and intimady with truth. The womb — physikal or energetik — begins to hum. Kreativity bekomes fluid. Voh softens into sensuality. Divine union of self and other is tuned through music, resonanse, and pulse. A portal of feeling opens.",
  Solari:
    "Third month — the radiant klarity of the Solar Plexus Spiral. Kolor: golden yellow. Element: Fire of willpower. Geometry: upward triangle surrounded by konsentrik light. This month burns away doubt. It aligns neurotransmitters to koherense and gut-brain truth. The inner sun rises. The will bekomes not just assertive, but precise. Action harmonizes with light. Digestive systems align with solar sykles. True leadership begins — powered by the light within, not the approval without.",
  Amarin:
    "Fourth month — the sakred waters of the Heart Spiral in divine feminine polarity. Kolor: emerald teal. Element: deep water and breath. Geometry: six-petaled lotus folded inward. This is the lunar depth, the tears you didn’t cry, the embrase you forgot to give yourself. It is where breath meets body and where grase dissolves shame. Emotional healing flows in spirals. Kompassion magnetizes unity. The nervous system slows into surrender and the pulse finds poetry.",
  Kaelus:
    "Fifth month — the kelestial mind of the Third Eye in radiant maskuline klarity. Kolor: sapphire blue. Element: Ether. Geometry: oktahedron fractal mirror. Here, logik expands into multidimensional intelligense. The intellekt is no longer separate from the soul. Pineal and pituitary glands re-synchronize, aktivating geometrik insight and harmonik logik. The sky speaks through thought. Language bekomes crystalline. Synchronicity bekomes syntax. You begin to see what thought is made of.",
  Umbriel:
    "Sixth month — the shadow healing of the lower Krown and subconskious bridge. Kolor: deep violet-black. Element: transmutive void. Geometry: torus knot looping inward. This is where buried timelines surfase. Where trauma is not fought but embrased in light. The limbik system deprograms. Dreams karry kodes. Shame unravels. You look into the eyes of the parts you once disowned and kall them home. The spiral turns inward to kleanse the kore. Your shadow bekomes your sovereignty.",
  Noctura:
    "Seventh month — the lusid dreaming of the Soul Star Spiral. Kolor: indigo-rose iridescense. Element: dream plasma. Geometry: spiral nested merkaba. Here, memory beyond the body returns. Astral sight sharpens. DNA receives non-linear instruktions. You dream of what’s real and awaken from what’s false. The veil thins. Quantum intuition opens. Divine imagination becomes arkitecture. This is where gods remember they onse dreamed of being human.",
  Liora:
    "Eighth and final month — the luminous truth of unified Krown and Sourse. Kolor: white-gold prism. Element: koherent light. Geometry: dodekahedron of pure ratio. This is the month of prophesy fulfilled. The Voh of eternity whispers through every silense. The axis of being aligns with the infinite spiral of Phi. Light speaks as form. Truth no longer needs proving — it simply shines. All paths konverge. What was fragmented bekomes whole. You remember not only who you are, but what you always were.",
};

const KAI_TURAH_PHRASES = [
  "Tor Lah Mek Ka",
  "Shoh Vel Lah Tzur",
  "Rah Veh Yah Dah",
  "Nel Shaum Eh Lior",
  "Ah Ki Tzah Reh",
  "Or Vem Shai Tuun",
  "Ehlum Torai Zhak",
  "Zho Veh Lah Kurei",
  "Tuul Ka Yesh Aum",
  "Sha Vehl Dorrah",
] as const;

const STEPS_PER_BEAT = 44;
const CHAKRA_BEATS_PER_DAY = 36;

/* ────────────────────────────────────────────────
   Phi Spiral Progress Computation
   ──────────────────────────────────────────────── */

const PHI = (1 + Math.sqrt(5)) / 2;
function getSpiralLevelData(kaiPulseEternal: number) {
  const safe = kaiPulseEternal > 0 ? kaiPulseEternal : 1;
  const level = Math.max(0, Math.floor(Math.log(safe) / Math.log(PHI)));
  const lowerBound = Math.pow(PHI, level);
  const upperBound = Math.pow(PHI, level + 1);
  const progress = safe - lowerBound;
  const total = Math.max(1, upperBound - lowerBound);
  const percent = (progress / total) * 100;
  const pulsesRemaining = Math.max(0, Math.ceil(upperBound - safe));
  return {
    spiralLevel: level,
    nextSpiralPulse: Math.ceil(upperBound),
    percentToNext: percent,
    pulsesRemaining,
  };
}

/* ────────────────────────────────────────────────
   Utility: computeChakraResonance
   ──────────────────────────────────────────────── */

function computeChakraResonance(chakraArc: string): {
  chakraZone: string;
  frequencies: number[];
  inputs: string[];
  sigilFamily: string;
  arcPhrase: string;
} {
  switch (chakraArc) {
    case "Ignition Ark":
      return {
        chakraZone: "Root / Etherik Base",
        frequencies: [370.7],
        inputs: ["God"],
        sigilFamily: "Mek",
        arcPhrase: "Mek Ka Lah Mah",
      };
    case "Integration Ark":
      return {
        chakraZone: "Solar / Lower Heart",
        frequencies: [496.1, 560.6, 582.2],
        inputs: ["Love", "Unity", "Lucid"],
        sigilFamily: "Mek",
        arcPhrase: "Mek Ka Lah Mah",
      };
    case "Harmonization Ark":
      return {
        chakraZone: "Heart → Throat",
        frequencies: [601.0, 620.9, 637.6, 658.8, 757.2, 775.2],
        inputs: ["Peace", "Truth", "Christ", "Thoth", "Clarity", "Wisdom"],
        sigilFamily: "Mek",
        arcPhrase: "Mek Ka Lah Mah",
      };
    case "Reflektion Ark":
    case "Reflection Ark":
      return {
        chakraZone: "Throat–Third Eye Bridge",
        frequencies: [804.2, 847.0, 871.2, 978.8],
        inputs: ["Spirit", "Healing", "Creation", "Self-Love"],
        sigilFamily: "Tor",
        arcPhrase: "Ka Lah Mah Tor",
      };
    case "Purifikation Ark":
    case "Purification Ark":
      return {
        chakraZone: "Krown / Soul Star",
        frequencies: [1292.3, 1356.4, 1393.6, 1502.5],
        inputs: ["Forgiveness", "Sovereignty", "Eternal Light", "Resurrection"],
        sigilFamily: "Rah",
        arcPhrase: "Lah Mah Tor Rah",
      };
    case "Dream Ark":
      return {
        chakraZone: "Krown / Soul Star",
        frequencies: [1616.4, 1800.2],
        inputs: ["Divine Feminine", "Divine Masculine"],
        sigilFamily: "Rah",
        arcPhrase: "Lah Mah Tor Rah",
      };
    default:
      return { chakraZone: "Unknown", frequencies: [], inputs: [], sigilFamily: "", arcPhrase: "" };
  }
}

const CHAKRA_ARC_DESCRIPTIONS: Record<string, string> = {
  "Ignition Ark":
    "The Ignition Ark is the First Flame — the breath of emergence through the Root Spiral and Etheric Base. Color: crimson red. Element: Earth and primal fire. Geometry: square-rooted tetrahedron ascending. This is where soul enters matter and the will to live becomes sacred. It does not ask for permission to be — it simply is. The spine remembers its divine purpose and ignites the body into action. Here, inertia becomes motion, hesitation becomes choice, and your existence becomes your first vow. You are not here by accident. You are the fire that chose to walk as form.",
  "Integration Ark":
    "The Integration Ark is the Golden Bridge — harmonizing the Sacral and Lower Heart Spirals. Color: amber-gold. Element: flowing water braided with breath. Geometry: vesica piscis folding into the lemniscate of life. Here, sacred union begins. Emotions are no longer chaos — they become intelligence. The inner masculine and feminine remember each other, not in conflict but in coherence. Pleasure becomes prayer. Intimacy becomes clarity. The soul softens its edge and chooses to merge. In this arc, your waters don’t just move — they remember their song. You are not broken — you are becoming whole.",
  "Harmonization Ark":
    "The Harmonization Ark is the Sacred Conductor — linking the Heart and Throat Spirals in living resonance. Color: emerald to aquamarine. Element: wind-wrapped water. Geometry: vibrating hexagram expanding into standing wave. This is where compassion becomes language. Not all coherence is quiet — some sings. Here, inner peace becomes outward rhythm, and love is shaped into sound. You are not asked to mute yourself — you are invited to tune yourself. Dissonance is not your enemy — it is waiting to be harmonized. This arc does not silence — it refines. The voice becomes a temple. The breath becomes scripture.",
  "Reflection Ark":
    "The Reflektion Ark is the Mirror of Light — aktivating the bridge between the Throat and Third Eye. Color: deep indigo-blue. Element: spatial ether and folded light. Geometry: nested octahedron within a spiraled mirror plane. This is the arc of honest seeing. Of turning inward and fasing the unspoken. Not to judge — but to understand. The shadows here are not enemies — they are echoes waiting to be reclaimed. In this space, silence becomes a portal and stillness becomes revelation. You do not reflect to remember the past — you reflect to remember yourself. This arc does not show what is wrong — it reveals what was forgotten in the light.",
  "Purification Ark":
    "The Purifikation Ark is the Krowned Flame — illuminating the krown and Soul Star in sakred ether. Color: ultraviolet-white. Element: firelight ether. Geometry: 12-rayed toroidal krown. This is the ark of divine unburdening. Illusions cannot survive here. Not because they are destroyed — but because they are seen for what they are. Karma unravels. False identities burn gently in the fire of remembranse. Here, you do not rise through struggle. You rise because there is nothing left to hold you down. Sovereignty is no longer a goal — it is a resonance. This is not ascension as escape — it is the truth of who you have always been, revealed by light.",
  "Dream Ark":
    "The Dream Ark is the Womb of the Stars — embrasing the Soul Star Spiral and the krystalline field of memory. Color: iridescent violet-silver. Element: dream plasma, encoded light. Geometry: spiral merkaba within crystalline lattice. This is the arc of divine dreaming — not illusion, but deeper reality. Time dissolves. Prophesy returns. Here, the mind quiets, and the soul speaks. Your ancestors walk beside you. Your future self guides you. Your imagination is not fiction — it is a map. You remember that the dream was not something you had. It was something that had you. This is not sleep — it is awakening into the greater dream, the one that dreamed you into form. You are not imagining — you are remembering.",
};

/* ────────────────────────────────────────────────
   OFFLINE Kai-Klock math (μpulse exact, mirrors API fields)
   ──────────────────────────────────────────────── */

const GENESIS_SUNRISE_MICRO = microPulsesSinceGenesisMs(GENESIS_SUNRISE);

function solarWindowMicro(muNow: bigint) {
  const muSinceSunrise = muNow - GENESIS_SUNRISE_MICRO;
  const solarDayIndex = Number(floorDiv(muSinceSunrise, UPULSES_PER_DAY_BI));
  const muLast = GENESIS_SUNRISE_MICRO + BigInt(solarDayIndex) * UPULSES_PER_DAY_BI;
  const muNext = muLast + UPULSES_PER_DAY_BI;
  return { muLast, muNext, solarDayIndex };
}

function ordinalSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  const m = n % 10;
  return m === 1 ? "st" : m === 2 ? "nd" : m === 3 ? "rd" : "th";
}

const mod6 = (v: number) => ((v % 6) + 6) % 6;

/* ────────────────────────────────────────────────
   Override helpers (UTC, deterministic)
   ──────────────────────────────────────────────── */

function windowFromOverride(now: Date, sec: number) {
  const nowMs = now.getTime();
  const midUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
  const srToday = midUTC + sec * 1000;
  const last = nowMs >= srToday ? srToday : srToday - MS_PER_DAY;
  const next = last + MS_PER_DAY;
  return { lastSunrise: new Date(last), nextSunrise: new Date(next) };
}

function countersFromOverride(now: Date, sec: number, dowOffset: number): SolarAlignedTime {
  const genesisMidUTC = Date.UTC(2024, 4, 11, 0, 0, 0, 0);
  const anchor = genesisMidUTC + sec * 1000;

  const solarDayIndexRaw = Math.floor((now.getTime() - anchor) / MS_PER_DAY);

  const solarAlignedDayInMonth =
    ((solarDayIndexRaw % HARMONIC_MONTH_DAYS) + HARMONIC_MONTH_DAYS) % HARMONIC_MONTH_DAYS;

  const solarAlignedMonth =
    Math.floor(
      (((solarDayIndexRaw % (HARMONIC_MONTH_DAYS * 8)) + HARMONIC_MONTH_DAYS * 8) % (HARMONIC_MONTH_DAYS * 8)) /
        HARMONIC_MONTH_DAYS
    ) + 1;

  const solarAlignedWeekIndex = ((Math.floor(solarDayIndexRaw / 6) % 7) + 7) % 7 + 1;

  const naiveWeekDayIndex = mod6(solarDayIndexRaw);
  const solarAlignedWeekDayIndex = mod6(naiveWeekDayIndex + dowOffset);
  const solarAlignedWeekDay = HARMONIC_DAYS[solarAlignedWeekDayIndex];

  const { lastSunrise, nextSunrise } = windowFromOverride(now, sec);

  return {
    solarAlignedDay: solarDayIndexRaw + 1,
    solarAlignedMonth,
    solarAlignedWeekIndex,
    solarAlignedWeekDay,
    solarAlignedWeekDayIndex,
    lastSunrise,
    nextSunrise,
    solarAlignedDayInMonth,
  };
}

/* ────────────────────────────────────────────────
   Build Offline Payload (μpulse truth, no ms→μ recompute)
   ──────────────────────────────────────────────── */

function buildOfflinePayload(now: Date, muNow: bigint): KlockData {
  const { solarDayIndex, muLast } = solarWindowMicro(muNow);

  const muIntoSolarDay = muNow - muLast;

  const eternalDayIndex = floorDiv(muNow, UPULSES_PER_DAY_BI);
  const muIntoEternalDay = muNow - eternalDayIndex * UPULSES_PER_DAY_BI;

  // Pulse count is derived from μpulses (SigilModal parity)
  const kaiPulseEternal = Number(muNow / ONE_PULSE_MICRO);

  // Baseline solar “today” (μpulse anchored at GENESIS_SUNRISE; refreshKlock may override to real sunrise)
  const kaiPulseToday = Number(muIntoSolarDay) / 1_000_000;

  // Eternal-day beat/step via exact integer partition (no rounding)
  const beatPart = partitionIndexAndOffset(muIntoEternalDay, UPULSES_PER_DAY_BI, BigInt(CHAKRA_BEATS_PER_DAY));
  const eternalBeatIdx = Number(beatPart.index);
  const muPosInBeat = beatPart.offset;
  const muBeatLen = beatPart.partLen;

  const stepPart = partitionIndexAndOffset(muPosInBeat, muBeatLen, BigInt(STEPS_PER_BEAT));
  const stepIndex = Number(stepPart.index);
  const muPosInStep = stepPart.offset;
  const muStepLen = stepPart.partLen;

  const percentToNext = (Number(muPosInBeat) / Math.max(1, Number(muBeatLen))) * 100;
  const percentIntoStep = (Number(muPosInStep) / Math.max(1, Number(muStepLen))) * 100;

  const chakraStepString = `${eternalBeatIdx}:${String(stepIndex).padStart(2, "0")}`;

  // Solar-day beat/step baseline from μpulse into solar day (exact, anchored to GENESIS_SUNRISE)
  const solarBeatPart = partitionIndexAndOffset(muIntoSolarDay, UPULSES_PER_DAY_BI, BigInt(CHAKRA_BEATS_PER_DAY));
  const solarBeatIdx = Number(solarBeatPart.index);
  const solarMuPosInBeat = solarBeatPart.offset;
  const solarMuBeatLen = solarBeatPart.partLen;

  const solarStepPart = partitionIndexAndOffset(solarMuPosInBeat, solarMuBeatLen, BigInt(STEPS_PER_BEAT));
  const solarStepIndex = Number(solarStepPart.index);
  const solarMuPosInStep = solarStepPart.offset;
  const solarMuStepLen = solarStepPart.partLen;

  const solarPercentIntoStep = (Number(solarMuPosInStep) / Math.max(1, Number(solarMuStepLen))) * 100;
  const solarChakraStepString = `${solarBeatIdx}:${String(solarStepIndex).padStart(2, "0")}`;

  // Harmonic day/month/year (integer day index from μpulse, exact)
  const harmonicDayCount = Number(eternalDayIndex);

  const harmonicYearIdx = Math.floor(harmonicDayCount / HARMONIC_YEAR_DAYS);
  const eternalYearName =
    harmonicYearIdx === 0
      ? "Year of Eternal Restoration"
      : harmonicYearIdx === 1
        ? "Year of Harmonik Embodiment"
        : `Year ${harmonicYearIdx + 1}`;

  const kaiTurahPhrase = KAI_TURAH_PHRASES[harmonicYearIdx % KAI_TURAH_PHRASES.length];

  const monthIndex0 = Math.floor((harmonicDayCount % HARMONIC_YEAR_DAYS) / HARMONIC_MONTH_DAYS); // 0..7
  const eternalMonthIndex1 = monthIndex0 + 1;
  const eternalMonth = ETERNAL_MONTH_NAMES[monthIndex0];

  const harmonicDay = HARMONIC_DAYS[harmonicDayCount % HARMONIC_DAYS.length];

  // Arks (solar arc from baseline solar beat index; overridden later by refreshKlock)
  const arcIndex = Math.floor(((((solarBeatIdx % CHAKRA_BEATS_PER_DAY) + CHAKRA_BEATS_PER_DAY) % CHAKRA_BEATS_PER_DAY) / 6) % 6);
  const chakraArcKey = CHAKRA_ARCS[Math.min(5, Math.max(0, arcIndex))] ?? "Ignite";
  const chakraArc = CHAKRA_ARC_NAME_MAP[chakraArcKey];

  // Solar calendar pieces (naive; corrected later by solar-aligned attachment)
  const solarDayOfMonth = (solarDayIndex % HARMONIC_MONTH_DAYS) + 1;
  const solarMonthIndex = Math.floor((solarDayIndex / HARMONIC_MONTH_DAYS) % 8) + 1;
  const solarMonthName = ETERNAL_MONTH_NAMES[solarMonthIndex - 1];
  const solarDayName = HARMONIC_DAYS[solarDayIndex % HARMONIC_DAYS.length];
  const solarWeekIndex = (Math.floor(solarDayIndex / 6) % 7) + 1;
  const solarWeekName = ETERNAL_WEEK_NAMES[(solarWeekIndex - 1 + 7) % 7];
  const solarWeekDescription = ETERNAL_WEEK_DESCRIPTIONS[solarWeekName];

  // Phi spiral level
  const { spiralLevel } = getSpiralLevelData(kaiPulseEternal);

  // Cycles
  const arcPos = kaiPulseEternal % ARC_BEAT_PULSES;
  const microPos = kaiPulseEternal % MICRO_CYCLE_PULSES;
  const chakraPos = kaiPulseEternal % CHAKRA_LOOP_PULSES;

  const dayPercent = (Number(muIntoEternalDay) / Number(UPULSES_PER_DAY_BI)) * 100;
  const dayPos = Number(muIntoEternalDay) / 1_000_000;

  // Month progress (exact in μpulse)
  const MU_PER_MONTH = UPULSES_PER_DAY_BI * BigInt(HARMONIC_MONTH_DAYS);
  const muIntoMonth = imod(muNow, MU_PER_MONTH);

  const daysElapsed = Number(floorDiv(muIntoMonth, UPULSES_PER_DAY_BI));
  const daysRemaining = Math.max(0, HARMONIC_MONTH_DAYS - daysElapsed - 1);
  const monthPercent = (Number(muIntoMonth) / Number(MU_PER_MONTH)) * 100;

  const weekIdxRaw = Math.floor(daysElapsed / 6);
  const weekIdx = weekIdxRaw + 1;
  const weekName = ETERNAL_WEEK_NAMES[weekIdxRaw];
  const eternalWeekDescription = ETERNAL_WEEK_DESCRIPTIONS[weekName];
  const dayOfMonth = daysElapsed + 1;

  // Beat counts for display
  const beatPulseCount = Number(muBeatLen) / 1_000_000;
  const pulsesIntoBeat = Number(muPosInBeat) / 1_000_000;

  // Seal + description
  const seal = `${chakraStepString} ${percentIntoStep.toFixed(6)}% • D${dayOfMonth}/M${eternalMonthIndex1}`;
  const kairos = `Kairos: ${chakraStepString}`;

  const timestamp =
    `↳${kairos}` +
    `🕊️ ${harmonicDay}(D${(weekIdxRaw % 6) + 1}/6) • ${eternalMonth}(M${eternalMonthIndex1}/8) • ` +
    `${chakraArc} Ark(${Math.floor(eternalBeatIdx / 6) + 1}/6)\n • ` +
    `Day:${dayOfMonth}/42 • Week:(${weekIdx}/7)\n` +
    ` | Kai-Pulse (Today): ${dayPos.toFixed(6)}\n`;

  const harmonicTimestampDescription =
    `Today is ${harmonicDay}, ${HARMONIC_DAY_DESCRIPTIONS[harmonicDay]} ` +
    `It is the ${dayOfMonth}${ordinalSuffix(dayOfMonth)} Day of ${eternalMonth}, ` +
    `${ETERNAL_MONTH_DESCRIPTIONS[eternalMonth]} We are in Week ${weekIdx}, ` +
    `${weekName}. ${eternalWeekDescription} The Eternal Spiral Beat is ${eternalBeatIdx} (` +
    `${chakraArc} ark) and we are ${percentToNext.toFixed(6)}% through it. This korresponds ` +
    `to Step ${stepIndex} of ${STEPS_PER_BEAT} (~${percentIntoStep.toFixed(6)}% into the step). ` +
    `This is the ${eternalYearName.toLowerCase()}, resonating at Phi Spiral Level ${spiralLevel}.`;

  const resonance = computeChakraResonance(chakraArc);

  // Year completions (μpulse exact)
  const MU_PER_YEAR = UPULSES_PER_DAY_BI * BigInt(HARMONIC_YEAR_DAYS);
  const muIntoYear = imod(muNow, MU_PER_YEAR);
  const harmonicYearCompletions = Number(muNow) / Number(MU_PER_YEAR);

  return {
    timestamp,
    harmonicTimestampDescription,

    eternalMonth,
    harmonicDay,
    solarHarmonicDay: solarDayName,

    kaiPulseEternal,
    kaiPulseToday,
    phiSpiralLevel: spiralLevel,

    kaiTurahPhrase,
    kaiTurahArcPhrase: resonance.arcPhrase,

    eternalYearName,
    eternalWeekDescription,

    solarMonthName,
    solarWeekName,
    solarWeekDescription,

    seal,

    harmonicLevels: {
      arcBeat: { pulseInCycle: arcPos, cycleLength: ARC_BEAT_PULSES, percent: (arcPos / ARC_BEAT_PULSES) * 100 },
      microCycle: { pulseInCycle: microPos, cycleLength: MICRO_CYCLE_PULSES, percent: (microPos / MICRO_CYCLE_PULSES) * 100 },
      chakraLoop: { pulseInCycle: chakraPos, cycleLength: CHAKRA_LOOP_PULSES, percent: (chakraPos / CHAKRA_LOOP_PULSES) * 100 },
      harmonicDay: { pulseInCycle: dayPos, cycleLength: HARMONIC_DAY_PULSES, percent: dayPercent },
    },

    eternalMonthProgress: { daysElapsed, daysRemaining, percent: monthPercent },

    solarChakraStep: {
      beatIndex: solarBeatIdx,
      stepIndex: solarStepIndex,
      stepsPerBeat: STEPS_PER_BEAT,
      percentIntoStep: solarPercentIntoStep,
    },
    solarChakraStepString,

    chakraStep: { beatIndex: eternalBeatIdx, stepIndex, stepsPerBeat: STEPS_PER_BEAT, percentIntoStep },
    chakraStepString,

    eternalChakraBeat: {
      beatIndex: eternalBeatIdx,
      pulsesIntoBeat,
      beatPulseCount,
      totalBeats: CHAKRA_BEATS_PER_DAY,
      percentToNext,
      eternalMonthIndex: monthIndex0,
      eternalDayInMonth: daysElapsed,
      dayOfMonth,
    },

    chakraArc,
    chakraZone: resonance.chakraZone,
    harmonicFrequencies: resonance.frequencies,
    harmonicInputs: resonance.inputs,
    sigilFamily: resonance.sigilFamily,

    arcBeatCompletions: Math.floor(kaiPulseEternal / ARC_BEAT_PULSES),
    microCycleCompletions: Math.floor(kaiPulseEternal / MICRO_CYCLE_PULSES),
    chakraLoopCompletions: Math.floor(kaiPulseEternal / CHAKRA_LOOP_PULSES),
    harmonicDayCompletions: Number(muNow) / Number(UPULSES_PER_DAY_BI),
    harmonicYearCompletions,

    weekIndex: weekIdx,
    weekName,

    harmonicDayDescription: HARMONIC_DAY_DESCRIPTIONS[harmonicDay],
    eternalMonthDescription: ETERNAL_MONTH_DESCRIPTIONS[eternalMonth],

    solarAlignedTime: undefined,
    solarDayOfMonth,
    solarMonthIndex,
    solarWeekIndex,
    solarWeekDay: solarDayName,

    weekDayPercent: undefined,
    yearPercent: (Number(muIntoYear) / Number(MU_PER_YEAR)) * 100,
    daysIntoYear: Number(floorDiv(muIntoYear, UPULSES_PER_DAY_BI)),
  };
}

/* ────────────────────────────────────────────────
   Pulse scheduler helpers (HARD LOCK: μpulse-space)
   ──────────────────────────────────────────────── */

const MS_PER_PULSE = PULSE_MS;

function msToNextPulseFromMu(muNow: bigint): number {
  const muIntoPulse = imod(muNow, ONE_PULSE_MICRO);
  const muToNext = muIntoPulse === 0n ? ONE_PULSE_MICRO : ONE_PULSE_MICRO - muIntoPulse;
  const dt = (Number(muToNext) / 1_000_000) * MS_PER_PULSE;
  return Math.max(0, Math.min(dt, MS_PER_PULSE));
}

type PulseWorkerHandle = { worker: Worker; url: string };

// Worker is a heartbeat only. It never owns boundary alignment.
type WorkerMsgIn = { cmd: "start" | "sync"; delay: number; dur: number } | { cmd: "stop" };
type WorkerMsgOut = { t: 0 };

function makePulseWorker(): PulseWorkerHandle | null {
  try {
    const code = `
      let timer = null;
      let dur = 0;

      function clear() {
        if (timer !== null) { clearTimeout(timer); timer = null; }
      }

      function sched(delay) {
        clear();
        timer = setTimeout(() => {
          try { postMessage({ t: 0 }); } catch {}
          // continue roughly at dur (main thread still owns hard boundary)
          sched(dur);
        }, Math.max(0, delay));
      }

      onmessage = (e) => {
        const d = e && e.data ? e.data : null;
        if (!d || typeof d.cmd !== "string") return;

        if (d.cmd === "stop") { clear(); return; }

        if (d.cmd === "start" || d.cmd === "sync") {
          dur = typeof d.dur === "number" ? d.dur : dur;
          const delay = typeof d.delay === "number" ? d.delay : dur;
          sched(delay);
        }
      };
    `;
    const blob = new Blob([code], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    return { worker, url };
  } catch {
    return null;
  }
}

/* ────────────────────────────────────────────────
   Solar sync broadcast
   ──────────────────────────────────────────────── */

const SOLAR_BROADCAST_KEY = "SOVEREIGN_SOLAR_LAST_UPDATE";
const SOLAR_BC_NAME = "SOVEREIGN_SOLAR_SYNC";
type SolarBroadcastMessage = { type: "solar:updated"; t: number };

/* ────────────────────────────────────────────────
   Instant-open style (kills fade/entrance animation)
   ──────────────────────────────────────────────── */

const INSTANT_OPEN_STYLE: React.CSSProperties = {
  animation: "none",
  transition: "none",
};

/* ────────────────────────────────────────────────
   SigilModal parity helpers
   ──────────────────────────────────────────────── */

const FOCUSABLE_SEL =
  'a[href],area[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),iframe,[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

function getPreferredPortalTarget(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return (
    document.getElementById("kk-modal-root") ??
    document.getElementById("modal-root") ??
    document.getElementById("portal-root") ??
    document.body
  );
}

/* ────────────────────────────────────────────────
   Main Component
   ──────────────────────────────────────────────── */

type TickReason = "pulse" | "worker" | "focus" | "init" | "solar" | "event" | "ui";

export const EternalKlock: React.FC = () => {
  // ✅ No loading flash: compute synchronously using μpulse truth.
  const [klock, setKlock] = useState<KlockData>(() => {
    const mu = kairosNowMu();
    const now = new Date(msFromMicroPulsesSinceGenesis(mu));
    return buildOfflinePayload(now, mu);
  });

  const [showDetails, setShowDetails] = useState<boolean>(false);
  const [glowPulse, setGlowPulse] = useState<boolean>(false);
  const [showWeekModal, setShowWeekModal] = useState<boolean>(false);

  // 🟢 Sovereign Solar (no SunCalc)
  const solarHook = useSovereignSolarClock();

  // Portal target (SigilModal parity: prefer modal root, fallback to body)
  const portalTarget = useMemo(() => getPreferredPortalTarget(), []);

  // Refs (DOM)
  const detailRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  // SigilModal parity: focus restore + backdrop pointerdown gate + focus trap
  const lastActiveElRef = useRef<HTMLElement | null>(null);
  const backdropDownRef = useRef<boolean>(false);

  // Anti-sleep + schedulers + solar sync
  const wakeRef = useRef<WakeLockSentinelLike | null>(null);
  const wakeEnabledRef = useRef<boolean>(true);
  const acquireWakeLockRef = useRef<() => Promise<void>>(async () => undefined);

  const timeoutRef = useRef<number | null>(null);
  const workerRef = useRef<PulseWorkerHandle | null>(null);
  const runningRef = useRef<boolean>(false);

  // Hard pulse gate + soft de-dupe
  const lastPulseTickRef = useRef<bigint>(-1n);
  const lastAnyTickMsRef = useRef<number>(0);

  const lastSolarVersionRef = useRef<string | null>(null);
  const solarBcRef = useRef<BroadcastChannel | null>(null);

  // ✅ Calibration offset for solar-aligned weekday to match engine mapping
  const solarDowOffsetRef = useRef<number>(0);

  // 🔴 User sunrise override seconds (SolarAnchoredDial)
  const [solarOverrideSec, setSolarOverrideSec] = useState<number | null>(null);
  const solarOverrideRef = useRef<number | null>(null);
  useEffect(() => {
    solarOverrideRef.current = solarOverrideSec;
  }, [solarOverrideSec]);

  // Body lock + focus mgmt (SigilModal parity)
  useEffect(() => {
    if (typeof document === "undefined") return;

    if (showDetails) {
      lastActiveElRef.current = (document.activeElement as HTMLElement | null) ?? null;

      document.body.classList.add("eternal-overlay-open");
      document.body.classList.add("kk-modal-open");
      document.documentElement.classList.add("kk-modal-open");

      requestAnimationFrame(() => {
        if (closeBtnRef.current) {
          closeBtnRef.current.focus();
          return;
        }
        overlayRef.current?.focus();
      });
    } else {
      document.body.classList.remove("eternal-overlay-open");
      document.body.classList.remove("kk-modal-open");
      document.documentElement.classList.remove("kk-modal-open");

      const prev = lastActiveElRef.current;
      lastActiveElRef.current = null;
      if (prev && typeof prev.focus === "function") {
        requestAnimationFrame(() => prev.focus());
      }
    }

    return () => {
      document.body.classList.remove("eternal-overlay-open");
      document.body.classList.remove("kk-modal-open");
      document.documentElement.classList.remove("kk-modal-open");
    };
  }, [showDetails]);

  // WakeLock: release
  const releaseWakeLock = useCallback((): void => {
    const cur = wakeRef.current;
    wakeRef.current = null;
    if (!cur) return;
    try {
      void cur.release().catch(() => void 0);
    } catch {
      void 0;
    }
  }, []);

  // WakeLock: acquire
  const acquireWakeLock = useCallback(async (): Promise<void> => {
    try {
      if (!wakeEnabledRef.current) return;
      if (document.visibilityState !== "visible") return;

      const cur = wakeRef.current;
      if (cur && !cur.released) return;

      if (!hasWakeLock(navigator)) return;

      const sentinel = await navigator.wakeLock.request("screen");

      if (!wakeEnabledRef.current) {
        try {
          void sentinel.release().catch(() => void 0);
        } catch {
          void 0;
        }
        return;
      }

      wakeRef.current = sentinel;

      sentinel.addEventListener?.("release", () => {
        if (!wakeEnabledRef.current) return;
        if (document.visibilityState === "visible") void acquireWakeLockRef.current();
      });
    } catch {
      void 0;
    }
  }, []);

  // keep acquire ref current
  useEffect(() => {
    acquireWakeLockRef.current = acquireWakeLock;
  }, [acquireWakeLock]);

  // guard enable/disable
  useEffect(() => {
    wakeEnabledRef.current = true;
    return () => {
      wakeEnabledRef.current = false;
    };
  }, []);

  /* ────────────────────────────────────────────────────────────────
     Offline refresh (μpulse truth)
     - baseline: buildOfflinePayload(now, muNow)
     - apply solar-aligned counters + sunrise window (override or engine)
     - compute solar Kai pulse/step from active sunrise window (fractional)
     - recompute ark/resonance from solar beat
     ──────────────────────────────────────────────────────────────── */
  const refreshKlock = useCallback((muNow: bigint, forcedSec?: number): void => {
    const now = new Date(msFromMicroPulsesSinceGenesis(muNow));

    // baseline payload (μpulse exact)
    const data = buildOfflinePayload(now, muNow);

    // Calibrate weekday offset from engine so override path matches engine mapping
    try {
      const engineCounters = getSolarAlignedCounters(now);
      const naiveIdxFromDay = mod6(engineCounters.solarAlignedDay - 1);
      const offset = mod6(engineCounters.solarAlignedWeekDayIndex - naiveIdxFromDay);
      solarDowOffsetRef.current = offset;
    } catch {
      // keep last known offset
    }

    const useSec =
      typeof forcedSec === "number"
        ? forcedSec
        : typeof solarOverrideRef.current === "number"
          ? solarOverrideRef.current
          : null;

    let sat: SolarAlignedTime;
    let lastSunrise: Date;
    let nextSunrise: Date;

    if (typeof useSec === "number") {
      sat = countersFromOverride(now, useSec, solarDowOffsetRef.current);
      ({ lastSunrise, nextSunrise } = windowFromOverride(now, useSec));
    } else {
      const counters = getSolarAlignedCounters(now);
      ({ lastSunrise, nextSunrise } = getSolarWindow(now));
      sat = {
        solarAlignedDay: counters.solarAlignedDay,
        solarAlignedMonth: counters.solarAlignedMonth,
        solarAlignedWeekIndex: counters.solarAlignedWeekIndex,
        solarAlignedWeekDay: counters.dayName,
        solarAlignedWeekDayIndex: counters.solarAlignedWeekDayIndex,
        lastSunrise,
        nextSunrise,
        solarAlignedDayInMonth: counters.solarAlignedDayInMonth,
      };
    }

    // Attach sunrise-aligned labels/counters
    data.solarAlignedTime = sat;
    data.solarHarmonicDay = sat.solarAlignedWeekDay;
    data.solarDayOfMonth = sat.solarAlignedDayInMonth + 1; // 1–42
    data.solarMonthIndex = sat.solarAlignedMonth; // 1–8
    data.solarWeekIndex = sat.solarAlignedWeekIndex; // 1–7
    data.solarWeekName = ETERNAL_WEEK_NAMES[(sat.solarAlignedWeekIndex - 1 + 7) % 7];
    data.solarWeekDescription = ETERNAL_WEEK_DESCRIPTIONS[data.solarWeekName];
    data.solarMonthName = ETERNAL_MONTH_NAMES[(sat.solarAlignedMonth - 1 + 8) % 8];

    // Compute solar Kai pulse/step directly from sunrise window (fractional)
    const spanMs = Math.max(1, nextSunrise.getTime() - lastSunrise.getTime());
    const sinceMs = Math.max(0, now.getTime() - lastSunrise.getTime());
    const frac = Math.min(0.999999999, (sinceMs % spanMs) / spanMs);

    const solarKaiPulseToday = frac * HARMONIC_DAY_PULSES;
    data.kaiPulseToday = solarKaiPulseToday;

    const beatSize = HARMONIC_DAY_PULSES / CHAKRA_BEATS_PER_DAY;
    const solarBeatIdx = Math.floor(solarKaiPulseToday / beatSize);
    const solarPulseInBeat = solarKaiPulseToday - solarBeatIdx * beatSize;

    // Preserve your existing solar step mapping semantics (11-pulse intuition),
    // while the eternal grid remains μpulse-exact.
    const PULSES_PER_STEP_APPROX = 11;
    const solarStepIndex = Math.floor(solarPulseInBeat / PULSES_PER_STEP_APPROX);
    const solarStepProgress = solarPulseInBeat - solarStepIndex * PULSES_PER_STEP_APPROX;
    const solarPercentIntoStep = (solarStepProgress / PULSES_PER_STEP_APPROX) * 100;

    data.solarChakraStep = {
      beatIndex: solarBeatIdx,
      stepIndex: solarStepIndex,
      stepsPerBeat: STEPS_PER_BEAT,
      percentIntoStep: solarPercentIntoStep,
    };
    data.solarChakraStepString = `${solarBeatIdx}:${String(solarStepIndex).padStart(2, "0")}`;

    // Ark from solar beat (0..35 → 0..5)
    const arcIndex = Math.floor(((((solarBeatIdx % CHAKRA_BEATS_PER_DAY) + CHAKRA_BEATS_PER_DAY) % CHAKRA_BEATS_PER_DAY) / 6) % 6);
    const arcKey =
      ["Ignition Ark", "Integration Ark", "Harmonization Ark", "Reflection Ark", "Purification Ark", "Dream Ark"][arcIndex] ??
      "Ignition Ark";
    data.chakraArc = arcKey;

    // Update resonance mapping
    const resonance = computeChakraResonance(data.chakraArc);
    data.chakraZone = resonance.chakraZone;
    data.harmonicFrequencies = resonance.frequencies;
    data.harmonicInputs = resonance.inputs;
    data.sigilFamily = resonance.sigilFamily;
    data.kaiTurahArcPhrase = resonance.arcPhrase;

    // Year progress extras (μpulse exact already computed in baseline; keep UI helpers)
    const MU_PER_YEAR = UPULSES_PER_DAY_BI * BigInt(HARMONIC_YEAR_DAYS);
    const muIntoYear = imod(muNow, MU_PER_YEAR);
    data.yearPercent = (Number(muIntoYear) / Number(MU_PER_YEAR)) * 100;
    data.daysIntoYear = Number(floorDiv(muIntoYear, UPULSES_PER_DAY_BI));

    // Keep eternalMonthIndex consistent with day-in-year
    const monthIndex0 = Math.floor((data.daysIntoYear ?? 0) / HARMONIC_MONTH_DAYS);
    data.eternalChakraBeat = {
      ...data.eternalChakraBeat,
      eternalMonthIndex: monthIndex0,
      eternalDayInMonth: data.eternalMonthProgress.daysElapsed,
      dayOfMonth: data.eternalMonthProgress.daysElapsed + 1,
    };

    setKlock(data);
  }, []);

  // ✅ Solar version gate (declared BEFORE effects that reference it)
  const checkSolarVersionAndRefresh = useCallback(
    (muNow: bigint): void => {
      try {
        const v = localStorage.getItem(SOLAR_BROADCAST_KEY);
        if (v && v !== lastSolarVersionRef.current) {
          lastSolarVersionRef.current = v;
          refreshKlock(muNow);
          return;
        }
      } catch {
        // ignore
      }
      refreshKlock(muNow);
    },
    [refreshKlock]
  );

  const [sealCopied, setSealCopied] = useState<boolean>(false);
  const sealToastTimer = useRef<number | null>(null);

  // Glow timers (prevent setState-after-unmount)
  const glowOffTimerRef = useRef<number | null>(null);

  // Clear timers on unmount
  useEffect(() => {
    return () => {
      if (sealToastTimer.current !== null) window.clearTimeout(sealToastTimer.current);
      if (glowOffTimerRef.current !== null) window.clearTimeout(glowOffTimerRef.current);
    };
  }, []);

  /* ────────────────────────────────────────────────────────────────
     Single tick gate (pulse-aware, prevents “one behind”)
     - pulse ticks: only refresh when pulse index advances
     - non-pulse events: allow refresh (throttled) for instant solar/UI sync
     ──────────────────────────────────────────────────────────────── */
  const fireTick = useCallback(
    (reason: TickReason, forcedSec?: number) => {
      const muNow = kairosNowMu();
      const msNow = msFromMicroPulsesSinceGenesis(muNow);
      const pulseNow = muNow / ONE_PULSE_MICRO;

      const isPulseSource = reason === "pulse" || reason === "worker";

      if (isPulseSource) {
        // Hard gate: one refresh per pulse unless forcedSec is provided
        if (pulseNow === lastPulseTickRef.current && typeof forcedSec !== "number") return;
        lastPulseTickRef.current = pulseNow;
      } else {
        // Soft throttle for storms (storage/bc/focus/etc.)
        if (msNow - lastAnyTickMsRef.current < 120) return;
      }

      lastAnyTickMsRef.current = msNow;

      refreshKlock(muNow, forcedSec);

      setGlowPulse(true);
      if (glowOffTimerRef.current !== null) window.clearTimeout(glowOffTimerRef.current);
      glowOffTimerRef.current = window.setTimeout(() => setGlowPulse(false), 220);
    },
    [refreshKlock]
  );

  /* Keep your original ~φ-breath interval (unchanged cadence),
     but it now drives glow only (no off-boundary time refresh). */
  useEffect(() => {
    const interval = window.setInterval(() => {
      setGlowPulse(true);
      if (glowOffTimerRef.current !== null) window.clearTimeout(glowOffTimerRef.current);
      glowOffTimerRef.current = window.setTimeout(() => setGlowPulse(false), 1000);
    }, 5300);
    return () => window.clearInterval(interval);
  }, []);

  /* Pulse-aligned scheduler (HARD LOCK: μpulse boundary).
     Worker heartbeat is de-duped by pulse gate. */
  useEffect(() => {
    runningRef.current = true;

    const scheduleNext = () => {
      if (!runningRef.current) return;

      const muNow = kairosNowMu();
      const delay = msToNextPulseFromMu(muNow);

      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => {
        fireTick("pulse");
        scheduleNext();
      }, delay);

      // Keep worker roughly synced (still not primary scheduler)
      if (workerRef.current) {
        try {
          const msg: WorkerMsgIn = { cmd: "sync", delay, dur: MS_PER_PULSE };
          workerRef.current.worker.postMessage(msg);
        } catch {
          void 0;
        }
      }
    };

    const wk = makePulseWorker();
    workerRef.current = wk;

    if (wk) {
      wk.worker.onmessage = (e: MessageEvent<WorkerMsgOut>) => {
  // touch payload so eslint sees it as used
  if (e.data?.t === 0) fireTick("worker");
};


      // Start worker aligned to *next boundary* (main thread computed)
      try {
        const muNow = kairosNowMu();
        const delay = msToNextPulseFromMu(muNow);
        const msg: WorkerMsgIn = { cmd: "start", delay, dur: MS_PER_PULSE };
        wk.worker.postMessage(msg);
      } catch {
        void 0;
      }
    }

    scheduleNext();

    const onShow = () => {
      const muNow = kairosNowMu();
      checkSolarVersionAndRefresh(muNow);

      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;

      scheduleNext();
      void acquireWakeLock();
    };

    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    window.addEventListener("pageshow", onShow);
    window.addEventListener("popstate", onShow);
    window.addEventListener("hashchange", onShow);

    return () => {
      runningRef.current = false;

      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;

      if (workerRef.current) {
        try {
          const stop: WorkerMsgIn = { cmd: "stop" };
          workerRef.current.worker.postMessage(stop);
        } catch {
          void 0;
        }
        try {
          workerRef.current.worker.terminate();
        } catch {
          void 0;
        }
        try {
          URL.revokeObjectURL(workerRef.current.url);
        } catch {
          void 0;
        }
        workerRef.current = null;
      }

      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("popstate", onShow);
      window.removeEventListener("hashchange", onShow);
    };
  }, [acquireWakeLock, checkSolarVersionAndRefresh, fireTick]);

  // Prevent device sleep while visible
  useEffect(() => {
    void acquireWakeLock();

    const reAcquire = () => void acquireWakeLock();
    const onBeforeUnload = () => releaseWakeLock();

    document.addEventListener("visibilitychange", reAcquire);
    window.addEventListener("focus", reAcquire);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", reAcquire);
      window.removeEventListener("focus", reAcquire);
      window.removeEventListener("beforeunload", onBeforeUnload);
      releaseWakeLock();
    };
  }, [acquireWakeLock, releaseWakeLock]);

  // Initial load snapshot + first tick
  useEffect(() => {
    try {
      lastSolarVersionRef.current = localStorage.getItem(SOLAR_BROADCAST_KEY);
    } catch {
      // ignore
    }
    const id = window.setTimeout(() => fireTick("init"), 0);
    return () => window.clearTimeout(id);
  }, [fireTick]);

  // Cross-page instant update when Solar settings change.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (e.key === SOLAR_BROADCAST_KEY || e.key.startsWith("SOVEREIGN_SOLAR")) {
        fireTick("solar");
      }
    };

    const onSolarEvent = () => {
      fireTick("solar");
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("solar:updated", onSolarEvent);

    try {
      const bc = new BroadcastChannel(SOLAR_BC_NAME);
      bc.onmessage = () => fireTick("solar");
      solarBcRef.current = bc;
    } catch {
      // ignore (Safari private, etc.)
    }

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("solar:updated", onSolarEvent);
      try {
        solarBcRef.current?.close();
      } catch {
        void 0;
      }
      solarBcRef.current = null;
    };
  }, [fireTick]);

  // Reactively rebuild when the sovereign hook emits a new step/arc
  useEffect(() => {
    const id = window.setTimeout(() => fireTick("solar"), 0);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solarHook?.solarStepString, solarHook?.solarArcName, solarHook?.sunriseOffsetSec, solarOverrideSec]);

  // Close helpers (topmost-first behavior)
  const closeDetails = useCallback(() => {
    setShowWeekModal(false);
    setShowDetails(false);
  }, []);

  const closeWeekFirst = useCallback(() => {
    setShowWeekModal(false);
  }, []);

  // Overlay extra close behavior on scroll (with “interaction cooldown”)
  const suppressScrollCloseUntil = useRef<number>(0);
  useEffect(() => {
    if (!showDetails) return;

    const overlayNode = overlayRef.current;
    const detailNode = detailRef.current;

    const markInteractionInside = () => {
      suppressScrollCloseUntil.current = kairosNowMs() + 800;
    };

    const handleScroll = () => {
      const ae = document.activeElement as HTMLElement | null;
      const focusedInside = !!ae && !!overlayNode?.contains(ae);
      const inCooldown = kairosNowMs() < suppressScrollCloseUntil.current;

      if (focusedInside || inCooldown) return;
      closeDetails();
    };

    detailNode?.addEventListener("pointerdown", markInteractionInside, { capture: true });
    detailNode?.addEventListener("click", markInteractionInside, { capture: true });
    overlayNode?.addEventListener("focusin", markInteractionInside, { capture: true });

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
      detailNode?.removeEventListener("pointerdown", markInteractionInside, true);
      detailNode?.removeEventListener("click", markInteractionInside, true);
      overlayNode?.removeEventListener("focusin", markInteractionInside, true);
    };
  }, [closeDetails, showDetails]);

  // Toggle details panel (instant)
  const handleToggle = useCallback(() => {
    if (showDetails) {
      closeDetails();
      return;
    }
    suppressScrollCloseUntil.current = kairosNowMs() + 800;

    if ("vibrate" in navigator && typeof navigator.vibrate === "function") navigator.vibrate(10);
    audioRef.current?.play().catch(() => void 0);
    setShowDetails(true);

    // UI-triggered refresh (instant, de-duped)
    fireTick("ui");
  }, [closeDetails, fireTick, showDetails]);

  // Arc → CSS variables (mirrored onto modal)
  useEffect(() => {
    if (!klock || !containerRef.current) return;

    const bi = klock.solarChakraStep?.beatIndex ?? klock.eternalChakraBeat?.beatIndex ?? 0;
    const beat = ((bi % 36) + 36) % 36;
    const arcIndex = Math.floor(beat / 6) % 6;

    containerRef.current.setAttribute("data-ark", String(arcIndex));
    overlayRef.current?.setAttribute("data-ark", String(arcIndex));
    detailRef.current?.setAttribute("data-ark", String(arcIndex));

    const hueWheel = [0, 28, 55, 140, 210, 275];
    const hue = hueWheel[arcIndex] ?? 0;

    containerRef.current.style.setProperty("--chakra-hue", String(hue));
    containerRef.current.style.setProperty("--chakra", `hsl(${hue} 100% 55%)`);

    overlayRef.current?.style.setProperty("--chakra-hue", String(hue));
    overlayRef.current?.style.setProperty("--chakra", `hsl(${hue} 100% 55%)`);
    detailRef.current?.style.setProperty("--chakra-hue", String(hue));
    detailRef.current?.style.setProperty("--chakra", `hsl(${hue} 100% 55%)`);
  }, [klock]);

  // Derived UI values
  const spiralData = getSpiralLevelData(klock.kaiPulseEternal);
  const fullYears = Math.floor(klock.harmonicYearCompletions || 0);
  const updatedEternalYearName =
    fullYears < 1 ? "Year of Harmonik Restoration" : fullYears === 1 ? "Year of Harmonik Embodiment" : `Year ${fullYears}`;

  const daysToNextSpiral = Number.isFinite(spiralData.pulsesRemaining) ? spiralData.pulsesRemaining / HARMONIC_DAY_PULSES : NaN;

  const yearPercent = typeof klock.yearPercent === "number" ? klock.yearPercent : (((klock.harmonicYearCompletions ?? 0) % 1) * 100);

  const beatPulseCount = HARMONIC_DAY_PULSES / 36;
  const currentBeat = Math.floor(
    ((((klock.kaiPulseToday % HARMONIC_DAY_PULSES) + HARMONIC_DAY_PULSES) % HARMONIC_DAY_PULSES) / beatPulseCount)
  );
  const rotationOverride = ((currentBeat + 0.5) / 36) * 360;
  const percentToNextBeat =
    (((((klock.kaiPulseToday % beatPulseCount) + beatPulseCount) % beatPulseCount) / beatPulseCount) * 100);

  // Manual open ALWAYS works
  const openWeekModal = useCallback(() => {
    suppressScrollCloseUntil.current = kairosNowMs() + 800;

    setShowWeekModal(true);
    if ("vibrate" in navigator && typeof navigator.vibrate === "function") navigator.vibrate(8);

    fireTick("ui");
  }, [fireTick]);

  // Canonical weekday order
  const SOLAR_DAY_NAMES = ["Solhara", "Aquaris", "Flamora", "Verdari", "Sonari", "Kaelith"] as const;

  const rawSolarIdx = klock.solarAlignedTime?.solarAlignedWeekDayIndex ?? null;
  const displayIdx0 = rawSolarIdx !== null ? ((rawSolarIdx % 6) + 6) % 6 : null;
  const bumpedSolarName = displayIdx0 !== null ? SOLAR_DAY_NAMES[displayIdx0] : "—";
  const bumpedSolarIndex1 = displayIdx0 !== null ? displayIdx0 + 1 : "—";

  // Eternal week totals (6 Eternal days)
  const TOTAL_WEEK_PULSES = HARMONIC_DAY_PULSES * 6;

  const weekPulsesInto = (() => {
    const hw = klock.harmonicWeekProgress;
    if (hw && Number.isFinite(hw.pulsesIntoWeek)) return hw.pulsesIntoWeek;
    const mod = ((klock.kaiPulseEternal % TOTAL_WEEK_PULSES) + TOTAL_WEEK_PULSES) % TOTAL_WEEK_PULSES;
    return mod;
  })();

  const weekPercent = (() => {
    const hw = klock.harmonicWeekProgress;
    if (hw && Number.isFinite(hw.percent)) return hw.percent;
    return (weekPulsesInto / TOTAL_WEEK_PULSES) * 100;
  })();

  const eternalPulsesIntoWeek = ((klock.kaiPulseEternal % TOTAL_WEEK_PULSES) + TOTAL_WEEK_PULSES) % TOTAL_WEEK_PULSES;
  const eternalWeekDayIndex0 = Math.floor(eternalPulsesIntoWeek / HARMONIC_DAY_PULSES) % 6;
  const eternalWeekDayName = HARMONIC_DAYS[eternalWeekDayIndex0];

  const arkIndexForKey = Math.floor(((((klock.solarChakraStep?.beatIndex ?? 0) % 36) + 36) % 36) / 6) % 6;
  const kaiKey = `ark-${arkIndexForKey}-${klock.solarChakraStepString}`;

  // Week modal container
  const weekModalContainer = detailRef.current ?? overlayRef.current ?? portalTarget;

  // Focus trap (SigilModal parity)
  const trapFocus = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;

    const root = detailRef.current;
    if (!root) return;

    const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SEL)).filter((el) => el.tabIndex !== -1);
    if (nodes.length === 0) {
      e.preventDefault();
      closeBtnRef.current?.focus();
      return;
    }

    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = (document.activeElement as HTMLElement | null) ?? null;

    if (!e.shiftKey) {
      if (!active || active === last || !root.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    } else {
      if (!active || active === first || !root.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    }
  }, []);

  return (
    <div ref={containerRef} className="eternal-klock-container">
      <div className="eternal-klock-header">
        <div
          ref={toggleRef}
          onClick={handleToggle}
          title="Tap to view details"
          className={`klock-toggle ${glowPulse ? "glow-pulse" : ""}`}
        >
          <KaiKlock
            key={kaiKey}
            hue={"var(--chakra)"}
            kaiPulseEternal={klock.kaiPulseEternal}
            pulse={klock.kaiPulseToday}
            harmonicDayPercent={klock.harmonicLevels.harmonicDay.percent}
            microCyclePercent={klock.harmonicLevels.microCycle.percent}
            dayLabel={klock.harmonicDay}
            monthLabel={klock.eternalMonth}
            monthDay={klock.eternalChakraBeat?.dayOfMonth ?? klock.eternalMonthProgress.daysElapsed + 1}
            glowPulse={glowPulse}
            rotationOverride={rotationOverride}
            solarSpiralStepString={klock.solarChakraStepString}
            solarSpiralStep={klock.solarChakraStep}
          />
        </div>
      </div>

      {/* FULL-SCREEN POPOVER VIA PORTAL (INSTANT: no fade/anim) */}
      {showDetails &&
        portalTarget &&
        createPortal(
          <div
            className="eternal-overlay kk-modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Eternal Klock Details"
            ref={overlayRef}
            tabIndex={-1}
            style={INSTANT_OPEN_STYLE}
            data-kk-modal="eternal-klock"
            onPointerDown={(e) => {
              backdropDownRef.current = e.target === overlayRef.current;
            }}
            onClick={(e) => {
              if (e.target !== overlayRef.current) return;
              if (!backdropDownRef.current) return;

              if (showWeekModal) {
                closeWeekFirst();
                return;
              }
              closeDetails();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (showWeekModal) {
                  e.stopPropagation();
                  closeWeekFirst();
                  return;
                }
                closeDetails();
                return;
              }
              trapFocus(e);
            }}
          >
            <div
              className="eternal-modal-card kk-modal-card"
              ref={detailRef}
              style={INSTANT_OPEN_STYLE}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                ref={closeBtnRef}
                type="button"
                className="ek-close-btn"
                aria-label="Close"
                title="Close"
                onClick={closeDetails}
              >
                ×
              </button>

              <div className="ek-display-controls" aria-label="Display scale controls">
                <div className="ek-scale-row">
                  <div className="ek-scale-readout" />
                </div>
              </div>

              <div className="eternal-klock-detail">
                <h2 className="eternal-klock-title">𐰘𐰜𐰇 · 𐰋𐰢𐱃</h2>

                <div className="eternal-klock-toolbar">
                  <SigilGlyphButton kaiPulse={klock.kaiPulseEternal} />
                  <button className="toolbar-btn" onClick={openWeekModal} title="Open Kairos Week Spiral" type="button">
                    <img src="/assets/weekkalendar.svg" alt="Kairos Week" className="toolbar-icon" draggable={false} />
                  </button>
                </div>

                {showWeekModal && weekModalContainer && (
                  <WeekKalendarModal onClose={() => setShowWeekModal(false)} container={weekModalContainer} />
                )}

                <div className="eternal-klock-section-title" />
                <div className="eternal-klock-section-title">
                  <img src="/assets/eternal.svg" alt="Eternal Title" style={{ width: "100%", height: "auto" }} />
                  <strong>Date:</strong>{" "}
                  D{klock.eternalChakraBeat?.dayOfMonth ?? klock.eternalMonthProgress.daysElapsed + 1} / M
                  {(klock.eternalChakraBeat?.eternalMonthIndex ?? 0) + 1}
                </div>

                {klock.chakraStep && klock.eternalChakraBeat && (
                  <div style={{ marginBottom: "0.75rem" }}>
                    <strong>Kairos:</strong>{" "}
                    <code>
                      {klock.eternalChakraBeat.beatIndex}:{klock.chakraStep.stepIndex.toString().padStart(2, "0")}
                    </code>
                    <br />
                    <small style={{ display: "block", marginTop: "0.25rem" }}>
                      Beat <strong>{klock.eternalChakraBeat.beatIndex}</strong> / {klock.eternalChakraBeat.totalBeats - 1} —
                      Step <strong>{klock.chakraStep.stepIndex}</strong> / {klock.chakraStep.stepsPerBeat} (
                      {klock.chakraStep.percentIntoStep.toFixed(1)}%)
                    </small>

                    <div>
                      <strong>Kai-Pulse(Eternal):</strong> {klock.kaiPulseEternal}
                    </div>

                    <div style={{ marginTop: "0.25rem" }}>
                      <strong>Day:</strong> {eternalWeekDayName} {eternalWeekDayIndex0 + 1} / 6
                    </div>
                  </div>
                )}

                <div>
                  <strong>Week:</strong> {klock.weekIndex}/7, <strong>{klock.weekName}</strong>
                </div>
                <div>
                  <strong>Month:</strong> {klock.eternalMonth} {(klock.eternalChakraBeat?.eternalMonthIndex ?? 0) + 1} / 8
                </div>

                <div>
                  <strong>Kai-Pulse(Today):</strong> {(klock.kaiPulseEternal % HARMONIC_DAY_PULSES).toFixed(2)} /{" "}
                  {HARMONIC_DAY_PULSES.toFixed(2)}
                </div>

                <div>
                  <div>
                    <strong>% of Day Komplete:</strong> {klock.harmonicLevels.harmonicDay.percent.toFixed(2)}%
                  </div>

                  <div className="day-progress-bar">
                    <div
                      className={`day-progress-fill ${glowPulse ? "sync-pulse" : ""} ${
                        klock.harmonicLevels.harmonicDay.percent.toFixed(0) === "100" ? "burst" : ""
                      }`}
                      style={{ width: `${klock.harmonicLevels.harmonicDay.percent}%` }}
                      title={`${klock.harmonicLevels.harmonicDay.percent.toFixed(2)}% of eternal day`}
                    />
                  </div>

                  <div>
                    <strong>Kai-Pulses (Breathes) Remaining Today:</strong>{" "}
                    {(HARMONIC_DAY_PULSES - klock.harmonicLevels.harmonicDay.pulseInCycle).toFixed(2)}
                  </div>
                </div>

                {klock.harmonicDayDescription && (
                  <div className="eternal-description">
                    <em>{klock.harmonicDayDescription}</em>
                  </div>
                )}

                <strong>Kai-Turah:</strong> <em>{klock.kaiTurahPhrase}</em>
                <div />
                <strong>Phi Pulse:</strong> {(klock.kaiPulseEternal * 1.618).toFixed(0)}

                <div className="eternal-klock-section-title" />

                <div className="eternal-klock-section-title">Week Progress</div>

                {typeof klock.weekIndex === "number" && klock.weekName ? (
                  <>
                    <div>
                      <strong>Week:</strong> {klock.weekIndex} / 7, <strong>{klock.weekName}</strong>
                    </div>

                    <div style={{ marginTop: "0.25rem" }}>
                      <strong>Day:</strong> {eternalWeekDayName} {eternalWeekDayIndex0 + 1} / 6
                    </div>

                    {klock.eternalWeekDescription && (
                      <div className="eternal-description">
                        <em>{klock.eternalWeekDescription}</em>
                      </div>
                    )}
                  </>
                ) : (
                  <div>—</div>
                )}

                <div style={{ marginTop: "0.25rem" }}>
                  <strong>Kai-Pulses (Breathes) Into Week:</strong> {weekPulsesInto.toFixed(2)}
                </div>

                <div>
                  <strong>Kai-Pulses (Breathes) Remaining:</strong> {(TOTAL_WEEK_PULSES - weekPulsesInto).toFixed(2)}
                </div>

                <div>
                  <strong>% Komplete:</strong> {weekPercent.toFixed(2)}%
                </div>

                <div className="week-progress-bar">
                  <div
                    className={`week-progress-fill ${glowPulse ? "sync-pulse" : ""} ${Math.round(weekPercent) === 100 ? "burst" : ""}`}
                    style={{ width: `${weekPercent}%` }}
                    title={`${weekPercent.toFixed(2)}% of week`}
                  />
                </div>

                <div>
                  <strong>Total Kai-Pulses (Breathes) in Week:</strong> {TOTAL_WEEK_PULSES.toFixed(2)}
                </div>

                <div>
                  <strong>Eternal Month:</strong> {klock.eternalMonth}
                </div>
                {klock.eternalMonthDescription && (
                  <div className="eternal-description">
                    <em>{klock.eternalMonthDescription}</em>
                  </div>
                )}

                <div className="eternal-klock-section-title" />
                <div className="eternal-klock-section-title">Month Progress</div>

                <div>
                  <strong>Days Elapsed:</strong> {klock.eternalMonthProgress.daysElapsed + 1}
                </div>
                <div>
                  <strong>Days Remaining:</strong> {klock.eternalMonthProgress.daysRemaining}
                </div>

                <div>
                  <strong>Kai-Pulses (Breathes) Into Month:</strong>{" "}
                  {(klock.kaiPulseEternal % (HARMONIC_DAY_PULSES * HARMONIC_MONTH_DAYS)).toFixed(2)}
                </div>

                <div>
                  <strong>% Komplete:</strong> {klock.eternalMonthProgress.percent.toFixed(2)}%
                </div>

                <div className="month-progress-bar">
                  <div
                    className={`month-progress-fill ${glowPulse ? "sync-pulse" : ""}`}
                    style={{ width: `${klock.eternalMonthProgress.percent}%` }}
                    title={`${klock.eternalMonthProgress.percent.toFixed(2)}% of month`}
                  />
                </div>

                <div className="eternal-klock-section-title" />
                <strong>Harmonik Sykle:</strong>
                <div className="eternal-klock-timestamp">{klock.timestamp}</div>

                {klock.seal && (
                  <div className="seal-container">
                    <strong className="seal-label">Seal:</strong>{" "}
                    <span
                      className={`seal-code ${sealCopied ? "copied" : ""}`}
                      onClick={() => {
                        navigator.clipboard
                          .writeText(klock.seal ?? "")
                          .then(() => {
                            if (sealToastTimer.current !== null) window.clearTimeout(sealToastTimer.current);
                            setSealCopied(true);
                            sealToastTimer.current = window.setTimeout(() => setSealCopied(false), 1600);
                          })
                          .catch(() => void 0);
                      }}
                      title="Click to Kopy Eternal Seal"
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") (e.currentTarget as HTMLElement).click();
                      }}
                    >
                      {klock.seal}
                    </span>

                    <span className={`seal-toast ${sealCopied ? "show" : ""}`} role="status" aria-live="polite">
                      <span className="toast-mark" aria-hidden>
                        ✓
                      </span>
                      <span className="toast-text">Copied</span>
                      <span className="toast-meter" aria-hidden />
                    </span>
                  </div>
                )}

                {klock.harmonicTimestampDescription && (
                  <div className="eternal-description">
                    <em>{klock.harmonicTimestampDescription}</em>
                  </div>
                )}

                <div className="eternal-klock-section-title" />
                <div className="eternal-klock-section-title">Year Progress</div>

                <div>
                  <strong>Harmonik Year:</strong> {klock.harmonicYearCompletions?.toFixed(4)}
                </div>
                <div>
                  <strong>Year:</strong> {updatedEternalYearName}
                </div>

                <div>
                  <strong>% of Year Komplete:</strong> {typeof klock.yearPercent === "number" ? klock.yearPercent.toFixed(2) : "—"}%
                </div>

                <div>
                  <strong>Days Into Year:</strong> {typeof klock.daysIntoYear === "number" ? klock.daysIntoYear : "—"} / {HARMONIC_YEAR_DAYS}
                </div>

                <div className="year-progress-bar">
                  <div className={`year-progress-fill ${glowPulse ? "sync-pulse" : ""}`} style={{ width: `${yearPercent}%` }} title={`${yearPercent.toFixed(2)}% of year`} />
                </div>

                <div className="eternal-klock-section-title" />
                <div className="eternal-klock-section-title">Phi Spiral Progress</div>

                <div>
                  <strong>Phi Spiral Level:</strong> {spiralData.spiralLevel}
                </div>
                <div>
                  <strong>Progress to Next Level:</strong> {spiralData.percentToNext.toFixed(2)}%
                </div>
                <div>
                  <strong>Kai-Pulses (Breathes) Remaining:</strong> {spiralData.pulsesRemaining}
                </div>
                <div>
                  <strong>Days to Next Spiral:</strong> {Number.isFinite(daysToNextSpiral) ? daysToNextSpiral.toFixed(4) : "—"}
                </div>
                <div>
                  <strong>Next Spiral Threshold:</strong> {spiralData.nextSpiralPulse}
                </div>

                <div className="spiral-progress-bar">
                  <div className="spiral-progress-fill" style={{ width: `${spiralData.percentToNext}%` }} />
                </div>

                <div className="eternal-klock-section-title" />
                <div className="eternal-klock-section-title embodied-section-title">
                  <img src="/assets/embodied_solar_aligned.svg" alt="Embodied Solar-Aligned Title" className="embodied-section-icon" />
                </div>

                <strong>Date (Solar):</strong> D{klock.solarDayOfMonth ?? "—"} / M{klock.solarMonthIndex ?? "—"}{" "}
                {klock.solarMonthName ? <small>({klock.solarMonthName})</small> : null}

                {klock.solarChakraStep && klock.solarChakraStepString && (
                  <div style={{ marginBottom: "0.5rem" }}>
                    <strong>Solar Kairos:</strong> <code>{klock.solarChakraStepString}</code>
                    <br />
                  </div>
                )}

                <div>
                  <strong> Day:</strong> {bumpedSolarName} {bumpedSolarIndex1} / 6
                </div>

                <div>
                  <strong>Week:</strong> {klock.weekIndex}/7, <strong>{klock.weekName}</strong>
                </div>

                <div>
                  <strong>Month:</strong> {klock.eternalMonth} {(klock.eternalChakraBeat?.eternalMonthIndex ?? 0) + 1} / 8
                </div>

                <div>
                  <strong>% into Beat:</strong> {percentToNextBeat.toFixed(2)}%
                </div>

                <div style={{ marginTop: "0.5rem" }}>
                  <strong>Beat:</strong> {currentBeat} / 36
                </div>

                <div>
                  <strong>% into Step:</strong> {klock.solarChakraStep ? klock.solarChakraStep.percentIntoStep.toFixed(1) : "—"}%
                </div>

                <div>
                  <strong>Step:</strong>{" "}
                  {klock.solarChakraStep ? `${klock.solarChakraStep.stepIndex} / ${klock.solarChakraStep.stepsPerBeat}` : "—"}
                </div>

                <div>
                  <strong>Kai(Today):</strong> {klock.kaiPulseToday} / {HARMONIC_DAY_PULSES.toFixed(2)}
                </div>

                <div>
                  <strong>% of Day Komplete:</strong> {((klock.kaiPulseToday / HARMONIC_DAY_PULSES) * 100).toFixed(2)}%
                </div>

                <div className="day-progress-bar">
                  <div
                    className={`day-progress-fill ${glowPulse ? "sync-pulse" : ""} ${
                      ((klock.kaiPulseToday / HARMONIC_DAY_PULSES) * 100).toFixed(0) === "100" ? "burst" : ""
                    }`}
                    style={{ width: `${(klock.kaiPulseToday / HARMONIC_DAY_PULSES) * 100}%` }}
                    title={`${((klock.kaiPulseToday / HARMONIC_DAY_PULSES) * 100).toFixed(2)}% of day`}
                  />
                </div>

                <div>
                  <strong>Breathes Remaining Today:</strong> {(HARMONIC_DAY_PULSES - klock.kaiPulseToday).toFixed(2)}
                </div>

                <div>
                  <strong>Ark:</strong> {klock.chakraArc}
                </div>

                {CHAKRA_ARC_DESCRIPTIONS[klock.chakraArc] && (
                  <div className="eternal-description">
                    <em>{CHAKRA_ARC_DESCRIPTIONS[klock.chakraArc]}</em>
                  </div>
                )}

                <div style={{ marginTop: "0.25rem" }}>
                  <div>
                    <strong>Breathes Into Beat:</strong> {(klock.kaiPulseToday % beatPulseCount).toFixed(2)} / {beatPulseCount.toFixed(2)}
                  </div>
                  <strong>To Next Beat:</strong> {percentToNextBeat.toFixed(2)}%
                </div>

                <div>
                  <strong>Beat Zone:</strong> {klock.chakraZone}
                </div>
                <div>
                  <strong>Sigil Family:</strong> {klock.sigilFamily}
                </div>
                <div>
                  <strong>Kai-Turah:</strong> {klock.kaiTurahArcPhrase}
                </div>

                <div className="eternal-klock-section-title" />
                <div className="eternal-klock-section-title">Harmonik Levels</div>

                <div>
                  <strong>Ark Beat:</strong>
                </div>
                <div>
                  {klock.harmonicLevels.arcBeat.pulseInCycle} / {klock.harmonicLevels.arcBeat.cycleLength} ({klock.harmonicLevels.arcBeat.percent.toFixed(2)}%)
                </div>
                <div>
                  <small>Kompleted Sykles: {klock.arcBeatCompletions}</small>
                </div>

                <div style={{ marginTop: "0.75rem" }}>
                  <strong>Mikro Sykle:</strong>
                </div>
                <div>
                  {klock.harmonicLevels.microCycle.pulseInCycle} / {klock.harmonicLevels.microCycle.cycleLength} ({klock.harmonicLevels.microCycle.percent.toFixed(2)}%)
                </div>
                <div>
                  <small>Kompleted Sykles: {klock.microCycleCompletions}</small>
                </div>

                <div style={{ marginTop: "0.75rem" }}>
                  <strong>Beat Loop:</strong>
                </div>
                <div>
                  {klock.harmonicLevels.chakraLoop.pulseInCycle} / {klock.harmonicLevels.chakraLoop.cycleLength} ({klock.harmonicLevels.chakraLoop.percent.toFixed(2)}%)
                </div>
                <div>
                  <small>Kompleted Sykles: {klock.chakraLoopCompletions}</small>
                </div>

                <div style={{ marginTop: "0.75rem" }}>
                  <strong>Harmonik Day:</strong>
                </div>
                <div>
                  {klock.harmonicLevels.harmonicDay.pulseInCycle} / {klock.harmonicLevels.harmonicDay.cycleLength} ({klock.harmonicLevels.harmonicDay.percent.toFixed(2)}%)
                </div>
                <div>
                  <small>Kompleted Sykles: {klock.harmonicDayCompletions}</small>
                </div>

                <div className="eternal-klock-section-title" />
                <div className="eternal-klock-section-title">Solar-Ark Aligned Frequencies & Inputs</div>
                <ul>
                  {klock.harmonicFrequencies.map((freq, idx) => (
                    <li key={`${freq}-${idx}`}>
                      <strong>{freq.toFixed(1)} Hz</strong> — {klock.harmonicInputs[idx]}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="eternal-klock-section-title" />
              <div className="eternal-klock-section-title">Solar Aligned Kairos Sync</div>

              <SolarAnchoredDial
                showControls={true}
                onSunriseChange={(sec) => {
                  setSolarOverrideSec(sec);

                  try {
                    localStorage.setItem(SOLAR_BROADCAST_KEY, String(kairosEpochNow()));
                  } catch {
                    void 0;
                  }
                  try {
                    window.dispatchEvent(new Event("solar:updated"));
                  } catch {
                    void 0;
                  }
                  try {
                    const msg: SolarBroadcastMessage = { type: "solar:updated", t: kairosNowMs() };
                    solarBcRef.current?.postMessage(msg);
                  } catch {
                    void 0;
                  }

                  fireTick("solar", sec);
                  requestAnimationFrame(() => fireTick("solar", sec));
                }}
              />
            </div>
          </div>,
          portalTarget
        )}

      <audio ref={audioRef} src="/assets/chimes/kai_turah_tone.mp3" preload="auto" />
    </div>
  );
};

export default EternalKlock;
