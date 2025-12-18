// src/pages/sigilstream/status/KaiStatus.tsx
"use client";

/**
 * KaiStatus — Atlantean μpulse Bar
 * v5.0 — CLICK → Kai-Klok POPOVER (portal modal) + a11y + scroll-lock + ESC close
 *
 * ✅ FIX (Day chakra correctness):
 * Day chakra must follow the weekday (Solhara..Kaelith), not day-of-month segmentation.
 * - Verdari → Heart (green)
 * - Sonari  → Throat (blue)
 * - Kaelith → Crown ("Krown")
 *
 * Keeps everything else unchanged.
 */

import * as React from "react";
import { createPortal } from "react-dom";
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
import KaiKlockRaw from "../../../components/EternalKlock";
import "./KaiStatus.css";

const DEFAULT_PULSE_DUR_S = 3 + Math.sqrt(5); // 5.2360679…

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
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

const ARK_NAMES = ["Ignite", "Integrate", "Harmonize", "Reflekt", "Purify", "Dream"] as const;
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

/* ✅ FIX: weekday → chakra (Verdari/Heart, Sonari/Throat, Kaelith/Crown) */
const WEEKDAY_CHAKRA: Readonly<Record<string, ChakraName>> = {
  solhara: "Root",
  aquaris: "Sacral",
  flamora: "Solar Plexus",
  verdari: "Heart",
  sonari: "Throat",
  kaelith: "Crown",
  caelith: "Crown", // alias safety
};

