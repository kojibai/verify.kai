// src/pages/sigilstream/core/ticker.ts
"use client";

import { useEffect, useRef, useState } from "react";
import { kaiNowDate, kaiNowMs } from "../../../utils/kaiNow";
import { computeLocalKai, GENESIS_TS, PULSE_MS, KAI_PULSE_SEC } from "./kai_time";
import type { LocalKai } from "./types";

/**
 * Returns seconds (float) until the next Kai pulse boundary, or null if inactive.
 * Uses a lightweight RAF loop so the countdown flows smoothly instead of stuttering
 * at 0. Resyncs on tab visibility change to avoid background drift.
 */
export function useKaiPulseCountdown(active: boolean): number | null {
  const [secsLeft, setSecsLeft] = useState<number | null>(active ? KAI_PULSE_SEC : null);
  const rafRef = useRef<number | null>(null);
  const targetRef = useRef<number | null>(null);

  const scheduleNextBoundary = () => {
    const now = kaiNowMs();
    const periods = Math.ceil((now - GENESIS_TS) / PULSE_MS);
    targetRef.current = GENESIS_TS + periods * PULSE_MS;
  };

  useEffect(() => {
    if (!active) {
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      targetRef.current = null;
      setSecsLeft(null);
      return;
    }

    scheduleNextBoundary();

    const tick = () => {
      const target = targetRef.current;
      if (target == null) {
        setSecsLeft(null);
      } else {
        const now = kaiNowMs();

        // If we crossed the boundary, immediately align to the next one instead of sitting at 0.
        if (now >= target) {
          scheduleNextBoundary();
          setSecsLeft(0);
        } else {
          setSecsLeft((target - now) / 1000);
        }
      }

      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);

    const onVis = () => {
      if (document.visibilityState === "visible") scheduleNextBoundary();
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
  const [kai, setKai] = useState<LocalKai>(() => computeLocalKai(kaiNowDate()));
  const timerRef = useRef<number | null>(null);

  const setCssPhaseVars = () => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const now = kaiNowMs();
    const lag = (PULSE_MS - ((now - GENESIS_TS) % PULSE_MS)) % PULSE_MS; // ms until boundary
    root.style.setProperty("--pulse-dur", `${PULSE_MS}ms`);
    // Negative delay causes CSS animations to appear already in-progress by `lag`
    root.style.setProperty("--pulse-offset", `-${Math.round(lag)}ms`);
  };

  const schedule = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);

    const now = kaiNowMs();
    const elapsed = now - GENESIS_TS;
    const next = GENESIS_TS + Math.ceil(elapsed / PULSE_MS) * PULSE_MS;
    const delay = Math.max(0, next - now);

    // Keep CSS phase vars fresh (useful for pure-CSS progress)
    setCssPhaseVars();

    timerRef.current = window.setTimeout(() => {
      // Update state exactly at boundary, then immediately schedule the next one
      setKai(computeLocalKai(kaiNowDate()));
      schedule();
    }, delay) as unknown as number;
  };

  useEffect(() => {
    schedule();

    const onVis = () => {
      if (document.visibilityState === "visible") {
        // Recompute immediately and reschedule to avoid any drift after background throttling.
        setKai(computeLocalKai(kaiNowDate()));
        schedule();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return kai;
}
