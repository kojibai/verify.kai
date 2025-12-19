// src/hooks/useBreathTicker.ts
// Ultra-stable φ-breath ticker with zero drift.
// Uses requestAnimationFrame when visible and falls back to an interval when hidden.

import { useCallback, useSyncExternalStore } from "react";
import { kaiPulseNowBridge, msUntilNextPulseBoundary } from "../utils/kai_pulse";

const BREATH_MS = Math.round((3 + Math.sqrt(5)) * 1000);

type Snapshot = {
  pulse: number | null;
  msToNext: number | null;
};

const IDLE_SNAPSHOT: Snapshot = { pulse: null, msToNext: null };

function monotonicNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.timeOrigin + performance.now();
  }
  return Date.now();
}

function createStore() {
  let snapshot: Snapshot = { pulse: 0, msToNext: BREATH_MS };
  const listeners = new Set<() => void>();

  let rafId: number | null = null;
  let intervalId: number | null = null;
  let visHooked = false;

  const compute = (): Snapshot => {
    const pulseFloat = kaiPulseNowBridge();
    const msToNext = msUntilNextPulseBoundary(pulseFloat);
    return {
      pulse: Math.floor(pulseFloat),
      msToNext: Math.max(0, Number.isFinite(msToNext) ? msToNext : BREATH_MS),
    };
  };

  const notify = () => {
    for (const fn of listeners) fn();
  };

  const syncSnapshot = () => {
    snapshot = compute();
    notify();
  };

  const rafTick = () => {
    syncSnapshot();
    rafId = window.requestAnimationFrame(rafTick);
  };

  const startRaf = () => {
    if (rafId !== null) return;
    rafId = window.requestAnimationFrame(rafTick);
  };

  const stopRaf = () => {
    if (rafId === null) return;
    window.cancelAnimationFrame(rafId);
    rafId = null;
  };

  const startInterval = () => {
    if (intervalId !== null) return;
    intervalId = window.setInterval(syncSnapshot, 200);
  };

  const stopInterval = () => {
    if (intervalId === null) return;
    window.clearInterval(intervalId);
    intervalId = null;
  };

  const onVisibility = () => {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "hidden") {
      stopRaf();
      startInterval();
    } else {
      stopInterval();
      syncSnapshot();
      startRaf();
    }
  };

  const attachVisibility = () => {
    if (visHooked || typeof document === "undefined") return;
    document.addEventListener("visibilitychange", onVisibility, { passive: true });
    visHooked = true;
  };

  const detachVisibility = () => {
    if (!visHooked || typeof document === "undefined") return;
    document.removeEventListener("visibilitychange", onVisibility);
    visHooked = false;
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);

    if (listeners.size === 1) {
      syncSnapshot();
      startRaf();
      attachVisibility();
    }

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        stopRaf();
        stopInterval();
        detachVisibility();
      }
    };
  };

  const getSnapshot = () => snapshot;
  const getServerSnapshot = () => ({ ...IDLE_SNAPSHOT });

  return { subscribe, getSnapshot, getServerSnapshot };
}

const store = createStore();

export function useBreathTicker(enabled = true): Snapshot & { sampledAt: number } {
  const subscribe = useCallback<Parameters<typeof useSyncExternalStore>[0]>(
    (listener) => (enabled ? store.subscribe(listener) : () => {}),
    [enabled]
  );

  const getSnapshot = useCallback(() => {
    if (!enabled) return { ...IDLE_SNAPSHOT, sampledAt: monotonicNow() };
    const snap = store.getSnapshot();
    return { ...snap, sampledAt: monotonicNow() };
  }, [enabled]);

  const getServerSnapshot = useCallback(
    () => ({ ...IDLE_SNAPSHOT, sampledAt: monotonicNow() }),
    []
  );

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
