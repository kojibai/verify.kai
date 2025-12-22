// src/components/DayDetailModal.tsx
/* ───────────────────────────────────────────────────────────────
   DayDetailModal.tsx · Atlantean Lumitech  “Kairos Kalendar — Day”
   v3.0.2 · REF-TYPED (accept RefObject<T|null> safely) • PURE RENDER • Deterministic Note IDs
   ───────────────────────────────────────────────────────────────
   • Bottom-sheet editor auto-lifts above mobile keyboards
   • Uses VisualViewport (iOS/Android) with safe fallback
   • Textarea autofocus + scroll-into-view on open
   • onSaveKaiNote callback maps Beat:Step → absolute pulse (BigInt-exact; no float drift)
   • ✅ No Date.now / Math.random / randomUUID
   • ✅ No setState called synchronously inside effects
   • ✅ No inline style props (CSS owns visuals; JS only sets CSS vars on refs)
   ─────────────────────────────────────────────────────────────── */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FC } from "react";
import { AnimatePresence, motion } from "framer-motion";
import "./DayDetailModal.css";

/* ══════════════ Types ══════════════ */
export interface HarmonicDayInfo {
  name: string; // e.g. “Solhara”
  kaiTimestamp: string; // display string (already formatted)
  startPulse: number; // first Kai-Pulse of the day (integer)
}

interface Note {
  beat: number; // 0-based beat
  step: number; // 0–43
  text: string;
}

/* When saving from Day modal, parent may persist to global dock */
export type SaveKaiNote = (n: {
  id: string;
  text: string;
  pulse: number;
  beat: number;
  step: number;
}) => void;

export type DayDetailModalProps = {
  day: HarmonicDayInfo;
  onClose: () => void;
  onSaveKaiNote?: SaveKaiNote; // push to global dock in parent
};

/* ══════════════ Constants ══════════════ */
const TOTAL_BEATS = 36; // 0 … 35
const BEATS_PER_CHAPTER = 12; // → 3 chapters
const STEPS_PER_BEAT = 44; // steps 0..43

/* BigInt-exact mapping constants (match WeekKalendarModal) */
const ONE_PULSE_MICRO = 1_000_000n;
const N_DAY_MICRO = 17_491_270_421n;
const PULSES_PER_STEP_MICRO = 11_000_000n;
const MU_PER_BEAT_EXACT = (N_DAY_MICRO + 18n) / 36n;

/* Local storage key for per-day editor (independent of global dock) */
const STORAGE_PREFIX = "kai_notes_";

/* 4 step-categories per beat (11 each) — 0-based */
const STEP_GROUPS: Array<{ idx: number; start: number; end: number; title: string }> = [
  { idx: 0, start: 0, end: 10, title: "Steps 0–10" },
  { idx: 1, start: 11, end: 21, title: "Steps 11–21" },
  { idx: 2, start: 22, end: 32, title: "Steps 22–32" },
  { idx: 3, start: 33, end: 43, title: "Steps 33–43" },
];

/* ══════════════ Helpers ══════════════ */
const storageKey = (p: number): string => `${STORAGE_PREFIX}${p}`;

/** Deterministic, Kai-native note id: stable for a given Day+Beat+Step. */
const noteIdFor = (dayStartPulse: number, beat: number, step: number): string =>
  `kai_note_${dayStartPulse}_${beat}_${step}`;

type RawNote = Record<string, unknown>;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Parse & sanitize notes from storage without using `any`. */
const loadNotes = (p: number): Note[] => {
  try {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(storageKey(p));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) return [];

    const out: Note[] = [];
    for (const item of parsed as unknown[]) {
      if (!isRecord(item)) continue;

      const beatU = (item as RawNote).beat;
      const stepU = (item as RawNote).step;
      const textU = (item as RawNote).text;

      const beat = typeof beatU === "number" ? beatU : Number(beatU);
      const step = typeof stepU === "number" ? stepU : Number(stepU);
      const text = typeof textU === "string" ? textU : String(textU ?? "");

      if (Number.isFinite(beat) && Number.isFinite(step) && step >= 0 && step < STEPS_PER_BEAT) {
        out.push({ beat, step, text });
      }
    }
    return out;
  } catch {
    return [];
  }
};

const saveNotes = (p: number, n: Note[]): void => {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey(p), JSON.stringify(n));
  } catch {
    /* ignore quota/private-mode errors */
  }
};

function floorDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  return r !== 0n && (r > 0n) !== (d > 0n) ? q - 1n : q;
}

/* Map Beat:Step → absolute pulse (integer) within the given day (BigInt exact) */
const beatStepToPulse = (dayStartPulse: number, beat: number, step: number): number => {
  const beatB = BigInt(beat);
  const stepB = BigInt(step);
  const offsetMicro = beatB * MU_PER_BEAT_EXACT + stepB * PULSES_PER_STEP_MICRO;
  const offsetPulses = floorDiv(offsetMicro, ONE_PULSE_MICRO);
  return Number(BigInt(dayStartPulse) + offsetPulses);
};

/* ══════════════ Animation variants ══════════════ */
const collapseVariants = {
  closed: { height: 0, opacity: 0 },
  open: { height: "auto", opacity: 1 },
} as const;

/* ══════════════ Accessible key handler (Enter/Space) ══════════════ */
const onEnterOrSpace =
  (fn: () => void) =>
  (e: React.KeyboardEvent<HTMLElement>): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };

/* ══════════════ Hook: keyboard inset → CSS var (NO setState) ══════════════
   FIX: accept `RefObject<T | null>` so even if someone typed
   `React.RefObject<HTMLDivElement | null>` it still matches.
*/
function useKeyboardInsetCSSVar<T extends HTMLElement>(
  targetRef: React.RefObject<T | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const el = targetRef.current;
    if (!el) return;

    const computeInset = (): number => {
      const vv = window.visualViewport;
      if (!vv) return 0;
      return Math.round(Math.max(0, window.innerHeight - (vv.height + vv.offsetTop)));
    };

    const apply = (): void => {
      const inset = computeInset();
      el.style.setProperty("--kb-inset", `${inset}px`);
    };

    apply();

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", apply);
      vv.addEventListener("scroll", apply);
    }
    window.addEventListener("resize", apply);

    return () => {
      if (vv) {
        vv.removeEventListener("resize", apply);
        vv.removeEventListener("scroll", apply);
      }
      window.removeEventListener("resize", apply);
    };
  }, [enabled, targetRef]);
}

