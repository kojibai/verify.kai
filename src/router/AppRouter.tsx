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

const SigilFeedPage = React.lazy(() => import("../pages/SigilFeedPage"));
const SigilPage = React.lazy(() => import("../pages/SigilPage/SigilPage"));
const PShort = React.lazy(() => import("../pages/PShort"));
const VerifyPage = React.lazy(() => import("../pages/VerifyPage"));
const VerifierStamper = React.lazy(
  () => import("../components/VerifierStamper/VerifierStamper"),
);

const PREFETCH_LAZY_ROUTES: Array<() => Promise<unknown>> = [
  () => import("../pages/SigilFeedPage"),
  () => import("../pages/SigilPage/SigilPage"),
  () => import("../pages/PShort"),
  () => import("../pages/VerifyPage"),
  () => import("../components/VerifierStamper/VerifierStamper"),
];

function RouteLoader(): React.JSX.Element {
  return (
    <div className="route-loader" role="status" aria-live="polite">
      <div className="route-loader__glow" />
      <div className="route-loader__content">
        <div className="route-loader__dot" aria-hidden="true" />
        <div className="route-loader__text"> BREATH REMEMBERS...</div>
      </div>
    </div>
  );
}

function withSuspense(node: React.ReactElement): React.JSX.Element {
  return <Suspense fallback={<RouteLoader />}>{node}</Suspense>;
}

export default function AppRouter(): React.JSX.Element {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const idleWin = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    const warmLazyBundles = (): void => {
      PREFETCH_LAZY_ROUTES.forEach((prefetch) => {
        prefetch().catch(() => {
          /* non-blocking */
        });
      });
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
      <KaiSplashScreen />
      <Routes>
        <Route path="s" element={withSuspense(<SigilPage />)} />
        <Route path="s/:hash" element={withSuspense(<SigilPage />)} />

        <Route path="stream" element={withSuspense(<SigilFeedPage />)} />
        <Route path="stream/p/:token" element={withSuspense(<SigilFeedPage />)} />
        <Route path="stream/c/:token" element={withSuspense(<SigilFeedPage />)} />
        <Route path="feed" element={withSuspense(<SigilFeedPage />)} />
        <Route path="feed/p/:token" element={withSuspense(<SigilFeedPage />)} />
        <Route path="p~:token" element={withSuspense(<SigilFeedPage />)} />
        <Route path="p~:token/*" element={withSuspense(<PShort />)} />
        <Route path="token" element={withSuspense(<SigilFeedPage />)} />
        <Route path="p~token" element={withSuspense(<SigilFeedPage />)} />
        <Route path="p" element={withSuspense(<PShort />)} />
        <Route path="verify/*" element={withSuspense(<VerifyPage />)} />

        <Route element={<AppChrome />}>
          <Route index element={withSuspense(<VerifierStamper />)} />
          <Route path="mint" element={<SigilMintRoute />} />
          <Route path="voh" element={<KaiVohRoute />} />
          <Route path="explorer" element={<ExplorerRoute />} />
          <Route path="keystream" element={<ExplorerRoute />} />
          <Route path="klock" element={<KlockRoute />} />
          <Route path="klok" element={<KlockRoute />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
