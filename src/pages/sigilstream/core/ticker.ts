// src/pages/sigilstream/core/ticker.ts
"use client";

import { useEffect, useRef, useState } from "react";
import { useKaiTime } from "../../../hooks/useKaiTime";
import {
  computeLocalKaiFromMicroPulses,
  PULSE_MS,
  KAI_PULSE_SEC,
} from "./kai_time";
import { msUntilNextPulseBoundary } from "../../../utils/kai_pulse";
import type { LocalKai } from "./types";

/**
 * Returns seconds (float) until the next Kai pulse boundary, or null if inactive.
 * Uses a lightweight RAF loop so the countdown flows smoothly instead of stuttering
 * at 0. Resyncs on tab visibility change to avoid background drift.
 */
export function useKaiPulseCountdown(active: boolean): number | null {
  const [secsLeft, setSecsLeft] = useState<number | null>(active ? KAI_PULSE_SEC : null);
  const rafRef = useRef<number | null>(null);
  const { timeSource } = useKaiTime();

  useEffect(() => {
    if (!active) {
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      setSecsLeft(null);
      return;
    }

    const compute = () =>
      msUntilNextPulseBoundary(undefined, timeSource) / 1000;

    const tick = () => {
      setSecsLeft(compute());
      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);

    const onVis = () => {
      if (document.visibilityState === "visible") {
        setSecsLeft(compute());
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return secsLeft;
}

/**
 * μpulse-true Kai ticker.
 * - Schedules exactly at each pulse boundary using setTimeout(nextBoundary - now).
 * - Updates CSS vars on :root to phase-lock animations:
 *     --pulse-dur: PULSE_MS
 *     --pulse-offset: negative ms lag to align CSS timelines
 * - Reschedules on visibility change to stay in lockstep after backgrounding.
 */
export function useAlignedKaiTicker(): LocalKai {
  const { timeSource, msToNextPulse } = useKaiTime();
  const [kai, setKai] = useState<LocalKai>(() =>
    computeLocalKaiFromMicroPulses(timeSource.nowMicroPulses())
  );

  const setCssPhaseVars = (lagMs: number) => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.style.setProperty("--pulse-dur", `${PULSE_MS}ms`);
    // Negative delay causes CSS animations to appear already in-progress by `lag`
    root.style.setProperty("--pulse-offset", `-${Math.round(lagMs)}ms`);
  };

  useEffect(() => {
    // Keep CSS phase vars fresh (useful for pure-CSS progress)
    setCssPhaseVars(msToNextPulse);
    setKai(computeLocalKaiFromMicroPulses(timeSource.nowMicroPulses()));

    const onVis = () => {
      if (document.visibilityState === "visible") {
        setCssPhaseVars(msToNextPulse);
        setKai(computeLocalKaiFromMicroPulses(timeSource.nowMicroPulses()));
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [msToNextPulse, timeSource]);

  return kai;
}
