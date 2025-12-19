import React from "react";
import ReactDOM from "react-dom/client";

// ✅ CSS FIRST (so App.css can be the final authority)
import "./styles.css";
import "./App.css";

import AppRouter from "./router/AppRouter";

const isProduction = import.meta.env.MODE === "production";
const APP_VERSION = import.meta.env.VITE_APP_VERSION || "dev";
const SW_VERSION_EVENT = "kairos:sw-version";

declare global {
  interface Window {
    kairosSwVersion?: string;
  }
}

function rewriteLegacyHash(): void {
  const h = window.location.hash || "";
  if (!h.startsWith("#/")) return;

  const frag = h.slice(1); // "/stream/p/ABC123?add=...."
  const qMark = frag.indexOf("?");
  const path = (qMark === -1 ? frag : frag.slice(0, qMark)) || "/";
  const query = qMark === -1 ? "" : frag.slice(qMark + 1);

  if (!path.startsWith("/stream/p/")) return;

  const qs = new URLSearchParams(query);
  const add = qs.get("add") || "";
  qs.delete("add");
  const search = qs.toString();

  const newUrl =
    `${path}${search ? `?${search}` : ""}` +
    `${add ? `#add=${add}` : ""}`;

  window.history.replaceState(null, "", newUrl);
}

if (isProduction) {
  window.addEventListener("DOMContentLoaded", rewriteLegacyHash, { once: true });
}


ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppRouter />
  </React.StrictMode>
);

// ✅ Register Kairos Service Worker with instant-upgrade behavior
if ("serviceWorker" in navigator && isProduction) {
  const registerKairosSW = async () => {
    try {
      const reg = await navigator.serviceWorker.register(`/sw.js?v=${APP_VERSION}`, { scope: "/" });

      // Auto-skip waiting once the new worker finishes installing (no forced reload)
      const triggerSkipWaiting = (worker: ServiceWorker | null) => {
        worker?.postMessage({ type: "SKIP_WAITING" });
      };

      const watchForUpdates = (registration: ServiceWorkerRegistration) => {
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              triggerSkipWaiting(newWorker);
            }
          });
        });
      };

      watchForUpdates(reg);

      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data?.type === "SW_ACTIVATED") {
          console.log("Kairos service worker active", event.data.version);
          if (typeof event.data.version === "string") {
            window.kairosSwVersion = event.data.version;
            window.dispatchEvent(new CustomEvent(SW_VERSION_EVENT, { detail: event.data.version }));
          }
        }
      });

      // Periodically ask the browser to re-check the SW script to reduce staleness on mobile
      const ONE_HOUR = 60 * 60 * 1000;
      window.setInterval(() => {
        reg.update().catch(() => {});
      }, ONE_HOUR);

      console.log("Kairos Service Worker registered:", reg);
    } catch (err) {
      console.error("Service Worker error:", err);
    }
  };

  window.addEventListener("load", registerKairosSW);
}
