/* ──────────────────────────────────────────────────────────────────────────────
   App.tsx · ΦNet Sovereign Gate Shell (KaiOS-style PWA)
   v28.3.0 · Zero-jank Live Header + Bulletproof Popovers + Native Zoom Lock
   ──────────────────────────────────────────────────────────────────────────────
   KEY UX/PERF UPGRADES (no look/behavior regressions):
   ✅ Live header updates are isolated (no 250ms full-app rerender)
      - Only the LIVE button rerenders on pulse ticks
      - Everything else stays stable unless route/viewport actually changes

   ✅ VisualViewport listener is shared (no duplicate listeners / no thrash)
      - Single RAF-throttled publisher, multiple subscribers

   ✅ Popover scroll-lock is iOS-safe (no rubber-band / background wiggle)
      - Uses body position:fixed lock + scroll restore (still works everywhere)

   ✅ Zoom lock is more complete + less intrusive
      - Blocks pinch/double-tap/ctrl-zoom
      - Adds legacy iOS gesture* guards
      - Avoids swallowing legitimate input taps when possible

   ✅ Portal host is “fixed-safe”
      - Uses .app-shell when safe
      - Falls back to document.body if .app-shell would break position:fixed (transform/contain/etc.)
────────────────────────────────────────────────────────────────────────────── */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { createPortal } from "react-dom";

import VerifierStamper from "./components/VerifierStamper/VerifierStamper";
import KaiVohModal from "./components/KaiVoh/KaiVohModal";
import SigilModal from "./components/SigilModal";

// ✅ Kai Pulse NOW (canonical Kai-Klok utility)
// ✅ pull KKS v1.0 calendar constants for D/M/Y
import {
  momentFromUTC,
  DAYS_PER_MONTH,
  DAYS_PER_YEAR,
  MONTHS_PER_YEAR,
} from "./utils/kai_pulse";

// ✅ Chart + value (Atrium-level bar)
import HomePriceChartCard from "./components/HomePriceChartCard";
import SovereignDeclarations from "./components/SovereignDeclarations";

// ✅ IMPORTANT: use the ACTUAL explorer file (it lives in /components here)
import SigilExplorer from "./components/SigilExplorer";

// ✅ NEW: Eternal KaiKlok module (popover content)
import EternalKlock from "./components/KaiKlockHomeFace";

import SigilFeedPage from "./pages/SigilFeedPage";
import SigilPage from "./pages/SigilPage/SigilPage";
import PShort from "./pages/PShort";

import "./App.css";

type NavItem = {
  to: string;
  label: string;
  desc: string;
  end?: boolean;
};

// Strict: allow CSS custom vars without `any`
type AppShellStyle = CSSProperties & {
  ["--breath-s"]?: string;
  ["--vvh-px"]?: string;
};

// Popover needs its own SX vars (portal may be outside .sigil-explorer scope)
type ExplorerPopoverStyle = CSSProperties & {
  ["--sx-breath"]?: string;
  ["--sx-border"]?: string;
  ["--sx-border-strong"]?: string;
  ["--sx-ring"]?: string;
};

// Klock popover vars
type KlockPopoverStyle = CSSProperties & {
  ["--klock-breath"]?: string;
  ["--klock-border"]?: string;
  ["--klock-border-strong"]?: string;
  ["--klock-ring"]?: string;
  ["--klock-scale"]?: string;
};

// Explicit prop types for popovers
type ExplorerPopoverProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

type KlockPopoverProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

// ✅ router state shape for auto-opening details on KaiKlok launch
type KlockNavState = { openDetails?: boolean };

// ✅ IMPORTANT FIX (compile-time):
// Your EternalKlock component MUST accept this prop.
type EternalKlockProps = {
  initialDetailsOpen?: boolean;
};

type KaiMoment = ReturnType<typeof momentFromUTC>;

