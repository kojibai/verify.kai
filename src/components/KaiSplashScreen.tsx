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

  const fadeDurationMs = useMemo(() => (prefersReducedMotion ? 180 : 420), [prefersReducedMotion]);
  const navHoldMs = useMemo(() => (prefersReducedMotion ? 180 : 520), [prefersReducedMotion]);
  const initialFallbackMs = useMemo(() => (prefersReducedMotion ? 840 : 1500), [prefersReducedMotion]);

  const clearTimers = useCallback((): void => {
    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
    if (fadeTimerRef.current !== null) window.clearTimeout(fadeTimerRef.current);
    exitTimerRef.current = null;
    fadeTimerRef.current = null;
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

    return allowed.some((pattern) => Boolean(matchPath({ path: pattern, end: false }, p)));
  }, [location.pathname]);

  const hideSplash = useCallback(
    (delayMs: number) => {
      clearTimers();
      exitTimerRef.current = window.setTimeout(() => {
        setPhase("fade");
        fadeTimerRef.current = window.setTimeout(() => {
          setPhase("hidden");
          setMounted(false);
        }, fadeDurationMs);
      }, Math.max(0, delayMs));
    },
    [clearTimers, fadeDurationMs],
  );

  const showSplash = useCallback((): void => {
    clearTimers();
    setMounted(true);
    setPhase("show");
  }, [clearTimers]);

  useEffect(() => {
    if (splashEnabled) return undefined;
    clearTimers();
    setPhase("hidden");
    setMounted(false);
    return undefined;
  }, [clearTimers, splashEnabled]);

  useEffect(() => {
    if (!splashEnabled) return undefined;

    let readyTimer: number | null = null;

    const finishInitial = (): void => hideSplash(prefersReducedMotion ? 60 : 180);

    if (document.readyState === "complete" || document.readyState === "interactive") {
      readyTimer = window.setTimeout(finishInitial, prefersReducedMotion ? 60 : 180);
    } else {
      window.addEventListener("load", finishInitial, { once: true });
    }

    const fallbackTimer = window.setTimeout(() => hideSplash(0), initialFallbackMs);

    return () => {
      if (readyTimer !== null) window.clearTimeout(readyTimer);
      window.removeEventListener("load", finishInitial);
      window.clearTimeout(fallbackTimer);
      clearTimers();
    };
  }, [clearTimers, hideSplash, initialFallbackMs, prefersReducedMotion, splashEnabled]);

  useEffect(() => {
    if (!hasCompletedFirstPaint.current) {
      hasCompletedFirstPaint.current = true;
      return undefined;
    }

    showSplash();
    const navTimer = window.setTimeout(() => hideSplash(prefersReducedMotion ? 80 : 220), navHoldMs);

    return () => {
      window.clearTimeout(navTimer);
      clearTimers();
    };
  }, [clearTimers, hideSplash, navHoldMs, prefersReducedMotion, showSplash, splashEnabled, location.pathname, location.search, location.hash]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  if (!mounted || !splashEnabled) return null;

  return createPortal(
    <div className="kai-splash" data-state={phase} aria-live="polite" role="status">
      <div className="kai-splash__grid" aria-hidden="true" />
      <div className="kai-splash__halo" aria-hidden="true" />
      <div className="kai-splash__glow" aria-hidden="true" />

      <div className="kai-splash__content">
        <div className="kai-splash__badge" aria-hidden="true">
          <div className="kai-splash__rays" />
          <div className="kai-splash__badge-core">
            <img src="/phi.svg" alt="Phi sigil" loading="eager" decoding="sync" />
            <span className="kai-splash__badge-orb" />
          </div>
          <div className="kai-splash__ring" />
        </div>

        <div className="kai-splash__text">
          <div className="kai-splash__eyebrow">Atlantean Gate • Live</div>
          <div className="kai-splash__title">ΦNet Sovereign Link</div>
          <div className="kai-splash__subtitle">Preparing memory tides &amp; sigil stream…</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
