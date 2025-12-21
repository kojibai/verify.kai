// useSovereignSolarClock.ts — shared clock data hook for KaiKlock + Eternal
import { useEffect, useMemo, useState } from "react";
import {
  ETERNAL_BEATS_PER_DAY,
  ETERNAL_STEPS_PER_BEAT,
  SOLAR_DAY_NAMES,
  MONTHS,
  HARMONIC_DAY_PULSES,
  getKaiPulseEternal,
  getKaiPulseToday,
  getSolarAlignedCounters,
  getSolarArcName,
  getSunriseOffsetSec,
} from "../SovereignSolar";
import { msUntilNextSovereignPulse, sovereignPulseNow } from "./sovereign_pulse";
import { subscribeSunriseOffset } from "./solarSync";

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

export type SolarStep = {
  stepIndex: number;
  percentIntoStep: number;
  stepsPerBeat: number;
  beatIndex: number;
};

export default function useSovereignSolarClock() {
  const [pulseNow, setPulseNow] = useState<number>(sovereignPulseNow());
  const [tick, setTick] = useState(0); // used to re-eval on external sunrise change

  // φ tick
  useEffect(() => {
    let id: number | null = null;
    const pulse = () => {
      setPulseNow(sovereignPulseNow());
      const next = msUntilNextSovereignPulse();
      id = window.setTimeout(pulse, Math.max(16, Math.round(next)));
    };
    pulse();
    return () => {
      if (id !== null) window.clearTimeout(id);
    };
  }, []);

  // react to sunrise changes (from Eternal/controls)
  useEffect(() => {
    const off = subscribeSunriseOffset(() => setTick((t) => t + 1));
    return off;
  }, []);

  // core (100% offline)
  const kaiPulseEternal = useMemo(() => getKaiPulseEternal(pulseNow), [pulseNow, tick]);

  const today = useMemo(() => getKaiPulseToday(pulseNow), [pulseNow, tick]);
  const {
    kaiPulseToday,
    dayPercent,
    beatIndex: solarBeatIndex,
    stepIndex: solarStepIndex,
    percentIntoStep: solarPercentIntoStep,
  } = today;

  const solarStep: SolarStep = useMemo(
    () => ({
      beatIndex: solarBeatIndex,
      stepIndex: solarStepIndex,
      stepsPerBeat: ETERNAL_STEPS_PER_BEAT,
      percentIntoStep: solarPercentIntoStep,
    }),
    [solarBeatIndex, solarStepIndex, solarPercentIntoStep]
  );

  const solarStepString = `${solarBeatIndex}:${String(solarStepIndex).padStart(2, "0")}`;
  const solarArcName = useMemo(() => getSolarArcName(pulseNow), [pulseNow, tick]);

  const counters = useMemo(() => getSolarAlignedCounters(pulseNow), [pulseNow, tick]);
  const solarWeekDayName = SOLAR_DAY_NAMES[counters.solarAlignedWeekDayIndex];

  const monthIndex1 = clamp(counters.solarAlignedMonth, 1, 8);
  const monthLabel = MONTHS[monthIndex1 - 1];
  const monthDay1 = counters.solarAlignedDayInMonth + 1;

  // Eternal beat/step from eternal pulse
  const eternalPulsesPerBeat = HARMONIC_DAY_PULSES / ETERNAL_BEATS_PER_DAY;
  const etBeatIndex =
    Math.floor((kaiPulseEternal % HARMONIC_DAY_PULSES) / eternalPulsesPerBeat) %
    ETERNAL_BEATS_PER_DAY;
  const pulsesIntoBeatET =
    (kaiPulseEternal % HARMONIC_DAY_PULSES) - etBeatIndex * eternalPulsesPerBeat;
  const pulsesPerStep = eternalPulsesPerBeat / ETERNAL_STEPS_PER_BEAT;
  const etStepIndex = Math.floor(pulsesIntoBeatET / pulsesPerStep) % ETERNAL_STEPS_PER_BEAT;

  // center-of-beat needle (same look)
  const rotationOverride = useMemo(
    () => ((solarBeatIndex + 0.5) / ETERNAL_BEATS_PER_DAY) * 360,
    [solarBeatIndex]
  );

  return {
    now: pulseNow,
    sunriseOffsetSec: getSunriseOffsetSec(),
    kaiPulseEternal,
    kaiPulseToday,
    dayPercent,
    solarStep,
    solarStepString,
    solarArcName,
    dayLabel: solarWeekDayName,
    monthLabel,
    monthDay1,
    etBeatIndex,
    etStepIndex,
    rotationOverride,
  };
}
