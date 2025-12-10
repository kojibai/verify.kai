// src/pages/sigilstream/status/KaiStatus.tsx
"use client";

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

type LayoutMode = "full" | "compact" | "micro";

/** Responsive layout mode based on *actual* rendered width (no overlap on tiny devices). */
function useStatusLayout(ref: React.RefObject<HTMLElement | null>): LayoutMode {
  const [width, setWidth] = React.useState<number>(0);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const setFromEl = (): void => {
      // getBoundingClientRect is stable + precise for layout decisions
      const w = Math.round(el.getBoundingClientRect().width);
      setWidth(w);
    };

    setFromEl();

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => setFromEl());
      ro.observe(el);
      return () => ro.disconnect();
    }

    // Fallback (very old browsers)
    const onResize = (): void => setFromEl();
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, [ref]);

  // “Collapse sooner” thresholds (tune once; the markup will never overlap).
  // - compact kicks in earlier than typical breakpoints
  // - micro strips non-essentials to guarantee single-line clarity
  if (width > 0 && width < 520) return "micro";
  if (width > 0 && width < 760) return "compact";
  return "full";
}

function shortDayLabel(day: string, mode: LayoutMode): string {
  if (mode === "full") return day;
  // keep it readable but compact (e.g. "Harmonization" -> "HARM")
  if (day.length <= 6) return day.toUpperCase();
  return day.slice(0, 4).toUpperCase();
}

function shortChakraLabel(chakra: string, mode: LayoutMode): string {
  if (mode === "full") return chakra;

  // compact: prefer strong, consistent abbreviations
  const c = chakra.trim();
  switch (c) {
    case "Solar Plexus":
      return "SOLAR";
    case "Third Eye":
      return "3RD";
    default: {
      // first word is usually enough ("Root", "Heart", "Throat", "Crown", "Sacral")
      const first = c.split(/\s+/)[0] ?? c;
      return first.toUpperCase();
    }
  }
}

type KaiStatusVars = React.CSSProperties & {
  ["--kai-progress"]?: number;
};

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

  // ✅ Full precision internally (for progress + correctness), compact display for UI.
  const secsTextFull = secsLeft !== null ? secsLeft.toFixed(6) : "—";
  const secsText = secsLeft !== null ? secsLeft.toFixed(3) : "—";

  const styleVars: KaiStatusVars = React.useMemo(() => {
    return { "--kai-progress": progress };
  }, [progress]);

  // Labels (responsive, never overlap)
  const harmonicDayFull = String(kaiNow.harmonicDay);
  const chakraDayFull = String(kaiNow.chakraDay);

  const harmonicDayDisp = shortDayLabel(harmonicDayFull, layout);
  const chakraDayDisp = shortChakraLabel(chakraDayFull, layout);

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
      {/* single slim row */}
      <div className="kai-feed-status__left">
        <span className="kai-feed-status__kLabel" aria-label="Kairos">
          {layout === "micro" ? "KAI" : "KAIROS"}
        </span>

        <span className="kai-feed-status__bsi" aria-label={`Beat step ${beatStepDisp}`}>
          {beatStepDisp}
        </span>

        {/* On micro widths, strip non-essentials to guarantee zero overlap */}
       <span
  className="kai-pill kai-pill--day"
  title={harmonicDayFull}
  aria-label={`Harmonic day ${harmonicDayFull}`}
>
  {harmonicDayDisp}
</span>


        {layout === "full" || layout === "compact" ? (
          <span className="kai-pill kai-pill--chakra" title={chakraDayFull} aria-label={`Spiral day ${chakraDayFull}`}>
            {chakraDayDisp}
          </span>
        ) : null}

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
        <span className="kai-feed-status__nVal" title={secsTextFull} aria-label={`Next pulse in ${secsTextFull} seconds`}>
          {secsText}
          <span className="kai-feed-status__nUnit">s</span>
        </span>
      </div>

      {/* thin progress line (doesn't stack; lives inside the same bar) */}
      <div className="kai-feed-status__bar" aria-hidden="true">
        <div className="kai-feed-status__barFill" />
        <div className="kai-feed-status__barSpark" />
      </div>
    </div>
  );
}

export default KaiStatus;
