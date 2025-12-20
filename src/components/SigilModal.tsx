/* ────────────────────────────────────────────────────────────────
   SigilModal.tsx · Atlantean Lumitech “Kairos Sigil Viewer”
   v22.9 — MINT BUTTON ONLY (remove verifier + stargate row)
   • Keeps: deterministic datetime-local parsing (no browser Date quirks)
   • Keeps: no timezone double-adjust + no timezone-less ISO roundtrip
   • Keeps: live scheduler ticks on exact φ-boundaries (uses boundary timestamp)
   • Keeps: strict TS timer handles (window.setTimeout/clearTimeout), no NodeJS.Timeout
   • Change: REMOVE 3-button FAB dock, Verifier overlay, Stargate link
   • Change: ONE obvious action button: “MINT MOMENT” (opens SealMomentModal)
────────────────────────────────────────────────────────────────── */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ChangeEvent,
  type FC,
} from "react";
import { createPortal } from "react-dom";
import html2canvas from "html2canvas";
import JSZip from "jszip";

/* Moment row */
import SigilMomentRow from "./SigilMomentRow";

import KaiSigil, {
  type KaiSigilProps,
  type KaiSigilHandle,
} from "./KaiSigil";

import SealMomentModal from "./SealMomentModal";
import { makeSigilUrl, type SigilSharePayload } from "../utils/sigilUrl";
import "./SigilModal.css";
import { kaiNowMs } from "../utils/kaiNow";

/* ────────────────────────────────────────────────────────────────
   Strict browser timer handle types (FIX)
   IMPORTANT: Do NOT use ReturnType<typeof setTimeout> here — setTimeout is
   overloaded when Node typings are present, and ReturnType picks the last
   overload (often `Timeout`) while window.setTimeout returns `number`.
────────────────────────────────────────────────────────────────── */
type TimeoutHandle = number; // window.setTimeout(...) -> number (browser)
type IntervalHandle = number; // window.setInterval(...) -> number (browser)

/* html2canvas typing compatibility (no `any`, extra-props allowed) */
type H2COptions = NonNullable<Parameters<typeof html2canvas>[1]>;
type Loose<T> = T & Record<string, unknown>;

/* ═════════════ external props ═════════════ */
interface Props {
  initialPulse?: number;
  onClose: () => void;
}

/* ═════════════ “server shape” — locally computed ═════════════ */
type HarmonicDay =
  | "Solhara"
  | "Aquaris"
  | "Flamora"
  | "Verdari"
  | "Sonari"
  | "Kaelith";

/* Narrow chakra union used for share payloads and internal state */
type ChakraName =
  | "Root"
  | "Sacral"
  | "Solar Plexus"
  | "Heart"
  | "Throat"
  | "Third Eye"
  | "Crown";

interface KaiApiResponseLike {
  kaiPulseEternal: number;
  eternalSeal: string;
  kairos_seal_day_month: string;
  eternalMonth: string;
  eternalMonthIndex: number;
  eternalChakraArc: string;
  eternalYearName: string;
  kaiTurahPhrase: string;
  chakraStepString: string;
  chakraStep: { stepIndex: number; percentIntoStep: number; stepsPerBeat: number };
  harmonicDay: HarmonicDay;
  kaiPulseToday: number;
  eternalKaiPulseToday: number;
  chakraBeat: {
    beatIndex: number;
    pulsesIntoBeat: number;
    beatPulseCount: number;
    totalBeats: number;
  };
  eternalChakraBeat: {
    beatIndex: number;
    pulsesIntoBeat: number;
    beatPulseCount: number;
    totalBeats: number;
    percentToNext: number;
  };
  harmonicWeekProgress: {
    weekDay: HarmonicDay;
    weekDayIndex: number;
    pulsesIntoWeek: number;
    percent: number;
  };
  harmonicYearProgress: { daysElapsed: number; daysRemaining: number; percent: number };
  eternalMonthProgress: { daysElapsed: number; daysRemaining: number; percent: number };
  weekIndex: number;
  weekName: string;
  dayOfMonth: number;
  kaiMomentSummary: string;
  compressed_summary: string;
  phiSpiralLevel: number;
}

/* ═════════════ canon constants (offline Eternal-Klok) ═════════════ */
const GENESIS_TS = Date.UTC(2024, 4, 10, 6, 45, 41, 888); // 2024-05-10 06:45:41.888 UTC
const KAI_PULSE_SEC = 3 + Math.sqrt(5); // φ-exact breath (≈ 5.236067977 s)
const PULSE_MS = KAI_PULSE_SEC * 1000;

/* Exact day pulses (float, for % display in moment row) */
const DAY_PULSES = 17_491.270_421;

const STEPS_BEAT = 44;
const BEATS_DAY = 36;

const DAYS_PER_WEEK = 6;
const DAYS_PER_MONTH = 42;
const MONTHS_PER_YEAR = 8;
const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR; // 336

const PHI = (1 + Math.sqrt(5)) / 2;

const WEEKDAY: readonly HarmonicDay[] = [
  "Solhara",
  "Aquaris",
  "Flamora",
  "Verdari",
  "Sonari",
  "Kaelith",
] as const;

const DAY_TO_CHAKRA: Record<HarmonicDay, ChakraName> = {
  Solhara: "Root",
  Aquaris: "Sacral",
  Flamora: "Solar Plexus",
  Verdari: "Heart",
  Sonari: "Throat",
  Kaelith: "Crown",
};

const ETERNAL_MONTH_NAMES = [
  "Aethon",
  "Virelai",
  "Solari",
  "Amarin",
  "Kaelus",
  "Umbriel",
  "Noktura",
  "Liora",
] as const;

const ARC_NAMES = [
  "Ignite",
  "Integrate",
  "Harmonize",
  "Reflekt",
  "Purifikation",
  "Dream",
] as const;

const ARC_LABEL = (n: string) => `${n} Ark`;

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
];

/* harmonic-breath labels (1–11 × breath) */
const BREATH_LABELS: readonly string[] = Array.from({ length: 11 }, (_, i) => {
  const t = (i * KAI_PULSE_SEC).toFixed(3);
  return `Breath ${i + 1} — ${t}s`;
});

