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
import SigilFeedPage from "../pages/SigilFeedPage";
import SigilPage from "../pages/SigilPage/SigilPage";
import PShort from "../pages/PShort";
import VerifyPage from "../pages/VerifyPage";
import VerifierStamper from "../components/VerifierStamper/VerifierStamper";

const PREFETCH_LAZY_ROUTES: Array<() => Promise<unknown>> = [];

function RouteLoader(): React.JSX.Element {
  return (
    <div className="route-loader" role="status" aria-live="polite">
      <div className="route-loader__glow" />
      <div className="route-loader__content">
        <div className="route-loader__dot" aria-hidden="true" />
        <div className="route-loader__text"> MEMORY REMEMBERS...</div>
      </div>
    </div>
  );
}

function withSuspense(
  node: React.ReactElement,
  fallback: React.ReactNode = null,
): React.JSX.Element {
  return <Suspense fallback={fallback}>{node}</Suspense>;
}

export default function AppRouter(): React.JSX.Element {
  useEffect(() => {
    if (!PREFETCH_LAZY_ROUTES.length) return undefined;
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
        <Route path="s" element={withSuspense(<SigilPage />, <RouteLoader />)} />
        <Route path="s/:hash" element={withSuspense(<SigilPage />, <RouteLoader />)} />

        <Route path="stream" element={withSuspense(<SigilFeedPage />, <RouteLoader />)} />
        <Route
          path="stream/p/:token"
          element={withSuspense(<SigilFeedPage />, <RouteLoader />)}
        />
        <Route
          path="stream/c/:token"
          element={withSuspense(<SigilFeedPage />, <RouteLoader />)}
        />
        <Route path="feed" element={withSuspense(<SigilFeedPage />, <RouteLoader />)} />
        <Route
          path="feed/p/:token"
          element={withSuspense(<SigilFeedPage />, <RouteLoader />)}
        />
        <Route path="p~:token" element={withSuspense(<SigilFeedPage />, <RouteLoader />)} />
        <Route path="p~:token/*" element={<PShort />} />
        <Route path="token" element={withSuspense(<SigilFeedPage />, <RouteLoader />)} />
        <Route path="p~token" element={withSuspense(<SigilFeedPage />, <RouteLoader />)} />
        <Route path="p" element={<PShort />} />
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
