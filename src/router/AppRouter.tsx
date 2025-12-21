import React, { Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import {
  AppChrome,
  ExplorerRoute,
  KaiVohRoute,
  KlockRoute,
  NotFound,
  SigilMintRoute,
} from "../App";
import KaiSplashScreen from "../components/KaiSplashScreen";

// Standalone pages stay lazy (RouteLoader allowed here)
const SigilFeedPage = React.lazy(() => import("../pages/SigilFeedPage"));
const SigilPage = React.lazy(() => import("../pages/SigilPage/SigilPage"));
const PShort = React.lazy(() => import("../pages/PShort"));
const VerifyPage = React.lazy(() => import("../pages/VerifyPage"));

// ✅ HOME MUST BE INSTANT → eager import (no Suspense fallback)
import VerifierStamper from "../components/VerifierStamper/VerifierStamper";

const PREFETCH_LAZY_ROUTES: ReadonlyArray<() => Promise<unknown>> = [
  () => import("../pages/SigilFeedPage"),
  () => import("../pages/SigilPage/SigilPage"),
  () => import("../pages/PShort"),
  () => import("../pages/VerifyPage"),
];

function RouteLoader(): React.JSX.Element {
return (
  <div
    className="route-loader"
    role="status"
    aria-live="polite"
    aria-label="Loading"
  >
    <div className="route-loader__bg" aria-hidden="true" />
    <div className="route-loader__grid" aria-hidden="true" />
    <div className="route-loader__halo" aria-hidden="true" />

    <div className="route-loader__stage">
      <div className="route-loader__orb" aria-hidden="true">
        <div className="route-loader__orb-ring route-loader__orb-ring--a" />
        <div className="route-loader__orb-ring route-loader__orb-ring--b" />
        <div className="route-loader__orb-ring route-loader__orb-ring--c" />

        <div className="route-loader__orb-core" />

        <span className="route-loader__spark route-loader__spark--a" />
        <span className="route-loader__spark route-loader__spark--b" />
      </div>

      <div className="route-loader__content">
        <div className="route-loader__content-inner">
          <div className="route-loader__dot" aria-hidden="true" />
          <div className="route-loader__text">BREATH REMEMBERS</div>
          <div className="route-loader__sub">Aligning…</div>
        </div>
      </div>
    </div>
  </div>
);
}

function withStandaloneSuspense(node: React.ReactElement): React.JSX.Element {
  return <Suspense fallback={<RouteLoader />}>{node}</Suspense>;
}

// AppChrome routes: NEVER show the RouteLoader (home must be instant)
function withChromeSuspense(node: React.ReactElement): React.JSX.Element {
  return <Suspense fallback={null}>{node}</Suspense>;
}

export default function AppRouter(): React.JSX.Element {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const idleWin = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    const warmLazyBundles = (): void => {
      for (const prefetch of PREFETCH_LAZY_ROUTES) {
        prefetch().catch(() => {
          /* non-blocking */
        });
      }
    };

    const idleHandle =
      typeof idleWin.requestIdleCallback === "function"
        ? idleWin.requestIdleCallback(warmLazyBundles, { timeout: 1000 })
        : window.setTimeout(warmLazyBundles, 380);

    return () => {
      if (typeof idleWin.cancelIdleCallback === "function") {
        idleWin.cancelIdleCallback(idleHandle as number);
      } else {
        window.clearTimeout(idleHandle as number);
      }
    };
  }, []);

  return (
    <BrowserRouter>
      {/* stays allowed; your App.tsx already hard-kills splash on "/" */}
      <KaiSplashScreen />

      <Routes>
        {/* ───────────── Standalone routes (RouteLoader is allowed here) ───────────── */}
        <Route path="s" element={withStandaloneSuspense(<SigilPage />)} />
        <Route path="s/:hash" element={withStandaloneSuspense(<SigilPage />)} />

        <Route path="stream" element={withStandaloneSuspense(<SigilFeedPage />)} />
        <Route path="stream/p/:token" element={withStandaloneSuspense(<SigilFeedPage />)} />
        <Route path="stream/c/:token" element={withStandaloneSuspense(<SigilFeedPage />)} />
        <Route path="feed" element={withStandaloneSuspense(<SigilFeedPage />)} />
        <Route path="feed/p/:token" element={withStandaloneSuspense(<SigilFeedPage />)} />

        <Route path="p~:token" element={withStandaloneSuspense(<SigilFeedPage />)} />
        <Route path="p~:token/*" element={withStandaloneSuspense(<PShort />)} />

        <Route path="token" element={withStandaloneSuspense(<SigilFeedPage />)} />
        <Route path="p~token" element={withStandaloneSuspense(<SigilFeedPage />)} />
        <Route path="p" element={withStandaloneSuspense(<PShort />)} />

        <Route path="verify/*" element={withStandaloneSuspense(<VerifyPage />)} />

        {/* ───────────── App shell routes (NO RouteLoader, home = instant) ───────────── */}
        <Route element={<AppChrome />}>
          <Route index element={<VerifierStamper />} />
          <Route path="mint" element={<SigilMintRoute />} />
          <Route path="voh" element={<KaiVohRoute />} />
          <Route path="explorer" element={<ExplorerRoute />} />
          <Route path="keystream" element={<ExplorerRoute />} />
          <Route path="klock" element={<KlockRoute />} />
          <Route path="klok" element={<KlockRoute />} />
          <Route path="*" element={withChromeSuspense(<NotFound />)} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
