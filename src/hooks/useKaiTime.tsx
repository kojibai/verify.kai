// src/hooks/useKaiTime.tsx
import {
  PULSE_MS,
  kaiPulseNowBridge,
  getKaiTimeSource,
  msUntilNextPulseBoundary,
  KaiTimeSource,
  type KaiTimeSourceOptions,
} from "../utils/kai_pulse";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

type KaiTimeContextValue = {
  timeSource: KaiTimeSource;
  pulse: number;
  pulseFloat: number;
  msToNextPulse: number;
};

const KaiTimeContext = createContext<KaiTimeContextValue | null>(null);

const snapshot = (source: KaiTimeSource): KaiTimeContextValue => {
  const pulseFloat = kaiPulseNowBridge(source);
  return {
    timeSource: source,
    pulse: Math.floor(pulseFloat),
    pulseFloat,
    msToNextPulse: msUntilNextPulseBoundary(pulseFloat, source),
  };
};

export function KaiTimeProvider({
  children,
  options,
  timeSource,
}: PropsWithChildren<{
  options?: KaiTimeSourceOptions;
  timeSource?: KaiTimeSource;
}>): JSX.Element {
  const source = useMemo(
    () => timeSource ?? (options ? new KaiTimeSource(options) : getKaiTimeSource()),
    [options, timeSource],
  );

  const [value, setValue] = useState<KaiTimeContextValue>(() => snapshot(source));

  useEffect(() => {
    let timeout: number | null = null;

    const schedule = () => {
      const next = snapshot(source);
      setValue(next);

      const delay = Math.max(8, Math.min(PULSE_MS, next.msToNextPulse));
      timeout = window.setTimeout(schedule, delay);
    };

    schedule();

    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      if (timeout !== null) window.clearTimeout(timeout);
      schedule();
    };

    document.addEventListener("visibilitychange", onVis);

    return () => {
      if (timeout !== null) window.clearTimeout(timeout);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [source]);

  return <KaiTimeContext.Provider value={value}>{children}</KaiTimeContext.Provider>;
}

/**
 * Subscribe to the shared KaiTimeSource. If no provider is present, falls back
 * to the global KaiTimeSource seeded at module load for deterministic behavior.
 */
export function useKaiTime(): KaiTimeContextValue {
  const ctx = useContext(KaiTimeContext);

  const fallbackSource = useMemo(() => getKaiTimeSource(), []);
  const [localTick, setLocalTick] = useState<KaiTimeContextValue>(() => snapshot(fallbackSource));

  useEffect(() => {
    if (ctx) return;

    let raf: number | null = null;
    const tick = () => {
      setLocalTick(snapshot(fallbackSource));
      raf = window.requestAnimationFrame(tick);
    };

    raf = window.requestAnimationFrame(tick);
    return () => { if (raf !== null) cancelAnimationFrame(raf); };
  }, [ctx, fallbackSource]);

  return ctx ?? localTick;
}
