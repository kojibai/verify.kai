// SolarAnchoredDial.tsx — Offline, sunrise-anchored dial + controls
// Drop-in child component for EternalKlock.tsx (no geolocation, no network)
//
// FIX: kairosEpochNow() returns μpulses (micro-pulses), NOT epoch-ms.
// This file converts μpulses → pulses correctly (÷ 1e6), so you won’t see 1.5B “pulse” anymore.
//
// ✅ NO Date.now() / new Date() for “NOW”
// ✅ NOW source = kai_pulse.ts kairosEpochNow() (μpulses since GENESIS)
// ✅ Schedules ticks to next φ pulse boundary using μremainder
// ✅ Date is used ONLY as a bridge for sunrise setters (derived from GENESIS + μpulses)

import React, { useEffect, useMemo, useState } from "react";
import KaiKlock from "./KaiKlock";
import "./SolarAnchoredDial.css";

import * as KaiSpec from "../utils/kai_pulse";

import {
  ETERNAL_BEATS_PER_DAY,
  ETERNAL_STEPS_PER_BEAT,
  SOLAR_DAY_NAMES,
  MONTHS,
  HARMONIC_DAY_PULSES,
  BREATH_SEC, // fallback only
  getSunriseOffsetSec,
  setSunriseFromLocalHHMM,
  tapSunroseNow,
} from "../SovereignSolar";

/* Types */
type ChakraStep = {
  stepIndex: number;
  percentIntoStep: number; // 0..100
  stepsPerBeat: number;
  beatIndex: number;
};

type HarmonicLevels = {
  arcBeat: { pulseInCycle: number; cycleLength: number; percent: number };
  microCycle: { pulseInCycle: number; cycleLength: number; percent: number };
  chakraLoop: { pulseInCycle: number; cycleLength: number; percent: number };
  harmonicDay: { pulseInCycle: number; cycleLength: number; percent: number };
};

export type SolarAnchoredDialProps = {
  showControls?: boolean;
  className?: string;
  onSunriseChange?: (offsetSec: number) => void;
};

/* Helpers */
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

const chakraColor = (ark: string) => {
  switch (ark) {
    case "Ignition Ark":
      return "#ff0033";
    case "Integration Ark":
      return "#ff6600";
    case "Harmonization Ark":
      return "#ffcc00";
    case "Reflektion Ark":
      return "#00cc66";
    case "Purifikation Ark":
      return "#00ccff";
    case "Dream Ark":
      return "#cc00cc";
    default:
      return "#00ffff";
  }
};

const fmodPos = (n: number, m: number): number => {
  if (!Number.isFinite(n) || !Number.isFinite(m) || m === 0) return 0;
  const r = n % m;
  return r < 0 ? r + m : r;
};

const imodPos = (n: number, m: number): number => {
  if (!Number.isFinite(n) || !Number.isFinite(m) || m === 0) return 0;
  const r = n % m;
  return r < 0 ? r + m : r;
};

const modPosBig = (a: bigint, m: bigint): bigint => {
  if (m === 0n) return 0n;
  const r = a % m;
  return r < 0n ? r + m : r;
};

function isFn(v: unknown): v is (...args: never[]) => unknown {
  return typeof v === "function";
}

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function readPulseMsFromKaiSpec(): number {
  const rec = KaiSpec as unknown as Record<string, unknown>;
  const pulseMs = asFiniteNumber(rec["PULSE_MS"]);
  if (pulseMs !== null && pulseMs > 0) return pulseMs;
  return BREATH_SEC * 1000;
}

function readGenesisMsFromKaiSpec(): number | null {
  const rec = KaiSpec as unknown as Record<string, unknown>;
  const g = asFiniteNumber(rec["GENESIS_TS"]);
  return g !== null ? g : null;
}

/** Read μpulses since GENESIS (the spec “NOW”). */
function readMicroPulsesNow(): bigint | null {
  const rec = KaiSpec as unknown as Record<string, unknown>;

  const f1 = rec["kairosEpochNow"];
  if (isFn(f1)) {
    const out = (f1 as () => unknown)();
    if (typeof out === "bigint") return out;
    if (typeof out === "number" && Number.isFinite(out)) return BigInt(Math.floor(out));
  }

  // Optional alternates (if you ever rename exports)
  for (const k of ["microPulsesNow", "kaiMicroNow", "kaiNowMicroPulses"]) {
    const fn = rec[k];
    if (isFn(fn)) {
      const out = (fn as () => unknown)();
      if (typeof out === "bigint") return out;
      if (typeof out === "number" && Number.isFinite(out)) return BigInt(Math.floor(out));
    }
  }

  return null;
}

