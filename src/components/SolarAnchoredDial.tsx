// SolarAnchoredDial.tsx — Offline, sunrise-anchored dial + controls
// Drop-in child component for EternalKlock.tsx (no geolocation, no network)

import React, { useEffect, useMemo, useRef, useState } from "react";
import KaiKlock from "./KaiKlock";
import "./SolarAnchoredDial.css";

import {
  ETERNAL_BEATS_PER_DAY,
  ETERNAL_STEPS_PER_BEAT,
  SOLAR_DAY_NAMES,
  MONTHS,
  HARMONIC_DAY_PULSES,
  BREATH_SEC,
  getKaiPulseEternal,
  getKaiPulseToday,
  getSolarAlignedCounters,
  getSolarArcName,
  getSunriseOffsetSec,
  setSunriseFromLocalHHMM,
  tapSunroseNow,
} from "../SovereignSolar";
import { getKaiTimeSource } from "../utils/kai_pulse";

/* Types */
type ChakraStep = {
  stepIndex: number;
  percentIntoStep: number;
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
    case "Ignition Ark":      return "#ff0033";
    case "Integration Ark":   return "#ff6600";
    case "Harmonization Ark": return "#ffcc00";
    case "Reflektion Ark":    return "#00cc66";
    case "Purifikation Ark":  return "#00ccff";
    case "Dream Ark":         return "#cc00cc";
    default:                  return "#00ffff";
  }
};

const SolarAnchoredDial: React.FC<SolarAnchoredDialProps> = ({
  showControls = true,
  className = "",
  onSunriseChange,
}) => {
  const timeSourceRef = useRef(getKaiTimeSource());
  const [glowPulse, setGlowPulse] = useState(false);
  const [now, setNow] = useState<Date>(() => new Date(timeSourceRef.current.nowEpochMs()));
  const [hhmm, setHhmm] = useState("");
  const [offsetPreview, setOffsetPreview] = useState<number | null>(null);
  const [showExplainer, setShowExplainer] = useState(false);

  // φ tick
  useEffect(() => {
    const tick = () => {
      setNow(new Date(timeSourceRef.current.nowEpochMs()));
      setGlowPulse(true);
      setTimeout(() => setGlowPulse(false), 750);
    };
    tick();
    const id = setInterval(tick, Math.round(BREATH_SEC * 1000));
    return () => clearInterval(id);
  }, []);

  // Core numbers
  const kaiPulseEternal = useMemo(() => getKaiPulseEternal(now), [now]);

  const today = useMemo(() => getKaiPulseToday(now), [now]);
  const {
    kaiPulseToday,
    dayPercent,
    beatIndex: solarBeatIndex,
    stepIndex: solarStepIndex,
    percentIntoStep: solarPercentIntoStep,
  } = today;

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
  const solarArcName = useMemo(() => getSolarArcName(now), [now]);

  const counters = useMemo(() => getSolarAlignedCounters(now), [now]);
  const solarWeekDayName =
  counters.dayName ??
  SOLAR_DAY_NAMES[((counters.solarAlignedWeekDayIndex ?? 0) % 6 + 6) % 6];

  const monthIndex1 = clamp(counters.solarAlignedMonth, 1, 8);
  const monthLabel = MONTHS[monthIndex1 - 1];
  const monthDay1 = counters.solarAlignedDayInMonth + 1;

  // Eternal beat/step
  const eternalPulsesPerBeat = HARMONIC_DAY_PULSES / ETERNAL_BEATS_PER_DAY;
  const etBeatIndex =
    Math.floor((kaiPulseEternal % HARMONIC_DAY_PULSES) / eternalPulsesPerBeat) %
    ETERNAL_BEATS_PER_DAY;
  const pulsesIntoBeatET =
    (kaiPulseEternal % HARMONIC_DAY_PULSES) - etBeatIndex * eternalPulsesPerBeat;
  const pulsesPerStep = eternalPulsesPerBeat / ETERNAL_STEPS_PER_BEAT;
  const etStepIndex = Math.floor(pulsesIntoBeatET / pulsesPerStep) % ETERNAL_STEPS_PER_BEAT;

  // Presentational cycles
  const levels: HarmonicLevels = useMemo(() => {
    const arcBeatLen = 6, microLen = 60, loopLen = 360;
    const p = kaiPulseEternal;
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

  // Sunrise offset
  const offsetSec = getSunriseOffsetSec();

  // Handlers
  const handleApplyHHMM = () => {
    if (!hhmm) return;
    setSunriseFromLocalHHMM(hhmm, new Date());
    setHhmm("");
    const off = getSunriseOffsetSec();
    setOffsetPreview(off);
    onSunriseChange?.(off);
    setNow(new Date(timeSourceRef.current.nowEpochMs()));
  };

  const handleTapSunrose = () => {
    tapSunroseNow(new Date());
    const off = getSunriseOffsetSec();
    setOffsetPreview(off);
    onSunriseChange?.(off);
    setNow(new Date(timeSourceRef.current.nowEpochMs()));
  };
// Turn digits into H:MM or HH:MM as you type (works with numeric keypad)
const handleHHMMMaskedChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 4); // keep max 4 digits
    let next = digits;
  
    if (digits.length > 2) {
      // e.g., "612" -> "6:12", "1234" -> "12:34"
      next = `${digits.slice(0, digits.length - 2)}:${digits.slice(-2)}`;
    }
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
            {/* LEFT “?” — now the toggle */}
            <button
              type="button"
              className="panel-glyph"
              title={showExplainer ? "Hide explainer" : "Show explainer"}
              aria-label="Toggle explainer"
              aria-expanded={showExplainer}
              aria-controls="solar-explainer"
              onClick={() => setShowExplainer(v => !v)}
            >
              ?
            </button>

            <div className="panel-text">
              <strong>Solar Sync</strong>
              <span className="panel-sub">
                Sunrise offset (UTC): <code>{offsetPreview ?? offsetSec}s</code>
              </span>
            </div>

            {/* (Right-side “?” removed) */}
          </div>

          {/* Buttons */}
          <div className="row buttons-row">
            <button
              className="btn primary"
              onClick={handleTapSunrose}
              title="Set sunrise = now (offline)"
              type="button"
            >
              Sun rose now
            </button>
          </div>

          {/* Input */}
          <div className="row input-row">
            <label htmlFor="sunriseHHMM" className="label">Sunrise (HH:MM, local)</label>
            <div className="input-group">
            <input
  id="sunriseHHMM"
  className="time-input"
  type="text"
  inputMode="numeric"            /* keeps the number pad */
  enterKeyHint="done"
  autoComplete="off"
  autoCorrect="off"
  spellCheck={false}
  placeholder="06:12"
  value={hhmm}
  onChange={handleHHMMMaskedChange}  /* ⬅️ auto-inserts ":" */
  /* keep the modal open when focusing/typing on mobile */
  onClick={(e) => e.stopPropagation()}
  onFocus={(e) => e.stopPropagation()}
  onTouchStart={(e) => e.stopPropagation()}
  /* prevent iOS zoom */
  style={{ width: 88, fontSize: 17, lineHeight: 1.4 }}
/>

              <button className="btn save" onClick={handleApplyHHMM} type="button">Save</button>
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
              No location, no network. The dial maps each day from your stored sunrise
              to the next (fixed at <strong>{HARMONIC_DAY_PULSES.toFixed(6)}</strong> Breathes).
              Re-tap “Sun rose now” or enter your local sunrise anytime to re-calibrate. 
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default SolarAnchoredDial;
