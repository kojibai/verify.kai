// src/components/WeekKalendarModal.tsx
/* ────────────────────────────────────────────────────────────────
   WeekKalendarModal.tsx · Atlantean Lumitech “Kairos Kalendar”
   v9.4.1 · FIX: DOM timer typing (no NodeJS.Timeout)
   ────────────────────────────────────────────────────────────────
   • DayDetailModal sits ABOVE both Note box and NoteModal
   • Notes Dock is fixed, scrollable, and persists until user clears
   • No note counters on weekday labels
   • Notes saved in Day modal map to the exact Beat:Step moment
   • Fully offline (pure Kai math), μpulse-aligned scheduler
   • ✅ No synchronous setState in effect bodies:
       - notes + hiddenIds load via useState initializers (not effects)
       - scheduler effect only schedules timers; setState happens in timer/event callbacks
       - external DOM sync (CSS vars, framer motion value) done in effects (no React state)
───────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { FC } from "react";

import { createPortal } from "react-dom";
import { AnimatePresence, motion, useMotionValue, useSpring } from "framer-motion";

import "./WeekKalendarModal.css";

import DayDetailModal from "./DayDetailModal";
import type { HarmonicDayInfo } from "./DayDetailModal";

import MonthKalendarModal from "./MonthKalendarModal";

/* ✅ NoteModal (enriched) */
import NoteModal from "./NoteModal";
import type { Note as EnrichedNote } from "./NoteModal";

/* ══════════════ constants ══════════════ */
const PULSE_MS = (3 + Math.sqrt(5)) * 1000; // ≈ 5236ms

/* μpulse-accurate timing (match SigilModal/Month/NoteModal) */
const GENESIS_TS = Date.UTC(2024, 4, 10, 6, 45, 41, 888);
const KAI_PULSE_SEC = 3 + Math.sqrt(5);
const PULSE_MS_EXACT = KAI_PULSE_SEC * 1000; // scheduler tick in ms

/* day pulses (whole pulses, not μpulses) */
const DAY_PULSES = 17_491.270_421;
const PHI = (1 + Math.sqrt(5)) / 2;

const NOTES_KEY = "kairosNotes";
const HIDDEN_IDS_KEY = "kairosNotesHiddenIds"; // panel-only hides
const Z_INDEX = 10_000;

/* ───────── Spiral → hex palette (Root-►Krown) ───────── */
const Spiral_COLOR = {
  Root: "#ff0024",
  Sakral: "#ff6f00",
  Solar: "#ffd600",
  Heart: "#00c853",
  Throat: "#00b0ff",
  Krown: "#c186ff",
  MemorySpiral: "#ff80ab",
} as const;

/* Legacy SpiralArc labels mapped to palette keys */
const ARC_TO_CHARKA = {
  "Ignition ArK": "Root",
  "Integration ArK": "Sakral",
  "Harmonization ArK": "Solar",
  "Reflection ArK": "Heart",
  "Purification ArK": "Throat",
  "Dream ArK": "Krown",
} as const;

/* Deterministic Day → SpiralArc so hue can be derived offline */
const DAYS = ["Solhara", "Aquaris", "Flamora", "Verdari", "Sonari", "Kaelith"] as const;
type Day = (typeof DAYS)[number];

const DAY_TO_ARC: Record<Day, keyof typeof ARC_TO_CHARKA> = {
  Solhara: "Ignition ArK",
  Aquaris: "Integration ArK",
  Flamora: "Harmonization ArK",
  Verdari: "Reflection ArK",
  Sonari: "Purification ArK",
  Kaelith: "Dream ArK",
};

/* Canonical weekday colors (fixed identity, not dynamic) */
const DAY_COLOR: Record<Day, string> = {
  Solhara: "#ff0024",
  Aquaris: "#ff6f00",
  Flamora: "#ffd600",
  Verdari: "#00c853",
  Sonari: "#00b0ff",
  Kaelith: "#c186ff",
};

/* ══════════════ helpers ══════════════ */
const stopBubble = (e: React.SyntheticEvent) => {
  e.stopPropagation();
};

const squashSeal = (seal: string) =>
  seal.replace(/D\s+(\d+)/, "D$1").replace(/\/\s*M(\d+)/, "/M$1");