function microToPulseInt1Based(micro: bigint): number {
  // pulse index = floor(μ / 1e6) + 1
  const p0 = micro / 1_000_000n;
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (p0 > max) return Number.MAX_SAFE_INTEGER;
  return Number(p0) + 1;
}

function microToPulseFloat1Based(micro: bigint): number {
  // pulse float = (floor(μ/1e6) + (μ%1e6)/1e6) + 1
  const q = micro / 1_000_000n;
  const r = micro % 1_000_000n;
  const qn = Number(q); // safe for your horizon (and guarded by int conversion elsewhere)
  const rn = Number(r); // < 1e6 always
  return qn + rn / 1_000_000 + 1;
}

function microToEpochMs(micro: bigint, genesisMs: number, pulseMs: number): number {
  // Avoid Number(micro) overflow: split q + r
  const q = micro / 1_000_000n;
  const r = micro % 1_000_000n;
  const qn = Number(q);
  const rn = Number(r);
  return genesisMs + qn * pulseMs + (rn / 1_000_000) * pulseMs;
}

/** ms until next pulse boundary based on μ remainder */
function delayToNextPulseBoundaryMs(micro: bigint, pulseMs: number): number {
  const r = micro % 1_000_000n; // 0..999999
  const remainingMicro = r === 0n ? 1_000_000n : 1_000_000n - r;
  const rem = Number(remainingMicro); // <= 1e6 safe
  const raw = (rem / 1_000_000) * pulseMs;
  return Math.ceil(Math.max(25, Math.min(60_000, raw)));
}

const ARK_NAMES = [
  "Ignition Ark",
  "Integration Ark",
  "Harmonization Ark",
  "Reflektion Ark",
  "Purifikation Ark",
  "Dream Ark",
] as const;

