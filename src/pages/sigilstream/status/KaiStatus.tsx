// src/pages/sigilstream/status/KaiStatus.tsx
"use client";

/**
 * KaiStatus — Atlantean μpulse Bar
 * v4.9 — 2-ROW TIMELINE (DAY row + MONTH/ARK row) + ARK CHAKRA COLORS (KKS-1.0)
 *
 * Update (per your screenshots):
 * - Month + Month Chakra + Ark move to their own row (between top timeline and countdown)
 * - Ark color is NOT forced Heart anymore:
 *    Ignition must be Root (red), then ascends by arc:
 *    Ignition→Root, Integration→Sacral, Harmonization→Solar Plexus,
 *    Reflekt→Heart, Purify→Throat, Dream→Third Eye
 */

import * as React from "react";
import { useAlignedKaiTicker, useKaiPulseCountdown } from "../core/ticker";
import { pad2 } from "../core/utils";
import {
  epochMsFromPulse,
  microPulsesSinceGenesis,
  N_DAY_MICRO,
  DAYS_PER_MONTH,
  DAYS_PER_YEAR,
  MONTHS_PER_YEAR,
} from "../../../utils/kai_pulse";
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

type LayoutMode = "wide" | "tight" | "tiny" | "nano";
type BottomMode = "row" | "stack";

function layoutForWidth(width: number): LayoutMode {
  if (width > 0 && width < 360) return "nano";
  if (width > 0 && width < 520) return "tiny";
  if (width > 0 && width < 760) return "tight";
  return "wide";
}

function uiScaleFor(layout: LayoutMode): number {
  switch (layout) {
    case "nano":
      return 0.84;
    case "tiny":
      return 0.9;
    case "tight":
      return 0.95;
    default:
      return 1.0;
  }
}

function bottomModeFor(layout: LayoutMode): BottomMode {
  return layout === "nano" ? "stack" : "row";
}

function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = React.useState<number>(0);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const read = (): void => {
      const w = Math.round(el.getBoundingClientRect().width);
      setWidth(w);
    };

    read();

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => read());
      ro.observe(el);
      return () => ro.disconnect();
    }

    const onResize = (): void => read();
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, [ref]);

  return width;
}

/* ─────────────────────────────────────────────────────────────
   Ark mapping (beats 0..35; 6 beats per ark)
───────────────────────────────────────────────────────────── */

const ARK_NAMES = [
  "Ignite",
  "Integrate",
  "Harmonize",
  "Reflekt",
  "Purify",
  "Dream",
] as const;

type ArkName = (typeof ARK_NAMES)[number];

function arkFromBeat(beat: number): ArkName {
  const b = Number.isFinite(beat) ? Math.floor(beat) : 0;
  const idx = Math.max(0, Math.min(5, Math.floor(b / 6)));
  return ARK_NAMES[idx];
}

/* ─────────────────────────────────────────────────────────────
   KKS-1.0: D/M/Y from μpulses (exact, deterministic) — FeedCard parity
───────────────────────────────────────────────────────────── */

/** Euclidean mod (always 0..m-1) */
const modE = (a: bigint, m: bigint): bigint => {
  const r = a % m;
  return r >= 0n ? r : r + m;
};

/** Euclidean floor division (toward −∞) */
const floorDivE = (a: bigint, d: bigint): bigint => {
  if (d === 0n) throw new Error("Division by zero");
  const q = a / d;
  const r = a % d;
  return r === 0n ? q : a >= 0n ? q : q - 1n;
};

const toSafeNumber = (x: bigint): number => {
  const MAX = BigInt(Number.MAX_SAFE_INTEGER);
  const MIN = BigInt(Number.MIN_SAFE_INTEGER);
  if (x > MAX) return Number.MAX_SAFE_INTEGER;
  if (x < MIN) return Number.MIN_SAFE_INTEGER;
  return Number(x);
};

function kaiDMYFromPulseKKS(pulse: number): { day: number; month: number; year: number } {
  const ms = epochMsFromPulse(pulse); // bigint
  const pμ = microPulsesSinceGenesis(ms); // bigint μpulses

  const dayIdx = floorDivE(pμ, N_DAY_MICRO); // bigint days since genesis

  const monthIdx = floorDivE(dayIdx, BigInt(DAYS_PER_MONTH)); // bigint
  const yearIdx = floorDivE(dayIdx, BigInt(DAYS_PER_YEAR)); // bigint

  const dayOfMonth = toSafeNumber(modE(dayIdx, BigInt(DAYS_PER_MONTH))) + 1; // 1..42
  const month = toSafeNumber(modE(monthIdx, BigInt(MONTHS_PER_YEAR))) + 1; // 1..8
  const year = toSafeNumber(yearIdx); // 0..

  return { day: dayOfMonth, month, year };
}

/* ─────────────────────────────────────────────────────────────
   Chakra labeling + deterministic chakra assignment hooks
───────────────────────────────────────────────────────────── */

