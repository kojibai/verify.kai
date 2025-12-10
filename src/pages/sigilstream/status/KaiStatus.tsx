// src/pages/sigilstream/status/KaiStatus.tsx
"use client";

/**
 * KaiStatus — Atlantean μpulse Bar
 * v3.4 — ALWAYS-SHOW MODE (Day + Chakra Ark + Pulse)
 * - Day + Chakra Ark ALWAYS render (no hiding at any size)
 * - No abbreviations (Kaelith stays Kaelith; Solar Plexus stays Solar Plexus)
 * - Layout driven by measured width: adjusts density + text scaling, never drops data
 * - Countdown display: fixed to 3 decimals (x.xxx)
 *
 * Chakra Ark is derived from Beat:
 * 36 beats/day, 6 arks/day → 6 beats per ark:
 *   0–5   Ignition Ark
 *   6–11  Integration Ark
 *   12–17 Harmonization Ark
 *   18–23 Reflection Ark
 *   24–29 Purification Ark
 *   30–35 Dream Ark
 */

import * as React from "react";
import { useAlignedKaiTicker, useKaiPulseCountdown } from "../core/ticker";
import { pad2 } from "../core/utils";
import "./KaiStatus.css";

const DEFAULT_PULSE_DUR_S = 3 + Math.sqrt(5); // 5.2360679…

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
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

/** Always-show modes: we never hide pills; we only tighten spacing + scale text. */
type LayoutMode = "full" | "compact" | "micro";

/** Responsive layout mode based on *actual* rendered width (prevents overlap). */
function useStatusLayout(ref: React.RefObject<HTMLElement | null>): LayoutMode {
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

  // Collapse sooner than media queries to ensure no collisions.
  if (width > 0 && width < 520) return "micro";
  if (width > 0 && width < 760) return "compact";
  return "full";
}

type KaiStatusVars = React.CSSProperties & {
  ["--kai-progress"]?: number;
  ["--kai-ui-scale"]?: number; // applied by CSS to scale text/pills (1..~0.86)
};

function uiScaleFor(layout: LayoutMode): number {
  // Tuned to keep ALL labels visible without abbreviations.
  // CSS will apply this via transform/typography sizing.
  switch (layout) {
    case "micro":
      return 0.86;
    case "compact":
      return 0.92;
    default:
      return 1.0;
  }
}

const ARK_NAMES = [
  "Ignite",
  "Integrate",
  "Harmonize",
  "Reflekt",
  "Purify",
  "Dream",
] as const;

type ChakraArkName = (typeof ARK_NAMES)[number];

function chakraArkFromBeat(beat: number): ChakraArkName {
  const b = Number.isFinite(beat) ? Math.floor(beat) : 0;
  const idx = Math.max(0, Math.min(5, Math.floor(b / 6)));
  return ARK_NAMES[idx];
}

export function KaiStatus(): React.JSX.Element {
  const kaiNow = useAlignedKaiTicker();
  const secsLeftAnchor = useKaiPulseCountdown(true);

  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const layout = useStatusLayout(rootRef);

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

  const beatNum =
    typeof kaiNow.beat === "number"
      ? kaiNow.beat
      : Number.parseInt(String(kaiNow.beat), 10) || 0;

  const chakraArkFull: ChakraArkName = chakraArkFromBeat(beatNum);

  const styleVars: KaiStatusVars = React.useMemo(() => {
    return {
      "--kai-progress": progress,
      "--kai-ui-scale": uiScaleFor(layout),
    };
  }, [progress, layout]);

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
      data-kai-ark={chakraArkFull}
      style={styleVars}
    >
      <div className="kai-feed-status__left">
        <span className="kai-feed-status__kLabel" aria-label="Kairos">
          KAIROS
        </span>

        <span className="kai-feed-status__bsi" aria-label={`Beat step ${beatStepDisp}`}>
          {beatStepDisp}
        </span>

        {/* ✅ ALWAYS show Day (full) */}
        <span
          className="kai-pill kai-pill--day"
          title={harmonicDayFull}
          aria-label={`Harmonic day ${harmonicDayFull}`}
        >
          {harmonicDayFull}
        </span>

        {/* ✅ ALWAYS show Chakra Ark (full) */}
        <span
          className="kai-pill kai-pill--chakra"
          title={chakraArkFull}
          aria-label={`Chakra ark ${chakraArkFull}`}
        >
          {chakraArkFull}
        </span>

        {/* ✅ ALWAYS show Pulse */}
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