const SolarAnchoredDial: React.FC<SolarAnchoredDialProps> = ({
  showControls = true,
  className = "",
  onSunriseChange,
}) => {
  const [glowPulse, setGlowPulse] = useState(false);

  const [microNow, setMicroNow] = useState<bigint>(() => readMicroPulsesNow() ?? 0n);

  const [hhmm, setHhmm] = useState("");
  const [offsetPreview, setOffsetPreview] = useState<number | null>(null);
  const [showExplainer, setShowExplainer] = useState(false);

  const pulseMs = useMemo(() => readPulseMsFromKaiSpec(), []);
  const pulseSec = pulseMs / 1000;

  const genesisMs = useMemo(() => readGenesisMsFromKaiSpec(), []);

  // φ tick (boundary scheduled off μ remainder)
  useEffect(() => {
    let cancelled = false;
    let t: number | null = null;
    let glowT: number | null = null;

    const tick = (): void => {
      if (cancelled) return;

      const m = readMicroPulsesNow();
      if (m !== null) setMicroNow(m);

      setGlowPulse(true);
      if (glowT !== null) window.clearTimeout(glowT);
      glowT = window.setTimeout(() => setGlowPulse(false), 750);

      const nextDelay = m !== null ? delayToNextPulseBoundaryMs(m, pulseMs) : Math.round(BREATH_SEC * 1000);
      t = window.setTimeout(tick, nextDelay);
    };

    tick();

    return () => {
      cancelled = true;
      if (t !== null) window.clearTimeout(t);
      if (glowT !== null) window.clearTimeout(glowT);
    };
  }, [pulseMs]);

  // “NOW” bridges (only what we need)
  const kaiPulseEternal = useMemo(() => microToPulseInt1Based(microNow), [microNow]);
  const kaiPulseEternalFloat = useMemo(() => microToPulseFloat1Based(microNow), [microNow]);

  const nowDate = useMemo(() => {
    // Bridge Date ONLY from spec (GENESIS + μpulses)
    if (genesisMs === null) return new Date(0);
    const ms = microToEpochMs(microNow, genesisMs, pulseMs);
    return new Date(ms);
  }, [genesisMs, microNow, pulseMs]);

  // Sunrise offset (seconds UTC) → μpulse shift
  const offsetSec = getSunriseOffsetSec();
  const offsetMicro = useMemo(() => {
    if (!Number.isFinite(offsetSec) || !(pulseSec > 0)) return 0n;
    const shift = Math.round((offsetSec * 1_000_000) / pulseSec); // μpulses
    return BigInt(shift);
  }, [offsetSec, pulseSec]);

  // Solar-anchored “today” in μpulses
  const dayMicro = useMemo(() => {
    const dm = Math.round(HARMONIC_DAY_PULSES * 1_000_000);
    return dm > 0 ? BigInt(dm) : 0n;
  }, []);

  const phaseMicro = microNow + offsetMicro;
  const pulseTodayMicro = dayMicro > 0n ? modPosBig(phaseMicro, dayMicro) : 0n;

  // Convert to pulses (float) for existing KaiKlock props/math (safe size)
  const kaiPulseToday = useMemo(() => Number(pulseTodayMicro) / 1_000_000, [pulseTodayMicro]);
  const dayPercent = useMemo(() => {
    if (!(dayMicro > 0n)) return 0;
    const pct = (Number(pulseTodayMicro) / Number(dayMicro)) * 100;
    return clamp(pct, 0, 100);
  }, [dayMicro, pulseTodayMicro]);

  // Solar beat/step indices (float math preserved)
  const pulsesPerBeatSolar = HARMONIC_DAY_PULSES / ETERNAL_BEATS_PER_DAY;
  const solarBeatIndex =
    pulsesPerBeatSolar > 0 ? Math.floor(kaiPulseToday / pulsesPerBeatSolar) % ETERNAL_BEATS_PER_DAY : 0;

  const pulsesIntoBeatSolar = kaiPulseToday - solarBeatIndex * pulsesPerBeatSolar;
  const pulsesPerStepSolar = pulsesPerBeatSolar / ETERNAL_STEPS_PER_BEAT;
  const solarStepIndex =
    pulsesPerStepSolar > 0 ? Math.floor(pulsesIntoBeatSolar / pulsesPerStepSolar) % ETERNAL_STEPS_PER_BEAT : 0;

  const pulsesIntoStepSolar = pulsesIntoBeatSolar - solarStepIndex * pulsesPerStepSolar;
  const solarPercentIntoStep =
    pulsesPerStepSolar > 0 ? clamp((pulsesIntoStepSolar / pulsesPerStepSolar) * 100, 0, 100) : 0;

  const solarStep: ChakraStep = useMemo(
    () => ({
      beatIndex: solarBeatIndex,
      stepIndex: solarStepIndex,
      stepsPerBeat: ETERNAL_STEPS_PER_BEAT,
      percentIntoStep: solarPercentIntoStep,
    }),
    [solarBeatIndex, solarStepIndex, solarPercentIntoStep]
  );

  const solarStepString = `${solarBeatIndex}:${String(solarStepIndex).padStart(2, "0")}`;
  const arcIndex = Math.floor(solarBeatIndex / 6) % 6;
  const solarArcName = ARK_NAMES[imodPos(arcIndex, 6)];

  // Solar-aligned counters (derived from phase pulse count)
  const phasePulseFloat = useMemo(() => {
    // Convert phaseMicro safely: split q+r
    const q = phaseMicro / 1_000_000n;
    const r = phaseMicro % 1_000_000n;
    return Number(q) + Number(r) / 1_000_000;
  }, [phaseMicro]);

  const dayIndex = HARMONIC_DAY_PULSES > 0 ? Math.floor(phasePulseFloat / HARMONIC_DAY_PULSES) : 0;
  const weekDayIndex = imodPos(dayIndex, 6);
  const solarWeekDayName = SOLAR_DAY_NAMES[weekDayIndex] ?? SOLAR_DAY_NAMES[0];

  const dayInYear = imodPos(dayIndex, 336); // 8 months * 42 days
  const monthIndex0 = Math.floor(dayInYear / 42); // 0..7
  const monthIndex1 = clamp(monthIndex0 + 1, 1, 8);
  const monthLabel = MONTHS[monthIndex1 - 1];
  const dayInMonth0 = dayInYear % 42; // 0..41
  const monthDay1 = dayInMonth0 + 1;

  // Eternal beat/step (from eternal pulse float; preserves fractional within pulse)
  const eternalPulsesPerBeat = HARMONIC_DAY_PULSES / ETERNAL_BEATS_PER_DAY;

  const etBeatIndex =
    eternalPulsesPerBeat > 0
      ? Math.floor(fmodPos(kaiPulseEternalFloat, HARMONIC_DAY_PULSES) / eternalPulsesPerBeat) % ETERNAL_BEATS_PER_DAY
      : 0;

  const pulsesIntoBeatET =
    fmodPos(kaiPulseEternalFloat, HARMONIC_DAY_PULSES) - etBeatIndex * eternalPulsesPerBeat;

  const pulsesPerStepET = eternalPulsesPerBeat / ETERNAL_STEPS_PER_BEAT;
  const etStepIndex = pulsesPerStepET > 0 ? Math.floor(pulsesIntoBeatET / pulsesPerStepET) % ETERNAL_STEPS_PER_BEAT : 0;

  // Presentational cycles
  const levels: HarmonicLevels = useMemo(() => {
    const arcBeatLen = 6;
    const microLen = 60;
    const loopLen = 360;

    const p = kaiPulseEternal; // int is fine for these display cycles
    const mk = (len: number) => {
      const inCycle = ((p % len) + len) % len;
      return { pulseInCycle: inCycle, cycleLength: len, percent: (inCycle / len) * 100 };
    };

    const harmonicDay = {
      pulseInCycle: kaiPulseToday,
      cycleLength: HARMONIC_DAY_PULSES,
      percent: dayPercent,
    };

    return { arcBeat: mk(arcBeatLen), microCycle: mk(microLen), chakraLoop: mk(loopLen), harmonicDay };
  }, [kaiPulseEternal, kaiPulseToday, dayPercent]);

  // Needle rotation override (center of beat)
  const rotationOverride = useMemo(
    () => ((solarBeatIndex + 0.5) / ETERNAL_BEATS_PER_DAY) * 360,
    [solarBeatIndex]
  );

  // Handlers
  const refreshNow = (): void => {
    const m = readMicroPulsesNow();
    if (m !== null) setMicroNow(m);
  };

  const handleApplyHHMM = (): void => {
    if (!hhmm) return;
    setSunriseFromLocalHHMM(hhmm, nowDate); // Date derived from spec
    setHhmm("");
    const off = getSunriseOffsetSec();
    setOffsetPreview(off);
    onSunriseChange?.(off);
    refreshNow();
  };

  const handleTapSunrose = (): void => {
    tapSunroseNow(nowDate); // Date derived from spec
    const off = getSunriseOffsetSec();
    setOffsetPreview(off);
    onSunriseChange?.(off);
    refreshNow();
  };

  // Turn digits into H:MM or HH:MM as you type
  const handleHHMMMaskedChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
    let next = digits;
    if (digits.length > 2) next = `${digits.slice(0, digits.length - 2)}:${digits.slice(-2)}`;
    setHhmm(next);
  };

  return (
    <div className={`solar-anchored-dial ${className}`}>
      {/* Stage container only — KaiKlock itself is untouched */}
      <div className={`dial-stage depth-3d ${glowPulse ? "glow-pulse" : ""}`} title="Solar-anchored dial">
        <KaiKlock
          hue={chakraColor(solarArcName)}
          kaiPulseEternal={kaiPulseEternal}
          pulse={kaiPulseToday}
          harmonicDayPercent={levels.harmonicDay.percent}
          microCyclePercent={solarPercentIntoStep}
          dayLabel={solarWeekDayName}
          monthLabel={monthLabel}
          monthDay={monthDay1}
          glowPulse={glowPulse}
          rotationOverride={rotationOverride}
          solarSpiralStepString={solarStepString}
          solarSpiralStep={solarStep}
          eternalBeatIndex={etBeatIndex}
          eternalStepIndex={etStepIndex}
        />
      </div>

      {showControls && (
        <div className="solar-sync-panel">
          {/* Title row */}
          <div className="panel-title">
            <button
              type="button"
              className="panel-glyph"
              title={showExplainer ? "Hide explainer" : "Show explainer"}
              aria-label="Toggle explainer"
              aria-expanded={showExplainer}
              aria-controls="solar-explainer"
              onClick={() => setShowExplainer((v) => !v)}
            >
              ?
            </button>

            <div className="panel-text">
              <strong>Solar Sync</strong>
              <span className="panel-sub">
                Sunrise offset (UTC): <code>{offsetPreview ?? offsetSec}s</code>
              </span>
            </div>
          </div>

          {/* Buttons */}
          <div className="row buttons-row">
            <button className="btn primary" onClick={handleTapSunrose} title="Set sunrise = now (offline)" type="button">
              Sun rose now
            </button>
          </div>

          {/* Input */}
          <div className="row input-row">
            <label htmlFor="sunriseHHMM" className="label">
              Sunrise (HH:MM, local)
            </label>
            <div className="input-group">
              <input
                id="sunriseHHMM"
                className="time-input"
                type="text"
                inputMode="numeric"
                enterKeyHint="done"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="06:12"
                value={hhmm}
                onChange={handleHHMMMaskedChange}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                style={{ width: 88, fontSize: 17, lineHeight: 1.4 }}
              />
              <button className="btn save" onClick={handleApplyHHMM} type="button">
                Save
              </button>
            </div>
          </div>

          {/* Explainer (hidden until toggled) */}
          <div
            id="solar-explainer"
            className={`explainer ${showExplainer ? "open" : ""}`}
            role="region"
            aria-label="Solar Sync explainer"
          >
            <p className="hint">
              No location, no network. The dial maps each day from your stored sunrise to the next (fixed at{" "}
              <strong>{HARMONIC_DAY_PULSES.toFixed(6)}</strong> Breathes). Re-tap “Sun rose now” or enter your local
              sunrise anytime to re-calibrate.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default SolarAnchoredDial;