function readNum(obj: unknown, key: string): number | null {
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  const v = rec[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function fmt2(n: number): string {
  const nn = Math.floor(n);
  if (!Number.isFinite(nn)) return "00";
  if (nn < 0) return String(nn);
  return String(nn).padStart(2, "0");
}

function formatPulse(pulse: number): string {
  if (!Number.isFinite(pulse)) return "—";
  if (pulse < 0) return String(pulse);
  if (pulse < 1_000_000) return String(pulse).padStart(6, "0");
  return pulse.toLocaleString("en-US");
}

function modPos(n: number, d: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return 0;
  const r = n % d;
  return r < 0 ? r + d : r;
}

// App.tsx (or your existing VisualViewport init)
// sets <html data-perf="low"> only on genuinely low-power conditions
const root = document.documentElement;

const lowPower =
  window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ||
  window.matchMedia?.("(prefers-reduced-transparency: reduce)")?.matches ||
  (typeof (navigator as unknown as { deviceMemory?: number }).deviceMemory === "number" &&
    (navigator as unknown as { deviceMemory?: number }).deviceMemory! <= 4) ||
  (typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 4);

if (lowPower) root.dataset.perf = "low";
else delete root.dataset.perf;

// ===== KKS v1.0 display math (exact step) =====
// IMPORTANT: “pulse” is continuous; beat/step must be derived from the DAY FRACTION (not 11-pulse buckets),
// otherwise step drifts over the longer Kai-day.
const BEATS_PER_DAY = 36;
const STEPS_PER_BEAT = 44;
const STEPS_PER_DAY = BEATS_PER_DAY * STEPS_PER_BEAT;

// Canon breath count per day (precision)
const PULSES_PER_DAY = 17_491.270421;

type BeatStepDMY = {
  beat: number; // 0..35
  step: number; // 0..43
  day: number; // 1..DAYS_PER_MONTH
  month: number; // 1..MONTHS_PER_YEAR
  year: number; // 0-based
};

function computeBeatStepDMY(m: KaiMoment): BeatStepDMY {
  const pulse = readNum(m, "pulse") ?? 0;

  // Beat/Step (exact): map fractional day → step-of-day → beat/step
  const pulseInDay = modPos(pulse, PULSES_PER_DAY);
  const dayFrac = PULSES_PER_DAY > 0 ? pulseInDay / PULSES_PER_DAY : 0;

  const rawStepOfDay = Math.floor(dayFrac * STEPS_PER_DAY);
  const stepOfDay = Math.min(STEPS_PER_DAY - 1, Math.max(0, rawStepOfDay));

  const beat = Math.min(
    BEATS_PER_DAY - 1,
    Math.max(0, Math.floor(stepOfDay / STEPS_PER_BEAT)),
  );
  const step = Math.min(
    STEPS_PER_BEAT - 1,
    Math.max(0, stepOfDay - beat * STEPS_PER_BEAT),
  );

  // D/M/Y (KKS v1.0):
  // - Day starts at 1
  // - Month starts at 1
  // - Year is 0-based
  // Prefer the library’s dayIndex if present; otherwise derive from pulse.
  const dayIndexFromMoment =
    readNum(m, "dayIndex") ??
    readNum(m, "dayIndex0") ??
    readNum(m, "dayIndexSinceGenesis");

  const eps = 1e-9; // guard float boundary jitter
  const dayIndex =
    dayIndexFromMoment !== null
      ? Math.floor(dayIndexFromMoment)
      : Math.floor((pulse + eps) / PULSES_PER_DAY);

  const daysPerYear = Number.isFinite(DAYS_PER_YEAR) ? DAYS_PER_YEAR : 336;
  const daysPerMonth = Number.isFinite(DAYS_PER_MONTH) ? DAYS_PER_MONTH : 42;
  const monthsPerYear = Number.isFinite(MONTHS_PER_YEAR) ? MONTHS_PER_YEAR : 8;

  const year = Math.floor(dayIndex / daysPerYear); // 0-based
  const dayInYear = modPos(dayIndex, daysPerYear);

  let monthIndex = Math.floor(dayInYear / daysPerMonth); // 0-based
  if (monthIndex < 0) monthIndex = 0;
  if (monthIndex > monthsPerYear - 1) monthIndex = monthsPerYear - 1;

  const dayInMonth = dayInYear - monthIndex * daysPerMonth;

  const month = monthIndex + 1; // 1-based (M1 start)
  const day = Math.floor(dayInMonth) + 1; // 1-based (D1 start)

  return { beat, step, day, month, year };
}

/**
 * Beat:Step label (00:00)
 */
function formatBeatStepLabel(v: BeatStepDMY): string {
  return `${fmt2(v.beat)}:${fmt2(v.step)}`;
}

/**
 * D/M/Y label (D#/M#/Y#) — NO zero-padding:
 * Start is D1/M1/Y0
 */
function formatDMYLabel(v: BeatStepDMY): string {
  return `D${v.day}/M${v.month}/Y${v.year}`;
}

function isInteractiveTarget(t: EventTarget | null): boolean {
  const el = t instanceof Element ? t : null;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select" || tag === "button") return true;
  if (tag === "a") return true;
  const ht = el as HTMLElement;
  return Boolean(ht.isContentEditable) || Boolean(el.closest("[contenteditable='true']"));
}

/**
 * 🔒 useDisableZoom — lock viewport like a native app
 *
 * - Blocks pinch-zoom (multi-touch)
 * - Blocks double-tap zoom
 * - Blocks CTRL/⌘ +/- / 0 zoom shortcuts
 * - Adds iOS legacy gesture* guards
 * - Sets touch-action: manipulation on <html> and <body>
 *
 * NOTE: Pair this with CSS:
 *   input, textarea, select, button { font-size: 16px; }
 */
function useDisableZoom(): void {
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    let lastTouchEnd = 0;

    const onTouchEnd = (e: TouchEvent): void => {
      // Avoid swallowing legitimate fast taps on form controls/links.
      if (isInteractiveTarget(e.target)) return;

      const now = Date.now();
      if (now - lastTouchEnd <= 300) {
        // prevent double-tap zoom
        e.preventDefault();
      }
      lastTouchEnd = now;
    };

    const onTouchMove = (e: TouchEvent): void => {
      // Block pinch-zoom (2+ fingers moving)
      if (e.touches.length > 1) {
        e.preventDefault();
      }
    };

    const onWheel = (e: WheelEvent): void => {
      // Disable ctrl/⌘ + wheel zoom while preserving scrolling
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };

    const onKeydown = (e: KeyboardEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return;
      const k = e.key;
      // CTRL/⌘ + / - / 0 zoom shortcuts (covers different keyboard layouts)
      if (k === "+" || k === "-" || k === "=" || k === "_" || k === "0") {
        e.preventDefault();
      }
    };

    // iOS Safari legacy pinch handlers (non-standard, but still emitted on some builds)
    const onGesture = (e: Event): void => {
      e.preventDefault();
    };

    const html = document.documentElement;
    const body = document.body;

    const prevHtmlTouchAction = html.style.touchAction;
    const prevBodyTouchAction = body.style.touchAction;
    const prevTextSizeAdjust =
      (html.style as unknown as { webkitTextSizeAdjust?: string }).webkitTextSizeAdjust;

    html.style.touchAction = "manipulation";
    body.style.touchAction = "manipulation";
    (html.style as unknown as { webkitTextSizeAdjust?: string }).webkitTextSizeAdjust = "100%";

    // Capture helps block zoom earlier in the event chain.
    document.addEventListener("touchend", onTouchEnd, { passive: false, capture: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    document.addEventListener("gesturestart", onGesture, { passive: false, capture: true });
    document.addEventListener("gesturechange", onGesture, { passive: false, capture: true });
    document.addEventListener("gestureend", onGesture, { passive: false, capture: true });

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeydown);

    return () => {
      document.removeEventListener("touchend", onTouchEnd, { capture: true } as unknown as EventListenerOptions);
      document.removeEventListener("touchmove", onTouchMove, { capture: true } as unknown as EventListenerOptions);
      document.removeEventListener("gesturestart", onGesture, { capture: true } as unknown as EventListenerOptions);
      document.removeEventListener("gesturechange", onGesture, { capture: true } as unknown as EventListenerOptions);
      document.removeEventListener("gestureend", onGesture, { capture: true } as unknown as EventListenerOptions);

      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeydown);

      html.style.touchAction = prevHtmlTouchAction;
      body.style.touchAction = prevBodyTouchAction;
      (html.style as unknown as { webkitTextSizeAdjust?: string }).webkitTextSizeAdjust =
        prevTextSizeAdjust;
    };
  }, []);
}

