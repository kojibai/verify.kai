// src/hooks/useKaiTicker.ts
import { useEffect, useRef, useState } from "react";
import { PULSE_MS, computeKaiLocally, kairosEpochNow } from "../utils/kai_pulse";

export function useKaiTicker() {
  const [pulse, setPulse] = useState<number | null>(null);
  const [msToNextPulse, setMsToNextPulse] = useState<number>(PULSE_MS);
  const lastPulseAtRef = useRef<number | null>(null);
  const lastPulseRef = useRef<number | null>(null);

  useEffect(() => {
    let intervalId: number | null = null;
    const update = () => {
      const calc = computeKaiLocally();
      const now = kairosEpochNow();
      if (lastPulseRef.current == null || calc.pulse !== lastPulseRef.current) {
        lastPulseRef.current = calc.pulse;
        lastPulseAtRef.current = now;
        setPulse(calc.pulse);
        setMsToNextPulse(PULSE_MS);
      } else {
        const lastAt = lastPulseAtRef.current;
        const rem = lastAt == null ? PULSE_MS : Math.max(0, PULSE_MS - (now - lastAt));
        setPulse(calc.pulse);
        setMsToNextPulse(rem);
      }
    };
    intervalId = window.setInterval(update, 50);
    update();
    return () => {
      if (intervalId != null) window.clearInterval(intervalId);
    };
  }, []);

  return { pulse, msToNextPulse };
}
