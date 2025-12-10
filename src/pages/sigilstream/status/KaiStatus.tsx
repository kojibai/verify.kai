// src/pages/sigilstream/status/KaiStatus.tsx
"use client";

/**
 * KaiStatus — Atlantean μpulse Bar
 * v3.3 — ALWAYS-SHOW + TRUE LAYOUT SCALING (no transform clipping)
 * - Day + Chakra + Pulse ALWAYS render (no hiding at any size)
 * - No abbreviations (Kaelith stays Kaelith; Solar Plexus stays Solar Plexus)
 * - Countdown display: fixed to 3 decimals (x.xxx)
 * - Uses --kai-ui-scale as REAL layout scaling (CSS uses calc() for sizes)
 */

import * as React from "react";
import { useAlignedKaiTicker, useKaiPulseCountdown } from "../core/ticker";
import { pad2 } from "../core/utils";
import "./KaiStatus.css";

const DEFAULT_PULSE_DUR_S = 3 + Math.sqrt(5); // 5.2360679…

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smooth the authoritative countdown so the UI ticks perfectly between hook updates. */
function useSmoothCountdown(anchorSeconds: number | null): number | null {
  const [smooth, setSmooth] = React.useState<number | null>(anchorSeconds);

  const anchorRef = React.useRef<number | null>(anchorSeconds);
  const t0Ref = React.useRef<number>(0);
  const rafRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    anchorRef.current = anchorSeconds;
    t0Ref.current = performance.now();
    setSmooth(anchorSeconds);
  }, [anchorSeconds]);

  React.useEffect(() => {
    let mounted = true;

    const loop = (): void => {
      if (!mounted) return;

      const a = anchorRef.current;
      if (a == null) {
        setSmooth(null);
        rafRef.current = window.requestAnimationFrame(loop);
        return;
      }

      const dt = (performance.now() - t0Ref.current) / 1000;
      setSmooth(Math.max(0, a - dt));

      rafRef.current = window.requestAnimationFrame(loop);
    };

    rafRef.current = window.requestAnimationFrame(loop);
    return () => {
      mounted = false;
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return smooth;
}

function readPulseDurSeconds(el: HTMLElement | null): number {
  if (!el) return DEFAULT_PULSE_DUR_S;
  const raw = window.getComputedStyle(el).getPropertyValue("--pulse-dur").trim();
  const v = Number.parseFloat(raw);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_PULSE_DUR_S;
}

/** Always-show modes: never hide pills; only tighten and scale. */
type LayoutMode = "full" | "compact" | "micro";

type LayoutInfo = {
  mode: LayoutMode;
  width: number;
};

/** Responsive layout + measured width (prevents overlap, drives scale). */
function useStatusLayout(ref: React.RefObject<HTMLElement | null>): LayoutInfo {
  const [width, setWidth] = React.useState<number>(0);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const setFromEl = (): void => {
      const w = Math.round(el.getBoundingClientRect().width);
      setWidth(w);
    };

    setFromEl();

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => setFromEl());
      ro.observe(el);
      return () => ro.disconnect();
    }

    const onResize = (): void => setFromEl();
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, [ref]);

  // Collapse sooner than media queries to guarantee no collisions.
  const mode: LayoutMode =
    width > 0 && width < 520 ? "micro" : width > 0 && width < 760 ? "compact" : "full";

  return { mode, width };
}

/**
 * Compute a scale that REALLY shrinks layout (CSS uses calc()).
 * Tuned so the last pill (☤Kai: #######) never gets clipped.
 */
function uiScaleFor(width: number, mode: LayoutMode): number {
  if (width <= 0) return 1;

  // micro range ~ 320–520
  if (mode === "micro") {
    const t = clamp((width - 320) / (520 - 320), 0, 1);
    return lerp(0.76, 0.88, t);
  }

  // compact range ~ 520–760
  if (mode === "compact") {
    const t = clamp((width - 520) / (760 - 520), 0, 1);
    return lerp(0.88, 0.96, t);
  }

  return 1.0;
}

type KaiStatusVars = React.CSSProperties & {
  ["--kai-progress"]?: number;
  ["--kai-ui-scale"]?: number;
};

