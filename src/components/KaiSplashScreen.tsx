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
import "./KaiSplashScreen.css";

type SplashPhase = "show" | "fade" | "hidden";

type CSSVars = React.CSSProperties & Record<`--${string}`, string | number>;

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Standalone-only pages (NO HOME).
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
  "/p",
  "/verify",
  "/verify/*",
];

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia === "undefined") return undefined;

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent | MediaQueryList): void => {
      setPrefersReducedMotion(e.matches);
    };

    onChange(mq);

    try {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    } catch {
      mq.addListener(onChange);
      return () => mq.removeListener(onChange);
    }
  }, []);

  return prefersReducedMotion;
}

export default function KaiSplashScreen(): React.JSX.Element | null {
  const location = useLocation();
  const prefersReducedMotion = usePrefersReducedMotion();

  const isHome = location.pathname === "/" || location.pathname === "";

  const matchesStandaloneSplashRoute = useMemo(() => {
    if (isHome) return false;
    return SPLASH_ROUTES.some((pattern) =>
      Boolean(matchPath({ path: pattern, end: false }, location.pathname)),
    );
  }, [isHome, location.pathname]);

  // Show on FIRST LOAD only if the initial route is a standalone page.
  const [phase, setPhase] = useState<SplashPhase>(() =>
    matchesStandaloneSplashRoute ? "show" : "hidden",
  );

  const exitTimerRef = useRef<number | null>(null);
  const fadeTimerRef = useRef<number | null>(null);
  const navShowTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const hasCompletedFirstPaint = useRef<boolean>(false);
  const showStartedAtRef = useRef<number>(0);
  const prevPathnameRef = useRef<string>(location.pathname);

  const fadeDurationMs = useMemo(
    () => (prefersReducedMotion ? 140 : 280),
    [prefersReducedMotion],
  );
  const navHoldMs = useMemo(
    () => (prefersReducedMotion ? 220 : 460),
    [prefersReducedMotion],
  );
  const initialFallbackMs = useMemo(
    () => (prefersReducedMotion ? 850 : 1250),
    [prefersReducedMotion],
  );
  const minShowMs = useMemo(
    () => (prefersReducedMotion ? 160 : 260),
    [prefersReducedMotion],
  );
  const navShowDelayMs = useMemo(
    () => (prefersReducedMotion ? 60 : 120),
    [prefersReducedMotion],
  );

  // ✅ FIX: CSS custom property typing
  const styleVars = useMemo<CSSVars>(() => {
    return {
      "--kai-splash-fade": `${fadeDurationMs}ms`,
    };
  }, [fadeDurationMs]);

  const clearTimers = useCallback((): void => {
    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
    if (fadeTimerRef.current !== null) window.clearTimeout(fadeTimerRef.current);
    exitTimerRef.current = null;
    fadeTimerRef.current = null;
  }, []);

  const clearNavShowTimer = useCallback((): void => {
    if (navShowTimerRef.current !== null) window.clearTimeout(navShowTimerRef.current);
    navShowTimerRef.current = null;
  }, []);

  const clearRaf = useCallback((): void => {
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const beginHide = useCallback(
    (delayMs: number) => {
      clearTimers();
      clearNavShowTimer();

      exitTimerRef.current = window.setTimeout(() => {
        setPhase("fade");
        fadeTimerRef.current = window.setTimeout(() => {
          setPhase("hidden");
        }, fadeDurationMs);
      }, Math.max(0, delayMs));
    },
    [clearNavShowTimer, clearTimers, fadeDurationMs],
  );

  const beginHideNextFrame = useCallback(
    (delayMs: number) => {
      clearRaf();
      rafRef.current = window.requestAnimationFrame(() => beginHide(delayMs));
    },
    [beginHide, clearRaf],
  );

  const showNow = useCallback((): void => {
    clearTimers();
    clearRaf();
    clearNavShowTimer();
    showStartedAtRef.current = performance.now();
    setPhase("show");

    // If a critical boot splash exists, fade it immediately (no double-splash).
    const boot = document.getElementById("kai-boot-splash");
    if (boot) boot.setAttribute("data-state", "fade");
  }, [clearNavShowTimer, clearRaf, clearTimers]);

  // Lock background behind splash (prevents any flash-through on some browsers)
  useIsomorphicLayoutEffect(() => {
    if (typeof document === "undefined") return undefined;
    const html = document.documentElement;
    const body = document.body;

    const prevHtmlBg = html.style.backgroundColor;
    const prevBodyBg = body.style.backgroundColor;

    html.style.backgroundColor = "var(--bg-0, #040f24)";
    body.style.backgroundColor = "var(--bg-0, #040f24)";

    return () => {
      html.style.backgroundColor = prevHtmlBg;
      body.style.backgroundColor = prevBodyBg;
    };
  }, []);

  // INITIAL load logic (only if current route is standalone)
  useEffect(() => {
    if (phase !== "show") return undefined;
    if (!matchesStandaloneSplashRoute) return undefined;

    let readyTimer: number | null = null;

    const finish = (): void => {
      const elapsed = performance.now() - showStartedAtRef.current;
      const remaining = Math.max(0, minShowMs - elapsed);
      beginHideNextFrame(remaining);
    };

    if (document.readyState === "complete" || document.readyState === "interactive") {
      readyTimer = window.setTimeout(finish, prefersReducedMotion ? 20 : 50);
    } else {
      window.addEventListener("load", finish, { once: true });
    }

    const fallbackTimer = window.setTimeout(() => beginHide(0), initialFallbackMs);

    return () => {
      if (readyTimer !== null) window.clearTimeout(readyTimer);
      window.removeEventListener("load", finish);
      window.clearTimeout(fallbackTimer);
      clearTimers();
      clearNavShowTimer();
      clearRaf();
    };
  }, [
    beginHide,
    beginHideNextFrame,
    clearNavShowTimer,
    clearRaf,
    clearTimers,
    initialFallbackMs,
    matchesStandaloneSplashRoute,
    minShowMs,
    phase,
    prefersReducedMotion,
  ]);

  // NAV splashes: only when PATHNAME changes (NOT search/hash), and only for standalone pages.
  useEffect(() => {
    if (!hasCompletedFirstPaint.current) {
      hasCompletedFirstPaint.current = true;
      prevPathnameRef.current = location.pathname;
      return undefined;
    }

    const prevPath = prevPathnameRef.current;
    const nextPath = location.pathname;
    prevPathnameRef.current = nextPath;

    if (prevPath === nextPath) return undefined;
    if (!matchesStandaloneSplashRoute) return undefined;

    navShowTimerRef.current = window.setTimeout(() => {
      showNow();
      beginHideNextFrame(navHoldMs);
    }, navShowDelayMs);

    return () => {
      clearNavShowTimer();
      clearTimers();
      clearRaf();
    };
  }, [
    beginHideNextFrame,
    clearNavShowTimer,
    clearRaf,
    clearTimers,
    location.pathname,
    matchesStandaloneSplashRoute,
    navHoldMs,
    navShowDelayMs,
    showNow,
  ]);

  // Cleanup on unmount
  useEffect(
    () => () => {
      clearTimers();
      clearNavShowTimer();
      clearRaf();
    },
    [clearNavShowTimer, clearRaf, clearTimers],
  );

  if (phase === "hidden") return null;

  return createPortal(
    <div
      className="kai-splash"
      data-state={phase}
      data-reduced-motion={prefersReducedMotion ? "1" : "0"}
      aria-live="polite"
      role="status"
      style={styleVars}
    >
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

      <span className="kai-sr-only">Preparing Atlantean link…</span>
    </div>,
    document.body,
  );
}
