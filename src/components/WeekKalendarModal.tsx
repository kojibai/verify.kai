// src/components/WeekKalendarModal.tsx
/* ────────────────────────────────────────────────────────────────
   WeekKalendarModal.tsx · Atlantean Lumitech “Kairos Kalendar”
   v10.1.2 · BIGINT-SAFE (no unions) + Deterministic μpulse boundaries
   ────────────────────────────────────────────────────────────────
   ✅ Fix: NO bigint leaks into React state / objects typed as number
   ✅ Uses canonical GENESIS_TS / PULSE_MS from kai_pulse.ts
   ✅ Boundary scheduling derived from μpulse rounding (ties-to-even)
   ✅ DOM timer typing: timeoutRef is always number | null
   ✅ No early-return before hooks (rules-of-hooks safe)
───────────────────────────────────────────────────────────────── */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FC, KeyboardEvent, SyntheticEvent } from "react";
import { createPortal, flushSync } from "react-dom";

import { GENESIS_TS, PULSE_MS, kairosEpochNow } from "../utils/kai_pulse";

import "./WeekKalendarModal.css";

import DayDetailModal from "./DayDetailModal";
import MonthKalendarModal from "./MonthKalendarModal";

import NoteModal from "./NoteModal";
import type { Note as EnrichedNote } from "./NoteModal";

/* ── isomorphic layout effect (no SSR warning) ── */
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/* day pulses (whole pulses, not μpulses) */
const DAY_PULSES = 17_491.270_421;

const NOTES_KEY = "kairosNotes";
const HIDDEN_IDS_KEY = "kairosNotesHiddenIds";

/* kairosEpochNow returns bigint → this modal uses epoch-ms as number for Date/timers */
const epochMsNow = (): number => {
  const msB = kairosEpochNow();
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  const minSafe = BigInt(Number.MIN_SAFE_INTEGER);
  if (msB > maxSafe) return Number.MAX_SAFE_INTEGER;
  if (msB < minSafe) return Number.MIN_SAFE_INTEGER;
  const n = Number(msB);
  return Number.isFinite(n) ? n : 0;
};

/* ───────── Spiral → palette (Root-►Krown) ───────── */
const Spiral_COLOR = {
  Root: "#ff0024",
  Sakral: "#ff6f00",
  Solar: "#ffd600",
  Heart: "#00c853",
  Throat: "#00b0ff",
  Krown: "#c186ff",
  MemorySpiral: "#ff80ab",
} as const;

const ARC_TO_CHARKA = {
  "Ignition ArK": "Root",
  "Integration ArK": "Sakral",
  "Harmonization ArK": "Solar",
  "Reflection ArK": "Heart",
  "Purification ArK": "Throat",
  "Dream ArK": "Krown",
} as const;

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

const DAY_COLOR: Record<Day, string> = {
  Solhara: "#ff0024",
  Aquaris: "#ff6f00",
  Flamora: "#ffd600",
  Verdari: "#00c853",
  Sonari: "#00b0ff",
  Kaelith: "#c186ff",
};

/* local structural type (avoids needing a named export from DayDetailModal) */
type HarmonicDayInfo = {
  name: Day;
  kaiTimestamp: string;
  startPulse: number;
};

/* ══════════════ helpers ══════════════ */
const stop = (e: SyntheticEvent) => e.stopPropagation();