type ChakraName =
  | "Root"
  | "Sacral"
  | "Solar Plexus"
  | "Heart"
  | "Throat"
  | "Third Eye"
  | "Crown";

const CHAKRA_SEQ: readonly ChakraName[] = [
  "Root",
  "Sacral",
  "Solar Plexus",
  "Heart",
  "Throat",
  "Third Eye",
  "Crown",
] as const;

function chakraToLabel(ch: ChakraName): string {
  return ch === "Crown" ? "Krown" : ch;
}

function chakraFromDayOfMonth(dayOfMonth: number): ChakraName {
  const d = Number.isFinite(dayOfMonth) ? Math.floor(dayOfMonth) : 1;
  const idx = Math.max(0, Math.min(6, Math.floor((Math.max(1, d) - 1) / 6)));
  return CHAKRA_SEQ[idx] ?? "Root";
}

function modIndex(n: number, m: number): number {
  const r = n % m;
  return r < 0 ? r + m : r;
}

function chakraFromMonth(month: number): ChakraName {
  const m = Number.isFinite(month) ? Math.floor(month) : 1;
  const idx = modIndex(Math.max(1, m) - 1, 7);
  return CHAKRA_SEQ[idx] ?? "Root";
}

/** Month names (8). Replace labels here if you have canonical names. */
const KAI_MONTH_NAMES: readonly string[] = [
  "Aethon",
  "Virelai",
  "Solari",
  "Amarin",
  "Kaelus",
  "Umbriel",
  "Noktura",
  "Liora",
] as const;

function monthNameFromIndex(month: number): string {
  const m = Number.isFinite(month) ? Math.floor(month) : 1;
  const idx = Math.max(1, Math.min(8, m)) - 1;
  return KAI_MONTH_NAMES[idx] ?? `Month ${Math.max(1, m)}`;
}

/** Ark → Chakra color mapping (Ignition MUST be Root/red). */
const ARK_CHAKRA: Readonly<Record<ArkName, ChakraName>> = {
  Ignite: "Root",
  Integrate: "Sacral",
  Harmonize: "Solar Plexus",
  Reflekt: "Heart",
  Purify: "Throat",
  Dream: "Third Eye",
};

type KaiStatusVars = React.CSSProperties & {
  ["--kai-progress"]?: number;
  ["--kai-ui-scale"]?: number;
};

