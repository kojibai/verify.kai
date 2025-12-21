// src/version.ts
// Shared PWA version constants so the app shell, SW registration, and UI stay in sync.

export const BASE_APP_VERSION = "29.6.7"; // Canonical offline/PWA version
export const SW_VERSION_EVENT = "kairos:sw-version";
export const DEFAULT_APP_VERSION = BASE_APP_VERSION; // Keep in sync with public/sw.js
const ENV_APP_VERSION =
  typeof import.meta !== "undefined" && typeof import.meta.env?.VITE_APP_VERSION === "string"
    ? import.meta.env.VITE_APP_VERSION
    : undefined;

export const APP_VERSION = ENV_APP_VERSION || DEFAULT_APP_VERSION;
