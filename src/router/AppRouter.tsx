import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import SigilFeedPage from "../pages/SigilFeedPage";
import SigilPage from "../pages/SigilPage/SigilPage";
import PShort from "../pages/PShort";
import VerifyPage from "../pages/VerifyPage";
import {
  AppChrome,
  ExplorerRoute,
  KaiVohRoute,
  KlockRoute,
  NotFound,
  SigilMintRoute,
} from "../App";
import VerifierStamper from "../components/VerifierStamper/VerifierStamper";
import KaiSplashScreen from "../components/KaiSplashScreen";

export default function AppRouter(): React.JSX.Element {
  return (
    <BrowserRouter>
      <KaiSplashScreen />
      <Routes>
        <Route path="s" element={<SigilPage />} />
        <Route path="s/:hash" element={<SigilPage />} />

        <Route path="stream" element={<SigilFeedPage />} />
        <Route path="stream/p/:token" element={<SigilFeedPage />} />
        <Route path="stream/c/:token" element={<SigilFeedPage />} />
        <Route path="feed" element={<SigilFeedPage />} />
        <Route path="feed/p/:token" element={<SigilFeedPage />} />
        <Route path="p~:token" element={<SigilFeedPage />} />
        <Route path="p~:token/*" element={<PShort />} />
        <Route path="token" element={<SigilFeedPage />} />
        <Route path="p~token" element={<SigilFeedPage />} />
        <Route path="p" element={<PShort />} />
        <Route path="verify/*" element={<VerifyPage />} />

        <Route element={<AppChrome />}>
          <Route index element={<VerifierStamper />} />
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
