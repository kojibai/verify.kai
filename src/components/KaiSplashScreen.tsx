import React, { useEffect, useLayoutEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { matchPath, useLocation } from "react-router-dom";

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
];

export default function KaiSplashScreen(): React.JSX.Element | null {
  const location = useLocation();

  const matchesSplashRoute = useMemo(
    () => SPLASH_ROUTES.some((pattern) => Boolean(matchPath({ path: pattern, end: false }, location.pathname))),
    [location.pathname],
  );

  useIsomorphicLayoutEffect(() => {
    if (!matchesSplashRoute) return undefined;
    if (typeof document === "undefined") return undefined;
    const body = document.body;
    const prevBg = body.style.backgroundColor;
    if (!prevBg) body.style.backgroundColor = "var(--bg-0, #040f24)";
    return () => {
      body.style.backgroundColor = prevBg;
    };
  }, [matchesSplashRoute]);

  if (!matchesSplashRoute || typeof document === "undefined") return null;

  return createPortal(
    <div className="kai-splash" data-state="show" aria-live="polite" role="status">
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