/* ═════════════ KKS-1.0 fixed-point μpulse constants ═════════════ */
const ONE_PULSE_MICRO = 1_000_000n; // 1 pulse = 1e6 μpulses
const N_DAY_MICRO = 17_491_270_421n; // 17,491.270421 pulses/day (closure)
const PULSES_PER_STEP_MICRO = 11_000_000n; // 11 * 1e6

/* ── EXACT μpulses-per-beat for Eternal day (rounded) ──────────── */
const MU_PER_BEAT_EXACT = (N_DAY_MICRO + 18n) / 36n; // round(N_DAY_MICRO/36)
const BEAT_PULSES_ROUNDED = Number(
  (MU_PER_BEAT_EXACT + ONE_PULSE_MICRO / 2n) / ONE_PULSE_MICRO
); // ≈ 486 pulses

/* ═════════════ helpers ═════════════ */
const pad2 = (n: number) => String(n).padStart(2, "0");

const fmtSeal = (raw: string) =>
  raw
    .trim()
    .replace(/^(\d+):(\d+)/, (_m, b, s) => `${+b}:${String(s).padStart(2, "0")}`)
    .replace(/D\s*(\d+)/, (_m, d) => `D${+d}`);

/* ── exact helpers for BigInt math (safe floor & modulo) ───────── */
const imod = (n: bigint, m: bigint) => ((n % m) + m) % m;
function floorDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  return r !== 0n && (r > 0n) !== (d > 0n) ? q - 1n : q;
}

/* ties-to-even rounding Number→BigInt */
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

/* Chronos → μpulses since Genesis (bridge uses φ-exact T) */
function microPulsesSinceGenesis(date: Date): bigint {
  const deltaSec = (date.getTime() - GENESIS_TS) / 1000;
  const pulses = deltaSec / KAI_PULSE_SEC;
  const micro = pulses * 1_000_000;
  return roundTiesToEvenBigInt(micro);
}