export function KaiStatus(): React.JSX.Element {
  const kaiNow = useAlignedKaiTicker();
  const secsLeftAnchor = useKaiPulseCountdown(true);

  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const { mode: layout, width } = useStatusLayout(rootRef);

  const secsLeft = useSmoothCountdown(secsLeftAnchor);

  const [pulseDur, setPulseDur] = React.useState<number>(DEFAULT_PULSE_DUR_S);
  React.useEffect(() => {
    setPulseDur(readPulseDurSeconds(rootRef.current));
  }, [kaiNow.pulse]);

  // Boundary flash when anchor wraps (0 → dur).
  const [flash, setFlash] = React.useState<boolean>(false);
  const prevAnchorRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    const prev = prevAnchorRef.current;
    prevAnchorRef.current = secsLeftAnchor;

    if (prev != null && secsLeftAnchor != null && secsLeftAnchor > prev + 0.25) {
      setFlash(true);
      const t = window.setTimeout(() => setFlash(false), 200);
      return () => window.clearTimeout(t);
    }
    return;
  }, [secsLeftAnchor]);

  const beatStepDisp = `${kaiNow.beat}:${pad2(kaiNow.step)}`;

  const progress = React.useMemo<number>(() => {
    if (secsLeft == null) return 0;
    return clamp01(1 - secsLeft / pulseDur);
  }, [secsLeft, pulseDur]);

  // Full precision for a11y/title; 3 decimals for display.
  const secsTextFull = secsLeft !== null ? secsLeft.toFixed(6) : "—";
  const secsText = secsLeft !== null ? secsLeft.toFixed(3) : "—";

  // Labels: ALWAYS FULL (no abbreviations).
  const harmonicDayFull = String(kaiNow.harmonicDay);
  const chakraDayFull = String(kaiNow.chakraDay);

  const uiScale = React.useMemo<number>(() => uiScaleFor(width, layout), [width, layout]);

  const styleVars: KaiStatusVars = React.useMemo(() => {
    return {
      "--kai-progress": progress,
      "--kai-ui-scale": uiScale,
    };
  }, [progress, uiScale]);

  return (
    <div
      ref={rootRef}
      className={`kai-feed-status${flash ? " kai-feed-status--flash" : ""}`}
      role="status"
      aria-live="polite"
      data-layout={layout}
      data-kai-beat={kaiNow.beat}
      data-kai-step={kaiNow.step}
      data-kai-bsi={beatStepDisp}
      data-kai-pulse={kaiNow.pulse}
      style={styleVars}
    >
      <div className="kai-feed-status__left">
        <span className="kai-feed-status__kLabel" aria-label="Kairos">
          KAIROS
        </span>

        <span className="kai-feed-status__bsi" aria-label={`Beat step ${beatStepDisp}`}>
          {beatStepDisp}
        </span>

        <span
          className="kai-pill kai-pill--day"
          title={harmonicDayFull}
          aria-label={`Harmonic day ${harmonicDayFull}`}
        >
          {harmonicDayFull}
        </span>

        <span
          className="kai-pill kai-pill--chakra"
          title={chakraDayFull}
          aria-label={`Spiral day ${chakraDayFull}`}
        >
          {chakraDayFull}
        </span>

        <span
          className="kai-pill kai-pill--pulse"
          title={`Absolute pulse ${kaiNow.pulse}`}
          aria-label={`Absolute pulse ${kaiNow.pulse}`}
        >
          ☤Kai: <strong className="kai-pill__num">{kaiNow.pulse}</strong>
        </span>
      </div>

      <div className="kai-feed-status__right" aria-label="Countdown to next pulse">
        <span className="kai-feed-status__nLabel">NEXT</span>
        <span
          className="kai-feed-status__nVal"
          title={secsTextFull}
          aria-label={`Next pulse in ${secsTextFull} seconds`}
        >
          {secsText}
          <span className="kai-feed-status__nUnit">s</span>
        </span>
      </div>

      <div className="kai-feed-status__bar" aria-hidden="true">
        <div className="kai-feed-status__barFill" />
        <div className="kai-feed-status__barSpark" />
      </div>
    </div>
  );
}

export default KaiStatus;
