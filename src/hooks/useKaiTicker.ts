// src/hooks/useKaiTicker.ts
import { useEffect, useState } from "react";
import { ONE_PULSE_MICRO, PULSE_MS, subscribeKaiNow } from "../utils/kai_pulse";

export function useKaiTicker() {
  const [pulse, setPulse] = useState<number | null>(null);
  const [msToNextPulse, setMsToNextPulse] = useState<number>(PULSE_MS);

  useEffect(() => {
    const off = subscribeKaiNow(({ pulse: p, microInPulse }) => {
      const remainMicro = ONE_PULSE_MICRO - microInPulse;
      const remainMs = Math.max(
        0,
        Math.floor((Number(remainMicro) / Number(ONE_PULSE_MICRO)) * PULSE_MS)
      );
      setPulse(p);
      setMsToNextPulse(remainMs);
    });
    return off;
  }, []);

  return { pulse, msToNextPulse };
}