/* ── SVG metadata helpers ─────────── */
const SVG_NS = "http://www.w3.org/2000/svg";
function ensureXmlns(svg: SVGSVGElement) {
  if (!svg.getAttribute("xmlns")) svg.setAttribute("xmlns", SVG_NS);
  if (!svg.getAttribute("xmlns:xlink")) {
    svg.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  }
}
function ensureMetadata(svg: SVGSVGElement): SVGMetadataElement {
  const doc = svg.ownerDocument || document;
  const existing = svg.querySelector("metadata");
  if (existing) return existing as SVGMetadataElement;
  const created = doc.createElementNS(SVG_NS, "metadata") as SVGMetadataElement;
  svg.insertBefore(created, svg.firstChild);
  return created;
}
function ensureDesc(svg: SVGSVGElement): SVGDescElement {
  const doc = svg.ownerDocument || document;
  const existing = svg.querySelector("desc");
  if (existing) return existing as SVGDescElement;
  const created = doc.createElementNS(SVG_NS, "desc") as SVGDescElement;
  const meta = svg.querySelector("metadata");
  if (meta && meta.nextSibling) svg.insertBefore(created, meta.nextSibling);
  else svg.insertBefore(created, svg.firstChild);
  return created;
}
function putMetadata(svg: SVGSVGElement, meta: unknown): string {
  ensureXmlns(svg);

  const metaEl = ensureMetadata(svg);
  metaEl.textContent = JSON.stringify(meta);

  const descEl = ensureDesc(svg);
  const summary =
    typeof meta === "object" && meta !== null
      ? (() => {
          const o = meta as Record<string, unknown>;
          const p = typeof o.pulse === "number" ? o.pulse : undefined;
          const b = typeof o.beat === "number" ? o.beat : undefined;
          const s = typeof o.stepIndex === "number" ? o.stepIndex : undefined;
          const c = typeof o.chakraDay === "string" ? o.chakraDay : undefined;
          return `KaiSigil — pulse:${p ?? "?"} beat:${b ?? "?"} step:${s ?? "?"} chakra:${c ?? "?"}`;
        })()
      : "KaiSigil — exported";
  descEl.textContent = summary;

  const xml = new XMLSerializer().serializeToString(svg);
  return xml.startsWith("<?xml")
    ? xml
    : `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
}

/* ═════════════ icons ═════════════ */
const CloseIcon: FC = () => (
  <svg viewBox="0 0 24 24" aria-hidden className="close-icon">
    <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="2" />
    <line x1="20" y1="4" x2="4" y2="20" stroke="currentColor" strokeWidth="2" />
    <circle
      cx="12"
      cy="12"
      r="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      opacity=".25"
    />
  </svg>
);

const MintIcon: FC = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path
      d="M12 6v6l3.5 3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M8.2 15.8l2.1-2.1"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
);

/* ═════════════ sovereign Eternal-Klok compute ═════════════ */
type LocalKai = {
  pulse: number;
  beat: number;
  step: number; // 0..43
  stepPct: number;
  pulsesIntoBeat: number;
  pulsesIntoDay: number;
  harmonicDay: HarmonicDay;
  chakraDay: ChakraName;
  chakraStepString: string; // "beat:SS" (zero-based)
  dayOfMonth: number; // 1..42
  monthIndex0: number; // 0..7
  monthIndex1: number; // 1..8
  monthName: string;
  yearIndex: number; // 0..∞
  yearName: string;
  arcIndex: number; // 0..5
  arcName: string; // "... Ark"
  weekIndex: number; // 0..6 within month
  weekName: string;

  _pμ_in_day: bigint;
  _pμ_in_beat: bigint;
};

function computeLocalKai(date: Date): LocalKai {
  const pμ_total = microPulsesSinceGenesis(date);

  const pμ_in_day = imod(pμ_total, N_DAY_MICRO);
  const dayIndex = floorDiv(pμ_total, N_DAY_MICRO);

  const beat = Number(floorDiv(pμ_in_day, MU_PER_BEAT_EXACT)); // 0..35
  const pμ_in_beat = pμ_in_day - BigInt(beat) * MU_PER_BEAT_EXACT;

  const rawStep = Number(pμ_in_beat / PULSES_PER_STEP_MICRO);
  const step = Math.min(Math.max(rawStep, 0), STEPS_BEAT - 1);

  const pμ_in_step = pμ_in_beat - BigInt(step) * PULSES_PER_STEP_MICRO;
  const stepPct = Number(pμ_in_step) / Number(PULSES_PER_STEP_MICRO);

  const pulse = Number(floorDiv(pμ_total, ONE_PULSE_MICRO));
  const pulsesIntoBeat = Number(pμ_in_beat / ONE_PULSE_MICRO);
  const pulsesIntoDay = Number(pμ_in_day / ONE_PULSE_MICRO);

  const harmonicDayIndex = Number(imod(dayIndex, BigInt(DAYS_PER_WEEK)));
  const harmonicDay = WEEKDAY[harmonicDayIndex];
  const chakraDay: ChakraName = DAY_TO_CHAKRA[harmonicDay];

  const dayIndexNum = Number(dayIndex);
  const dayOfMonth =
    ((dayIndexNum % DAYS_PER_MONTH) + DAYS_PER_MONTH) % DAYS_PER_MONTH + 1;

  const monthsSinceGenesis = Math.floor(dayIndexNum / DAYS_PER_MONTH);
  const monthIndex0 =
    ((monthsSinceGenesis % MONTHS_PER_YEAR) + MONTHS_PER_YEAR) % MONTHS_PER_YEAR;
  const monthIndex1 = monthIndex0 + 1;
  const monthName = ETERNAL_MONTH_NAMES[monthIndex0];

  const yearIndex = Math.floor(dayIndexNum / DAYS_PER_YEAR);
  const yearName =
    yearIndex < 1
      ? "Year of Harmonik Restoration"
      : yearIndex === 1
        ? "Year of Harmonik Embodiment"
        : `Year ${yearIndex}`;

  const arcIndex = Number((pμ_in_day * 6n) / N_DAY_MICRO);
  const arcName = ARC_LABEL(ARC_NAMES[Math.min(5, Math.max(0, arcIndex))]);

  const weekIndex = Math.floor((dayOfMonth - 1) / DAYS_PER_WEEK);
  const weekName = [
    "Awakening Flame",
    "Flowing Heart",
    "Radiant Will",
    "Harmonic Voh",
    "Inner Mirror",
    "Dreamfire Memory",
    "Krowned Light",
  ][weekIndex];

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
    yearName,
    arcIndex,
    arcName,
    weekIndex,
    weekName,
    _pμ_in_day: pμ_in_day,
    _pμ_in_beat: pμ_in_beat,
  };
}

function buildLocalKairosLike(now: Date): KaiApiResponseLike {
  const k = computeLocalKai(now);

  const kairos_seal_day_month = `${k.chakraStepString} — D${k.dayOfMonth}/M${k.monthIndex1}`;

  const chakraBeat = {
    beatIndex: k.beat,
    pulsesIntoBeat: k.pulsesIntoBeat,
    beatPulseCount: BEAT_PULSES_ROUNDED,
    totalBeats: BEATS_DAY,
  };

  const percentIntoBeat =
    (Number(k._pμ_in_beat) / Number(MU_PER_BEAT_EXACT)) * 100;
  const percentToNextBeat =
    (1 - Number(k._pμ_in_beat) / Number(MU_PER_BEAT_EXACT)) * 100;

  const daysIntoWeek = (k.dayOfMonth - 1) % DAYS_PER_WEEK;
  const pμ_into_week = BigInt(daysIntoWeek) * N_DAY_MICRO + k._pμ_in_day;
  const harmonicWeekProgress = {
    weekDay: k.harmonicDay,
    weekDayIndex: WEEKDAY.indexOf(k.harmonicDay),
    pulsesIntoWeek: Number(pμ_into_week / ONE_PULSE_MICRO),
    percent:
      (Number(pμ_into_week) / Number(N_DAY_MICRO * BigInt(DAYS_PER_WEEK))) * 100,
  };

  const daysElapsedInMonth = k.dayOfMonth - 1;
  const eternalMonthProgress = {
    daysElapsed: daysElapsedInMonth,
    daysRemaining: DAYS_PER_MONTH - k.dayOfMonth,
    percent: (daysElapsedInMonth / DAYS_PER_MONTH) * 100,
  };

  const dayOfYear = k.monthIndex0 * DAYS_PER_MONTH + k.dayOfMonth;
  const harmonicYearProgress = {
    daysElapsed: dayOfYear - 1,
    daysRemaining: DAYS_PER_YEAR - dayOfYear,
    percent: ((dayOfYear - 1) / DAYS_PER_YEAR) * 100,
  };

  const chakraStep = {
    stepIndex: k.step,
    percentIntoStep: k.stepPct * 100,
    stepsPerBeat: STEPS_BEAT,
  };

  const kaiMomentSummary =
    `Beat ${k.beat + 1}/${BEATS_DAY} • Step ${k.step + 1}/${STEPS_BEAT} • ` +
    `${k.harmonicDay}, ${k.arcName} • D${k.dayOfMonth}/M${k.monthIndex1} (${k.monthName}) • ${k.yearName}`;

  const compressed_summary = `Kai:${k.chakraStepString} D${k.dayOfMonth}/M${k.monthIndex1} ${k.harmonicDay} ${k.monthName} y${k.yearIndex}`;

  const phiSpiralLevel = Math.floor(
    Math.log(Math.max(k.pulse, 1)) / Math.log(PHI)
  );

  const baseArc = (s: string) => s.replace(/\s*Ark$/i, "");
  const arcDisp = (s: string) => `${baseArc(s)} Ark`;

  const eternalSeal =
    `Eternal Seal: ` +
    `Kairos:${k.chakraStepString}, ${k.harmonicDay}, ${arcDisp(k.arcName)} • ` +
    `D${k.dayOfMonth}/M${k.monthIndex1} • ` +
    `Beat:${k.beat}/${BEATS_DAY}(${percentIntoBeat.toFixed(6)}%) ` +
    `Step:${k.step}/${STEPS_BEAT} ` +
    `Kai(Today):${k.pulsesIntoDay} • ` +
    `Y${k.yearIndex} PS${phiSpiralLevel} • ` +
    `Eternal Pulse:${k.pulse}`;

  return {
    kaiPulseEternal: k.pulse,
    kaiPulseToday: k.pulsesIntoDay,
    eternalKaiPulseToday: k.pulsesIntoDay,
    eternalSeal,
    kairos_seal_day_month,
    eternalMonth: k.monthName,
    eternalMonthIndex: k.monthIndex1,
    eternalChakraArc: k.arcName,
    eternalYearName: k.yearName,
    kaiTurahPhrase: KAI_TURAH_PHRASES[k.yearIndex % KAI_TURAH_PHRASES.length],
    chakraStepString: k.chakraStepString,
    chakraStep,
    harmonicDay: k.harmonicDay,
    chakraBeat,
    eternalChakraBeat: { ...chakraBeat, percentToNext: percentToNextBeat },
    harmonicWeekProgress,
    harmonicYearProgress,
    eternalMonthProgress,
    weekIndex: k.weekIndex,
    weekName: k.weekName,
    dayOfMonth: k.dayOfMonth,
    kaiMomentSummary,
    compressed_summary,
    phiSpiralLevel,
  };
}

/* ═════════════ aligned time helpers ═════════════ */
const epochNow = (): number => {
  return kaiNowMs();
};

const computeNextBoundary = (nowMs: number): number => {
  const elapsed = nowMs - GENESIS_TS;
  const periods = Math.ceil(elapsed / PULSE_MS);
  return GENESIS_TS + periods * PULSE_MS;
};

/* ═════════════ deterministic datetime-local parsing ═════════════ */
function parseDateTimeLocal(value: string): Date | null {
  const m = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/
  );
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const sec = Number(m[6] ?? "0");
  const ms = String(m[7] ?? "0").padEnd(3, "0");
  const milli = Number(ms);

  const d = new Date(year, month, day, hour, minute, sec, milli); // LOCAL time
  return Number.isNaN(d.getTime()) ? null : d;
}

function addBreathOffset(baseLocal: Date, breathIndex: number): Date {
  const idx = Number.isFinite(breathIndex) ? Math.max(1, Math.min(11, breathIndex)) : 1;
  return new Date(baseLocal.getTime() + (idx - 1) * PULSE_MS);
}

/* ═════════════ High-precision φ-pulse countdown (6 decimals) ═════════════ */
function useKaiPulseCountdown(active: boolean) {
  const [secsLeft, setSecsLeft] = useState<number>(KAI_PULSE_SEC);
  const nextRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const intRef = useRef<IntervalHandle | null>(null);

  useEffect(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (intRef.current !== null) {
      window.clearInterval(intRef.current);
      intRef.current = null;
    }

    if (!active) return;

    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.style.setProperty("--kai-pulse", `${PULSE_MS}ms`);
    }

    nextRef.current = computeNextBoundary(epochNow());

    const tick = () => {
      const now = epochNow();

      if (now >= nextRef.current) {
        const missed = Math.floor((now - nextRef.current) / PULSE_MS) + 1;
        nextRef.current += missed * PULSE_MS;
      }

      const diffMs = Math.max(0, nextRef.current - now);
      setSecsLeft(diffMs / 1000);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    const onVis = () => {
      if (document.visibilityState === "hidden") {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        if (intRef.current === null) {
          intRef.current = window.setInterval(() => {
            const now = epochNow();
            if (now >= nextRef.current) {
              const missed = Math.floor((now - nextRef.current) / PULSE_MS) + 1;
              nextRef.current += missed * PULSE_MS;
            }
            setSecsLeft(Math.max(0, (nextRef.current - now) / 1000));
          }, 33);
        }
      } else {
        if (intRef.current !== null) {
          window.clearInterval(intRef.current);
          intRef.current = null;
        }
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        nextRef.current = computeNextBoundary(epochNow());
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    document.addEventListener("visibilitychange", onVis);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (intRef.current !== null) window.clearInterval(intRef.current);
      rafRef.current = null;
      intRef.current = null;
    };
  }, [active]);

  return active ? secsLeft : null;
}

/* ═════════════ hash helpers ═════════════ */
const getSubtle = (): SubtleCrypto | undefined => {
  try {
    return globalThis.crypto?.subtle;
  } catch {
    return undefined;
  }
};

const sha256Hex = async (text: string): Promise<string> => {
  const encoded = new TextEncoder().encode(text);
  const subtle = getSubtle();
  if (subtle) {
    try {
      const buf = await subtle.digest("SHA-256", encoded);
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      /* fall through */
    }
  }
  // JS fallback (short) — deterministic
  let h1 = 0x811c9dc5;
  for (let i = 0; i < encoded.length; i++) {
    h1 ^= encoded[i];
    h1 = Math.imul(h1, 16777619);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0");
};

/* ═════════════ Ark colors (MATCHES actual arc labels) ═════════════ */
const ARK_COLORS: Record<string, string> = {
  "Ignite Ark": "#ff0024",
  "Ignition Ark": "#ff0024",

  "Integrate Ark": "#ff6f00",
  "Integration Ark": "#ff6f00",

  "Harmonize Ark": "#ffd600",
  "Harmonization Ark": "#ffd600",

  "Reflekt Ark": "#00c853",
  "Reflection Ark": "#00c853",

  "Purifikation Ark": "#00b0ff",
  "Purification Ark": "#00b0ff",

  "Dream Ark": "#c186ff",
};

const getArkColor = (label?: string): string => {
  if (!label) return "#ffd600";
  const key = label.trim();
  const normalized = key.replace(/\s*ark$/i, " Ark");
  return ARK_COLORS[key] ?? ARK_COLORS[normalized] ?? "#ffd600";
};

/* ═════════════ sticky MINT dock styles ═════════════ */
const MintDockStyles = () => (
  <style>{`
    .sigil-modal { position: relative; isolation: isolate; }

    .sigil-modal .close-btn {
      z-index: 99999 !important;
      pointer-events: auto;
      touch-action: manipulation;
    }
    .sigil-modal .close-btn svg { pointer-events: none; }

    .modal-bottom-spacer { height: clamp(96px, 14vh, 140px); }

.mint-dock{
  position: sticky;
  bottom: max(10px, env(safe-area-inset-bottom));
  z-index: 6;

  /* 🔒 NOT a bar */
  display: grid;          /* centers child without creating a row bar */
  place-items: center;
  width: fit-content;     /* shrink-wrap to the button */
  max-width: 100%;
  margin: 0 auto;         /* center the shrink-wrapped dock */
  padding: 0;             /* remove bar padding */
  background: transparent;/* no bar surface */
  border: 0;
  box-shadow: none;

  contain: layout paint style;
  -webkit-transform: translateZ(0);
          transform: translateZ(0);
}

/* hard stop: prevent child from stretching wide */
.mint-dock > *{
  width: auto;
  max-width: 100%;
  flex: 0 0 auto;
}

/* if your button is an <a> or <button> and inherits block styles elsewhere */
.mint-dock button,
.mint-dock a{
  display: inline-flex;
}


    .mint-btn {
      width: min(520px, calc(100% - 2px));
      display: grid;
      grid-template-columns: 54px 1fr;
      gap: 12px;
      align-items: center;

      border: 0;
      cursor: pointer;
      color: inherit;
      padding: 12px 14px;
      border-radius: 18px;

      background:
        radial-gradient(900px 220px at 30% 0%, rgba(255,230,150,.18), rgba(0,0,0,0) 60%),
        radial-gradient(900px 280px at 80% 10%, rgba(120,220,255,.16), rgba(0,0,0,0) 55%),
        linear-gradient(180deg, rgba(255,255,255,.14), rgba(255,255,255,.06));
      backdrop-filter: blur(10px) saturate(140%);
      -webkit-backdrop-filter: blur(10px) saturate(140%);

      box-shadow:
        0 10px 34px rgba(0,0,0,.45),
        inset 0 0 0 1px rgba(255,255,255,.22),
        0 0 44px rgba(255, 215, 120, .12);

      transition: transform .18s ease, box-shadow .18s ease, filter .18s ease, opacity .18s ease;
      will-change: transform;
      touch-action: manipulation;
    }

    .mint-btn::before {
      content: "";
      position: absolute;
      inset: -1px;
      border-radius: 19px;
      background:
        linear-gradient(90deg,
          rgba(255,215,140,.0),
          rgba(255,215,140,.55),
          rgba(120,220,255,.35),
          rgba(155, 91, 255, .35),
          rgba(255,215,140,.0)
        );
      filter: blur(10px);
      opacity: .55;
      pointer-events: none;
    }

    .mint-btn:hover { transform: translateY(-2px); box-shadow: 0 14px 44px rgba(0,0,0,.55), inset 0 0 0 1px rgba(255,255,255,.28), 0 0 60px rgba(255, 215, 120, .16); }
    .mint-btn:active { transform: translateY(0px) scale(.99); }

    .mint-btn__icon {
      width: 54px;
      height: 54px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;

      background:
        radial-gradient(120% 120% at 50% 0%, rgba(255,255,255,.16), rgba(255,255,255,.06)),
        linear-gradient(180deg, rgba(12, 20, 48, .62), rgba(3, 6, 16, .72));
      box-shadow:
        inset 0 0 0 1px rgba(255,255,255,.22),
        0 10px 26px rgba(0,0,0,.35);
    }

    .mint-btn__icon img,
    .mint-btn__icon svg {
      width: 56%;
      height: 56%;
      display: block;
      user-select: none;
      -webkit-user-drag: none;
    }

    .mint-btn__text { text-align: left; line-height: 1.1; }
    .mint-btn__title {
      font-weight: 800;
      letter-spacing: .06em;
      text-transform: uppercase;
      font-size: 13px;
      opacity: .98;
    }
    .mint-btn__sub {
      margin-top: 4px;
      font-size: 12px;
      opacity: .78;
    }

    @media (pointer: coarse) {
      .mint-btn { padding: 14px 14px; }
      .mint-btn__icon { width: 58px; height: 58px; }
    }

    @media (prefers-reduced-motion: reduce) {
      .mint-btn { transition: none; }
      .mint-btn:hover { transform: none; }
    }
  `}</style>
);

/* ═════════════ init state builder (PURE: no “now” during render) ═════════════ */
type InitState = {
  pulse: number;
  beat: number;
  stepPct: number;
  stepIdx: number;
  chakraDay: ChakraName;
  kairos: KaiApiResponseLike;
};

function makeInitState(initialPulse?: number): InitState {
  const dt =
    typeof initialPulse === "number" && initialPulse > 0
      ? new Date(GENESIS_TS + initialPulse * PULSE_MS)
      : new Date(GENESIS_TS);

  const local = computeLocalKai(dt);

  return {
    pulse: local.pulse,
    beat: local.beat,
    stepPct: local.stepPct,
    stepIdx: local.step,
    chakraDay: local.chakraDay,
    kairos: buildLocalKairosLike(dt),
  };
}

/* ═════════════ clipboard helper ═════════════ */
async function copyText(txt: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(txt);
      return true;
    }
  } catch {
    /* fallback */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = txt;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

const fireAndForget = (p: Promise<unknown>): void => {
  p.catch(() => {
    /* swallow */
  });
};

/* ═════════════ main component ═════════════ */
const SigilModal: FC<Props> = ({ initialPulse = 0, onClose }) => {
  const [init] = useState<InitState>(() => makeInitState(initialPulse));

  const [pulse, setPulse] = useState(init.pulse);
  const [beat, setBeat] = useState(init.beat);
  const [stepPct, setStepPct] = useState(init.stepPct);
  const [stepIdx, setStepIdx] = useState(init.stepIdx);
  const [chakraDay, setChakraDay] = useState<ChakraName>(init.chakraDay);

  const [kairos, setKairos] = useState<KaiApiResponseLike | null>(init.kairos);

  /* static-mode controls */
  const [dateISO, setDateISO] = useState(""); // datetime-local string
  const [breathIdx, setBreathIdx] = useState(1);

  /* Mint icon fallback */
  const [mintSvgOk, setMintSvgOk] = useState(true);

  /* SealMomentModal */
  const [sealOpen, setSealOpen] = useState(false);
  const [sealUrl, setSealUrl] = useState("");
  const [sealHash, setSealHash] = useState("");

  /* canonical child hash from KaiSigil.onReady() */
  const [lastHash, setLastHash] = useState("");

  /* RICH DATA toggle */
  const [showRich, setShowRich] = useState(false);

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const sigilRef = useRef<KaiSigilHandle | null>(null);

  /* ✅ boundary-aligned scheduler refs (FIXED) */
  const timeoutRef = useRef<TimeoutHandle | null>(null);
  const targetBoundaryRef = useRef<number>(0);

  /* ── HARD-LOCK shielding ───────────────────────────────── */
  useEffect(() => {
    const shield = (e: Event) => {
      const ov = overlayRef.current;
      if (!ov) return;

      const t = e.target;
      if (!(t instanceof Node)) return;
      if (!ov.contains(t)) return;
      if (closeBtnRef.current?.contains(t)) return;

      e.stopPropagation();
    };

    const events: Array<keyof DocumentEventMap> = ["click", "mousedown", "touchstart"];
    const opts: AddEventListenerOptions = { passive: true };

    events.forEach((ev) => document.addEventListener(ev, shield, opts));

    const escTrap = (e: KeyboardEvent) => {
      if (e.key === "Escape" && overlayRef.current) e.stopPropagation();
    };
    window.addEventListener("keydown", escTrap, true);

    return () => {
      events.forEach((ev) => document.removeEventListener(ev, shield, opts));
      window.removeEventListener("keydown", escTrap, true);
    };
  }, []);

  const syncCloseBtn = useCallback((nowMs: number) => {
    const btn = closeBtnRef.current;
    if (!btn) return;
    const elapsed = ((nowMs - GENESIS_TS) % PULSE_MS + PULSE_MS) % PULSE_MS;
    const lag = PULSE_MS - elapsed;
    btn.style.setProperty("--pulse-dur", `${PULSE_MS}ms`);
    btn.style.setProperty("--pulse-offset", `-${Math.round(lag)}ms`);
  }, []);

  const syncGlobalPulseVars = useCallback((nowMs: number) => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const elapsed = ((nowMs - GENESIS_TS) % PULSE_MS + PULSE_MS) % PULSE_MS;
    const lag = PULSE_MS - elapsed;
    root.style.setProperty("--pulse-dur", `${PULSE_MS}ms`);
    root.style.setProperty("--pulse-offset", `-${Math.round(lag)}ms`);
  }, []);

  const applyKaiFromDate = useCallback(
    (dt: Date, nowMsForCss?: number) => {
      const local = computeLocalKai(dt);
      setPulse(local.pulse);
      setBeat(local.beat);
      setStepPct(local.stepPct);
      setStepIdx(local.step);
      setChakraDay(local.chakraDay);
      setKairos(buildLocalKairosLike(dt));

      const cssNow = typeof nowMsForCss === "number" ? nowMsForCss : dt.getTime();
      syncGlobalPulseVars(cssNow);
      syncCloseBtn(cssNow);
    },
    [syncCloseBtn, syncGlobalPulseVars]
  );

  /* ✅ aligned scheduler */
  const clearAlignedTimer = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const scheduleAlignedTick = useCallback(() => {
    clearAlignedTimer();

    const startNow = epochNow();
    targetBoundaryRef.current = computeNextBoundary(startNow);

    const fire = () => {
      const nowMs = epochNow();
      const nextBoundary = targetBoundaryRef.current;

      if (nowMs < nextBoundary) {
        timeoutRef.current = window.setTimeout(fire, Math.max(0, nextBoundary - nowMs));
        return;
      }

      const missed = Math.floor((nowMs - nextBoundary) / PULSE_MS) + 1;
      const lastBoundary = nextBoundary + (missed - 1) * PULSE_MS;

      applyKaiFromDate(new Date(lastBoundary), lastBoundary);

      targetBoundaryRef.current = nextBoundary + missed * PULSE_MS;

      const delay = Math.max(0, targetBoundaryRef.current - nowMs);
      timeoutRef.current = window.setTimeout(fire, delay);
    };

    timeoutRef.current = window.setTimeout(() => {
      const nowMs = epochNow();
      applyKaiFromDate(new Date(nowMs), nowMs);

      const delay = Math.max(0, targetBoundaryRef.current - nowMs);
      timeoutRef.current = window.setTimeout(fire, delay);
    }, 0);
  }, [applyKaiFromDate, clearAlignedTimer]);

  /* LIVE mode start/stop (boundaries) */
  useEffect(() => {
    if (dateISO) return;

    scheduleAlignedTick();

    const onVis = () => {
      if (document.visibilityState === "visible" && !dateISO) scheduleAlignedTick();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      clearAlignedTimer();
    };
  }, [dateISO, scheduleAlignedTick, clearAlignedTimer]);

  /* datetime picker (STATIC mode) */
  const applyStatic = useCallback(
    (val: string, bIdx: number) => {
      const base = parseDateTimeLocal(val);
      if (!base) return;
      const dt = addBreathOffset(base, bIdx);
      applyKaiFromDate(dt, dt.getTime());
    },
    [applyKaiFromDate]
  );

  const onDateChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDateISO(val);

    if (!val) {
      setBreathIdx(1);
      return;
    }

    clearAlignedTimer();
    applyStatic(val, breathIdx);
  };

  const onBreathChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const idx = Number(e.target.value);
    setBreathIdx(idx);
    if (!dateISO) return;
    applyStatic(dateISO, idx);
  };

  const resetToNow = () => {
    const card =
      overlayRef.current?.querySelector(".sigil-modal") as HTMLElement | null;
    if (card) {
      card.classList.remove("flash-now");
      void card.offsetWidth;
      card.classList.add("flash-now");
    }
    setDateISO("");
    setBreathIdx(1);
    const now = epochNow();
    applyKaiFromDate(new Date(now), now);
  };

  const secsLeft = useKaiPulseCountdown(!dateISO);

  const copy = (txt: string) => fireAndForget(copyText(txt));
  const copyJSON = (obj: unknown) => copy(JSON.stringify(obj, null, 2));

  const getSVGElement = (): SVGSVGElement | null =>
    document.querySelector<SVGSVGElement>("#sigil-export svg");

  const getSVGStringWithMetadata = (meta: unknown): string | null => {
    const svg = getSVGElement();
    if (!svg) return null;
    return putMetadata(svg, meta);
  };

  const buildSVGBlob = (meta: unknown): Blob | null => {
    const xml = getSVGStringWithMetadata(meta);
    if (!xml) return null;
    return new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  };

  const buildPNGBlob = async (): Promise<Blob | null> => {
    const el = document.getElementById("sigil-export");
    if (!el) return null;

    const opts: Loose<H2COptions> = {
      background: undefined,
      backgroundColor: null,
    };

    const canvas = await html2canvas(el as HTMLElement, opts);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png")
    );
    if (blob) return blob;

    const dataUrl = canvas.toDataURL("image/png");
    const base64 = dataUrl.split(",")[1] ?? "";
    const byteStr = atob(base64);
    const buf = new ArrayBuffer(byteStr.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < byteStr.length; i++) view[i] = byteStr.charCodeAt(i);
    return new Blob([buf], { type: "image/png" });
  };

  const makeSharePayload = (
    canonicalHash: string
  ): SigilSharePayload & {
    canonicalHash: string;
    exportedAt: string;
    expiresAtPulse: number;
  } => {
    const stepsPerBeat = STEPS_BEAT;
    const rawStep = kairos?.chakraStep.stepIndex ?? stepIdx;

    const stepIndex = Number.isFinite(rawStep)
      ? Math.max(0, Math.min(Number(rawStep), stepsPerBeat - 1))
      : 0;

    return {
      pulse,
      beat,
      stepIndex,
      chakraDay,
      stepsPerBeat,
      canonicalHash,
      exportedAt: new Date().toISOString(),
      expiresAtPulse: pulse + 11,
    };
  };

  /* ── MINT MOMENT (opens SealMomentModal) ─────────────────────── */
  const mintMoment = async () => {
    let hash = (lastHash || "").toLowerCase();
    if (!hash) {
      const svg = getSVGElement();
      const basis = svg
        ? new XMLSerializer().serializeToString(svg)
        : JSON.stringify({ pulse, beat, stepPct, chakraDay });
      hash = (await sha256Hex(basis)).toLowerCase();
    }
    const payload = makeSharePayload(hash);
    const url = makeSigilUrl(hash, payload);
    setSealHash(hash);
    setSealUrl(url);
    setSealOpen(true);
  };

  const saveZipBundle = async () => {
    const canonical = (lastHash || "").toLowerCase();
    const canonicalHash =
      canonical ||
      (await sha256Hex(JSON.stringify({ pulse, beat, stepPct, chakraDay })));

    const meta = makeSharePayload(canonicalHash);

    const [svgBlob, pngBlob] = await Promise.all([buildSVGBlob(meta), buildPNGBlob()]);
    if (!svgBlob || !pngBlob) return;

    const zip = new JSZip();
    zip.file(`sigil_${pulse}.svg`, svgBlob);
    zip.file(`sigil_${pulse}.png`, pngBlob);

    const manifest = {
      ...meta,
      overlays: { qr: false, eternalPulseBar: false },
    };
    zip.file(`sigil_${pulse}.manifest.json`, JSON.stringify(manifest, null, 2));

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(zipBlob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `sigil_${pulse}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    requestAnimationFrame(() => URL.revokeObjectURL(url));
  };

  const handleClose = () => {
    onClose();
  };

  const beatStepFromSeal = (raw: string): string | null => {
    const m = raw.trim().match(/^(\d+):(\d{1,2})/);
    return m ? `${+m[1]}:${m[2].padStart(2, "0")}` : null;
  };

  const sealBeatStep = kairos ? beatStepFromSeal(kairos.kairos_seal_day_month) : null;
  const localBeatStep = `${beat}:${pad2(stepIdx)}`;
  const beatStepDisp = sealBeatStep ?? localBeatStep;
  const kairosDisp = fmtSeal(kairos ? kairos.kairos_seal_day_month : beatStepDisp);

  const solarColor = "#ffd600";
  const eternalArkColor = getArkColor(kairos?.eternalChakraArc);
  const dayPct = kairos
    ? Math.max(0, Math.min(100, (kairos.kaiPulseToday / DAY_PULSES) * 100))
    : 0;

  return createPortal(
    <>
      <MintDockStyles />

      <div
        ref={overlayRef}
        role="dialog"
        aria-modal="true"
        className="sigil-modal-overlay"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) e.stopPropagation();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) e.stopPropagation();
        }}
        onTouchStart={(e) => {
          if (e.target === e.currentTarget) e.stopPropagation();
        }}
        onKeyDown={(e) => e.key === "Escape" && e.stopPropagation()}
      >
        <div
          className="sigil-modal"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          <button
            ref={closeBtnRef}
            aria-label="Close"
            className="close-btn"
            onClick={handleClose}
          >
            <CloseIcon />
          </button>

          <SigilMomentRow
            dateISO={dateISO}
            onDateChange={onDateChange}
            secondsLeft={secsLeft ?? undefined}
            solarPercent={dayPct}
            eternalPercent={dayPct}
            solarColor={solarColor}
            eternalColor={eternalArkColor}
            eternalArkLabel={kairos?.eternalChakraArc || "Ignite Ark"}
          />

          {dateISO && (
            <>
              <label style={{ marginLeft: "12px" }}>
                Breath within minute:&nbsp;
                <select value={breathIdx} onChange={onBreathChange}>
                  {BREATH_LABELS.map((lbl, i) => (
                    <option key={lbl} value={i + 1}>
                      {lbl}
                    </option>
                  ))}
                </select>
              </label>
              <button className="now-btn" onClick={resetToNow}>
                Now
              </button>
            </>
          )}

          {secsLeft !== null && (
            <p className="countdown">
              next pulse in <strong>{secsLeft.toFixed(6)}</strong>s
            </p>
          )}

          <div
            id="sigil-export"
            style={{ position: "relative", width: 240, margin: "16px auto" }}
          >
            <KaiSigil
              ref={sigilRef}
              pulse={pulse}
              beat={beat}
              stepPct={stepPct}
              chakraDay={chakraDay as KaiSigilProps["chakraDay"]}
              size={240}
              hashMode="deterministic"
              origin=""
              onReady={(payload: { hash?: string; pulse?: number }) => {
                const hash = payload.hash ? String(payload.hash).toLowerCase() : "";
                if (hash) setLastHash(hash);

                if (typeof payload.pulse === "number" && payload.pulse !== pulse) {
                  setPulse(payload.pulse);
                }
              }}
            />
            <span className="pulse-tag">{pulse.toLocaleString()}</span>
          </div>

          <div className="sigil-meta-block">
            <p>
              <strong>Kairos:</strong>&nbsp;
              {beatStepDisp}
              <button className="copy-btn" onClick={() => copy(beatStepDisp)}>
                💠
              </button>
            </p>
            <p>
              <strong>Kairos/Date:</strong>&nbsp;
              {kairosDisp}
              <button className="copy-btn" onClick={() => copy(kairosDisp)}>
                💠
              </button>
            </p>

            {kairos && (
              <>
                <p>
                  <strong>Seal:</strong>&nbsp;
                  {kairos.eternalSeal}
                  <button className="copy-btn" onClick={() => copy(kairos.eternalSeal)}>
                    💠
                  </button>
                </p>
                <p><strong>Day:</strong> {kairos.harmonicDay}</p>
                <p><strong>Month:</strong> {kairos.eternalMonth}</p>
                <p><strong>Arc:</strong> {kairos.eternalChakraArc}</p>
                <p><strong>Year:</strong> {kairos.eternalYearName}</p>
                <p>
                  <strong>Kai-Turah:</strong>&nbsp;
                  {kairos.kaiTurahPhrase}
                  <button className="copy-btn" onClick={() => copy(kairos.kaiTurahPhrase)}>
                    💠
                  </button>
                </p>
              </>
            )}
          </div>

          {kairos && (
            <details
              className="rich-data"
              open={showRich}
              onToggle={(e) => setShowRich(e.currentTarget.open)}
            >
              <summary>Memory</summary>
              <div className="rich-grid">
                <div><code>kaiPulseEternal</code><span>{kairos.kaiPulseEternal.toLocaleString()}</span></div>
                <div><code>kaiPulseToday</code><span>{kairos.kaiPulseToday}</span></div>
                <div><code>kairos_seal_day_month</code><span>{kairos.kairos_seal_day_month}</span></div>
                <div><code>chakraStepString</code><span>{kairos.chakraStepString}</span></div>
                <div><code>chakraStep.stepIndex</code><span>{kairos.chakraStep.stepIndex}</span></div>
                <div><code>chakraStep.percentIntoStep</code><span>{kairos.chakraStep.percentIntoStep.toFixed(2)}%</span></div>
                <div><code>chakraBeat.beatIndex</code><span>{kairos.chakraBeat.beatIndex}</span></div>
                <div><code>chakraBeat.pulsesIntoBeat</code><span>{kairos.chakraBeat.pulsesIntoBeat}</span></div>
                <div><code>weekIndex</code><span>{kairos.weekIndex}</span></div>
                <div><code>weekName</code><span>{kairos.weekName}</span></div>
                <div><code>dayOfMonth</code><span>{kairos.dayOfMonth}</span></div>
                <div><code>eternalMonthIndex</code><span>{kairos.eternalMonthIndex}</span></div>
                <div><code>harmonicWeekProgress.percent</code><span>{kairos.harmonicWeekProgress.percent.toFixed(2)}%</span></div>
                <div><code>eternalMonthProgress.percent</code><span>{kairos.eternalMonthProgress.percent.toFixed(2)}%</span></div>
                <div><code>harmonicYearProgress.percent</code><span>{kairos.harmonicYearProgress.percent.toFixed(2)}%</span></div>
                <div><code>phiSpiralLevel</code><span>{kairos.phiSpiralLevel}</span></div>
                <div className="span-2"><code>kaiMomentSummary</code><span>{kairos.kaiMomentSummary}</span></div>
                <div className="span-2"><code>compressed_summary</code><span>{kairos.compressed_summary}</span></div>
                <div className="span-2"><code>eternalSeal</code><span className="truncate">{kairos.eternalSeal}</span></div>
              </div>

              <div className="rich-actions">
                <button onClick={() => copyJSON(kairos)}>Remember JSON</button>
              </div>
            </details>
          )}

          <div className="modal-bottom-spacer" aria-hidden="true" />

          {/* ONE ACTION ONLY: MINT MOMENT */}
          <div className="mint-dock">
            <button
              className="mint-btn"
              type="button"
              aria-label="Mint this moment"
              title="Mint this moment"
              onClick={mintMoment}
            >
              <span className="mint-btn__icon" aria-hidden="true">
                {mintSvgOk ? (
                  <img
                    src="/assets/seal.svg"
                    alt=""
                    loading="eager"
                    decoding="async"
                    onError={() => setMintSvgOk(false)}
                  />
                ) : (
                  <MintIcon />
                )}
              </span>
            </button>
          </div>
        </div>
      </div>

      <SealMomentModal
        open={sealOpen}
        url={sealUrl}
        hash={sealHash}
        onClose={() => setSealOpen(false)}
        onDownloadZip={saveZipBundle}
      />
    </>,
    document.body
  );
};

export default SigilModal;