function chakraFromHarmonicDay(harmonicDay: unknown, fallbackDayOfMonth: number): ChakraName {
  // Prefer string weekday names.
  if (typeof harmonicDay === "string") {
    const key = harmonicDay.trim().toLowerCase().replace(/[^a-z]/g, "");
    const ch = WEEKDAY_CHAKRA[key];
    if (ch) return ch;
  }

  // If numeric weekday index sneaks in (0..5), map it.
  if (typeof harmonicDay === "number" && Number.isFinite(harmonicDay)) {
    const idx = modIndex(Math.floor(harmonicDay), 6);
    const keys = ["solhara", "aquaris", "flamora", "verdari", "sonari", "kaelith"] as const;
    const ch = WEEKDAY_CHAKRA[keys[idx]];
    if (ch) return ch;
  }

  // Fallback keeps legacy behavior (never breaks UI).
  return chakraFromDayOfMonth(fallbackDayOfMonth);
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

/* ─────────────────────────────────────────────────────────────
   ✅ KaiKlock props (strict) + typed component binding
───────────────────────────────────────────────────────────── */

type KaiKlockProps = {
  hue: string;
  pulse: number;
  harmonicDayPercent: number;
  microCyclePercent: number;
  dayLabel: string;
  monthLabel: string;
  monthDay: number;
  kaiPulseEternal: number;
  glowPulse: boolean;
  pulseIntervalSec: number;
  rimFlash: boolean;
  solarSpiralStepString: string;
  eternalBeatIndex: number;
  eternalStepIndex: number;
};

const KaiKlock = KaiKlockRaw as unknown as React.ComponentType<KaiKlockProps>;

export function KaiStatus(): React.JSX.Element {
  const kaiNow = useAlignedKaiTicker();
  const secsLeft = useKaiPulseCountdown(true);

  const [dialOpen, setDialOpen] = React.useState<boolean>(false);
  const openDial = React.useCallback(() => setDialOpen(true), []);
  const closeDial = React.useCallback(() => setDialOpen(false), []);

  const onRootKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setDialOpen(true);
      }
    },
    [],
  );

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
    prevAnchorRef.current = secsLeft;

    if (prev != null && secsLeft != null && secsLeft > prev + 0.25) {
      setFlash(true);
      const t = window.setTimeout(() => setFlash(false), 180);
      return () => window.clearTimeout(t);
    }
    return;
  }, [secsLeft]);

  const beatStepDisp = `${kaiNow.beat}:${pad2(kaiNow.step)}`;

  const progress = React.useMemo<number>(() => {
    if (secsLeft == null) return 0;
    return clamp01(1 - secsLeft / pulseDur);
  }, [secsLeft, pulseDur]);

  const secsTextFull = secsLeft !== null ? secsLeft.toFixed(6) : "—";
  const secsText = secsLeft !== null ? secsLeft.toFixed(6) : "—";

  const dayNameFull = String(kaiNow.harmonicDay);

  const beatNum =
    typeof kaiNow.beat === "number" ? kaiNow.beat : Number.parseInt(String(kaiNow.beat), 10) || 0;

  const stepNum =
    typeof kaiNow.step === "number" ? kaiNow.step : Number.parseInt(String(kaiNow.step), 10) || 0;

  const arkFull: ArkName = arkFromBeat(beatNum);
  const arkChakra: ChakraName = ARK_CHAKRA[arkFull] ?? "Heart";

  const pulseNum =
    typeof kaiNow.pulse === "number" ? kaiNow.pulse : Number.parseInt(String(kaiNow.pulse), 10) || 0;

  const dmy = React.useMemo(() => kaiDMYFromPulseKKS(pulseNum), [pulseNum]);

  /* ✅ FIX: day chakra must track weekday name */
  const dayChakra = React.useMemo<ChakraName>(
    () => chakraFromHarmonicDay(kaiNow.harmonicDay, dmy.day),
    [kaiNow.harmonicDay, dmy.day],
  );

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

  // KaiKlock props derived from Beat/Step (stable + deterministic)
  const stepsPerDay = 36 * 44; // 1584
  const stepOfDay = Math.max(0, Math.min(stepsPerDay - 1, beatNum * 44 + stepNum));
  const harmonicDayPercent = (stepOfDay / stepsPerDay) * 100;
  const microCyclePercent = progress * 100;

  // If your dial expects hue degrees, keep it a string degrees payload.
  // If it expects a color, change to `hsl(${...} 100% 55%)`.
  const hue = String(Math.round((beatNum / 36) * 360));

  // Modal: scroll lock + ESC close
  React.useEffect(() => {
    if (!dialOpen) return;
    if (typeof document === "undefined") return;

    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";

    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") closeDial();
    };
    window.addEventListener("keydown", onKey);

    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [dialOpen, closeDial]);

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
      data-chakra={arkChakra}
    >
      {arkFull}
    </span>
  );

  const dialPortal =
    dialOpen && typeof document !== "undefined"
      ? createPortal(
          <div className="kk-pop" role="dialog" aria-modal="true" aria-label="Kai-Klok">
            <button
              type="button"
              className="kk-pop__backdrop"
              aria-label="Close Kai-Klok"
              onClick={closeDial}
            />
            <div className="kk-pop__panel" role="document">
              <div className="kk-pop__head">
                <div className="kk-pop__title">Kai-Klok</div>
                <button type="button" className="kk-pop__close" onClick={closeDial} aria-label="Close">
                  ✕
                </button>
              </div>

              <div className="kk-pop__meta" aria-label="Kai summary">
                <span className="kk-pop__pill">{beatStepDisp}</span>
                <span className="kk-pop__pill">{dmyText}</span>
                <span className="kk-pop__pill">{monthName}</span>
                <span className="kk-pop__pill">{arkFull}</span>
              </div>

              <div className="kk-pop__dial" aria-label="Kai-Klok dial">
                <div className="klock-stage" data-klock-stage="1">
                  <div className="klock-stage__inner">
                    <KaiKlock
                      hue={hue}
                      pulse={pulseNum}
                      harmonicDayPercent={harmonicDayPercent}
                      microCyclePercent={microCyclePercent}
                      dayLabel={dayNameFull}
                      monthLabel={monthName}
                      monthDay={dmy.day}
                      kaiPulseEternal={pulseNum}
                      glowPulse={true}
                      pulseIntervalSec={pulseDur}
                      rimFlash={flash}
                      solarSpiralStepString={`${pad2(beatNum)}:${pad2(stepNum)}`}
                      eternalBeatIndex={beatNum}
                      eternalStepIndex={stepNum}
                    />
                  </div>
                </div>
              </div>

              <div className="kk-pop__foot">
                <span className="kk-pop__hint">Tap outside or press ESC to return.</span>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div
        ref={rootRef}
        className={`kai-feed-status kai-feed-status--slim${flash ? " kai-feed-status--flash" : ""}`}
        onClick={openDial}
        onKeyDown={onRootKeyDown}
        tabIndex={0}
        role="button"
        aria-haspopup="dialog"
        aria-expanded={dialOpen}
        aria-label="Kai status (open Kai-Klok)"
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

      {dialPortal}
    </>
  );
}

export default KaiStatus;
