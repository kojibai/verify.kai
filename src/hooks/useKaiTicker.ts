// src/hooks/useKaiTicker.ts
import { useEffect, useRef, useState } from "react";
import { msUntilNextSovereignPulse, sovereignPulseNow, PULSE_MS } from "../utils/sovereign_pulse";

const hasPerformance = typeof performance !== "undefined";

export function useKaiTicker() {
  const [pulse, setPulse] = useState<number | null>(null);
  const [msToNextPulse, setMsToNextPulse] = useState<number>(PULSE_MS);
  const lastPulseRef = useRef<number | null>(null);

  useEffect(() => {
    let intervalId: number | null = null;
    const update = () => {
      const current = sovereignPulseNow();
      if (lastPulseRef.current == null || current !== lastPulseRef.current) {
        lastPulseRef.current = current;
        setPulse(current);
        setMsToNextPulse(PULSE_MS);
        return;
      }
      const rem = msUntilNextSovereignPulse(current);
      setPulse(current);
      setMsToNextPulse(rem);
    };
    intervalId = window.setInterval(update, 50);
    update();
    return () => {
      if (intervalId != null) window.clearInterval(intervalId);
    };
  }, []);

  return { pulse, msToNextPulse };
}
