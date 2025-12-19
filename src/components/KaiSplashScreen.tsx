import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { matchPath, useLocation } from "react-router-dom";

type SplashPhase = "show" | "fade" | "hidden";

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia === "undefined") return undefined;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = (event: MediaQueryListEvent | MediaQueryList): void => {
      setPrefersReducedMotion(event.matches);
    };

    handleChange(mediaQuery);

    try {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    } catch {
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, []);

  return prefersReducedMotion;
}

export default function KaiSplashScreen(): React.JSX.Element | null {
  const location = useLocation();
  const prefersReducedMotion = usePrefersReducedMotion();

  const [phase, setPhase] = useState<SplashPhase>("show");
  const [mounted, setMounted] = useState<boolean>(true);

  const hasCompletedFirstPaint = useRef<boolean>(false);
  const exitTimerRef = useRef<number | null>(null);
  const fadeTimerRef = useRef<number | null>(null);
  const firstLoadRef = useRef<boolean>(true);
  const rafRef = useRef<number | null>(null);

  const fadeDurationMs = useMemo(() => (prefersReducedMotion ? 140 : 260), [prefersReducedMotion]);
  const navHoldMs = useMemo(() => (prefersReducedMotion ? 40 : 120), [prefersReducedMotion]);
  const initialFallbackMs = useMemo(() => (prefersReducedMotion ? 800 : 1200), [prefersReducedMotion]);

  const clearTimers = useCallback((): void => {
    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
    if (fadeTimerRef.current !== null) window.clearTimeout(fadeTimerRef.current);
    exitTimerRef.current = null;
    fadeTimerRef.current = null;
  }, []);

  const clearRaf = useCallback((): void => {
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const splashEnabled = useMemo(() => {
    const p = location.pathname;
    const allowed = [
      "/s",
      "/s/:hash",
      "/stream",
      "/stream/*",
      "/feed",
      "/feed/*",
      "/p~:token",
      "/p~:token/*",
      "/token",
      "/p~token",
      "/p",
      "/verify/*",
    ];

    const matchesRoute = allowed.some((pattern) => Boolean(matchPath({ path: pattern, end: false }, p)));
    return firstLoadRef.current || matchesRoute;
  }, [location.pathname]);

  const hideSplash = useCallback(
    (delayMs: number) => {
      clearTimers();
      exitTimerRef.current = window.setTimeout(() => {
        setPhase("fade");
        fadeTimerRef.current = window.setTimeout(() => {
          setPhase("hidden");
          setMounted(false);
          firstLoadRef.current = false;
        }, fadeDurationMs);
      }, Math.max(0, delayMs));
    },
    [clearTimers, fadeDurationMs],
  );

  const hideOnNextFrame = useCallback(
    (delayMs: number) => {
      clearRaf();
      if (typeof window === "undefined") return;
      rafRef.current = window.requestAnimationFrame(() => hideSplash(delayMs));
    },
    [clearRaf, hideSplash],
  );

  const showSplash = useCallback((): void => {
    clearTimers();
    clearRaf();
    setMounted(true);
    setPhase("show");
  }, [clearTimers, clearRaf]);

  useEffect(() => {
    if (splashEnabled) return undefined;
    clearTimers();
    clearRaf();
    setPhase("hidden");
    setMounted(false);
    return undefined;
  }, [clearRaf, clearTimers, splashEnabled]);

  useEffect(() => {
    if (!splashEnabled) return undefined;

    let readyTimer: number | null = null;

    const finishInitial = (): void => hideOnNextFrame(prefersReducedMotion ? 30 : 80);

    if (document.readyState === "complete" || document.readyState === "interactive") {
      readyTimer = window.setTimeout(finishInitial, prefersReducedMotion ? 30 : 60);
    } else {
      window.addEventListener("load", finishInitial, { once: true });
    }

    const fallbackTimer = window.setTimeout(() => hideSplash(0), initialFallbackMs);

    return () => {
      if (readyTimer !== null) window.clearTimeout(readyTimer);
      window.removeEventListener("load", finishInitial);
      window.clearTimeout(fallbackTimer);
      clearTimers();
      clearRaf();
    };
  }, [clearRaf, clearTimers, hideOnNextFrame, hideSplash, initialFallbackMs, prefersReducedMotion, splashEnabled]);

  useEffect(() => {
    if (!hasCompletedFirstPaint.current) {
      hasCompletedFirstPaint.current = true;
      return undefined;
    }

    showSplash();
    hideOnNextFrame(prefersReducedMotion ? 40 : navHoldMs);

    return () => {
      clearTimers();
      clearRaf();
    };
  }, [clearRaf, clearTimers, hideOnNextFrame, navHoldMs, prefersReducedMotion, showSplash, splashEnabled, location.pathname, location.search, location.hash]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  if (!mounted || !splashEnabled) return null;

  return createPortal(
    <div className="kai-splash" data-state={phase} aria-live="polite" role="status">
      <div className="kai-splash__grid" aria-hidden="true" />
      <div className="kai-splash__halo" aria-hidden="true" />
      <div className="kai-splash__glow" aria-hidden="true" />

      <div className="kai-splash__content" aria-hidden="true">
        <div className="kai-splash__badge">
          <div className="kai-splash__rays" />
          <div className="kai-splash__badge-core">
            <img src="/phi.svg" alt="" loading="eager" decoding="sync" />
            <span className="kai-splash__badge-orb" />
            <span className="kai-splash__badge-core-shine" />
          </div>
          <div className="kai-splash__ring" />
          <div className="kai-splash__ring kai-splash__ring--inner" />
          <div className="kai-splash__flare" />
        </div>
      </div>

      <span className="sr-only">Preparing Atlantean link…</span>
    </div>,
    document.body,
  );
}