const stopHard = (e: SyntheticEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

const squashSeal = (seal: string) =>
  seal.replace(/D\s+(\d+)/, "D$1").replace(/\/\s*M(\d+)/, "/M$1");

const rgba = (hex: string, a: number) => {
  const h = hex.replace("#", "");
  const bi = Number.parseInt(h, 16);
  const r = (bi >> 16) & 255;
  const g = (bi >> 8) & 255;
  const b = bi & 255;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

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

/* ───────────────────── μpulse math (deterministic) ───────────────────── */
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

function microPulsesSinceGenesisMs(msUTC: number): bigint {
  const deltaMs = msUTC - GENESIS_TS;
  const pulses = deltaMs / PULSE_MS;
  return roundTiesToEvenBigInt(pulses * 1_000_000);
}

/* next φ-boundary in epoch-ms (number) — derived from μpulse rounding */
function computeNextBoundary(nowEpochMs: number): number {
  const pμ = microPulsesSinceGenesisMs(nowEpochMs);
  const pulseIdx = floorDiv(pμ, ONE_PULSE_MICRO);
  const nextPulseIdx = pulseIdx + 1n;
  return GENESIS_TS + Number(nextPulseIdx) * PULSE_MS;
}

/* ══════════════ types ══════════════ */
interface KaiKlock {
  harmonicDay: Day;
  eternalKaiPulseToday: number; // absolute whole pulses since genesis
  kairos_seal_day_month: string;
  SpiralArc?: string;
}

type SavedNote = EnrichedNote & { createdAt: number };

type LocalKai = {
  dayIndex: bigint;
  beat: number;
  step: number;
  pulsesIntoDay: number;
  harmonicDay: Day;
  dayOfMonth: number;
  monthIndex1: number;
  chakraStepString: string;
};

function computeLocalKai(now: Date): LocalKai {
  const pμ_total = microPulsesSinceGenesisMs(now.getTime());
  const pμ_in_day = imod(pμ_total, N_DAY_MICRO);
  const dayIndex = floorDiv(pμ_total, N_DAY_MICRO);

  const beat = Number(floorDiv(pμ_in_day, MU_PER_BEAT_EXACT));
  const pμ_in_beat = pμ_in_day - BigInt(beat) * MU_PER_BEAT_EXACT;

  const rawStep = Number(floorDiv(pμ_in_beat, PULSES_PER_STEP_MICRO));
  const step = Math.min(Math.max(rawStep, 0), 43);

  const pulsesIntoDay = Number(floorDiv(pμ_in_day, ONE_PULSE_MICRO));

  const weekdayIdx = Number(imod(dayIndex, 6n));
  const harmonicDay = DAYS[weekdayIdx];

  const dayOfMonth = Number(imod(dayIndex, 42n)) + 1;
  const monthIndex1 = Number(imod(floorDiv(dayIndex, 42n), 8n)) + 1;

  return {
    dayIndex,
    beat,
    step,
    pulsesIntoDay,
    harmonicDay,
    dayOfMonth,
    monthIndex1,
    chakraStepString: `${beat}:${pad2(step)}`,
  };
}

/* ══════════════ export helpers (Kairos-only) ══════════════ */
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

const eucMod = (n: number, m: number) => ((n % m) + m) % m;

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
  const pμ_total = microPulsesSinceGenesisMs(now.getTime());
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

/* legacy helper (float-safe fallback) */
const BEAT_PULSES = DAY_PULSES / 36;

function deriveBeatStepFromPulse(absPulse: number): { beat: number; step: number } {
  const intoDay = ((absPulse % DAY_PULSES) + DAY_PULSES) % DAY_PULSES;
  const beat = Math.floor(intoDay / BEAT_PULSES);
  const intoBeat = intoDay - beat * BEAT_PULSES;
  const step = Math.min(43, Math.max(0, Math.floor(intoBeat / 11)));
  return { beat, step };
}

function toSavedNote(u: unknown): SavedNote | null {
  const r = u as StoredUnknownNote;
  if (!isStr(r.id) || !isStr(r.text) || !isNum(r.pulse)) return null;

  const beat = isNum(r.beat) ? r.beat : undefined;
  const step = isNum(r.step) ? r.step : undefined;

  // createdAt MUST be number
  const createdAt: number = isNum(r.createdAt) ? r.createdAt : epochMsNow();

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
  } catch {
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
  } catch {
    return new Set<string>();
  }
}

function insertSortedByPulse(prev: SavedNote[], next: SavedNote): SavedNote[] {
  const i = prev.findIndex((p) => p.pulse > next.pulse);
  if (i === -1) return [...prev, next];
  return [...prev.slice(0, i), next, ...prev.slice(i)];
}

/* ══════════════ WeekKalendarModal ══════════════ */
interface Props {
  onClose: () => void;
  container?: HTMLElement | null;
}

const WeekKalendarModal: FC<Props> = ({ onClose, container }) => {
  // DO NOT early-return before hooks (fixes rules-of-hooks)
  const canUseDOM = typeof window !== "undefined" && typeof document !== "undefined";

  /* ── time state (pulse-bound) ── */
  const [nowMs, setNowMs] = useState<number>(() => epochMsNow());

  const nowDate = useMemo(() => new Date(nowMs), [nowMs]);
  const localKai = useMemo<LocalKai>(() => computeLocalKai(nowDate), [nowDate]);
  const data = useMemo<KaiKlock>(() => buildKaiSnapshot(nowDate), [nowDate]);

  /* ── notes (initializer — no setState-in-effect) ── */
  const [notes, setNotes] = useState<SavedNote[]>(() => loadNotesFromStorage());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => loadHiddenIdsFromStorage());

  const [monthOpen, setMonthOpen] = useState(false);

  const [noteModal, setNoteModal] = useState<{ open: boolean; pulse: number; initialText: string }>(() => ({
    open: false,
    pulse: 0,
    initialText: "",
  }));

  const [dayDetail, setDayDetail] = useState<HarmonicDayInfo | null>(null);

  /* ── portal root (computed safely) ── */
  const portalRoot = useMemo<HTMLElement | null>(() => {
    if (!canUseDOM) return null;
    return container ?? document.body;
  }, [canUseDOM, container]);

  /* ── apply hue BEFORE paint to prevent “flash” ── */
  useIsoLayoutEffect(() => {
    applySpiralHue(data.SpiralArc);
  }, [data.SpiralArc]);

  /* ── μpulse-aligned scheduler (NO NodeJS.Timeout) ── */
  const timeoutRef = useRef<number | null>(null);

  const clearAlignedTimer = useCallback(() => {
    const t = timeoutRef.current;
    if (t !== null) {
      window.clearTimeout(t);
      timeoutRef.current = null;
    }
  }, []);

  const armAlignedTimer = useCallback(() => {
    clearAlignedTimer();

    const now = epochMsNow();
    const target = computeNextBoundary(now);
    const delay = Math.max(0, target - now);

    timeoutRef.current = window.setTimeout(() => {
      setNowMs(epochMsNow());
      armAlignedTimer();
    }, delay);
  }, [clearAlignedTimer]);

  useEffect(() => {
    // effects don't run on SSR; safe
    armAlignedTimer();

    const onVis = () => {
      if (document.visibilityState === "visible") {
        setNowMs(epochMsNow());
        armAlignedTimer();
      }
    };

    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearAlignedTimer();
    };
  }, [armAlignedTimer, clearAlignedTimer]);

  /* ── notes persistence (sorted insert; no per-render sort) ── */
  const addNote = useCallback((note: EnrichedNote) => {
    setNotes((prev) => {
      const saved: SavedNote = { ...note, createdAt: epochMsNow() };
      const next = insertSortedByPulse(prev, saved);
      try {
        localStorage.setItem(NOTES_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const persistHiddenIds = useCallback((next: Set<string>) => {
    const copy = new Set(next);
    setHiddenIds(copy);
    try {
      localStorage.setItem(HIDDEN_IDS_KEY, JSON.stringify([...copy]));
    } catch {
      // ignore
    }
  }, []);

  /* ── derived day helpers (BigInt exact; no float dayStart) ── */
  const dayStartPulse = useCallback(
    (idx: number): number => {
      const curIdx = DAYS.indexOf(localKai.harmonicDay);
      const delta = idx - curIdx;
      const targetDayIndex = localKai.dayIndex + BigInt(delta);
      return Number(floorDiv(targetDayIndex * N_DAY_MICRO, ONE_PULSE_MICRO));
    },
    [localKai.dayIndex, localKai.harmonicDay],
  );

  const selectedDM = useCallback(
    (idx: number): { dayOfMonth: number; monthIndex1: number } => {
      const curIdx = DAYS.indexOf(localKai.harmonicDay);
      const delta = idx - curIdx;
      const targetDayIndex = localKai.dayIndex + BigInt(delta);
      const dayOfMonth = Number(imod(targetDayIndex, 42n)) + 1;
      const monthIndex1 = Number(imod(floorDiv(targetDayIndex, 42n), 8n)) + 1;
      return { dayOfMonth, monthIndex1 };
    },
    [localKai.dayIndex, localKai.harmonicDay],
  );

  /* ── visible memories (panel-only hides) ── */
  const visibleMemories = useMemo(() => notes.filter((n) => !hiddenIds.has(n.id)), [notes, hiddenIds]);

  /* ── export ── */
  const exportJSON = useCallback(() => {
    if (notes.length === 0) return;
    const rows = notes.map(augmentForExport);
    const kaiTag = `P${Math.round(data.eternalKaiPulseToday)}`;
    downloadBlob(`kairos-notes-${kaiTag}.json`, "application/json", JSON.stringify(rows, null, 2));
  }, [notes, data.eternalKaiPulseToday]);

  const exportCSV = useCallback(() => {
    if (notes.length === 0) return;
    const rows = notes.map(augmentForExport);
    const csv = toCSV(rows);
    const kaiTag = `P${Math.round(data.eternalKaiPulseToday)}`;
    downloadBlob(`kairos-notes-${kaiTag}.csv`, "text/csv;charset=utf-8", csv);
  }, [notes, data.eternalKaiPulseToday]);

  const clearPanelNotes = useCallback(() => {
    if (visibleMemories.length === 0) return;
    const next = new Set(hiddenIds);
    for (const n of visibleMemories) next.add(n.id);
    persistHiddenIds(next);
  }, [visibleMemories, hiddenIds, persistHiddenIds]);

  /* ── body scroll lock ── */
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

  /* ── focus close on mount (snappy) ── */
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  useIsoLayoutEffect(() => {
    closeBtnRef.current?.focus();
  }, []);

  /* ── topmost-first close behavior (ESC + backdrop tap) ── */
  const closeTopmost = useCallback(() => {
    if (dayDetail) {
      flushSync(() => setDayDetail(null));
      return;
    }
    if (noteModal.open) {
      flushSync(() => setNoteModal((p) => ({ ...p, open: false })));
      return;
    }
    if (monthOpen) {
      flushSync(() => setMonthOpen(false));
      return;
    }
    onClose();
  }, [dayDetail, noteModal.open, monthOpen, onClose]);

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeTopmost();
      }
    };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeTopmost]);

  /* ── ring geometry (precomputed) ── */
  const ringDefs = useMemo(() => {
    return DAYS.map((day, idx) => {
      const size = 90 - idx * 10;
      const w = size;
      const h = size * 0.7;
      const r = 10;

      const d = `M ${-w / 2 + r} ${-h / 2} H ${w / 2 - r}
                 Q ${w / 2} ${-h / 2} ${w / 2} ${-h / 2 + r}
                 V ${h / 2 - r} Q ${w / 2} ${h / 2} ${w / 2 - r} ${h / 2}
                 H ${-w / 2 + r} Q ${-w / 2} ${h / 2} ${-w / 2} ${h / 2 - r}
                 V ${-h / 2 + r} Q ${-w / 2} ${-h / 2} ${-w / 2 + r} ${-h / 2} Z`;

      return { day, idx, d, h, colour: DAY_COLOR[day] };
    });
  }, []);

  /* ── unique ids (no collisions) ── */
  const rid = useId().replace(/:/g, "");
  const glowId = `wk-neon-glow-${rid}`;
  const gradXId = `wk-grad-x-${rid}`;

  /* ── progress (pure SVG dash) ── */
  const dayProgress = useMemo(() => {
    const p = localKai.pulsesIntoDay / DAY_PULSES;
    return Math.max(0, Math.min(p, 1));
  }, [localKai.pulsesIntoDay]);

  /* ── instant open helpers (flushSync + pointerdown) ── */
  const openDayInstant = useCallback(
    (idx: number, day: Day) => {
      const { dayOfMonth, monthIndex1 } = selectedDM(idx);
      const kaiTimestamp = squashSeal(`${localKai.chakraStepString} — D${dayOfMonth}/M${monthIndex1}`);
      const payload: HarmonicDayInfo = { name: day, kaiTimestamp, startPulse: dayStartPulse(idx) };
      flushSync(() => setDayDetail(payload));
    },
    [dayStartPulse, localKai.chakraStepString, selectedDM],
  );

  const openNoteInstant = useCallback((pulse: number, initialText: string) => {
    flushSync(() => setNoteModal({ open: true, pulse, initialText }));
  }, []);

  const setMonthInstant = useCallback((open: boolean) => {
    flushSync(() => {
      setDayDetail(null);
      setMonthOpen(open);
    });
  }, []);

  // ✅ safe to return null AFTER hooks (fixes rules-of-hooks)
  if (!portalRoot) return null;

  return createPortal(
    <>
      <div
        className="wk-backdrop"
        data-theme="dark"
        data-mesh-depth="back"
        data-month-open={monthOpen ? "1" : "0"}
        role="presentation"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) {
            stopHard(e);
            closeTopmost();
          }
        }}
      >
        <div className="wk-container" role="dialog" aria-modal="true">
          {/* ✕ close button (instant) */}
          <button
            ref={closeBtnRef}
            type="button"
            className="wk-close god-x"
            aria-label="Close"
            onPointerDown={(e) => {
              stopHard(e);
              closeTopmost();
            }}
            onClick={(e) => {
              stopHard(e);
              closeTopmost();
            }}
          >
            <svg className="wk-xsvg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
              <defs>
                <linearGradient id={gradXId} x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#00eaff" />
                  <stop offset="100%" stopColor="#ff1559" />
                </linearGradient>
              </defs>
              <line x1="4" y1="4" x2="20" y2="20" stroke={`url(#${gradXId})`} strokeWidth="2" />
              <line x1="20" y1="4" x2="4" y2="20" stroke={`url(#${gradXId})`} strokeWidth="2" />
            </svg>
          </button>

          {/* header toggle (instant pointerdown) */}
          <div className="wk-header">
            <div className="wk-toggle" role="tablist" aria-label="Scope">
              <button
                type="button"
                role="tab"
                aria-selected={!monthOpen}
                className={!monthOpen ? "active" : ""}
                onPointerDown={(e) => {
                  stopHard(e);
                  setMonthInstant(false);
                }}
                onClick={(e) => {
                  stopHard(e);
                  setMonthInstant(false);
                }}
              >
                Week
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={monthOpen}
                className={monthOpen ? "active" : ""}
                onPointerDown={(e) => {
                  stopHard(e);
                  setMonthInstant(true);
                }}
                onClick={(e) => {
                  stopHard(e);
                  setMonthInstant(true);
                }}
              >
                Month
              </button>
            </div>
          </div>

          {/* Seal chip */}
          <div className="wk-seal" aria-hidden="true">
            <code className="wk-sealcode">
              {squashSeal(`${localKai.chakraStepString} — D${localKai.dayOfMonth}/M${localKai.monthIndex1}`)}
            </code>
          </div>

          {/* WEEK rings */}
          <svg className="wk-stage" viewBox="-50 -50 100 100" preserveAspectRatio="xMidYMid meet" aria-label="Week Rings">
            <defs>
              <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%" filterUnits="userSpaceOnUse">
                <feGaussianBlur stdDeviation="1.8" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {ringDefs.map(({ day, idx, d, h, colour }) => {
              const isToday = localKai.harmonicDay === day;
              const { dayOfMonth, monthIndex1 } = selectedDM(idx);

              const onKey = (e: KeyboardEvent<SVGGElement>) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openDayInstant(idx, day);
                }
              };

              return (
                <g
                  key={day}
                  className={`wk-day wk-i${idx} ${isToday ? "is-today" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${day} — D${dayOfMonth}/M${monthIndex1}`}
                  onPointerDown={(e) => {
                    stopHard(e);
                    openDayInstant(idx, day);
                  }}
                  onClick={(e) => {
                    stopHard(e);
                    openDayInstant(idx, day);
                  }}
                  onKeyDown={onKey}
                >
                  <path
                    className={`wk-ring ${isToday ? "is-today-ring" : ""}`}
                    d={d}
                    fill="none"
                    stroke={colour}
                    strokeLinecap="round"
                    strokeWidth={isToday ? 3.2 : 1.7}
                    pathLength={1}
                    strokeDasharray={1}
                    strokeDashoffset={isToday ? 1 - dayProgress : 0}
                    filter={`url(#${glowId})`}
                  />

                  <text
                    className={`wk-day-label ${isToday ? "is-today-label" : ""}`}
                    x="0"
                    y={-(h / 2) + 2}
                    fill={colour}
                    textAnchor="middle"
                    filter={`url(#${glowId})`}
                  >
                    {day}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* add note btn — CSS owns placement */}
          <button
            type="button"
            className="wk-add-note-btn"
            aria-label="Add memory"
            onPointerDown={(e) => {
              stopHard(e);
              openNoteInstant(data.eternalKaiPulseToday, "");
            }}
            onClick={(e) => {
              stopHard(e);
              openNoteInstant(data.eternalKaiPulseToday, "");
            }}
          >
            ＋
          </button>

          {/* Day Detail overlay — TOPMOST */}
          {dayDetail && (
            <div className="wk-daydetail-overlay" onPointerDown={stop} onClick={stop} role="presentation">
              <DayDetailModal day={dayDetail} onClose={() => flushSync(() => setDayDetail(null))} />
            </div>
          )}

          {/* NoteModal overlay — below Day, above dock */}
          {noteModal.open && (
            <div className="wk-notemodal-overlay" onPointerDown={stop} onClick={stop} role="presentation">
              <NoteModal
                pulse={noteModal.pulse}
                initialText={noteModal.initialText}
                onSave={(note) => {
                  addNote(note);
                  flushSync(() => setNoteModal((prev) => ({ ...prev, open: false })));
                }}
                onClose={() => flushSync(() => setNoteModal((prev) => ({ ...prev, open: false })))}
              />
            </div>
          )}

          {/* Persistent Notes Dock */}
          <aside className="wk-notes-dock" onPointerDown={stop} onClick={stop}>
            <div className="wk-notes-list">
              <div className="wk-notes-header">
                <h3>Memories</h3>

                <div className="wk-notes-actions">
                  {visibleMemories.length > 0 && (
                    <button
                      type="button"
                      className="wk-chip wk-clear-btn"
                      title="Clear panel notes (does not delete)"
                      onPointerDown={(e) => {
                        stopHard(e);
                        clearPanelNotes();
                      }}
                      onClick={(e) => {
                        stopHard(e);
                        clearPanelNotes();
                      }}
                    >
                      Clear
                    </button>
                  )}

                  {notes.length > 0 && (
                    <div className="wk-export-group" aria-label="Export memories">
                      <button
                        type="button"
                        className="wk-export-btn"
                        title="Download JSON"
                        onPointerDown={(e) => {
                          stopHard(e);
                          exportJSON();
                        }}
                        onClick={(e) => {
                          stopHard(e);
                          exportJSON();
                        }}
                      >
                        ⤓ JSON
                      </button>
                      <span className="wk-divider" aria-hidden="true" />
                      <button
                        type="button"
                        className="wk-export-btn"
                        title="Download CSV"
                        onPointerDown={(e) => {
                          stopHard(e);
                          exportCSV();
                        }}
                        onClick={(e) => {
                          stopHard(e);
                          exportCSV();
                        }}
                      >
                        ⤓ CSV
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {visibleMemories.length > 0 ? (
                <ul className="wk-mem-ul" aria-label="Memories list">
                  {visibleMemories.map((n) => (
                    <li key={n.id} className="wk-mem-li">
                      <strong className="wk-mem-kai">
                        {Math.round(n.pulse)} · {n.beat}:{pad2(n.step)}
                      </strong>
                      <span className="wk-mem-text"> {n.text}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="wk-notes-empty">No memories yet.</p>
              )}
            </div>
          </aside>
        </div>
      </div>

      {/* MONTH radial modal */}
      {monthOpen && (
        <MonthKalendarModal
          container={portalRoot}
          DAYS={DAYS}
          notes={notes}
          initialData={data}
          onSelectDay={() => {}}
          onAddNote={(idx) => {
            const pulse = Number(floorDiv(BigInt(idx) * N_DAY_MICRO, ONE_PULSE_MICRO));
            const initialText = notes.find((n) => Math.floor(n.pulse / DAY_PULSES) === idx)?.text || "";
            openNoteInstant(pulse, initialText);
          }}
          onClose={() => {
            flushSync(() => {
              setMonthOpen(false);
              setDayDetail(null);
            });
          }}
        />
      )}
    </>,
    portalRoot,
  );
};

export default WeekKalendarModal;
