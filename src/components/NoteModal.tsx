// NoteModal.tsx · “Kairos Kalendar — Note” · v5.1
// Document Mode, Toolbar, Autosize, Drag Resize, μpulse-accurate save (lint-clean, ref fix)

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type React from "react";
import type { FC } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { kairosEpochNow } from "../utils/kai_pulse";

/* ══════════════ Public types ══════════════ */
export interface Note {
  /** Integer Kai-Pulse at save time (rounded ties-to-even via μpulses) */
  pulse: number;
  /** Saved text content (plain text / markdown-ish) */
  text: string;
  /** Unique id */
  id: string;
  /** 0–35 */
  beat: number;
  /** 0–43 (0-based steps) */
  step: number;
}

interface NoteModalProps {
  /** (Legacy) initial pulse hint from caller; live pulse is computed internally */
  pulse: number;
  /** Optional initial text to prefill */
  initialText: string;
  /** Persist callback: receives enriched Note {pulse, beat, step, text, id} */
  onSave: (note: Note) => void | Promise<void>;
  /** Close callback */
  onClose: () => void;
}

/* ══════════════ Kai timing (μpulse parity with Week/Month) ══════════════ */
const GENESIS_TS = Date.UTC(2024, 4, 10, 6, 45, 41, 888);
const KAI_PULSE_SEC = 3 + Math.sqrt(5);
const PULSE_MS_EXACT = KAI_PULSE_SEC * 1000;

const ONE_PULSE_MICRO = 1_000_000n;
const N_DAY_MICRO = 17_491_270_421n;        // exact μpulses/day
const PULSES_PER_STEP_MICRO = 11_000_000n;  // 11 pulses per (0-based) step
const MU_PER_BEAT_EXACT = (N_DAY_MICRO + 18n) / 36n; // ties-to-even

function roundTiesToEvenBigInt(x: number): bigint {
  if (!Number.isFinite(x)) return 0n;
  const s = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const i = Math.trunc(ax);
  const f = ax - i;
  if (f < 0.5) return BigInt(s * i);
  if (f > 0.5) return BigInt(s * (i + 1));
  return BigInt(s * (i % 2 === 0 ? i : i + 1));
}
const imod = (n: bigint, m: bigint) => ((n % m) + m) % m;
function floorDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  return r !== 0n && (r > 0n) !== (d > 0n) ? q - 1n : q;
}
function microPulsesSinceGenesis(date: Date): bigint {
  const deltaSec = (date.getTime() - GENESIS_TS) / 1000;
  const pulses = deltaSec / KAI_PULSE_SEC;
  const micro = pulses * 1_000_000;
  return roundTiesToEvenBigInt(micro);
}

type LocalKai = {
  beat: number;           // 0..35
  step: number;           // 0..43 (0-based)
  pulsesIntoDay: number;  // whole pulses into current day (float truncated)
  livePulseApprox: number;// total pulse since genesis (approx, rounded)
};

function computeLocalKai(now: Date): LocalKai {
  const pμ_total = microPulsesSinceGenesis(now);
  const pμ_in_day = imod(pμ_total, N_DAY_MICRO);

  const beat = Number(floorDiv(pμ_in_day, MU_PER_BEAT_EXACT)); // 0..35
  const pμ_in_beat = pμ_in_day - BigInt(beat) * MU_PER_BEAT_EXACT;

  const rawStep = Number(floorDiv(pμ_in_beat, PULSES_PER_STEP_MICRO));
  const step = Math.min(Math.max(rawStep, 0), 43);

  const pulsesIntoDay = Number(floorDiv(pμ_in_day, ONE_PULSE_MICRO));
  const livePulseApprox = Number(floorDiv(pμ_total, ONE_PULSE_MICRO));

  return { beat, step, pulsesIntoDay, livePulseApprox };
}

/* ══════════════ Pretty helpers ══════════════ */
const pad2 = (n: number) => String(n).padStart(2, "0");


/* ══════════════ Hook: keyboard inset (VisualViewport) ══════════════ */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    const compute = () => {
      if (!vv) return setInset(0);
      const hidden = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
      setInset(Math.round(hidden));
    };
    compute();
    vv?.addEventListener("resize", compute);
    vv?.addEventListener("scroll", compute);
    window.addEventListener("resize", compute);
    return () => {
      vv?.removeEventListener("resize", compute);
      vv?.removeEventListener("scroll", compute);
      window.removeEventListener("resize", compute);
    };
  }, []);
  return inset;
}