/* ──────────────────────────────────────────────────────────────────────────────
   Shared VisualViewport publisher (RAF-throttled)
   - prevents duplicate listeners
   - prevents scroll/resize state thrash
────────────────────────────────────────────────────────────────────────────── */
type VVSize = { width: number; height: number };

type VVStore = {
  size: VVSize;
  subs: Set<(s: VVSize) => void>;
  listening: boolean;
  rafId: number | null;
  onAny?: (() => void) | null;
  cleanup?: (() => void) | null;
};

const vvStore: VVStore = {
  size: { width: 0, height: 0 },
  subs: new Set(),
  listening: false,
  rafId: null,
  onAny: null,
  cleanup: null,
};

function readVVNow(): VVSize {
  if (typeof window === "undefined") return { width: 0, height: 0 };
  const vv = window.visualViewport;
  if (vv) return { width: Math.round(vv.width), height: Math.round(vv.height) };
  return { width: window.innerWidth, height: window.innerHeight };
}

function startVVListeners(): void {
  if (typeof window === "undefined" || vvStore.listening) return;

  vvStore.listening = true;
  vvStore.size = readVVNow();

  const publish = (): void => {
    vvStore.rafId = null;
    const next = readVVNow();
    const prev = vvStore.size;
    if (next.width === prev.width && next.height === prev.height) return;
    vvStore.size = next;
    vvStore.subs.forEach((fn) => fn(next));
  };

  const schedule = (): void => {
    if (vvStore.rafId !== null) return;
    vvStore.rafId = window.requestAnimationFrame(publish);
  };

  vvStore.onAny = schedule;

  const vv = window.visualViewport;

  window.addEventListener("resize", schedule, { passive: true });
  if (vv) {
    vv.addEventListener("resize", schedule, { passive: true });
    vv.addEventListener("scroll", schedule, { passive: true });
  }

  vvStore.cleanup = (): void => {
    if (vvStore.rafId !== null) {
      window.cancelAnimationFrame(vvStore.rafId);
      vvStore.rafId = null;
    }
    window.removeEventListener("resize", schedule);
    if (vv) {
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
    }
    vvStore.onAny = null;
    vvStore.cleanup = null;
    vvStore.listening = false;
  };
}

function stopVVListenersIfIdle(): void {
  if (vvStore.subs.size > 0) return;
  if (vvStore.cleanup) vvStore.cleanup();
}

/**
 * useVisualViewportSize — shared, RAF-throttled viewport size
 */
function useVisualViewportSize(): VVSize {
  const [size, setSize] = useState<VVSize>(() => {
    if (typeof window === "undefined") return { width: 0, height: 0 };
    return readVVNow();
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    startVVListeners();

    const sub = (s: VVSize): void => setSize(s);
    vvStore.subs.add(sub);

    // sync immediately to store (covers mount after a resize)
    sub(vvStore.size);

    return () => {
      vvStore.subs.delete(sub);
      stopVVListenersIfIdle();
    };
  }, []);

  return size;
}