/* ══════════════ Component ══════════════ */
const DayDetailModal: FC<DayDetailModalProps> = ({ day, onClose, onSaveKaiNote }) => {
  /* ───────── state ───────── */
  const [editing, setEditing] = useState<Note | null>(null);

  // Accordion: nothing open by default
  const [openChapter, setOpenChapter] = useState<number>(-1); // –1 ⇒ all closed
  const [openBeat, setOpenBeat] = useState<number | null>(null);

  // within-beat step group (0..3), none open by default
  const [openGroup, setOpenGroup] = useState<number | null>(null);

  // Notes: localStorage is source-of-truth; rev tick triggers reread
  const [notesRev, setNotesRev] = useState<number>(0);

  const notes = useMemo(() => loadNotes(day.startPulse), [day.startPulse, notesRev]);

  /* ───────── structure ───────── */
  const chapters = useMemo(() => {
    const num = Math.ceil(TOTAL_BEATS / BEATS_PER_CHAPTER); // 3
    return Array.from({ length: num }, (_, c) => {
      const start = c * BEATS_PER_CHAPTER; // 0, 12, 24
      const end = Math.min(start + BEATS_PER_CHAPTER, TOTAL_BEATS);
      const beats = Array.from({ length: end - start }, (_, i) => {
        const beatIdx = start + i;
        return { beat: beatIdx, steps: Array.from({ length: STEPS_PER_BEAT }, (_, s) => s) };
      });
      return { chapter: c, title: `Beats ${start}–${end - 1}`, beats };
    });
  }, []);

  /* ───────── notes helpers ───────── */
  const findNote = useCallback(
    (b: number, s: number) => notes.find((n) => n.beat === b && n.step === s),
    [notes],
  );

  const upsertNote = useCallback(
    (beat: number, step: number, text: string): void => {
      const current = loadNotes(day.startPulse);
      const idx = current.findIndex((n) => n.beat === beat && n.step === step);

      const next =
        idx >= 0
          ? current.map((n, i) => (i === idx ? { ...n, text } : n))
          : [...current, { beat, step, text }];

      saveNotes(day.startPulse, next);
      setNotesRev((r) => r + 1);
    },
    [day.startPulse],
  );

  /* ───────── tap-friendly handlers (pointer) ───────── */
  const toggleChapter = useCallback((chapter: number) => {
    setOpenChapter((prev) => (prev === chapter ? -1 : chapter));
    setOpenBeat(null);
    setOpenGroup(null);
  }, []);

  const toggleBeat = useCallback((beat: number) => {
    setOpenBeat((prev) => (prev === beat ? null : beat));
    setOpenGroup(null);
  }, []);

  const toggleGroup = useCallback((groupIdx: number) => {
    setOpenGroup((prev) => (prev === groupIdx ? null : groupIdx));
  }, []);

  /* ───────── focus safety ───────── */
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const btn = panelRef.current?.querySelector<HTMLButtonElement>(".close-btn");
    btn?.focus();
  }, []);

  /* ───────── keyboard-safe editor (CSS var) ─────────
     NOTE: keep it simple. Do NOT annotate as React.RefObject<HTMLDivElement | null>.
  */
  const sheetRef = useRef<HTMLDivElement>(null);
  useKeyboardInsetCSSVar(sheetRef, Boolean(editing));

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) return;
    if (typeof window === "undefined") return;

    const t = window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 60);

    return () => window.clearTimeout(t);
  }, [editing]);

  /* ───────── deterministic save handler ───────── */
  const handleSave = useCallback((): void => {
    if (!editing) return;

    const text = editing.text.trim();
    if (!text) return;

    // Save in the Day editor (localStorage-backed)
    upsertNote(editing.beat, editing.step, text);

    // Push to global notes dock with exact Beat:Step → absolute pulse
    const pulse = beatStepToPulse(day.startPulse, editing.beat, editing.step);
    const id = noteIdFor(day.startPulse, editing.beat, editing.step);

    onSaveKaiNote?.({ id, text, pulse, beat: editing.beat, step: editing.step });
    setEditing(null);
  }, [day.startPulse, editing, onSaveKaiNote, upsertNote]);

  /* ══════════════ UI ══════════════ */
  return (
    <AnimatePresence>
      {/* Backdrop is visible but does NOT intercept clicks (CSS: pointer-events:none) */}
      <motion.div
        className="day-modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.85 }}
        exit={{ opacity: 0 }}
      />

      {/* Modal Panel */}
      <motion.section
        ref={panelRef}
        className="day-modal"
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="day-title"
      >
        {/* Header (sticky) */}
        <header className="day-header">
          <h2 id="day-title">
            {day.name} <span>• {day.kaiTimestamp}</span>
          </h2>

          <button
            type="button"
            className="close-btn"
            onPointerDown={onClose}
            onKeyDown={onEnterOrSpace(onClose)}
            aria-label="Close Day Detail"
          >
            ✕
          </button>
        </header>

        {/* Accordion list */}
        <div className="beat-list">
          {chapters.map(({ chapter, title, beats }) => {
            const chapterOpen = openChapter === chapter;
            return (
              <div className="chapter-container" key={chapter}>
                {/* Chapter toggle */}
                <button
                  type="button"
                  className={`chapter-header ${chapterOpen ? "open" : ""}`}
                  aria-expanded={chapterOpen}
                  aria-controls={`chapter-${chapter}`}
                  onPointerDown={() => toggleChapter(chapter)}
                  onKeyDown={onEnterOrSpace(() => toggleChapter(chapter))}
                >
                  {title}
                  <span className="chevron" aria-hidden="true" />
                </button>

                <AnimatePresence initial={false}>
                  {chapterOpen && (
                    <motion.div
                      id={`chapter-${chapter}`}
                      className="chapter-body"
                      variants={collapseVariants}
                      initial="closed"
                      animate="open"
                      exit="closed"
                      transition={{ type: "tween", duration: 0.24 }}
                    >
                      {beats.map(({ beat, steps }) => {
                        const beatOpen = openBeat === beat;

                        return (
                          <div className="beat-accordion" key={beat}>
                            {/* Beat toggle */}
                            <button
                              type="button"
                              className={`beat-header ${beatOpen ? "open" : ""}`}
                              aria-expanded={beatOpen}
                              aria-controls={`beat-${beat}`}
                              onPointerDown={() => toggleBeat(beat)}
                              onKeyDown={onEnterOrSpace(() => toggleBeat(beat))}
                            >
                              Beat&nbsp;{beat}
                              <span className="chevron" aria-hidden="true" />
                            </button>

                            <AnimatePresence initial={false}>
                              {beatOpen && (
                                <motion.div
                                  id={`beat-${beat}`}
                                  className="beat-steps"
                                  variants={collapseVariants}
                                  initial="closed"
                                  animate="open"
                                  exit="closed"
                                  transition={{ type: "tween", duration: 0.24 }}
                                >
                                  {/* ── Four step-groups inside the open beat ── */}
                                  {STEP_GROUPS.map(({ idx, start, end, title: groupTitle }) => {
                                    const groupOpen = openGroup === idx;
                                    return (
                                      <div className="group-accordion" key={idx}>
                                        <button
                                          type="button"
                                          className={`group-header ${groupOpen ? "open" : ""}`}
                                          aria-expanded={groupOpen}
                                          aria-controls={`beat-${beat}-group-${idx}`}
                                          onPointerDown={() => toggleGroup(idx)}
                                          onKeyDown={onEnterOrSpace(() => toggleGroup(idx))}
                                        >
                                          {groupTitle}
                                          <span className="chevron" aria-hidden="true" />
                                        </button>

                                        <AnimatePresence initial={false}>
                                          {groupOpen && (
                                            <motion.div
                                              id={`beat-${beat}-group-${idx}`}
                                              className="group-body"
                                              variants={collapseVariants}
                                              initial="closed"
                                              animate="open"
                                              exit="closed"
                                              transition={{ type: "tween", duration: 0.2 }}
                                            >
                                              {steps
                                                .filter((s) => s >= start && s <= end)
                                                .map((step) => {
                                                  const note = findNote(beat, step);
                                                  const globalIdx = beat * STEPS_PER_BEAT + step;

                                                  const openEditor = (): void => {
                                                    setEditing({ beat, step, text: note?.text ?? "" });
                                                  };

                                                  return (
                                                    <div
                                                      key={step}
                                                      role="button"
                                                      tabIndex={0}
                                                      data-step-index={globalIdx}
                                                      className={`step-row${note ? " has-note" : ""}`}
                                                      onPointerDown={openEditor}
                                                      onKeyDown={onEnterOrSpace(openEditor)}
                                                    >
                                                      <span className="step-index">Step&nbsp;{step}</span>

                                                      {note && (
                                                        <span className="step-note-preview">
                                                          {note.text.length > 42
                                                            ? `${note.text.slice(0, 42)}…`
                                                            : note.text}
                                                        </span>
                                                      )}
                                                    </div>
                                                  );
                                                })}
                                            </motion.div>
                                          )}
                                        </AnimatePresence>
                                      </div>
                                    );
                                  })}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        {/* Bottom-sheet editor (keyboard-safe; CSS reads --kb-inset) */}
        <AnimatePresence>
          {editing && (
            <>
              <motion.div
                className="note-editor-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.8 }}
                exit={{ opacity: 0 }}
                onPointerDown={() => setEditing(null)}
              />

              <motion.div
                ref={sheetRef}
                className="note-editor"
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "tween", duration: 0.24 }}
                role="dialog"
                aria-label={`Edit note for Beat ${editing.beat}, Step ${editing.step}`}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <h4>
                  Beat&nbsp;{editing.beat} • Step&nbsp;{editing.step}
                </h4>

                <textarea
                  ref={textareaRef}
                  autoFocus
                  value={editing.text}
                  placeholder="Add your resonance note…"
                  onChange={(e) => {
                    const next = e.target.value;
                    setEditing((prev) => (prev ? { ...prev, text: next } : prev));
                  }}
                  onFocus={() => textareaRef.current?.scrollIntoView({ block: "center", behavior: "smooth" })}
                />

                <footer>
                  <button
                    type="button"
                    className="btn-cancel"
                    onPointerDown={() => setEditing(null)}
                    onKeyDown={onEnterOrSpace(() => setEditing(null))}
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    className="btn-save"
                    disabled={!editing.text.trim()}
                    onPointerDown={handleSave}
                    onKeyDown={onEnterOrSpace(handleSave)}
                  >
                    Save
                  </button>
                </footer>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </motion.section>
    </AnimatePresence>
  );
};

export default DayDetailModal;