/* ══════════════ Small utils (editor ops) ══════════════ */
const countWords = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
const estReadMin = (w: number) => Math.max(1, Math.round(w / 200));

/** Insert or wrap selection in a textarea (accepts nullable ref) */
function useTextOps(
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  setText: (s: string) => void
) {
  const withEl = (fn: (el: HTMLTextAreaElement) => void) => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    fn(el);
  };

  const wrap = (left: string, right = left) =>
    withEl((el) => {
      const { selectionStart, selectionEnd, value } = el;
      const sel = value.slice(selectionStart, selectionEnd) || "…";
      const next = value.slice(0, selectionStart) + left + sel + right + value.slice(selectionEnd);
      setText(next);
      const caret = selectionStart + left.length + sel.length + right.length;
      requestAnimationFrame(() => el.setSelectionRange(caret, caret));
    });

  const linePrefix = (prefix: string) =>
    withEl((el) => {
      const { selectionStart, selectionEnd, value } = el;
      const start = value.lastIndexOf("\n", selectionStart - 1) + 1;
      const end = value.indexOf("\n", selectionEnd);
      const hardEnd = end === -1 ? value.length : end;
      const block = value
        .slice(start, hardEnd)
        .split("\n")
        .map((ln) => (ln.startsWith(prefix) ? ln : `${prefix}${ln}`))
        .join("\n");
      const next = value.slice(0, start) + block + value.slice(hardEnd);
      setText(next);
      const caret = start + block.length;
      requestAnimationFrame(() => el.setSelectionRange(caret, caret));
    });

  return {
    bold: () => wrap("**"),
    italic: () => wrap("*"),
    h1: () => linePrefix("# "),
    h2: () => linePrefix("## "),
    bullet: () => linePrefix("- "),
    quote: () => linePrefix("> "),
  };
}