/* ──────────────────────────────────────────────────────────────────────────────
   iOS-safe scroll lock (prevents background rubber-band / scroll bleed)
────────────────────────────────────────────────────────────────────────────── */
function useBodyScrollLock(lock: boolean): void {
  const savedRef = useRef<{
    scrollY: number;
    htmlOverflow: string;
    bodyOverflow: string;
    bodyPosition: string;
    bodyTop: string;
    bodyLeft: string;
    bodyRight: string;
    bodyWidth: string;
  } | null>(null);

  useEffect(() => {
    if (!lock) return;
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const html = document.documentElement;
    const body = document.body;

    const scrollY = window.scrollY || window.pageYOffset || 0;

    savedRef.current = {
      scrollY,
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width,
    };

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";

    // The fixed-body technique is the most consistent “no bleed” lock on iOS.
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";

    return () => {
      const saved = savedRef.current;
      if (!saved) return;

      html.style.overflow = saved.htmlOverflow;
      body.style.overflow = saved.bodyOverflow;
      body.style.position = saved.bodyPosition;
      body.style.top = saved.bodyTop;
      body.style.left = saved.bodyLeft;
      body.style.right = saved.bodyRight;
      body.style.width = saved.bodyWidth;

      // restore scroll position
      window.scrollTo(0, saved.scrollY);
      savedRef.current = null;
    };
  }, [lock]);
}

function isFixedSafeHost(el: HTMLElement): boolean {
  const cs = window.getComputedStyle(el);

  const backdropFilter = (cs as unknown as { backdropFilter?: string }).backdropFilter;
  const willChange = cs.willChange || "";

  // Any of these can turn a descendant position:fixed into a containing-block relative fixed.
  const risky =
    (cs.transform && cs.transform !== "none") ||
    (cs.perspective && cs.perspective !== "none") ||
    (cs.filter && cs.filter !== "none") ||
    (backdropFilter && backdropFilter !== "none") ||
    (cs.contain && cs.contain !== "none") ||
    willChange.includes("transform") ||
    willChange.includes("perspective") ||
    willChange.includes("filter");

  return !risky;
}

function getPortalHost(): HTMLElement {
  const shell = document.querySelector(".app-shell");
  if (shell instanceof HTMLElement) {
    try {
      if (isFixedSafeHost(shell)) return shell;
    } catch {
      // ignore and fall through
    }
  }
  return document.body;
}

/* ──────────────────────────────────────────────────────────────────────────────
   Popovers
────────────────────────────────────────────────────────────────────────────── */

function ExplorerPopover({
  open,
  onClose,
  children,
}: ExplorerPopoverProps): React.JSX.Element | null {
  const isClient = typeof document !== "undefined";
  const vvSize = useVisualViewportSize();

  const portalHost = useMemo<HTMLElement | null>(() => {
    if (!isClient) return null;
    return getPortalHost();
  }, [isClient]);

  // Lock background scroll while open (iOS-safe)
  useBodyScrollLock(open && isClient);

  // ESC to close
  useEffect(() => {
    if (!open || !isClient) return;

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, isClient]);

  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => closeBtnRef.current?.focus());
  }, [open]);

  const overlayStyle = useMemo<ExplorerPopoverStyle | undefined>(() => {
    if (!open || !isClient) return undefined;

    const h = vvSize.height;
    const w = vvSize.width;

    return {
      // ✅ force true full-screen hitbox (prevents click-through reopen bugs)
      position: "fixed",
      inset: 0,
      pointerEvents: "auto",
      height: h > 0 ? `${h}px` : undefined,
      width: w > 0 ? `${w}px` : undefined,

      ["--sx-breath"]: "5.236s",
      ["--sx-border"]: "rgba(60, 220, 205, 0.35)",
      ["--sx-border-strong"]: "rgba(55, 255, 228, 0.55)",
      ["--sx-ring"]:
        "0 0 0 2px rgba(55, 255, 228, 0.25), 0 0 0 6px rgba(55, 255, 228, 0.12)",
    };
  }, [open, isClient, vvSize.height, vvSize.width]);

  const onBackdropPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (e.target === e.currentTarget) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  const onClosePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>): void => {
      // ✅ prevents click-through to underlying LIVE button on some mobile stacks
      e.preventDefault();
      e.stopPropagation();
      onClose();
    },
    [onClose],
  );

  if (!open || !isClient || !portalHost) return null;

  return createPortal(
    <div
      className="explorer-pop"
      style={overlayStyle}
      role="dialog"
      aria-modal="true"
      aria-label="PhiStream Explorer"
      onPointerDown={onBackdropPointerDown}
      onClick={(e) => {
        // extra guard against click-through
        e.stopPropagation();
      }}
    >
      <div className="explorer-pop__panel" role="document">
        <button
          ref={closeBtnRef}
          type="button"
          className="explorer-pop__close kx-x"
          onPointerDown={onClosePointerDown}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }}
          aria-label="Close PhiStream Explorer"
          title="Close (Esc)"
        >
          ×
        </button>

        <div className="explorer-pop__body">{children}</div>

        <div className="sr-only" aria-live="polite">
          PhiStream explorer portal open
        </div>
      </div>
    </div>,
    portalHost,
  );
}

