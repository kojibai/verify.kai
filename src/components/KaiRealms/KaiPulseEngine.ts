// /src/components/KaiRealms/KaiPulseEngine.ts


import { useEffect, useRef } from 'react';
import { kairosEpochNow } from '../../utils/kai_pulse';

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

// Harmonic constants
const KAI_PULSE_MS = 5236;
const PULSES_PER_STEP = 11;
const STEPS_PER_BEAT = 44;

/**
 * Returns current Kai indices based on current timestamp.
 * Uses genesis Kai epoch to compute pulse, step, beat.
 */
function computeKaiState(now: number): KaiState {
  const genesisMs = 1715323541888; // 2024-05-10 06:45:41.888 UTC
  const deltaMs = now - genesisMs;

  const pulseIndex = Math.floor(deltaMs / KAI_PULSE_MS);
  const stepIndex = Math.floor(pulseIndex / PULSES_PER_STEP) % STEPS_PER_BEAT;
  const beatIndex = Math.floor(pulseIndex / (PULSES_PER_STEP * STEPS_PER_BEAT)) % 36;

  return { pulseIndex, stepIndex, beatIndex };
}

/**
 * React hook that calls registered callbacks on Kai pulse, step, and beat.
 * Internally uses `setInterval` every 5236 ms (1 Kai Pulse).
 */
export function useKaiPulse(callbacks: PulseCallbacks): void {
  const lastPulseRef = useRef<number | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = kairosEpochNow();
      const { pulseIndex, stepIndex, beatIndex } = computeKaiState(now);

      if (pulseIndex !== lastPulseRef.current) {
        callbacks.onPulse?.(pulseIndex);
        if (pulseIndex % PULSES_PER_STEP === 0) callbacks.onStep?.(stepIndex);
        if (pulseIndex % (PULSES_PER_STEP * STEPS_PER_BEAT) === 0) callbacks.onBeat?.(beatIndex);
        lastPulseRef.current = pulseIndex;
      }
    }, KAI_PULSE_MS);

    return () => clearInterval(interval);
  }, [callbacks]);
}