/* ══════════════ Component ══════════════ */
const NoteModal: FC<NoteModalProps> = ({ pulse, initialText, onSave, onClose }) => {
  const reduceMotion = useReducedMotion();

  // Form & UX state
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editorHeight, setEditorHeight] = useState<number | null>(null); // manual resize
  const [chars, setChars] = useState(initialText.length);

  // Live Kai state (μpulse-aligned, no drift)
  const [kai, setKai] = useState<LocalKai>(() => computeLocalKai(new Date()));

  // Focus & trap
  const modalRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // mobile keyboard clearance
  const kbInset = useKeyboardInset();

  /* Editor ops (toolbar) */
  const ops = useTextOps(textareaRef, (s) => {
    setText(s);
    setChars(s.length);
  });

  /* Autofocus text area on open */
  useEffect(() => textareaRef.current?.focus(), []);

  /* ESC to close */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  /* Simple focus trap (keeps tabbing inside the modal) */
  useEffect(() => {
    const el = modalRef.current;
    if (!el) return;
    const selector =
      'button,[href],input,textarea,select,details,[tabindex]:not([tabindex="-1"])';
    const getNodes = () =>
      Array.from(el.querySelectorAll<HTMLElement>(selector)).filter(
        (n) => !n.hasAttribute("disabled") && !n.getAttribute("aria-hidden")
      );
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const nodes = getNodes();
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, []);

  /* μpulse-aligned scheduler (exact φ period) */
  const timeoutRef = useRef<number | null>(null);
  const targetBoundaryRef = useRef<number>(0);
  const epochNow = () => performance.timeOrigin + performance.now();
  const computeNextBoundary = (nowMs: number) => {
    const elapsed = nowMs - GENESIS_TS;
    const periods = Math.ceil(elapsed / PULSE_MS_EXACT);
    return GENESIS_TS + periods * PULSE_MS_EXACT;
  };
  const clearTimer = () => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };
  const scheduleAlignedTick = useCallback(() => {
    clearTimer();
    setKai(computeLocalKai(new Date())); // initial sample
    const fire = () => {
      const nowMs = epochNow();
      if (nowMs >= targetBoundaryRef.current) {
        const missed = Math.floor((nowMs - targetBoundaryRef.current) / PULSE_MS_EXACT);
        for (let i = 0; i <= missed; i++) {
          setKai(computeLocalKai(new Date()));
          targetBoundaryRef.current += PULSE_MS_EXACT;
        }
      }
      const delay = Math.max(0, targetBoundaryRef.current - epochNow());
      timeoutRef.current = window.setTimeout(fire, delay) as unknown as number;
    };
    targetBoundaryRef.current = computeNextBoundary(epochNow());
    const initialDelay = Math.max(0, targetBoundaryRef.current - epochNow());
    timeoutRef.current = window.setTimeout(fire, initialDelay) as unknown as number;
  }, []);
  useEffect(() => {
    scheduleAlignedTick();
    const onVis = () => {
      if (document.visibilityState === "visible") scheduleAlignedTick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimer();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [scheduleAlignedTick]);

  /* Autosize textarea (grow with content unless user manually resized) */
  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el || editorHeight !== null) return; // respect manual size
    el.style.height = "auto";
    const max = Math.round(window.innerHeight * (expanded ? 0.7 : 0.42));
    el.style.height = Math.min(max, el.scrollHeight + 2) + "px";
  }, [expanded, editorHeight]);
  useEffect(() => {
    autoGrow();
  }, [text, expanded, autoGrow]);

  /* Drag-to-resize grip */
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const onGripDown = (e: React.PointerEvent) => {
    const el = textareaRef.current;
    if (!el) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startH: el.getBoundingClientRect().height };
  };
  const onGripMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const delta = e.clientY - dragRef.current.startY;
    const base = dragRef.current.startH + delta;
    const min = 120;
    const max = Math.round(window.innerHeight * 0.82);
    setEditorHeight(Math.max(min, Math.min(max, base)));
  };
  const onGripUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    dragRef.current = null;
  };

  /* Derived displays */
  const beatLabel = useMemo(() => `${kai.beat}:${pad2(kai.step)}`, [kai.beat, kai.step]);
  const words = useMemo(() => countWords(text), [text]);
  const readMin = useMemo(() => estReadMin(words), [words]);

  /* Save — resample at the exact click/shortcut moment */
  const doHaptic = () => {
    if ("vibrate" in navigator && typeof navigator.vibrate === "function") {
      navigator.vibrate(8);
    }
  };

  const commitSave = async () => {
    const trimmed = text.trim();
    if (!trimmed || saving) return;
    setSaving(true);

    const nowMsBI = kairosEpochNow();                 // bigint (epoch ms)
const nowKai = computeLocalKai(new Date(Number(nowMsBI))); // Date needs number

    const livePulse = Math.max(0, nowKai.livePulseApprox ?? Math.round(pulse));
    const note: Note = {
      id: `${livePulse}-${kairosEpochNow()}`,
      pulse: livePulse,
      text: trimmed,
      beat: nowKai.beat,
      step: nowKai.step,
    };

    try {
      doHaptic();
      await Promise.resolve(onSave(note));
    } finally {
      setSaving(false);
      onClose();
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        className="note-modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.92 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22 }}
        onClick={(e) => {
          // non-dismissive: ignore backdrop clicks to prevent accidental loss
          if (e.target === e.currentTarget) {
            /* no-op */
          }
        }}
      >
        <motion.div
          ref={modalRef}
          className={`note-modal${expanded ? " note-modal--expanded" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label="Add Kairos Note"
          initial={{ scale: 0.94, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.94, opacity: 0 }}
          transition={{ type: "spring", stiffness: 340, damping: 26 }}
          onClick={(e) => e.stopPropagation()}
          // keyboard avoidance: lift above overlay keyboards (iOS)
          style={{
            bottom: Math.max(12, kbInset),
            paddingBottom: "max(12px, env(safe-area-inset-bottom))",
          }}
        >
          {/* Header */}
          <div className="note-modal__header">
            <div className="note-modal__title">
              <span>Note @</span>
              <motion.code
                className="note-modal__beatstep"
                aria-label={`Beat ${kai.beat} Step ${kai.step}`}
                animate={
                  reduceMotion
                    ? {}
                    : { opacity: [0.9, 1, 0.9], filter: ["blur(0px)", "blur(0.2px)", "blur(0px)"] }
                }
                transition={
                  reduceMotion ? {} : { repeat: Infinity, duration: 5.236, ease: "easeInOut" }
                }
              >
                {beatLabel}
              </motion.code>
            </div>

            <div className="note-modal__meta">
              <code className="note-modal__pulse" title="Absolute Kai-Pulse">
                pulse&nbsp;{kai.livePulseApprox.toLocaleString()}
              </code>
          
            </div>

            {/* Top-right controls: Expand/Shrink + Close */}
            <div className="note-modal__controls">
              <button
                type="button"
                className="note-modal__expand"
                aria-pressed={expanded}
                title={expanded ? "Shrink editor" : "Expand editor"}
                onClick={() => {
                  setExpanded((v) => !v);
                  setEditorHeight(null); // reset manual size when flipping mode
                  requestAnimationFrame(() => textareaRef.current?.focus());
                }}
              >
                {expanded ? "↙︎" : "↗︎"}
              </button>

              <button
                type="button"
                className="note-modal__close"
                aria-label="Close"
                onClick={onClose}
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="note-modal__closeIcon"
                >
                  <defs>
                    <linearGradient id="kai-x" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="currentColor" />
                      <stop offset="100%" stopColor="currentColor" />
                    </linearGradient>
                  </defs>
                  <line x1="5" y1="5" x2="19" y2="19" stroke="url(#kai-x)" strokeWidth="2" />
                  <line x1="19" y1="5" x2="5" y2="19" stroke="url(#kai-x)" strokeWidth="2" />
                </svg>
              </button>
            </div>
          </div>

          {/* Toolbar */}
          <div className="note-modal__toolbar" role="group" aria-label="Formatting">
            <button
              type="button"
              className="tool-btn"
              title="Bold (**) — Cmd/Ctrl+B"
              onClick={(e) => {
                e.preventDefault();
                ops.bold();
              }}
            >
              B
            </button>
            <button
              type="button"
              className="tool-btn"
              title="Italic (*) — Cmd/Ctrl+I"
              onClick={(e) => {
                e.preventDefault();
                ops.italic();
              }}
            >
              I
            </button>
            <span className="tool-sep" />
            <button
              type="button"
              className="tool-btn"
              title="Heading 1 (# )"
              onClick={(e) => {
                e.preventDefault();
                ops.h1();
              }}
            >
              H1
            </button>
            <button
              type="button"
              className="tool-btn"
              title="Heading 2 (## )"
              onClick={(e) => {
                e.preventDefault();
                ops.h2();
              }}
            >
              H2
            </button>
            <span className="tool-sep" />
            <button
              type="button"
              className="tool-btn"
              title="Bulleted list (- )"
              onClick={(e) => {
                e.preventDefault();
                ops.bullet();
              }}
            >
              •
            </button>
            <button
              type="button"
              className="tool-btn"
              title="Quote (> )"
              onClick={(e) => {
                e.preventDefault();
                ops.quote();
              }}
            >
              ❝
            </button>

            {/* Stats (right-aligned) */}
            <div className="tool-stats" aria-live="polite">
              <span>{chars.toLocaleString()} chars</span>
              <span>· {words.toLocaleString()} words</span>
              <span>· {readMin} min</span>
            </div>
          </div>

          {/* Editor */}

            <div className={`note-modal__field${expanded ? " note-modal__field--doc" : ""}`}>
              {/* The “page” textarea. Height prefers: manual resize > mode default > autosize */}
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setChars(e.target.value.length);
                }}
                onKeyDown={(e) => {
                  // Save shortcut
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    void commitSave();
                  }
                  // common formatting shortcuts
                  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
                    e.preventDefault();
                    ops.bold();
                  }
                  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") {
                    e.preventDefault();
                    ops.italic();
                  }
                }}
                placeholder="Cast your resonance into the kairos stream..."
                rows={expanded ? 14 : 6}
                aria-label="Note text"
                maxLength={20000}
                style={{
                  height: editorHeight !== null ? `${Math.round(editorHeight)}px` : undefined,
                }}
              />
              {/* drag handle */}
              <div
                className="note-modal__resize"
                role="separator"
                aria-orientation="horizontal"
                title="Drag to resize"
                onPointerDown={onGripDown}
                onPointerMove={onGripMove}
                onPointerUp={onGripUp}
              />
            
            <div className="note-modal__hints" aria-live="polite">
              Encoding to <strong>Beat {kai.beat}</strong> • <strong>Step {kai.step}</strong>
            </div>
          </div>

          {/* Actions */}
          <div className="note-modal__actions">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!text.trim() || saving}
              onClick={commitSave}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default NoteModal;