function KlockPopover({ open, onClose, children }: KlockPopoverProps): React.JSX.Element | null {
  const isClient = typeof document !== "undefined";
  const vvSize = useVisualViewportSize();

  const portalHost = useMemo<HTMLElement | null>(() => {
    if (!isClient) return null;
    return getPortalHost();
  }, [isClient]);

  // Lock background scroll while open (iOS-safe)
  useBodyScrollLock(open && isClient);

  // ESC to close
  useEffect(() => {
    if (!open || !isClient) return;

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, isClient]);

  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => closeBtnRef.current?.focus());
  }, [open]);

  const overlayStyle = useMemo<KlockPopoverStyle | undefined>(() => {
    if (!open || !isClient) return undefined;

    const h = vvSize.height;
    const w = vvSize.width;

    return {
      // ✅ force true full-screen hitbox (prevents click-through / “won’t close” illusions)
      position: "fixed",
      inset: 0,
      pointerEvents: "auto",
      height: h > 0 ? `${h}px` : undefined,
      width: w > 0 ? `${w}px` : undefined,

      ["--klock-breath"]: "5.236s",
      ["--klock-border"]: "rgba(255, 216, 120, 0.26)",
      ["--klock-border-strong"]: "rgba(255, 231, 160, 0.55)",
      ["--klock-ring"]:
        "0 0 0 2px rgba(255, 225, 150, 0.22), 0 0 0 6px rgba(255, 210, 120, 0.10)",

      // ✅ Bigger Klock (CSS can map this to size/typography/layout)
      ["--klock-scale"]: "5",
    };
  }, [open, isClient, vvSize.height, vvSize.width]);

  const onBackdropPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (e.target === e.currentTarget) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  const onClosePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>): void => {
      // ✅ strongest close: prevents click-through + closes immediately on press
      e.preventDefault();
      e.stopPropagation();
      onClose();
    },
    [onClose],
  );

  if (!open || !isClient || !portalHost) return null;

  return createPortal(
    <div
      className="klock-pop"
      style={overlayStyle}
      role="dialog"
      aria-modal="true"
      aria-label="Eternal KaiKlok"
      onPointerDown={onBackdropPointerDown}
      onClick={(e) => {
        // extra guard against click-through
        e.stopPropagation();
      }}
    >
      <div className="klock-pop__panel" role="document" data-klock-size="xl">
        <button
          ref={closeBtnRef}
          type="button"
          className="klock-pop__close kx-x"
          onPointerDown={onClosePointerDown}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }}
          aria-label="Close Eternal KaiKlok"
          title="Close (Esc)"
        >
          ×
        </button>

        <div className="klock-pop__body">
          <div className="klock-stage" role="presentation" data-klock-stage="1">
            <div className="klock-stage__inner">{children}</div>
          </div>
        </div>

        <div className="sr-only" aria-live="polite">
          Eternal KaiKlok portal open
        </div>
      </div>
    </div>,
    portalHost,
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Routes
────────────────────────────────────────────────────────────────────────────── */

function KaiVohRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const [open, setOpen] = useState<boolean>(true);

  const handleClose = useCallback((): void => {
    setOpen(false);
    navigate("/", { replace: true });
  }, [navigate]);

  return (
    <>
      <KaiVohModal open={open} onClose={handleClose} />
      <div className="sr-only" aria-live="polite">
        KaiVoh portal open
      </div>
    </>
  );
}

function SigilMintRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const [open, setOpen] = useState<boolean>(true);

  const initialPulse = useMemo<number>(() => momentFromUTC(new Date()).pulse, []);

  const handleClose = useCallback((): void => {
    setOpen(false);
    navigate("/", { replace: true });
  }, [navigate]);

  return (
    <>
      {open ? <SigilModal initialPulse={initialPulse} onClose={handleClose} /> : null}
      <div className="sr-only" aria-live="polite">
        Sigil mint portal open
      </div>
    </>
  );
}

function ExplorerRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const [open, setOpen] = useState<boolean>(true);

  const handleClose = useCallback((): void => {
    setOpen(false);
    navigate("/", { replace: true });
  }, [navigate]);

  return (
    <>
      <ExplorerPopover open={open} onClose={handleClose}>
        <SigilExplorer />
      </ExplorerPopover>

      <div className="sr-only" aria-live="polite">
        PhiStream explorer portal open
      </div>
    </>
  );
}

function KlockRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState<boolean>(true);

  const handleClose = useCallback((): void => {
    setOpen(false);
    navigate("/", { replace: true });
  }, [navigate]);

  // ✅ Honor navigation intent (still defaults to BIG face open)
  const navState = (location.state as KlockNavState | null) ?? null;
  const initialDetailsOpen = navState?.openDetails ?? true;

  // ✅ Cast imported module to typed component locally (no `any`)
  const EternalKlockTyped = EternalKlock as unknown as React.ComponentType<EternalKlockProps>;

  return (
    <>
      <KlockPopover open={open} onClose={handleClose}>
        <EternalKlockTyped initialDetailsOpen={initialDetailsOpen} />
      </KlockPopover>

      <div className="sr-only" aria-live="polite">
        Eternal KaiKlok portal open
      </div>
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Live header button (isolated ticker = no full-app rerenders)
────────────────────────────────────────────────────────────────────────────── */

type LiveKaiButtonProps = {
  onOpenKlock: () => void;
  breathS: number;
  breathMs: number;
  breathsPerDay: number;
};

function LiveKaiButton({
  onOpenKlock,
  breathS,
  breathMs,
  breathsPerDay,
}: LiveKaiButtonProps): React.JSX.Element {
  const [snap, setSnap] = useState<{
    pulse: number;
    pulseStr: string;
    beatStepDMY: BeatStepDMY;
    beatStepLabel: string;
    dmyLabel: string;
  }>(() => {
    const m = momentFromUTC(new Date());
    const pulse = readNum(m, "pulse") ?? 0;
    const pulseStr = formatPulse(pulse);
    const bsd = computeBeatStepDMY(m);
    return {
      pulse,
      pulseStr,
      beatStepDMY: bsd,
      beatStepLabel: formatBeatStepLabel(bsd),
      dmyLabel: formatDMYLabel(bsd),
    };
  });

  const neonTextStyle = useMemo<CSSProperties>(
    () => ({
      color: "var(--accent-color)",
      textShadow:
        "0 0 14px rgba(0, 255, 255, 0.22), 0 0 28px rgba(0, 255, 255, 0.12)",
    }),
    [],
  );

  const neonTextStyleHalf = useMemo<CSSProperties>(
    () => ({
      color: "var(--accent-color)",
      textShadow:
        "0 0 14px rgba(0, 255, 255, 0.22), 0 0 28px rgba(0, 255, 255, 0.12)",
      fontSize: "0.5em",
      lineHeight: 1.05,
    }),
    [],
  );

  useEffect(() => {
    let alive = true;

    const tick = (): void => {
      if (!alive) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

      const m = momentFromUTC(new Date());
      const pulse = readNum(m, "pulse") ?? 0;
      const pulseStr = formatPulse(pulse);

      const bsd = computeBeatStepDMY(m);
      const beatStepLabel = formatBeatStepLabel(bsd);
      const dmyLabel = formatDMYLabel(bsd);

      setSnap((prev) => {
        // Update only if visible strings changed (prevents pointless rerenders)
        if (
          prev.pulseStr === pulseStr &&
          prev.beatStepLabel === beatStepLabel &&
          prev.dmyLabel === dmyLabel
        ) {
          return prev;
        }
        return { pulse, pulseStr, beatStepDMY: bsd, beatStepLabel, dmyLabel };
      });
    };

    // First tick immediately (ensures no “stale first paint” after resume)
    tick();

    const id = window.setInterval(tick, 250);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const liveTitle = useMemo(() => {
    return `LIVE • NOW PULSE ${snap.pulseStr} • ${snap.beatStepLabel} • ${snap.dmyLabel} • Breath ${breathS.toFixed(
      6,
    )}s (${Math.round(breathMs)}ms) • ${breathsPerDay.toLocaleString("en-US", {
      minimumFractionDigits: 6,
      maximumFractionDigits: 6,
    })}/day • Open Eternal KaiKlok`;
  }, [snap.pulseStr, snap.beatStepLabel, snap.dmyLabel, breathS, breathMs, breathsPerDay]);

  const liveAria = useMemo(() => {
    return `LIVE. Kai Pulse now ${snap.pulse}. Beat ${snap.beatStepDMY.beat} step ${snap.beatStepDMY.step}. D ${snap.beatStepDMY.day}. M ${snap.beatStepDMY.month}. Y ${snap.beatStepDMY.year}. Open Eternal KaiKlok.`;
  }, [snap]);

  return (
    <button
      type="button"
      className="topbar-live"
      onClick={onOpenKlock}
      aria-label={liveAria}
      title={liveTitle}
    >
      <span className="live-orb" aria-hidden="true" />
      <div className="live-text">
        <div className="live-meta">
          <span className="mono" style={neonTextStyle}>
            ☤KAI
          </span>
        </div>

        <div className="live-meta">
          <span className="mono" style={neonTextStyle}>
            {snap.pulseStr}
          </span>
        </div>

        <div className="live-sub">
          <span className="mono" style={neonTextStyleHalf}>
            {snap.beatStepLabel}{" "}
            <span aria-hidden="true" style={{ opacity: 0.7 }}>
              •
            </span>{" "}
            {snap.dmyLabel}
          </span>
        </div>
      </div>
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   AppChrome
────────────────────────────────────────────────────────────────────────────── */

function AppChrome(): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();

  // 🔒 Lock viewport zoom globally (acts like a native KaiOS app shell)
  useDisableZoom();

  // Canonical Golden Breath
  const BREATH_S = useMemo(() => 3 + Math.sqrt(5), []);
  const BREATH_MS = useMemo(() => BREATH_S * 1000, [BREATH_S]);

  // Canonical day breath count (precision)
  const BREATHS_PER_DAY = useMemo(() => 17_491.270421, []);

  const vvSize = useVisualViewportSize();

  const shellStyle = useMemo<AppShellStyle>(
    () => ({
      "--breath-s": `${BREATH_S}s`,
      "--vvh-px": `${vvSize.height}px`,
    }),
    [BREATH_S, vvSize.height],
  );

  const navItems = useMemo<NavItem[]>(
    () => [
      { to: "/", label: "Verifier", desc: "Inhale + Exhale", end: true },
      { to: "/mint", label: "Mint ΦKey", desc: "Breath-mint artifact" },
      { to: "/voh", label: "KaiVoh", desc: "Emission OS" },
      { to: "/explorer", label: "ΦStream", desc: "Live keystream" },
    ],
    [],
  );

  const pageTitle = useMemo<string>(() => {
    const p = location.pathname;
    if (p === "/") return "Verifier";
    if (p.startsWith("/mint")) return "Mint Sigil";
    if (p.startsWith("/voh")) return "KaiVoh";
    if (p.startsWith("/explorer")) return "PhiStream";
    if (p.startsWith("/klock")) return "KaiKlok";
    return "Sovereign Gate";
  }, [location.pathname]);

  useEffect(() => {
    document.title = `ΦNet • ${pageTitle}`;
  }, [pageTitle]);

  const lockPanelByRoute = useMemo(() => {
    const p = location.pathname;
    return (
      p === "/" ||
      p.startsWith("/voh") ||
      p.startsWith("/mint") ||
      p.startsWith("/explorer") ||
      p.startsWith("/klock")
    );
  }, [location.pathname]);

  const showAtriumChartBar = lockPanelByRoute;

  const chartHeight = useMemo<number>(() => {
    const h = vvSize.height || 800;
    if (h < 680) return 200;
    return 240;
  }, [vvSize.height]);

  const topbarScrollMaxH = useMemo<number>(() => {
    const h = vvSize.height || 800;
    return Math.max(220, Math.min(520, Math.floor(h * 0.52)));
  }, [vvSize.height]);

  const panelBodyRef = useRef<HTMLDivElement | null>(null);
  const panelCenterRef = useRef<HTMLDivElement | null>(null);
  const [needsInternalScroll, setNeedsInternalScroll] = useState<boolean>(false);
  const rafIdRef = useRef<number | null>(null);

  const computeOverflow = useCallback((): boolean => {
    const body = panelBodyRef.current;
    const center = panelCenterRef.current;
    if (!body || !center) return false;

    const contentEl = center.firstElementChild as HTMLElement | null;
    const contentHeight = contentEl ? contentEl.scrollHeight : center.scrollHeight;
    const availableHeight = body.clientHeight;

    return contentHeight > availableHeight + 6;
  }, []);

  const scheduleMeasure = useCallback((): void => {
    if (rafIdRef.current !== null) return;

    rafIdRef.current = window.requestAnimationFrame(() => {
      rafIdRef.current = null;
      const next = computeOverflow();
      setNeedsInternalScroll((prev) => (prev === next ? prev : next));
    });
  }, [computeOverflow]);

  useEffect(() => {
    if (!lockPanelByRoute) return;
    scheduleMeasure();
  }, [lockPanelByRoute, location.pathname, scheduleMeasure]);

  useEffect(() => {
    const body = panelBodyRef.current;
    const center = panelCenterRef.current;
    if (!body || !center) return;

    const contentEl = center.firstElementChild as HTMLElement | null;
    const onAnyResize = (): void => scheduleMeasure();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(onAnyResize);
      ro.observe(body);
      ro.observe(center);
      if (contentEl) ro.observe(contentEl);
    }

    // vv changes are already RAF-throttled in the shared publisher,
    // but we still re-check overflow on any resize since layout shifts.
    window.addEventListener("resize", onAnyResize, { passive: true });

    scheduleMeasure();

    return () => {
      window.removeEventListener("resize", onAnyResize);
      if (ro) ro.disconnect();
      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [scheduleMeasure, location.pathname]);

  const panelShouldScroll = lockPanelByRoute && needsInternalScroll;

  const panelBodyInlineStyle = useMemo<CSSProperties | undefined>(() => {
    if (!panelShouldScroll) return undefined;
    return {
      overflowY: "auto",
      overflowX: "hidden",
      WebkitOverflowScrolling: "touch",
      alignItems: "stretch",
      justifyContent: "flex-start",
      paddingBottom: "calc(1.25rem + var(--safe-bottom))",
    };
  }, [panelShouldScroll]);

  const panelCenterInlineStyle = useMemo<CSSProperties | undefined>(() => {
    if (!panelShouldScroll) return undefined;
    return {
      height: "auto",
      minHeight: "100%",
      alignItems: "flex-start",
      justifyContent: "flex-start",
    };
  }, [panelShouldScroll]);

  const navListRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const list = navListRef.current;
    if (!list) return;

    if (!window.matchMedia("(max-width: 980px)").matches) return;

    const active = list.querySelector<HTMLElement>(".nav-item--active");
    if (!active) return;

    window.requestAnimationFrame(() => {
      try {
        active.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center",
        });
      } catch {
        active.scrollIntoView();
      }
    });
  }, [location.pathname]);

  const openKlock = useCallback((): void => {
    const st: KlockNavState = { openDetails: true };
    navigate("/klock", { state: st });
  }, [navigate]);
const DNS_IP = "137.66.18.241";

async function copyDnsIp(btn?: HTMLButtonElement | null) {
  try {
    await navigator.clipboard.writeText(DNS_IP);
  } catch {
    // fallback for older browsers / permissions
    const ta = document.createElement("textarea");
    ta.value = DNS_IP;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }

  if (btn) {
    btn.classList.add("is-copied");
    window.setTimeout(() => btn.classList.remove("is-copied"), 900);
  }
}

  return (
    <div
      className="app-shell"
      data-ui="atlantean-banking"
      data-panel-scroll={panelShouldScroll ? "1" : "0"}
      style={shellStyle}
    >
      <a className="skip-link" href="#app-content">
        Skip to content
      </a>

      <div className="app-bg-orbit" aria-hidden="true" />
      <div className="app-bg-grid" aria-hidden="true" />
      <div className="app-bg-glow" aria-hidden="true" />

      <header className="app-topbar" role="banner" aria-label="ΦNet Sovereign Gate Header">
        <div className="topbar-left">
          <div className="brand" aria-label="ΦNet Sovereign Gate">
            <div className="brand__mark" aria-hidden="true">
              <img src="/phi.svg" alt="" className="brand__mark-img" />
            </div>
            <div className="brand__text">
              <div className="brand__title">Sovereign Gate</div>
              <div className="brand__subtitle">
                Breath-Minted Value · Kairos Identity Registry
              </div>
            </div>
          </div>
        </div>

        <LiveKaiButton
          onOpenKlock={openKlock}
          breathS={BREATH_S}
          breathMs={BREATH_MS}
          breathsPerDay={BREATHS_PER_DAY}
        />
      </header>

      <main
        className="app-stage"
        id="app-content"
        role="main"
        aria-label="Sovereign Value Workspace"
      >
        <div className="app-frame" role="region" aria-label="Secure frame">
          <div className="app-frame-inner">
            <div className="app-workspace">
              {showAtriumChartBar && (
                <div
                  className="workspace-topbar"
                  aria-label="Atrium live Φ value + chart"
                  style={{ overflow: "visible", position: "relative" }}
                >
                  <div
                    className="workspace-topbar-scroll"
                    style={{
                      maxHeight: `${topbarScrollMaxH}px`,
                      overflowY: "auto",
                      overflowX: "hidden",
                      WebkitOverflowScrolling: "touch",
                      overscrollBehavior: "contain",
                      borderRadius: "inherit",
                    }}
                  >
                    <HomePriceChartCard
                      apiBase="https://pay.kaiklok.com"
                      ctaAmountUsd={144}
                      chartHeight={chartHeight}
                    />
                  </div>
                </div>
              )}

              <nav className="app-nav" aria-label="Primary navigation">
                <div className="nav-head">
                  <div className="nav-head__title">Atrium</div>
                  <div className="nav-head__sub">Breath-Sealed Identity · Kairos-ZK Proof</div>
                </div>

                <div
                  ref={navListRef}
                  className="nav-list"
                  role="list"
                  aria-label="Atrium navigation tiles"
                >
                  {navItems.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        `nav-item ${isActive ? "nav-item--active" : ""}`
                      }
                      aria-label={`${item.label}: ${item.desc}`}
                    >
                      <div className="nav-item__label">{item.label}</div>
                      <div className="nav-item__desc">{item.desc}</div>
                    </NavLink>
                  ))}
                </div>

                <SovereignDeclarations />
              </nav>

              <section className="app-panel" aria-label="Sovereign Gate panel">
                <div className="panel-head">
                  <div className="panel-head__title">{pageTitle}</div>
                  <div className="panel-head__meta">
                    <span className="meta-chip">Proof of Breath™</span>
                    <span className="meta-chip">Kai-Signature™</span>
                  </div>
                </div>

                <div
                  ref={panelBodyRef}
                  className={`panel-body ${
                    lockPanelByRoute ? "panel-body--locked" : ""
                  } ${panelShouldScroll ? "panel-body--scroll" : ""}`}
                  style={panelBodyInlineStyle}
                >
                  <div
                    ref={panelCenterRef}
                    className="panel-center"
                    style={panelCenterInlineStyle}
                  >
                    <Outlet />
                  </div>
                </div>

