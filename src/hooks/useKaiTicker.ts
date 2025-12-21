// src/hooks/useKaiTicker.ts
import { useMemo } from "react";
import { useKaiTime } from "./useKaiTime";

export function useKaiTicker() {
  const { pulse, msToNextPulse } = useKaiTime();
  const safePulse = useMemo(
    () => (Number.isFinite(pulse) ? pulse : null),
    [pulse],
  );

  return { pulse: safePulse, msToNextPulse };
}
