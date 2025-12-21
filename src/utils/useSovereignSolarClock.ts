// useSovereignSolarClock.ts — shared clock data hook for KaiKlock + Eternal
import { useEffect, useMemo, useRef, useState } from "react";
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
} from "../SovereignSolar";
import { getKaiTimeSource } from "../utils/kai_pulse";
import { subscribeSunriseOffset } from "./solarSync";

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

export type SolarStep = {
  stepIndex: number;
  percentIntoStep: number;
  stepsPerBeat: number;
  beatIndex: number;
};

export default function useSovereignSolarClock() {
  const timeSourceRef = useRef(getKaiTimeSource());
  const [now, setNow] = useState<Date>(() => new Date(timeSourceRef.current.nowEpochMs()));
  const [tick, setTick] = useState(0); // used to re-eval on external sunrise change

  // φ tick
  useEffect(() => {
    const pulse = () => { setNow(new Date(timeSourceRef.current.nowEpochMs())); };
    pulse();
    const id = setInterval(pulse, Math.round(BREATH_SEC * 1000));
    return () => clearInterval(id);
  }, []);

  // react to sunrise changes (from Eternal/controls)
  useEffect(() => {
    const off = subscribeSunriseOffset(() => setTick((t) => t + 1));
    return off;
  }, []);

  // core (100% offline)
  const kaiPulseEternal = useMemo(() => getKaiPulseEternal(now), [now, tick]);

  const today = useMemo(() => getKaiPulseToday(now), [now, tick]);
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
  const solarArcName = useMemo(() => getSolarArcName(now), [now, tick]);

  const counters = useMemo(() => getSolarAlignedCounters(now), [now, tick]);
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
    now,
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