/* Convert #rrggbb → rgba(r,g,b,a) */
const rgba = (hex: string, a: number) => {
  const h = hex.replace("#", "");
  const bigint = Number.parseInt(h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

/* Push live Spiral hue into :root CSS vars */
const applySpiralHue = (arc: string | undefined) => {
  if (typeof document === "undefined") return;
  const SpiralKey = ARC_TO_CHARKA[arc as keyof typeof ARC_TO_CHARKA] ?? "Root";
  const core = Spiral_COLOR[SpiralKey as keyof typeof Spiral_COLOR];
  const doc = document.documentElement;
  doc.style.setProperty("--aqua-core", core);
  doc.style.setProperty("--aqua-soft", rgba(core, 0.14));
  doc.style.setProperty("--seal-glow-inset", rgba(core, 0.36));
  doc.style.setProperty("--seal-glow-mid", rgba(core, 0.42));
  doc.style.setProperty("--seal-glow-outer", rgba(core, 0.24));
};

/* ───────────────────── μpulse math (SigilModal parity) ───────────────────── */
const ONE_PULSE_MICRO = 1_000_000n;
const N_DAY_MICRO = 17_491_270_421n;
const PULSES_PER_STEP_MICRO = 11_000_000n;
const MU_PER_BEAT_EXACT = (N_DAY_MICRO + 18n) / 36n;

const pad2 = (n: number) => String(n).padStart(2, "0");
const imod = (n: bigint, m: bigint) => ((n % m) + m) % m;

function floorDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  return r !== 0n && (r > 0n) !== (d > 0n) ? q - 1n : q;
}

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

function microPulsesSinceGenesis(date: Date): bigint {
  const deltaSec = (date.getTime() - GENESIS_TS) / 1000;
  const pulses = deltaSec / KAI_PULSE_SEC;
  const micro = pulses * 1_000_000;
  return roundTiesToEvenBigInt(micro);
}

/* ══════════════ types ══════════════ */
interface KaiKlock {
  harmonicDay: Day;
  eternalKaiPulseToday: number;
  kairos_seal_day_month: string;
  SpiralArc?: string;
}

/* ✅ Notes saved in storage (extends enriched Note with timestamp) */
type SavedNote = EnrichedNote & { createdAt: number };

/* Local Kai snapshot used for live UI */
type LocalKai = {
  beat: number;
  step: number;
  pulsesIntoDay: number;
  harmonicDay: Day;
  dayOfMonth: number;
  monthIndex1: number;
  chakraStepString: string;
};

function computeLocalKai(now: Date): LocalKai {
  const pμ_total = microPulsesSinceGenesis(now);
  const pμ_in_day = imod(pμ_total, N_DAY_MICRO);
  const dayIndex = floorDiv(pμ_total, N_DAY_MICRO);

  const beat = Number(floorDiv(pμ_in_day, MU_PER_BEAT_EXACT));
  const pμ_in_beat = pμ_in_day - BigInt(beat) * MU_PER_BEAT_EXACT;

  const rawStep = Number(floorDiv(pμ_in_beat, PULSES_PER_STEP_MICRO));
  const step = Math.min(Math.max(rawStep, 0), 43);

  const pulsesIntoDay = Number(floorDiv(pμ_in_day, ONE_PULSE_MICRO));

  const weekdayIdx = Number(imod(dayIndex, 6n));
  const harmonicDay = DAYS[weekdayIdx];

  const dayIndexNum = Number(dayIndex);
  const dayOfMonth = ((dayIndexNum % 42) + 42) % 42 + 1;
  const monthIndex0 = Math.floor(dayIndexNum / 42) % 8;
  const monthIndex1 = ((monthIndex0 + 8) % 8) + 1;

  return {
    beat,
    step,
    pulsesIntoDay,
    harmonicDay,
    dayOfMonth,
    monthIndex1,
    chakraStepString: `${beat}:${pad2(step)}`,
  };
}

/* ──────────── extra helpers ──────────── */
const eucMod = (n: number, m: number) => ((n % m) + m) % m;

const parseSealDM = (seal?: string): { d: number; m: number } | null => {
  if (!seal) return null;
  const m = squashSeal(seal).match(/D\s*(\d+)\s*\/\s*M\s*(\d+)/i);
  return m ? { d: Number(m[1]), m: Number(m[2]) } : null;
};

function addDaysWithinMonth(
  dayOfMonth1: number,
  monthIndex1: number,
  deltaDays: number,
): { dayOfMonth: number; monthIndex1: number } {
  const dm0 = dayOfMonth1 - 1;
  const total = dm0 + deltaDays;
  const newDm0 = eucMod(total, 42);
  const monthDelta = Math.floor(total / 42);
  const newMi1 = eucMod(monthIndex1 - 1 + monthDelta, 8) + 1;
  return { dayOfMonth: newDm0 + 1, monthIndex1: newMi1 };
}

/* ✅ derive beat/step from an absolute pulse (legacy migration helper) */
const BEAT_PULSES = DAY_PULSES / 36;
function deriveBeatStepFromPulse(absPulse: number): { beat: number; step: number } {
  const intoDay = ((absPulse % DAY_PULSES) + DAY_PULSES) % DAY_PULSES;
  const beat = Math.floor(intoDay / BEAT_PULSES);
  const intoBeat = intoDay - beat * BEAT_PULSES;
  const step = Math.min(43, Math.max(0, Math.floor(intoBeat / 11)));
  return { beat, step };
}

/* ══════════════ EXPORT HELPERS (Kairos-only) ══════════════ */
type ExportRow = {
  id: string;
  text: string;
  pulse: number;
  beat: number;
  step: number;
  chakraStep: string;
  dayIndex: number;
  dayName: Day;
  dayOfMonth: number;
  monthIndex1: number;
};

function augmentForExport(n: SavedNote): ExportRow {
  const dayIndex = Math.floor(n.pulse / DAY_PULSES);
  const dayName = DAYS[eucMod(dayIndex, 6)];
  const dayOfMonth = eucMod(dayIndex, 42) + 1;
  const monthIndex1 = eucMod(Math.floor(dayIndex / 42), 8) + 1;
  const chakraStep = `${n.beat}:${pad2(n.step)}`;
  return {
    id: n.id,
    text: n.text,
    pulse: n.pulse,
    beat: n.beat,
    step: n.step,
    chakraStep,
    dayIndex,
    dayName,
    dayOfMonth,
    monthIndex1,
  };
}

function escapeCSV(val: string | number): string {
  const s = String(val);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCSV(rows: ExportRow[]): string {
  const headers: (keyof ExportRow)[] = [
    "id",
    "text",
    "pulse",
    "beat",
    "step",
    "chakraStep",
    "dayIndex",
    "dayName",
    "dayOfMonth",
    "monthIndex1",
  ];
  const head = headers.join(",");
  const body = rows.map((r) => headers.map((h) => escapeCSV(r[h])).join(",")).join("\n");
  return `${head}\n${body}\n`;
}

function downloadBlob(filename: string, mime: string, data: string): void {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ══════════════ Sovereign snapshot builder ══════════════ */
function buildKaiSnapshot(now: Date): KaiKlock {
  const lk = computeLocalKai(now);
  const pμ_total = microPulsesSinceGenesis(now);
  const wholePulses = Number(floorDiv(pμ_total, ONE_PULSE_MICRO));
  const seal = `${lk.chakraStepString} — D${lk.dayOfMonth}/M${lk.monthIndex1}`;
  const arc = DAY_TO_ARC[lk.harmonicDay];
  return {
    harmonicDay: lk.harmonicDay,
    eternalKaiPulseToday: wholePulses,
    kairos_seal_day_month: seal,
    SpiralArc: arc,
  };
}

/* ══════════════ Notes storage (strict parse) ══════════════ */
type StoredUnknownNote = {
  id?: unknown;
  text?: unknown;
  pulse?: unknown;
  beat?: unknown;
  step?: unknown;
  createdAt?: unknown;
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";

function toSavedNote(u: unknown): SavedNote | null {
  const r = u as StoredUnknownNote;
  if (!isStr(r.id) || !isStr(r.text) || !isNum(r.pulse)) return null;

  const beat = isNum(r.beat) ? r.beat : undefined;
  const step = isNum(r.step) ? r.step : undefined;
  const createdAt = isNum(r.createdAt) ? r.createdAt : Date.now();

  if (beat === undefined || step === undefined) {
    const d = deriveBeatStepFromPulse(r.pulse);
    return { id: r.id, text: r.text, pulse: r.pulse, beat: d.beat, step: d.step, createdAt };
  }
  return { id: r.id, text: r.text, pulse: r.pulse, beat, step, createdAt };
}

function loadNotesFromStorage(): SavedNote[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as unknown[]).map(toSavedNote).filter((n): n is SavedNote => n !== null);
  } catch (err) {
    void err;
    return [];
  }
}

function loadHiddenIdsFromStorage(): Set<string> {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const raw = localStorage.getItem(HIDDEN_IDS_KEY);
    if (!raw) return new Set<string>();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    const onlyStrings = parsed.filter((x) => typeof x === "string") as string[];
    return new Set<string>(onlyStrings);
  } catch (err) {
    void err;
    return new Set<string>();
  }
}

/* ══════════════ WeekKalendarModal ══════════════ */
interface Props {
  onClose: () => void;
  container?: HTMLElement | null;
}

const WeekKalendarModal: FC<Props> = ({ onClose, container }) => {
  /* ── minimal time state (pulse-bound) ── */
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  /* derived snapshots (no extra React state) */
  const nowDate = useMemo(() => new Date(nowMs), [nowMs]);
  const localKai = useMemo<LocalKai>(() => computeLocalKai(nowDate), [nowDate]);
  const data = useMemo<KaiKlock>(() => buildKaiSnapshot(nowDate), [nowDate]);

  /* ── notes (loaded via initializer — no setState-in-effect) ── */
  const [notes, setNotes] = useState<SavedNote[]>(() => loadNotesFromStorage());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => loadHiddenIdsFromStorage());

  const [monthOpen, setMO] = useState(false);
  const [noteModal, setNM] = useState<{ open: boolean; pulse: number; initialText: string }>({
    open: false,
    pulse: 0,
    initialText: "",
  });
  const [dayDetail, setDD] = useState<HarmonicDayInfo | null>(null);

  /* ── motion ── */
  const mv = useMotionValue(0);
  const prog = useSpring(mv, { stiffness: 40, damping: 16, mass: 0.28 });

  /* External sync: Spiral hue → CSS vars */
  useEffect(() => {
    applySpiralHue(data.SpiralArc);
  }, [data.SpiralArc]);

  /* External sync: progress spring value */
  useEffect(() => {
    mv.set(Math.min(localKai.pulsesIntoDay / DAY_PULSES, 1));
  }, [mv, localKai.pulsesIntoDay]);

  /* ── μpulse-aligned scheduler (NO setState in effect body) ── */
  type TimeoutHandle = ReturnType<typeof window.setTimeout>; // ✅ DOM timer handle (number)
  const timeoutRef = useRef<TimeoutHandle | null>(null);
  const targetBoundaryRef = useRef<number>(0);

  const epochNow = () => performance.timeOrigin + performance.now();

  const computeNextBoundary = (nowEpochMs: number) => {
    const elapsed = nowEpochMs - GENESIS_TS;
    const periods = Math.ceil(elapsed / PULSE_MS_EXACT);
    return GENESIS_TS + periods * PULSE_MS_EXACT;
  };

  const clearAlignedTimer = useCallback(() => {
    const t = timeoutRef.current;
    if (t !== null) {
      window.clearTimeout(t);
      timeoutRef.current = null;
    }
  }, []);

  const armAlignedTimer = useCallback(() => {
    clearAlignedTimer();

    // schedule first boundary in the future
    targetBoundaryRef.current = computeNextBoundary(epochNow());

  }, [clearAlignedTimer]);

  useEffect(() => {
    // effect body only wires external system (timers + listeners)
    armAlignedTimer();

    const onVis = () => {
      if (document.visibilityState === "visible") {
        // callback from external event: allowed to setState
        setNowMs(Date.now());
        armAlignedTimer();
      }
    };

    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearAlignedTimer();
    };
  }, [armAlignedTimer, clearAlignedTimer]);

  /* ── notes persistence ── */
  const persistNotes = (ns: SavedNote[]) => {
    setNotes(ns);
    try {
      localStorage.setItem(NOTES_KEY, JSON.stringify(ns));
    } catch (err) {
      void err;
    }
  };

  const addNote = (note: EnrichedNote) => {
    const saved: SavedNote = { ...note, createdAt: Date.now() };
    persistNotes([...notes, saved]);
  };

  const persistHiddenIds = (set: Set<string>) => {
    setHiddenIds(set);
    try {
      localStorage.setItem(HIDDEN_IDS_KEY, JSON.stringify([...set]));
    } catch (err) {
      void err;
    }
  };

  /* ── day mapping helpers ── */
  const dayStartPulse = (idx: number): number => {
    const todayZero = Math.floor(data.eternalKaiPulseToday / DAY_PULSES) * DAY_PULSES;
    const curIdx = DAYS.indexOf(data.harmonicDay);
    return todayZero + (idx - curIdx) * DAY_PULSES;
  };

  const selectedDM = (idx: number): { dayOfMonth: number; monthIndex1: number } => {
    const baseDM = localKai.dayOfMonth ?? parseSealDM(data.kairos_seal_day_month || "")?.d ?? 1;
    const baseM = localKai.monthIndex1 ?? parseSealDM(data.kairos_seal_day_month || "")?.m ?? 1;

    const curIdx = DAYS.indexOf((localKai.harmonicDay ?? data.harmonicDay) || "Solhara");
    const delta = idx - curIdx;
    return addDaysWithinMonth(baseDM, baseM, delta);
  };

  /* ── PERSISTENT memories list (no time-based filtering) ── */
  const visibleMemories = useMemo(
    () => notes.filter((n) => !hiddenIds.has(n.id)).sort((a, b) => a.pulse - b.pulse),
    [notes, hiddenIds],
  );

  /* ── EXPORT actions ── */
  const exportJSON = () => {
    if (notes.length === 0) return;
    const rows = notes.map(augmentForExport);
    const kaiTag = `P${Math.round(data.eternalKaiPulseToday)}`;
    downloadBlob(`kairos-notes-${kaiTag}.json`, "application/json", JSON.stringify(rows, null, 2));
  };

  const exportCSV = () => {
    if (notes.length === 0) return;
    const rows = notes.map(augmentForExport);
    const csv = toCSV(rows);
    const kaiTag = `P${Math.round(data.eternalKaiPulseToday)}`;
    downloadBlob(`kairos-notes-${kaiTag}.csv`, "text/csv;charset=utf-8", csv);
  };

  /* ── CLEAR (panel-only) ── */
  const clearPanelNotes = () => {
    if (visibleMemories.length === 0) return;
    const next = new Set(hiddenIds);
    for (const n of visibleMemories) next.add(n.id);
    persistHiddenIds(next);
  };

  /* ── body scroll lock while modal is open ── */
  useEffect(() => {
    const prev = document.body.style.overflow;
    const prevTB = document.body.style.touchAction;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    return () => {
      document.body.style.overflow = prev;
      document.body.style.touchAction = prevTB;
    };
  }, []);

  /* ── focus ✕ on mount ── */
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeBtnRef.current?.focus();
  }, []);

  /* ── precompute ring geometry ── */
  const rings = useMemo(
    () =>
      DAYS.map((d, i) => ({
        day: d,
        idx: i,
        size: 90 - i * 10,
        colour: DAY_COLOR[d],
        delay: ((i * PHI) % 1) * (PULSE_MS / 1000),
      })),
    [],
  );

  /* ── render ── */
  const root = container ?? document.body;

  return createPortal(
    <>
      {/* WEEK modal backdrop */}
      <AnimatePresence>
        <motion.div
          key="wk-modal"
          className="wk-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: monthOpen ? 0.25 : 0.96 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.26 }}
          style={{ zIndex: Z_INDEX }}
          onClick={stopBubble}
          aria-hidden={false}
        >
          <div
            className="wk-container"
            role="dialog"
            aria-modal="true"
            onClick={stopBubble}
            style={{ zIndex: dayDetail || noteModal.open ? Z_INDEX + 6 : undefined }}
          >
            {/* ✕ close button */}
            <button
              ref={closeBtnRef}
              type="button"
              className="wk-close god-x"
              aria-label="Close"
              onClick={onClose}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                <defs>
                  <linearGradient id="grad-x" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#00eaff" />
                    <stop offset="100%" stopColor="#ff1559" />
                  </linearGradient>
                </defs>
                <line x1="4" y1="4" x2="20" y2="20" stroke="url(#grad-x)" strokeWidth="2" />
                <line x1="20" y1="4" x2="4" y2="20" stroke="url(#grad-x)" strokeWidth="2" />
              </svg>
            </button>

            {/* header toggle */}
            <div className="wk-header">
              <div className="wk-toggle" role="tablist" aria-label="Scope">
                <button
                  type="button"
                  role="tab"
                  aria-selected={!monthOpen}
                  className={!monthOpen ? "active" : ""}
                  onClick={() => {
                    setMO(false);
                    setDD(null);
                  }}
                >
                  Week
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={monthOpen}
                  className={monthOpen ? "active" : ""}
                  onClick={() => {
                    setDD(null);
                    setMO(true);
                  }}
                >
                  Month
                </button>
              </div>
            </div>

            {/* WEEK view */}
            <>
              {/* μpulse-accurate seal above kalendar */}
              <div className="wk-seal">
                <code>
                  {squashSeal(
                    `${localKai.chakraStepString} — D${localKai.dayOfMonth}/M${localKai.monthIndex1}`,
                  )}
                </code>
              </div>

              <svg
                className="wk-stage"
                viewBox="-50 -50 100 100"
                preserveAspectRatio="xMidYMid meet"
                aria-label="Week Rings"
              >
                {/* neon filter defs */}
                <defs>
                  <filter
                    id="neon-glow"
                    x="-50%"
                    y="-50%"
                    width="200%"
                    height="200%"
                    filterUnits="userSpaceOnUse"
                  >
                    <feGaussianBlur stdDeviation="1.8" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                {rings.map(({ day, idx, size, colour, delay }) => {
                  const isToday = (localKai.harmonicDay ?? data.harmonicDay) === day;
                  const w = size;
                  const h = size * 0.7;
                  const r = 10;
                  const d = `M ${-w / 2 + r} ${-h / 2} H ${w / 2 - r}
                             Q ${w / 2} ${-h / 2} ${w / 2} ${-h / 2 + r}
                             V ${h / 2 - r} Q ${w / 2} ${h / 2} ${w / 2 - r} ${h / 2}
                             H ${-w / 2 + r} Q ${-w / 2} ${h / 2} ${-w / 2} ${h / 2 - r}
                             V ${-h / 2 + r} Q ${-w / 2} ${-h / 2} ${-w / 2 + r} ${-h / 2} Z`;

                  const { dayOfMonth, monthIndex1 } = selectedDM(idx);

                  const openDay = () => {
                    const beatStep = localKai.chakraStepString ?? "0:00";
                    const kaiTimestamp = squashSeal(`${beatStep} — D${dayOfMonth}/M${monthIndex1}`);
                    const payload: HarmonicDayInfo = {
                      name: day,
                      kaiTimestamp,
                      startPulse: dayStartPulse(idx),
                    };
                    setDD(payload);
                  };

                  return (
                    <g key={day} style={{ cursor: "pointer" }} onClick={openDay}>
                      <motion.path
                        d={d}
                        fill="none"
                        stroke={colour}
                        strokeLinecap="round"
                        strokeWidth={isToday ? 3.2 : 1.7}
                        style={{ pathLength: isToday ? prog : 1, filter: "url(#neon-glow)" }}
                        animate={{
                          opacity: isToday ? [0.82, 1, 0.82] : [0.45, 0.7, 0.45],
                          strokeWidth: isToday ? [3.2, 3.6, 3.2] : [1.7, 2.0, 1.7],
                        }}
                        transition={{
                          opacity: {
                            duration: PULSE_MS / 1000,
                            repeat: Infinity,
                            ease: "easeInOut",
                            delay,
                          },
                          strokeWidth: {
                            duration: PULSE_MS / 1000,
                            repeat: Infinity,
                            ease: "easeInOut",
                            delay,
                          },
                        }}
                      />
                      <text
                        x="0"
                        y={-(h / 2) + 2}
                        fill={colour}
                        fontSize="4"
                        textAnchor="middle"
                        fontFamily="Inter, system-ui, sans-serif"
                        style={{ filter: "url(#neon-glow)" }}
                      >
                        {day}
                      </text>
                    </g>
                  );
                })}
              </svg>

              {/* add note btn */}
              <button
                type="button"
                className="wk-add-note-btn"
                aria-label="Add note"
                onClick={() =>
                  setNM({
                    open: true,
                    pulse: localKai.pulsesIntoDay ?? data.eternalKaiPulseToday,
                    initialText: "",
                  })
                }
              >
                ＋
              </button>
            </>

            {/* Day Detail overlay — TOPMOST */}
            {dayDetail && (
              <div
                className="wk-daydetail-overlay"
                style={{
                  position: "fixed",
                  inset: 0,
                  zIndex: Z_INDEX + 5,
                  display: "grid",
                  placeItems: "center",
                  pointerEvents: "auto",
                }}
                onClick={stopBubble}
              >
                <DayDetailModal day={dayDetail} onClose={() => setDD(null)} />
              </div>
            )}

            {/* NoteModal overlay — BELOW Day, ABOVE Memories */}
            {noteModal.open && (
              <div
                className="wk-notemodal-overlay"
                style={{
                  position: "fixed",
                  inset: 0,
                  zIndex: Z_INDEX + 4,
                  display: "grid",
                  placeItems: "center",
                  pointerEvents: "auto",
                }}
                onClick={stopBubble}
              >
                <NoteModal
                  pulse={noteModal.pulse}
                  initialText={noteModal.initialText}
                  onSave={(note) => {
                    addNote(note);
                    setNM((prev) => ({ ...prev, open: false }));
                  }}
                  onClose={() => setNM((prev) => ({ ...prev, open: false }))}
                />
              </div>
            )}
          </div>

          {/* Persistent Notes Dock — ALWAYS BELOW BOTH MODALS */}
          <aside
            className="wk-notes-dock"
            style={{
              position: "fixed",
              right: "clamp(8px, 2vw, 16px)",
              bottom: "clamp(8px, 2vh, 16px)",
              width: "min(440px, 86vw)",
              maxHeight: "48vh",
              zIndex: Z_INDEX + 3,
              pointerEvents: "auto",
            }}
            onClick={stopBubble}
          >
            <div
              className="wk-notes-list"
              style={{
                background: "rgba(0,0,0,0.35)",
                backdropFilter: "blur(6px)",
                WebkitBackdropFilter: "blur(6px)",
                borderRadius: "14px",
                boxShadow: "0 10px 24px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,255,255,0.12)",
                padding: "10px 12px",
                overflowY: "auto",
                maxHeight: "min(40vh, 240px)",
              }}
            >
              <div className="wk-notes-header" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Memories</h3>
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                  {visibleMemories.length > 0 && (
                    <button
                      type="button"
                      className="wk-chip wk-clear-btn"
                      title="Clear panel notes (does not delete)"
                      onClick={clearPanelNotes}
                    >
                      Clear
                    </button>
                  )}
                  {notes.length > 0 && (
                    <>
                      <button
                        type="button"
                        className="wk-export-btn"
                        title="Download all notes (JSON, Kairos-only)"
                        onClick={exportJSON}
                      >
                        ⤓ JSON
                      </button>
                      <button
                        type="button"
                        className="wk-export-btn"
                        title="Download all notes (CSV, Kairos-only)"
                        onClick={exportCSV}
                      >
                        ⤓ CSV
                      </button>
                    </>
                  )}
                </div>
              </div>

              {visibleMemories.length > 0 ? (
                <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none" }}>
                  {visibleMemories.map((n) => (
                    <li key={n.id} style={{ padding: "6px 4px" }}>
                      <strong>
                        {Math.round(n.pulse)} · {n.beat}:{pad2(n.step)}
                      </strong>
                      {" : "}
                      {n.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="wk-notes-empty" style={{ margin: "8px 0 0", opacity: 0.8 }}>
                  No memories yet.
                </p>
              )}
            </div>
          </aside>
        </motion.div>
      </AnimatePresence>

      {/* MONTH radial modal */}
      {monthOpen && (
        <MonthKalendarModal
          DAYS={DAYS}
          notes={notes}
          initialData={data}
          onSelectDay={() => {}}
          onAddNote={(idx) =>
            setNM({
              open: true,
              pulse: idx * DAY_PULSES, // seed; NoteModal computes final beat/step live
              initialText: notes.find((n) => Math.floor(n.pulse / DAY_PULSES) === idx)?.text || "",
            })
          }
          onClose={() => {
            setMO(false);
            setDD(null);
          }}
        />
      )}
    </>,
    root,
  );
};

export default WeekKalendarModal;
