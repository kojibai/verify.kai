import React from "react";
import ReactDOM from "react-dom/client";

// ✅ CSS FIRST (so App.css can be the final authority)
import "./styles.css";
import "./App.css";

import AppRouter from "./router/AppRouter";
import { APP_VERSION, SW_VERSION_EVENT } from "./version";

// ✅ REPLACE scheduler impl with your utils cadence file
import { startKaiCadence } from "./utils/kai_cadence";
import { GENESIS_TS, PULSE_MS, seedKaiNowMicroPulses } from "./utils/kai_pulse";


/* ────────────────────────────────────────────────────────────────
   Kai NOW seeding (μpulses) — one-time coordinate selection only.
   Priority:
     1) localStorage checkpoint (if present)
     2) build-injected env anchor: VITE_KAI_ANCHOR_MICRO
     3) performance.timeOrigin + performance.now() → bridged to μpulses
────────────────────────────────────────────────────────────────── */

const KAI_SEED_KEYS: readonly string[] = [
  // try multiple to match whatever you’ve used historically
  "kai.now.micro",
  "kai_now_micro",
  "kai_anchor_micro",
  "KAI_ANCHOR_MICRO",
  "KAI_NOW_MICRO",
];

const parseBigInt = (v: unknown): bigint | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^-?\d+$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
};

const roundTiesToEvenBigInt = (x: number): bigint => {
  if (!Number.isFinite(x)) return 0n;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const i = Math.trunc(ax);
  const frac = ax - i;

  if (frac < 0.5) return BigInt(sign * i);
  if (frac > 0.5) return BigInt(sign * (i + 1));
  // exactly .5 → ties-to-even
  return BigInt(sign * (i % 2 === 0 ? i : i + 1));
};

const microPulsesSinceGenesisFromEpochMs = (epochMs: number): bigint => {
  const deltaMs = epochMs - GENESIS_TS;
  const pulses = deltaMs / PULSE_MS; // PULSE_MS may be fractional; OK
  return roundTiesToEvenBigInt(pulses * 1_000_000);
};

const readSeedFromLocalStorage = (): bigint | null => {
  if (typeof window === "undefined") return null;
  try {
    for (const k of KAI_SEED_KEYS) {
      const raw = window.localStorage.getItem(k);
      const b = parseBigInt(raw);
      if (b !== null) return b;
    }
  } catch {
    // ignore
  }
  return null;
};

const readSeedFromEnv = (): bigint | null => {
  // avoids needing ImportMetaEnv augmentation
  const env = import.meta.env as Record<string, string | boolean | undefined>;
  const raw = env["VITE_KAI_ANCHOR_MICRO"];
  return parseBigInt(typeof raw === "string" ? raw : undefined);
};

const pickSeedMicroPulses = (): bigint => {
  const fromLS = readSeedFromLocalStorage();
  if (fromLS !== null) return fromLS;

  const fromEnv = readSeedFromEnv();
  if (fromEnv !== null) return fromEnv;

  // final fallback: one-time bridge from perf-derived epoch ms
  const epochMs = performance.timeOrigin + performance.now();
  return microPulsesSinceGenesisFromEpochMs(epochMs);
};

// 🔒 MUST happen before any component calls kairosEpochNow()
if (typeof window !== "undefined") {
  const pμ = pickSeedMicroPulses();
  seedKaiNowMicroPulses(pμ);
}

const isProduction = import.meta.env.MODE === "production";

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

      // Force refresh when a new worker takes control
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });

      // Auto-skip waiting once the new worker finishes installing
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

      // ✅ REPLACES the hour interval: Kai beat cadence via utils
      startKaiCadence({
        unit: "beat",
        every: 1, // "do a beat"
        onTick: async () => {
          await reg.update();
        },
      });

      console.log("Kairos Service Worker registered:", reg);
    } catch (err) {
      console.error("Service Worker error:", err);
    }
  };

  window.addEventListener("load", registerKairosSW);
}
