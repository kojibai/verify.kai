import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { matchPath, useLocation } from "react-router-dom";

type SplashPhase = "show" | "fade" | "hidden";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const SPLASH_ROUTES: readonly string[] = [
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
  const [isFirstLoad, setIsFirstLoad] = useState<boolean>(true);

  const hasCompletedFirstPaint = useRef<boolean>(false);
  const exitTimerRef = useRef<number | null>(null);
  const fadeTimerRef = useRef<number | null>(null);
  const navShowTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const fadeDurationMs = useMemo(() => (prefersReducedMotion ? 140 : 260), [prefersReducedMotion]);
  const navHoldMs = useMemo(() => (prefersReducedMotion ? 220 : 420), [prefersReducedMotion]);
  const initialFallbackMs = useMemo(() => (prefersReducedMotion ? 800 : 1200), [prefersReducedMotion]);
  const navShowDelayMs = useMemo(() => (prefersReducedMotion ? 70 : 120), [prefersReducedMotion]);

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

  const clearNavShowTimer = useCallback((): void => {
    if (navShowTimerRef.current !== null) window.clearTimeout(navShowTimerRef.current);
    navShowTimerRef.current = null;
  }, []);

  const matchesSplashRoute = useMemo(
    () => SPLASH_ROUTES.some((pattern) => Boolean(matchPath({ path: pattern, end: false }, location.pathname))),
    [location.pathname],
  );

  const splashEnabled = useMemo(
    () => isFirstLoad || matchesSplashRoute,
    [isFirstLoad, matchesSplashRoute],
  );

  const hideSplash = useCallback(
    (delayMs: number) => {
      clearTimers();
      clearNavShowTimer();
      exitTimerRef.current = window.setTimeout(() => {
        setPhase("fade");
        fadeTimerRef.current = window.setTimeout(() => {
          setPhase("hidden");
          setIsFirstLoad(false);
        }, fadeDurationMs);
      }, Math.max(0, delayMs));
    },
    [clearNavShowTimer, clearTimers, fadeDurationMs],
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
    clearNavShowTimer();
    setMounted(true);
    setPhase("show");
  }, [clearNavShowTimer, clearRaf, clearTimers]);

  useIsomorphicLayoutEffect(() => {
    if (typeof document === "undefined") return undefined;
    const body = document.body;
    const prevBg = body.style.backgroundColor;
    if (!prevBg) body.style.backgroundColor = "var(--bg-0, #040f24)";
    return () => {
      body.style.backgroundColor = prevBg;
    };
  }, []);

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
      clearNavShowTimer();
      clearRaf();
    };
  }, [
    clearNavShowTimer,
    clearRaf,
    clearTimers,
    hideOnNextFrame,
    hideSplash,
    initialFallbackMs,
    prefersReducedMotion,
    splashEnabled,
  ]);

  useEffect(() => {
    if (!hasCompletedFirstPaint.current) {
      hasCompletedFirstPaint.current = true;
      return undefined;
    }

    if (!matchesSplashRoute) return undefined;

    navShowTimerRef.current = window.setTimeout(() => {
      showSplash();
      hideOnNextFrame(prefersReducedMotion ? 60 : navHoldMs);
    }, navShowDelayMs);

    return () => {
      clearNavShowTimer();
      clearTimers();
      clearRaf();
    };
  }, [
    clearNavShowTimer,
    clearRaf,
    clearTimers,
    hideOnNextFrame,
    matchesSplashRoute,
    navHoldMs,
    navShowDelayMs,
    prefersReducedMotion,
    showSplash,
    location.pathname,
    location.search,
    location.hash,
  ]);

  useEffect(
    () => () => {
      clearTimers();
      clearNavShowTimer();
      clearRaf();
    },
    [clearNavShowTimer, clearRaf, clearTimers],
  );

  if (!mounted) return null;

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