export function KaiStatus(): React.JSX.Element {
  const kaiNow = useAlignedKaiTicker();
  const secsLeftAnchor = useKaiPulseCountdown(true);
  const secsLeft = useSmoothCountdown(secsLeftAnchor);

  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const width = useElementWidth(rootRef);

  const layout: LayoutMode = layoutForWidth(width);
  const bottomMode: BottomMode = bottomModeFor(layout);

  // Pulse sits on TOP row when there’s room; otherwise drops to the countdown row.
  const pulseOnTop = layout === "wide" || layout === "tight";

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
      const t = window.setTimeout(() => setFlash(false), 180);
      return () => window.clearTimeout(t);
    }
    return;
  }, [secsLeftAnchor]);

  const beatStepDisp = `${kaiNow.beat}:${pad2(kaiNow.step)}`;

  const progress = React.useMemo<number>(() => {
    if (secsLeft == null) return 0;
    return clamp01(1 - secsLeft / pulseDur);
  }, [secsLeft, pulseDur]);

  const secsTextFull = secsLeft !== null ? secsLeft.toFixed(6) : "—";
  const secsText = secsLeft !== null ? secsLeft.toFixed(6) : "—";

  const dayNameFull = String(kaiNow.harmonicDay);

  const beatNum =
    typeof kaiNow.beat === "number"
      ? kaiNow.beat
      : Number.parseInt(String(kaiNow.beat), 10) || 0;

  const arkFull: ArkName = arkFromBeat(beatNum);
  const arkChakra: ChakraName = ARK_CHAKRA[arkFull] ?? "Heart";

  const pulseNum =
    typeof kaiNow.pulse === "number"
      ? kaiNow.pulse
      : Number.parseInt(String(kaiNow.pulse), 10) || 0;

  const dmy = React.useMemo(() => kaiDMYFromPulseKKS(pulseNum), [pulseNum]);

  const dayChakra = React.useMemo<ChakraName>(() => chakraFromDayOfMonth(dmy.day), [dmy.day]);
  const monthChakra = React.useMemo<ChakraName>(() => chakraFromMonth(dmy.month), [dmy.month]);
  const monthName = React.useMemo<string>(() => monthNameFromIndex(dmy.month), [dmy.month]);

  const dmyText = `D${dmy.day}/M${dmy.month}/Y${dmy.year}`;
  const dayChakraLabel = chakraToLabel(dayChakra);
  const monthChakraLabel = chakraToLabel(monthChakra);

  const styleVars: KaiStatusVars = React.useMemo(() => {
    return {
      "--kai-progress": progress,
      "--kai-ui-scale": uiScaleFor(layout),
    };
  }, [progress, layout]);

  const Countdown = (
    <div className="kai-status__countdown" aria-label="Next pulse">
      <span className="kai-status__nLabel">NEXT</span>
      <span
        className="kai-status__nVal"
        title={secsTextFull}
        aria-label={`Next pulse in ${secsTextFull} seconds`}
      >
        {secsText} <span className="kai-status__nUnit">s</span>
      </span>
    </div>
  );

  const PulsePill = (
    <span
      className="kai-pill kai-pill--pulse"
      title={`Pulse ${pulseNum}`}
      aria-label={`Pulse ${pulseNum}`}
      data-chakra="Pulse"
    >
      ☤KAI: <strong className="kai-pill__num">{pulseNum}</strong>
    </span>
  );

  const DMYPill = (
    <span className="kai-pill kai-pill--dmy" title={dmyText} aria-label={`Date ${dmyText}`}>
      <span className="kai-dmy__seg kai-dmy__seg--day" data-chakra={dayChakra}>
        D<span className="kai-dmy__num">{dmy.day}</span>
      </span>
      <span className="kai-dmy__sep">/</span>
      <span className="kai-dmy__seg kai-dmy__seg--month" data-chakra={monthChakra}>
        M<span className="kai-dmy__num">{dmy.month}</span>
      </span>
      <span className="kai-dmy__sep">/</span>
      <span className="kai-dmy__seg kai-dmy__seg--year" data-chakra="Year">
        Y<span className="kai-dmy__num">{dmy.year}</span>
      </span>
    </span>
  );

  const DayPill = (
    <span
      className="kai-pill kai-pill--day"
      title={dayNameFull}
      aria-label={`Day ${dayNameFull}`}
      data-chakra={dayChakra}
    >
      {dayNameFull}
    </span>
  );

  const DayChakraPill = (
    <span
      className="kai-pill kai-pill--dayChakra"
      title={`Day chakra ${dayChakraLabel}`}
      aria-label={`Day chakra ${dayChakraLabel}`}
      data-chakra={dayChakra}
    >
      {dayChakraLabel}
    </span>
  );

  const MonthNamePill = (
    <span
      className="kai-pill kai-pill--monthName"
      title={monthName}
      aria-label={`Month ${monthName}`}
      data-chakra={monthChakra}
    >
      {monthName}
    </span>
  );

  const MonthChakraPill = (
    <span
      className="kai-pill kai-pill--monthChakra"
      title={`Month chakra ${monthChakraLabel}`}
      aria-label={`Month chakra ${monthChakraLabel}`}
      data-chakra={monthChakra}
    >
      {monthChakraLabel}
    </span>
  );

  const ArkPill = (
    <span
      className="kai-pill kai-pill--ark"
      title={arkFull}
      aria-label={`Ark ${arkFull}`}
      data-chakra={arkChakra} // ✅ Ignition becomes Root/red
    >
      {arkFull}
    </span>
  );

  return (
    <div
      ref={rootRef}
      className={`kai-feed-status kai-feed-status--slim${flash ? " kai-feed-status--flash" : ""}`}
      role="status"
      aria-live="polite"
      data-layout={layout}
      data-bottom={bottomMode}
      data-kai-bsi={beatStepDisp}
      data-kai-ark={arkFull}
      data-kai-dmy={dmyText}
      data-day-chakra={dayChakra}
      data-month-chakra={monthChakra}
      data-ark-chakra={arkChakra}
      data-day-num={dmy.day}
      data-month-num={dmy.month}
      data-year-num={dmy.year}
      style={styleVars}
    >
      {/* ROW 1: day row (one line; scrollable) */}
      <div className="kai-status__top" aria-label="Kai timeline (day row)">
        <span className="kai-status__bsiWrap" aria-label={`Beat step ${beatStepDisp}`}>
          <span className="kai-status__kLabel" aria-hidden="true">
            KAIROS
          </span>
          <span className="kai-status__bsi" title={beatStepDisp}>
            {beatStepDisp}
          </span>
        </span>

        {DMYPill}
        {DayPill}
        {DayChakraPill}

        {pulseOnTop ? PulsePill : null}
      </div>

      {/* ROW 2: month + ark row (one line; scrollable) */}
      <div className="kai-status__mid" aria-label="Kai timeline (month/ark row)">
        {MonthNamePill}
        {MonthChakraPill}
        {ArkPill}
      </div>

      {/* ROW 3: countdown row (pulse drops here on tiny/nano) */}
      <div className="kai-status__bottom" aria-label="Next pulse row">
        {pulseOnTop ? null : PulsePill}
        {Countdown}
      </div>

      {/* Progress bar (always present) */}
      <div className="kai-feed-status__bar" aria-hidden="true">
        <div className="kai-feed-status__barFill" />
        <div className="kai-feed-status__barSpark" />
      </div>
    </div>
  );
}

export default KaiStatus;
