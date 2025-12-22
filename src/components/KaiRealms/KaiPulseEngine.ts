// /src/components/KaiRealms/KaiPulseEngine.ts
import { useEffect, useRef } from "react";
import { GENESIS_TS, PULSE_MS, kairosEpochNow } from "../../utils/kai_pulse";

type PulseCallbacks = {
  onPulse?: (pulseIndex: number) => void;
  onStep?: (stepIndex: number) => void;
  onBeat?: (beatIndex: number) => void;
};

type KaiState = {
  pulseIndex: number;
  stepIndex: number;
  beatIndex: number;
};

const hasWindow = typeof window !== "undefined";

// Kai lattice constants (integer)
const PULSES_PER_STEP = 11n;
const STEPS_PER_BEAT = 44n;
const BEATS_PER_DAY = 36n;

function computeKaiState(nowMs: bigint): KaiState {
  const genesis = BigInt(GENESIS_TS);
  const pulseMs = BigInt(PULSE_MS);

  const delta = nowMs > genesis ? nowMs - genesis : 0n;

  const pulseIndexBI = delta / pulseMs; // bigint
  const stepIndexBI = (pulseIndexBI / PULSES_PER_STEP) % STEPS_PER_BEAT;
  const beatIndexBI = (pulseIndexBI / (PULSES_PER_STEP * STEPS_PER_BEAT)) % BEATS_PER_DAY;

  return {
    pulseIndex: Number(pulseIndexBI),
    stepIndex: Number(stepIndexBI),
    beatIndex: Number(beatIndexBI),
  };
}

function nextPulseBoundaryMs(nowMs: bigint): bigint {
  const genesis = BigInt(GENESIS_TS);
  const pulseMs = BigInt(PULSE_MS);

  const delta = nowMs > genesis ? nowMs - genesis : 0n;
  const pulseIndex = delta / pulseMs;

  // next boundary = genesis + (pulseIndex + 1) * pulseMs
  return genesis + (pulseIndex + 1n) * pulseMs;
}

/**
 * React hook that fires on Kai pulse boundaries.
 * Deterministic scheduling: always targets the *next* pulse boundary.
 */
export function useKaiPulse(callbacks: PulseCallbacks): void {
  const lastPulseRef = useRef<number | null>(null);
  const cbRef = useRef<PulseCallbacks>(callbacks);

  // keep latest callbacks without rescheduling timers every render
  cbRef.current = callbacks;

  useEffect(() => {
    if (!hasWindow) return;

    let timer: number | null = null;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;

      const now = kairosEpochNow(); // bigint
      const { pulseIndex, stepIndex, beatIndex } = computeKaiState(now);

      if (pulseIndex !== lastPulseRef.current) {
        cbRef.current.onPulse?.(pulseIndex);

        if (pulseIndex % Number(PULSES_PER_STEP) === 0) {
          cbRef.current.onStep?.(stepIndex);
        }

        const beatModulo = Number(PULSES_PER_STEP * STEPS_PER_BEAT);
        if (pulseIndex % beatModulo === 0) {
          cbRef.current.onBeat?.(beatIndex);
        }

        lastPulseRef.current = pulseIndex;
      }

      const target = nextPulseBoundaryMs(now);
      const delayBI = target > now ? target - now : 0n;

      // delay is always < PULSE_MS (a few seconds) → safe conversion
      const delay = Number(delayBI);

      timer = window.setTimeout(tick, delay);
    };

    tick();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);
}