<footer className="panel-foot" aria-label="Footer">
  <div className="panel-foot__left">
    <span className="mono">ΦNet</span> • Sovereign Gate •{" "}
    <button
      type="button"
      className="dns-copy mono"
      onClick={(e) => void copyDnsIp(e.currentTarget)}
      aria-label={`Remember .kai DNS IP ${DNS_IP}`}
      title="Remember DNS IP"
    >
      .kai DNS: <span className="mono">{DNS_IP}</span>
    </button>
  </div>

  <div className="panel-foot__right">
    <span className="mono">V</span>{" "}
    <a
      className="mono"
      href="https://github.com/phinetwork/phi.network"
      target="_blank"
      rel="noreferrer"
      aria-label="Version 28.5 (opens GitHub)"
      title="Open GitHub"
    >
      28.5
    </a>
  </div>
</footer>


              </section>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function NotFound(): React.JSX.Element {
  return (
    <div className="notfound" role="region" aria-label="Not found">
      <div className="notfound__code">404</div>
      <div className="notfound__title">Route not found</div>
      <div className="notfound__hint">
        Use the Sovereign Gate navigation to return to Verifier, Mint Sigil, KaiVoh,
        or PhiStream.
      </div>
      <div className="notfound__actions">
        <NavLink className="notfound__cta" to="/">
          Go to Verifier
        </NavLink>
      </div>
    </div>
  );
}

export default function App(): React.JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="s" element={<SigilPage />} />
        <Route path="s/:hash" element={<SigilPage />} />

        <Route path="stream" element={<SigilFeedPage />} />
        <Route path="stream/p/:token" element={<SigilFeedPage />} />
        <Route path="stream/c/:token" element={<SigilFeedPage />} />
        <Route path="feed" element={<SigilFeedPage />} />
        <Route path="feed/p/:token" element={<SigilFeedPage />} />
        <Route path="p~:token" element={<SigilFeedPage />} />
        <Route path="p~:token/*" element={<PShort />} />
        <Route path="token" element={<SigilFeedPage />} />
        <Route path="p~token" element={<SigilFeedPage />} />
        <Route path="p" element={<PShort />} />

        <Route element={<AppChrome />}>
          <Route index element={<VerifierStamper />} />
          <Route path="mint" element={<SigilMintRoute />} />
          <Route path="voh" element={<KaiVohRoute />} />
          <Route path="explorer" element={<ExplorerRoute />} />
          <Route path="klock" element={<KlockRoute />} />
          <Route path="klok" element={<KlockRoute />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
