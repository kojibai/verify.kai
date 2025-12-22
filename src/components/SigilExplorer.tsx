// src/pages/SigilExplorer.tsx
// v3.10.7 — LAH-MAH-TOR Breath Sync (Mobile Scroll Stability Hardening) ✨
//
// CORE TRUTH (production behavior):
// ✅ On OPEN: push (inhale) everything you have → API, then pull (exhale) anything new ← API
// ✅ Every φ-pulse (~5.236s): inhale (flush) + seal-check + exhale (pull if changed)
// ✅ No double adds (URL-level registry is a Map; UI dedupes by *content identity*)
// ✅ UI renders each payload ONCE even if multiple URL variants exist
// ✅ Keeps ALL URL variants in data + shows them in detail; chooses best primary for viewing
// ✅ No echo loops from remote imports (remote adds never re-inhale automatically)
// ✅ Deterministic ordering: Kai-time only (pulse/beat/stepIndex). No Chronos ordering used.
//
// NEW (v3.10.5 — stream route compat):
// ✅ STREAM VIEW NORMALIZATION: any `/stream/p/<token>` (or `/p~<token>`) is DISPLAYED + OPENED as `/stream#p=<token>`
// ✅ Copy/Open always uses the working hash-viewer form (prevents “route not found” / broken deep links)
// ✅ Parent/Origin URLs in details also normalize to hash-viewer form when applicable
//
// NEW (v3.10.6 — stability hardening):
// ✅ Never fetch/probe non-viewable `/stream/p/<token>` routes (no 404 spam / no network console noise)
// ✅ Probe runs only in idle time + never while user is actively scrolling
// ✅ Stronger SSR/host canonicalization safety (no accidental host rewrites)
// ✅ Hook ordering + refs cleaned (prevents subtle StrictMode/HMR weirdness)
//
// NEW (v3.10.7 — mobile scroll stability hardening):
// ✅ ZERO “refresh feel” while reading: UI bumps (registry re-render + reorder) are DEFERRED during active scrolling/toggling
// ✅ Sync work is SKIPPED while scrolling (prevents heavy mid-scroll diff + Chrome/iOS jank)
// ✅ Toggle anchor preserved (opening nested replies never snaps / jumps the scroll container)
// ✅ Pull-to-refresh / overscroll bounce guarded inside the scroll container (best-effort, mobile-safe)
//
// EXTRA (requested):
// ✅ Always-hydrated hardening: cross-tab registry hydration listens to BOTH localStorage keys
// ✅ m.kai soft-failure: backup is auto-suppressed after failures (cooldown), never breaks primary flow

import React, {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FeedPostPayload } from "../utils/feedPayload";
import { extractPayloadFromUrl, resolveLineageBackwards, getOriginUrl } from "../utils/sigilUrl";
import type { SigilSharePayloadLoose } from "../utils/sigilUrl";
import { normalizeClaimGlyphRef, normalizeUsername } from "../utils/usernameClaim";
import { kairosEpochNow, microPulsesSinceGenesis } from "../utils/kai_pulse";
import {
  getUsernameClaimRegistry,
  ingestUsernameClaimGlyph,
  subscribeUsernameClaimRegistry,
  type UsernameClaimRegistry,
} from "../utils/usernameClaimRegistry";
import { USERNAME_CLAIM_KIND, type UsernameClaimPayload } from "../types/usernameClaim";
import { SIGIL_EXPLORER_OPEN_EVENT } from "../constants/sigilExplorer";
import "./SigilExplorer.css";

/* ─────────────────────────────────────────────────────────────────────
   Live base (API + canonical sync target)
────────────────────────────────────────────────────────────────────── */
const LIVE_BASE_URL = "https://align.kaiklok.com";

/* ─────────────────────────────────────────────────────────────────────
   IKANN backup base (same LAH-MAH-TOR API surface)
────────────────────────────────────────────────────────────────────── */
// Use http so the backup host still works on http pages (avoids mixed-content blocks).
const LIVE_BACKUP_URL = "http://m.kai";

/* ─────────────────────────────────────────────────────────────────────
 *  Types
 *  ───────────────────────────────────────────────────────────────────── */
export type SigilNode = {
  id: string; // content identity (dedupe key)
  url: string; // primary URL used for viewing
  urls: string[]; // ALL URL variants for this content
  payload: SigilSharePayloadLoose;
  children: SigilNode[];
};

type Registry = Map<string, SigilSharePayloadLoose>; // key: absolute URL (canonicalized)

type BranchSummary = {
  root: SigilNode;
  nodeCount: number;
  latest: SigilSharePayloadLoose;
};

type DetailEntry = {
  label: string;
  value: string;
};

type WitnessCtx = {
  chain: string[]; // origin..parent (URLs), from #add=
  originUrl?: string;
  parentUrl?: string;
};

type AddSource = "local" | "remote" | "hydrate";

type ApiSealResponse = { seal: string };

type ApiUrlsPageResponse = {
  status: "ok";
  state_seal: string;
  total: number;
  offset: number;
  limit: number;
  urls: string[];
};

type ApiInhaleResponse = {
  status: "ok" | "error";
  files_received: number;
  crystals_total: number;
  crystals_imported: number;
  crystals_failed: number;
  registry_urls: number;
  latest_pulse: number | null;
  errors: string[];
  urls?: string[] | null;
};

type SyncReason = "open" | "pulse" | "visible" | "focus" | "online" | "import";

/* ─────────────────────────────────────────────────────────────────────
 *  Chakra tint system (per node)
 *  ───────────────────────────────────────────────────────────────────── */
type ChakraKey = "root" | "sacral" | "solar" | "heart" | "throat" | "thirdEye" | "crown";

const CHAKRA_COLORS: Record<ChakraKey, string> = {
  root: "#ff3b3b",
  sacral: "#ff8a3d",
  solar: "#ffd54a",
  heart: "#3dff9a",
  throat: "#46d3ff",
  thirdEye: "#6b6cff",
  crown: "#c18bff",
};

function normalizeChakraKey(v: unknown): ChakraKey | null {
  if (typeof v !== "string") return null;
  const raw = v.trim().toLowerCase();
  if (!raw) return null;

  if (raw.includes("root")) return "root";
  if (raw.includes("sacral")) return "sacral";
  if (raw.includes("solar") || raw.includes("plexus") || raw.includes("sun")) return "solar";
  if (raw.includes("heart")) return "heart";
  if (raw.includes("throat")) return "throat";
  if (raw.includes("third") || raw.includes("eye") || raw.includes("indigo")) return "thirdEye";
  if (raw.includes("crown") || raw.includes("krown") || raw.includes("violet")) return "crown";

  if (raw === "1") return "root";
  if (raw === "2") return "sacral";
  if (raw === "3") return "solar";
  if (raw === "4") return "heart";
  if (raw === "5") return "throat";
  if (raw === "6") return "thirdEye";
  if (raw === "7") return "crown";

  return null;
}

function chakraTintStyle(chakraDay: unknown): React.CSSProperties {
  const key = normalizeChakraKey(chakraDay);
  const tint = key ? CHAKRA_COLORS[key] : "var(--sx-accent)";
  return { ["--sx-chakra" as unknown as string]: tint } as React.CSSProperties;
}

/* ─────────────────────────────────────────────────────────────────────
 *  Constants / Utilities
 *  ───────────────────────────────────────────────────────────────────── */
const REGISTRY_LS_KEY = "kai:sigils:v1"; // explorer’s persisted URL list
const MODAL_FALLBACK_LS_KEY = "sigil:urls"; // composer/modal fallback URL list
const BC_NAME = "kai-sigil-registry";

const WITNESS_ADD_MAX = 512;

/** Φ mark source. Expectation: phi.svg is served from /public/phi.svg */
const PHI_MARK_SRC = "/phi.svg";

const hasWindow = typeof window !== "undefined";
const canStorage = hasWindow && typeof window.localStorage !== "undefined";

/** KKS-1.0 φ-breath pulse cadence (ms). Used ONLY for cadence, never ordering. */
/** KKS-1.0 φ-exact breath (seconds). */
/** μpulses per pulse (KKS-1.0). */
const MICRO_PER_PULSE = 1_000_000n;
/** setTimeout clamps: prevent 0ms spin + absurd long sleeps if something goes weird */
const KAI_TIMER_MIN_MS = 8;        // never schedule tighter than a few ms
const KAI_TIMER_MAX_MS = 20_000;   // safety cap (should normally be ~5.2s)

/**
 * Next wake delay computed in Kai-domain:
 * - Compute current μpulse coordinate.
 * - Target next integer pulse boundary.
 * - Convert μpulse delta → ms using the bridge’s local slope (μpulses per 1ms).
 *
 * No floats. No sqrt. No Unix epoch anchor needed.
 */
function msUntilNextKaiBreath(): number {
  const nowMsBig = kairosEpochNow(); // bigint ms (Kairos engine)
  const microNow = microPulsesSinceGenesis(nowMsBig); // bigint μpulses since Genesis

  const nextPulseMicro = ((microNow / MICRO_PER_PULSE) + 1n) * MICRO_PER_PULSE;
  const deltaMicro = nextPulseMicro - microNow;

  // Local slope: μpulses gained per +1ms step (should be ~191 μpulses/ms)
  const microPlus1 = microPulsesSinceGenesis(nowMsBig + 1n);
  const microPerMsRaw = microPlus1 - microNow;

  // Defensive clamp (should never hit unless bridge is misbehaving)
  const microPerMs = microPerMsRaw > 0n ? microPerMsRaw : 191n;

  // Ceil(deltaMicro / microPerMs)
  const delayMsBig = (deltaMicro + microPerMs - 1n) / microPerMs;
  const delayMs = Number(delayMsBig);

  return Math.min(KAI_TIMER_MAX_MS, Math.max(KAI_TIMER_MIN_MS, delayMs));
}



/** Remote pull limits. */
const URLS_PAGE_LIMIT = 5000;
const URLS_MAX_PAGES_PER_SYNC = 24; // safety cap (5000*24 = 120k)

/** Inhale batching. */
const INHALE_BATCH_MAX = 200;
const INHALE_DEBOUNCE_MS = 180;
const INHALE_RETRY_BASE_MS = 1200;
const INHALE_RETRY_MAX_MS = 12000;

const INHALE_QUEUE_LS_KEY = "kai:inhaleQueue:v1";

/** URL health (used to choose primary view URL when variants exist). */
const URL_HEALTH_LS_KEY = "kai:urlHealth:v1";
/** Avoid probe storms. */
const URL_PROBE_MAX_PER_REFRESH = 18;
const URL_PROBE_TIMEOUT_MS = 2200;
const EXPLORER_PREFETCH_CACHE = "sigil-explorer-prefetch-v1";
const EXPLORER_PREFETCH_TIMEOUT_MS = 4200;

/** SSR fallback only (no host rewriting). */
const VIEW_BASE_FALLBACK = "https://phi.network";

/** UI stability windows (mobile). */
const UI_SCROLL_INTERACT_MS = 520; // “reading” window after scroll events
const UI_TOGGLE_INTERACT_MS = 900; // “reading” window after expanding/collapsing
const UI_FLUSH_PAD_MS = 80; // padding before applying deferred bumps

function nowMs(): number {
  const t = kairosEpochNow(); // bigint (ms)
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);

  // clamp only if something ever goes out of range (shouldn't for epoch ms)
  const clamped = t < 0n ? 0n : t > maxSafe ? maxSafe : t;

  return Number(clamped);
}


function cssEscape(v: string): string {
  if (!hasWindow) return v;
  const w = window as unknown as { CSS?: { escape?: (s: string) => string } };
  if (typeof w.CSS?.escape === "function") return w.CSS.escape(v);
  // best-effort escape for attribute selectors
  return v.replace(/[^a-zA-Z0-9_-]/gu, (m) => `\\${m}`);
}

/* ─────────────────────────────────────────────────────────────────────
 *  LAH-MAH-TOR API (Primary + IKANN Failover, soft-fail backup)
 *  ───────────────────────────────────────────────────────────────────── */
const API_BASE_PRIMARY = LIVE_BASE_URL;
const API_BASE_FALLBACK = LIVE_BACKUP_URL;

const API_SEAL_PATH = "/sigils/seal";
const API_URLS_PATH = "/sigils/urls";
const API_INHALE_PATH = "/sigils/inhale";

const API_BASE_HINT_LS_KEY = "kai:lahmahtorBase:v1";

/** Backup suppression: if m.kai fails, suppress it for a cooldown window (no issues, no spam). */
const API_BACKUP_DEAD_UNTIL_LS_KEY = "kai:lahmahtorBackupDeadUntil:v1";
const API_BACKUP_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes (tight, safe)

let apiBackupDeadUntil = 0;

function loadApiBackupDeadUntil(): void {
  if (!canStorage) return;
  const raw = localStorage.getItem(API_BACKUP_DEAD_UNTIL_LS_KEY);
  if (!raw) return;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) apiBackupDeadUntil = n;
}

function saveApiBackupDeadUntil(): void {
  if (!canStorage) return;
  try {
    localStorage.setItem(API_BACKUP_DEAD_UNTIL_LS_KEY, String(apiBackupDeadUntil));
  } catch {
    // ignore
  }
}

function isBackupSuppressed(): boolean {
  return nowMs() < apiBackupDeadUntil;
}

function clearBackupSuppression(): void {
  if (apiBackupDeadUntil === 0) return;
  apiBackupDeadUntil = 0;
  saveApiBackupDeadUntil();
}

function markBackupDead(): void {
  apiBackupDeadUntil = nowMs() + API_BACKUP_COOLDOWN_MS;
  saveApiBackupDeadUntil();
  // never “stick” to fallback if it’s failing
  if (apiBaseHint === API_BASE_FALLBACK) {
    apiBaseHint = API_BASE_PRIMARY;
    saveApiBaseHint();
  }
}

/** Sticky base: whichever succeeded last is attempted first. */
let apiBaseHint: string = API_BASE_PRIMARY;

function loadApiBaseHint(): void {
  if (!canStorage) return;
  const raw = localStorage.getItem(API_BASE_HINT_LS_KEY);
  if (raw === API_BASE_PRIMARY) {
    apiBaseHint = raw;
    return;
  }
  if (raw === API_BASE_FALLBACK) {
    // if backup is currently suppressed, never load it as the preferred base
    apiBaseHint = isBackupSuppressed() ? API_BASE_PRIMARY : raw;
  }
}

function saveApiBaseHint(): void {
  if (!canStorage) return;
  try {
    localStorage.setItem(API_BASE_HINT_LS_KEY, apiBaseHint);
  } catch {
    // ignore
  }
}

function apiBases(): string[] {
  const wantFallbackFirst = apiBaseHint === API_BASE_FALLBACK && !isBackupSuppressed();
  const list = wantFallbackFirst
    ? [API_BASE_FALLBACK, API_BASE_PRIMARY]
    : [API_BASE_PRIMARY, API_BASE_FALLBACK];

  if (!hasWindow) {
    // SSR: keep both, but still respect suppression in case it was set via storage read before render.
    return isBackupSuppressed() ? list.filter((b) => b !== API_BASE_FALLBACK) : list;
  }

  const isHttpsPage = window.location.protocol === "https:";
  // Never try http fallback from an https page (browser will block + log loudly)
  const protocolFiltered = isHttpsPage ? list.filter((b) => b.startsWith("https://")) : list;

  // Soft-fail: suppress backup if marked dead
  return isBackupSuppressed() ? protocolFiltered.filter((b) => b !== API_BASE_FALLBACK) : protocolFiltered;
}

function shouldFailoverStatus(status: number): boolean {
  // 0 = network/CORS/unknown from wrapper
  if (status === 0) return true;
  // common “route didn’t exist here but exists on the other base”
  if (status === 404) return true;
  // transient / throttling / upstream
  if (status === 408 || status === 429) return true;
  if (status >= 500) return true;
  return false;
}

async function apiFetchWithFailover(
  makeUrl: (base: string) => string,
  init?: RequestInit,
): Promise<Response | null> {
  const bases = apiBases();
  let last: Response | null = null;

  for (const base of bases) {
    const url = makeUrl(base);
    try {
      const res = await fetch(url, init);
      last = res;

      // 304 is a valid success for seal checks.
      if (res.ok || res.status === 304) {
        // if backup works again, clear suppression
        if (base === API_BASE_FALLBACK) clearBackupSuppression();

        apiBaseHint = base;
        saveApiBaseHint();
        return res;
      }

      // If backup is failing (404/5xx/etc), suppress it so it never “causes issues”.
      if (base === API_BASE_FALLBACK && shouldFailoverStatus(res.status)) markBackupDead();

      // If this status is “final”, stop here; otherwise try the other base.
      if (!shouldFailoverStatus(res.status)) return res;
    } catch {
      // network failure → try next base
      if (base === API_BASE_FALLBACK) markBackupDead();
      continue;
    }
  }

  return last;
}

async function apiFetchJsonWithFailover<T>(
  makeUrl: (base: string) => string,
  init?: RequestInit,
): Promise<{ ok: true; value: T; status: number } | { ok: false; status: number }> {
  const res = await apiFetchWithFailover(makeUrl, init);
  if (!res) return { ok: false, status: 0 };
  if (!res.ok) return { ok: false, status: res.status };
  try {
    const value = (await res.json()) as T;
    return { ok: true, value, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

function viewBaseOrigin(): string {
  if (!hasWindow) return VIEW_BASE_FALLBACK;
  return window.location.origin;
}

/**
 * Canonical URL (stable key):
 * - Always absolute
 * - Always rooted to *current origin* (no localhost → phi.network rewriting)
 * - Host-agnostic dedupe: foreign origins collapse to the same path on this host
 */
function canonicalizeUrl(raw: string): string {
  try {
    const base = viewBaseOrigin();
    const u = new URL(raw, base);
    const rooted = new URL(`${u.pathname}${u.search}${u.hash}`, base);
    return rooted.toString();
  } catch {
    return raw;
  }
}

/** Attempt to parse hash from a /s/:hash URL (display only). */
function parseHashFromUrl(url: string): string | undefined {
  try {
    const u = new URL(url, viewBaseOrigin());
    const m = u.pathname.match(/\/s\/([^/]+)/u);
    return m?.[1] ? decodeURIComponent(m[1]) : undefined;
  } catch {
    return undefined;
  }
}

/** True if url is the SMS-safe /p~<token> route (never browser-viewable). */
function isPTildeUrl(url: string): boolean {
  try {
    const u = new URL(url, viewBaseOrigin());
    return u.pathname.toLowerCase().startsWith("/p~");
  } catch {
    return url.toLowerCase().includes("/p~");
  }
}

function safeDecodeURIComponent(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function looksLikeBareToken(s: string): boolean {
  const t = s.trim();
  if (t.length < 16) return false;
  return /^[A-Za-z0-9_-]+$/u.test(t);
}

/** Build a canonical stream URL from a bare token (Composer uses /stream/p/<token>). */
function streamUrlFromToken(token: string): string {
  const base = viewBaseOrigin();
  return new URL(`/stream/p/${token}`, base).toString();
}

/** Build the WORKING hash-viewer URL for streams: /stream#p=<token> */
function streamHashViewerUrlFromToken(token: string): string {
  const base = viewBaseOrigin();
  const u = new URL("/stream", base);
  const h = new URLSearchParams();
  h.set("p", token);
  u.hash = `#${h.toString()}`;
  return u.toString();
}

/** Convert `/stream/p/<token>` → `/stream#p=<token>` (preserves search + existing hash params). */
function streamPPathToHashViewerUrl(raw: string): string {
  try {
    const base = viewBaseOrigin();
    const u = new URL(raw, base);
    const m = u.pathname.match(/\/stream\/p\/([^/]+)/u);
    if (!m?.[1]) return raw;

    const token = decodeURIComponent(m[1]);
    const out = new URL("/stream", base);

    // Preserve any query params (e.g. add=...) as-is.
    out.search = u.search;

    // Preserve existing hash params, but force `p=`.
    const hashStr = u.hash.startsWith("#") ? u.hash.slice(1) : "";
    const hp = new URLSearchParams(hashStr);
    hp.set("p", token);
    out.hash = `#${hp.toString()}`;

    return out.toString();
  } catch {
    return raw;
  }
}

/** Attempt to parse stream token from /stream/p/<token> or ?p=<token> or /p~<token> (identity help). */
function parseStreamToken(url: string): string | undefined {
  try {
    const u = new URL(url, viewBaseOrigin());
    const path = u.pathname;

    // /stream/p/<token>
    const m = path.match(/\/stream\/p\/([^/]+)/u);
    if (m?.[1]) return decodeURIComponent(m[1]);

    // /p~<token>  (SMS-safe short route)
    const pm = path.match(/^\/p~([^/]+)/u);
    if (pm?.[1]) return decodeURIComponent(pm[1]);

    // query p=
    const p = u.searchParams.get("p");
    if (p) return p;

    const hashStr = u.hash.startsWith("#") ? u.hash.slice(1) : "";
    const h = new URLSearchParams(hashStr);
    const hp = h.get("p");
    if (hp) return hp;

    return undefined;
  } catch {
    const low = url.toLowerCase();
    const pm = low.match(/\/p~([^/?#]+)/u);
    if (pm?.[1]) return safeDecodeURIComponent(pm[1]);
    return undefined;
  }
}

/**
 * Browser-view normalization:
 * - /p~<token> → /stream#p=<token>
 * - /stream/p/<token> → /stream#p=<token>
 * (view-only; DOES NOT mutate stored registry URLs)
 */
function browserViewUrl(u: string): string {
  const abs = canonicalizeUrl(u);

  // /p~<token> (never viewable) → hash-viewer
  if (isPTildeUrl(abs)) {
    const tok = parseStreamToken(abs);
    return tok ? canonicalizeUrl(streamHashViewerUrlFromToken(tok)) : abs;
  }

  // /stream/p/<token> → /stream#p=<token>
  const sp = streamPPathToHashViewerUrl(abs);
  if (sp !== abs) return canonicalizeUrl(sp);

  return abs;
}

/**
 * CLICK OPEN URL: force opens on the CURRENT host origin, preserving path/search/hash.
 * (Does NOT mutate stored URLs; view-only override for anchor clicks.)
 */
function explorerOpenUrl(raw: string): string {
  if (!hasWindow) return browserViewUrl(raw);

  const safe = browserViewUrl(raw);
  const origin = window.location.origin;

  try {
    const u = new URL(safe, origin);
    return `${origin}${u.pathname}${u.search}${u.hash}`;
  } catch {
    const m = safe.match(/^(?:https?:\/\/[^/]+)?(\/.*)$/i);
    const rel = (m?.[1] ?? safe).startsWith("/") ? (m?.[1] ?? safe) : `/${m?.[1] ?? safe}`;
    return `${origin}${rel}`;
  }
}

/** Human shortener for long strings. */
function short(s?: string, n = 10): string {
  if (!s) return "—";
  if (s.length <= n * 2 + 3) return s;
  return `${s.slice(0, n)}…${s.slice(-n)}`;
}

/** Safe compare by pulse/beat/step; ascending (earlier first). */
function byKaiTime(a: SigilSharePayloadLoose, b: SigilSharePayloadLoose): number {
  if ((a.pulse ?? 0) !== (b.pulse ?? 0)) return (a.pulse ?? 0) - (b.pulse ?? 0);
  if ((a.beat ?? 0) !== (b.beat ?? 0)) return (a.beat ?? 0) - (b.beat ?? 0);
  return (a.stepIndex ?? 0) - (b.stepIndex ?? 0);
}

/** Φ formatter — 6dp, trimmed. */
function formatPhi(value: number): string {
  const fixed = value.toFixed(6);
  return fixed.replace(/0+$/u, "").replace(/\.$/u, "");
}

function isOnline(): boolean {
  if (!hasWindow) return false;
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

function randId(): string {
  if (hasWindow && typeof window.crypto?.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return Math.random().toString(16).slice(2);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readStringField(obj: unknown, key: string): string | undefined {
  if (!isRecord(obj)) return undefined;
  const v = obj[key];
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

async function prefetchViewUrl(url: string): Promise<void> {
  if (!hasWindow) return;
  if (!isOnline()) return;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), EXPLORER_PREFETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { method: "GET", cache: "force-cache", signal: controller.signal });
    if (res && res.ok && "caches" in window && typeof caches.open === "function") {
      try {
        const cache = await caches.open(EXPLORER_PREFETCH_CACHE);
        await cache.put(new Request(url), res.clone());
      } catch {
        // ignore cache failures
      }
    }
  } catch {
    // ignore fetch failures
  } finally {
    window.clearTimeout(timeoutId);
  }
}

/* ─────────────────────────────────────────────────────────────────────
 *  URL health cache (primary URL selection becomes “the one that loads”)
 *  ───────────────────────────────────────────────────────────────────── */
type UrlHealth = 1 | -1;

const urlHealth: Map<string, UrlHealth> = new Map();

function loadUrlHealthFromStorage(): void {
  if (!canStorage) return;
  const raw = localStorage.getItem(URL_HEALTH_LS_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return;
    urlHealth.clear();
    for (const [k, v] of Object.entries(parsed)) {
      if (v === 1 || v === -1) urlHealth.set(canonicalizeUrl(k), v);
    }
  } catch {
    // ignore
  }
}

function saveUrlHealthToStorage(): void {
  if (!canStorage) return;
  const obj: Record<string, UrlHealth> = {};
  for (const [k, v] of urlHealth) obj[k] = v;
  try {
    localStorage.setItem(URL_HEALTH_LS_KEY, JSON.stringify(obj));
  } catch {
    // ignore
  }
}

function setUrlHealth(u: string, h: UrlHealth): boolean {
  const url = canonicalizeUrl(u);
  const prev = urlHealth.get(url);
  if (prev === h) return false;
  urlHealth.set(url, h);
  saveUrlHealthToStorage();
  return true;
}

function isCanonicalHost(host: string): boolean {
  const liveHost = new URL(LIVE_BASE_URL).host;
  const backupHost = new URL(LIVE_BACKUP_URL).host;
  const viewHost = new URL(viewBaseOrigin()).host;
  const fallbackHost = new URL(VIEW_BASE_FALLBACK).host;
  return host === liveHost || host === backupHost || host === viewHost || host === fallbackHost;
}

async function probeUrl(u: string): Promise<"ok" | "bad" | "unknown"> {
  if (!hasWindow) return "unknown";

  // ✅ Never probe the non-viewable server routes; probe the browser-view form instead.
  const target = browserViewUrl(u);

  let parsed: URL;
  try {
    parsed = new URL(target, viewBaseOrigin());
    if (!isCanonicalHost(parsed.host)) return "unknown";

    // ✅ /stream#p=... is SPA-viewed; probing it would just hit /stream anyway.
    // Treat as OK with zero network to avoid console spam + scroll jitter.
    if (parsed.pathname.toLowerCase() === "/stream") return "ok";
  } catch {
    return "unknown";
  }

  try {
    const ac = new AbortController();
    const t = window.setTimeout(() => ac.abort(), URL_PROBE_TIMEOUT_MS);

    const doFetch = (method: "HEAD" | "GET") =>
      fetch(parsed.toString(), {
        method,
        cache: "no-store",
        signal: ac.signal,
        redirect: "follow",
        mode: "cors",
      });

    let res: Response;
    try {
      res = await doFetch("HEAD");
    } catch {
      res = await doFetch("GET");
    } finally {
      window.clearTimeout(t);
    }

    return res.ok ? "ok" : "bad";
  } catch {
    return "unknown";
  }
}

/* ─────────────────────────────────────────────────────────────────────
 *  Content identity + parent-first /s grouping rules
 *  ───────────────────────────────────────────────────────────────────── */
type UrlKind = "postS" | "streamT" | "streamP" | "streamQ" | "stream" | "other";
type ContentKind = "post" | "stream" | "other";

function classifyUrlKind(u: string): UrlKind {
  try {
    const url = new URL(u, viewBaseOrigin());
    const path = url.pathname.toLowerCase();

    if (path.includes("/s/")) return "postS";
    if (path.startsWith("/p~")) return "streamP";

    const isStream = path.includes("/stream");
    if (!isStream) return "other";

    if (path.includes("/stream/p/")) return "streamP";

    const tQ = url.searchParams.get("t");
    if (tQ && tQ.trim()) return "streamT";

    const hashStr = url.hash.startsWith("#") ? url.hash.slice(1) : "";
    const h = new URLSearchParams(hashStr);
    const tH = h.get("t");
    if (tH && tH.trim()) return "streamT";

    if (path.includes("/stream/t")) return "streamT";

    const pQ = url.searchParams.get("p");
    if (pQ && pQ.trim()) return "streamQ";

    const pH = h.get("p");
    if (pH && pH.trim()) return "streamQ";

    return "stream";
  } catch {
    const low = u.toLowerCase();
    if (low.includes("/s/")) return "postS";
    if (low.includes("/p~")) return "streamP";
    if (low.includes("/stream/p/")) return "streamP";
    if (low.includes("/stream/t") || /[?&#]t=/.test(low)) return "streamT";
    if (low.includes("/stream") && /[?&#]p=/.test(low)) return "streamQ";
    if (low.includes("/stream")) return "stream";
    return "other";
  }
}

function contentKindForUrl(u: string): ContentKind {
  const k = classifyUrlKind(u);
  if (k === "postS") return "post";
  if (k.startsWith("stream")) return "stream";
  return "other";
}

function readPhiKeyFromPayload(p: SigilSharePayloadLoose): string {
  const rec = p as unknown as Record<string, unknown>;
  return (
    (typeof rec.userPhiKey === "string" && rec.userPhiKey) ||
    (typeof rec.phiKey === "string" && rec.phiKey) ||
    (typeof rec.phikey === "string" && rec.phikey) ||
    ""
  );
}

/**
 * Moment key (kindless): used to group /s + /stream nodes that represent the SAME moment.
 * Priority: (phiKey+pulse) > kaiSignature > token > hash/time fallback.
 */
function momentKeyFor(url: string, p: SigilSharePayloadLoose): string {
  const phiKey = readPhiKeyFromPayload(p);
  const pulse = Number.isFinite(p.pulse ?? NaN) ? (p.pulse as number) : null;

  if (phiKey && pulse != null) return `k:${phiKey}|${pulse}`;

  const sig = typeof p.kaiSignature === "string" ? p.kaiSignature.trim() : "";
  if (sig) return `sig:${sig}`;

  const tok = parseStreamToken(url);
  if (tok && tok.trim()) return `tok:${tok.trim()}`;

  const h = parseHashFromUrl(url) ?? "";
  if (h) return `h:${h}`;

  return `u:${canonicalizeUrl(url)}`;
}

/**
 * Content identity (kind-aware):
 * - /s posts are keyed by hash if available
 * - streams are moment-true by (phiKey|pulse)
 * - fallbacks remain for rare cases
 */
function contentIdFor(url: string, p: SigilSharePayloadLoose): string {
  const kind = contentKindForUrl(url);

  const h = parseHashFromUrl(url) ?? "";
  if (kind === "post" && h) return `post:${h}`;

  const phiKey = readPhiKeyFromPayload(p);
  const pulse = Number.isFinite(p.pulse ?? NaN) ? (p.pulse as number) : null;
  if (kind === "stream" && phiKey && pulse != null) return `stream:${phiKey}|${pulse}`;

  const sig = typeof p.kaiSignature === "string" ? p.kaiSignature.trim() : "";
  if (sig) return `${kind}:sig:${sig}`;

  const tok = parseStreamToken(url);
  if (tok && tok.trim()) return `${kind}:tok:${tok.trim()}`;

  return `${kind}:u:${canonicalizeUrl(url)}`;
}

const isPackedViewerUrl = (raw: string): boolean => {
  const u = raw.toLowerCase();
  if (!u.includes("/stream")) return false;

  const hasPackedSignals = u.includes("root=") || u.includes("&seg=") || u.includes("&add=");
  const isHashViewer = u.includes("/stream#") || u.includes("#v=");

  return hasPackedSignals && isHashViewer;
};

function scoreUrlForView(u: string, prefer: ContentKind): number {
  if (isPTildeUrl(u)) return -1e9;

  const url = u.toLowerCase();
  const kind = classifyUrlKind(u);
  let s = 0;

  if (isPackedViewerUrl(url)) s -= 10_000;

  if (prefer === "post") {
    if (kind === "postS") s += 220;
    else s -= 25;
  } else if (prefer === "stream") {
    if (kind === "streamT") s += 220;
    else if (kind === "streamP") s += 190;
    else if (kind === "streamQ") s += 175;
    else if (kind === "stream") s += 160;
    else if (kind === "postS") s += 80;
    else s -= 25;
  } else {
    if (kind === "postS") s += 120;
    if (kind === "streamT") s += 125;
    if (kind === "streamP") s += 105;
    if (kind === "streamQ" || kind === "stream") s += 95;
  }

  const viewBase = viewBaseOrigin().toLowerCase();
  if (url.startsWith(viewBase)) s += 12;
  if (url.startsWith(LIVE_BASE_URL.toLowerCase())) s += 10;
  if (url.startsWith(LIVE_BACKUP_URL.toLowerCase())) s += 10;

  const h = urlHealth.get(canonicalizeUrl(u));
  if (h === 1) s += 200;
  if (h === -1) s -= 200;

  s += Math.max(0, 20 - Math.floor(u.length / 40));

  return s;
}

function pickPrimaryUrl(urls: string[], prefer: ContentKind): string {
  const nonPTilde = urls.filter((u) => !isPTildeUrl(u));
  const candidates = nonPTilde.length > 0 ? nonPTilde : urls;

  // If only /p~ exists, choose a viewable stream URL by token.
  if (nonPTilde.length === 0 && urls.length > 0) {
    const tok = parseStreamToken(urls[0] ?? "");
    if (tok) return canonicalizeUrl(streamHashViewerUrlFromToken(tok));
  }

  let best = candidates[0] ?? "";
  let bestScore = -1e9;

  for (const u of candidates) {
    const sc = scoreUrlForView(u, prefer);
    if (sc > bestScore || (sc === bestScore && u.length < best.length)) {
      best = u;
      bestScore = sc;
    }
  }
  return best;
}

/* ─────────────────────────────────────────────────────────────────────
 *  Witness chain extraction + derived context
 *  ───────────────────────────────────────────────────────────────────── */
function extractWitnessChainFromUrl(url: string): string[] {
  try {
    const u = new URL(url, viewBaseOrigin());

    const hashStr = u.hash.startsWith("#") ? u.hash.slice(1) : "";
    const h = new URLSearchParams(hashStr);

    const rawAdds = [...u.searchParams.getAll("add"), ...h.getAll("add")];

    const out: string[] = [];
    for (const raw of rawAdds) {
      const decoded = safeDecodeURIComponent(String(raw)).trim();
      if (!decoded) continue;

      if (looksLikeBareToken(decoded)) {
        const abs = canonicalizeUrl(streamUrlFromToken(decoded));
        if (!out.includes(abs)) out.push(abs);
        continue;
      }

      let abs = canonicalizeUrl(decoded);

      if (isPTildeUrl(abs)) {
        const tok = parseStreamToken(abs);
        if (tok) abs = canonicalizeUrl(streamUrlFromToken(tok));
      }

      if (!out.includes(abs)) out.push(abs);
    }

    return out.slice(-WITNESS_ADD_MAX);
  } catch {
    return [];
  }
}

function deriveWitnessContext(url: string): WitnessCtx {
  const chain = extractWitnessChainFromUrl(url);
  if (chain.length === 0) return { chain: [] };
  return {
    chain,
    originUrl: chain[0],
    parentUrl: chain[chain.length - 1],
  };
}

function mergeDerivedContext(payload: SigilSharePayloadLoose, ctx: WitnessCtx): SigilSharePayloadLoose {
  const next: SigilSharePayloadLoose = { ...payload };
  if (ctx.originUrl && !next.originUrl) next.originUrl = ctx.originUrl;
  if (ctx.parentUrl && !next.parentUrl) next.parentUrl = ctx.parentUrl;
  return next;
}

/* ─────────────────────────────────────────────────────────────────────
 *  Global in-memory registry (URL → payload)
 *  ───────────────────────────────────────────────────────────────────── */
const memoryRegistry: Registry = new Map();
const channel = hasWindow && "BroadcastChannel" in window ? new BroadcastChannel(BC_NAME) : null;

/** Extract Φ sent from a payload (tolerant to field names). */
function getPhiFromPayload(payload: SigilSharePayloadLoose): number | undefined {
  const record = payload as unknown as Record<string, unknown>;
  const candidates = [
    "phiSent",
    "sentPhi",
    "phi_amount",
    "amountPhi",
    "phi",
    "phiValue",
    "phi_amount_sent",
  ];

  for (const key of candidates) {
    const v = record[key];
    if (typeof v === "number") {
      if (!Number.isFinite(v)) continue;
      if (Math.abs(v) < 1e-12) continue;
      return v;
    }
    if (typeof v === "string") {
      const n = Number(v);
      if (!Number.isNaN(n) && Math.abs(n) >= 1e-12) return n;
    }
  }
  return undefined;
}

function persistRegistryToStorage(): void {
  if (!canStorage) return;
  const urls = Array.from(memoryRegistry.keys());
  try {
    localStorage.setItem(REGISTRY_LS_KEY, JSON.stringify(urls));
  } catch {
    // ignore quota issues
  }
}

/** Upsert a payload into registry; returns true if materially changed. */
function upsertRegistryPayload(url: string, payload: SigilSharePayloadLoose): boolean {
  const key = canonicalizeUrl(url);

  ingestUsernameClaimEvidence(key, payload);

  const prev = memoryRegistry.get(key);
  if (!prev) {
    memoryRegistry.set(key, payload);
    return true;
  }

  const prevParent = prev.parentUrl ?? "";
  const prevOrigin = prev.originUrl ?? "";
  const nextParent = payload.parentUrl ?? "";
  const nextOrigin = payload.originUrl ?? "";

  const topoChanged = prevParent !== nextParent || prevOrigin !== nextOrigin;

  const prevKeys = Object.keys(prev as unknown as Record<string, unknown>).length;
  const nextKeys = Object.keys(payload as unknown as Record<string, unknown>).length;
  const richnessChanged = nextKeys !== prevKeys;

  const kaiChanged = byKaiTime(prev, payload) !== 0;

  if (topoChanged || richnessChanged || kaiChanged) {
    memoryRegistry.set(key, payload);
    return true;
  }

  return false;
}

function ingestUsernameClaimEvidence(url: string, payload: SigilSharePayloadLoose): void {
  const feed = (payload as { feed?: unknown }).feed as FeedPostPayload | undefined;
  if (!feed) return;

  const claimEvidence = (feed as FeedPostPayload & { usernameClaim?: unknown }).usernameClaim;

  const normalizedFromClaim = claimEvidence
    ? normalizeUsername(
        (claimEvidence as { payload?: { normalized?: string; username?: string } }).payload?.normalized ||
          (claimEvidence as { payload?: { normalized?: string; username?: string } }).payload?.username ||
          "",
      )
    : "";

  const normalizedFromAuthor = normalizeUsername(feed.author ?? "");
  const normalizedUsername = normalizedFromClaim || normalizedFromAuthor;

  if (!normalizedUsername) return;
  if (!claimEvidence) return;

  const claimHash = normalizeClaimGlyphRef((claimEvidence as { hash?: string }).hash ?? "");
  const claimUrl = (claimEvidence as { url?: string }).url?.trim() || url;

  if (!claimHash || !claimUrl) return;

  const payloadObj = (claimEvidence as { payload?: unknown }).payload as UsernameClaimPayload | undefined;

  if (!payloadObj || payloadObj.kind !== USERNAME_CLAIM_KIND) return;

  const normalizedPayloadUser =
    normalizeUsername(payloadObj.normalized || payloadObj.username || "") || normalizedUsername;

  if (normalizedPayloadUser !== normalizedUsername) return;

  const ownerHint = (claimEvidence as { ownerHint?: string | null }).ownerHint ?? payloadObj.ownerHint ?? null;

  ingestUsernameClaimGlyph({
    hash: claimHash,
    url: canonicalizeUrl(claimUrl),
    payload: { ...payloadObj, normalized: normalizedPayloadUser },
    ownerHint,
  });
}

function ensureUrlInRegistry(url: string): boolean {
  const abs = canonicalizeUrl(url);
  const extracted = extractPayloadFromUrl(abs);
  if (!extracted) return false;

  const ctx = deriveWitnessContext(abs);
  const merged = mergeDerivedContext(extracted, ctx);

  return upsertRegistryPayload(abs, merged);
}

function synthesizeEdgesFromWitnessChain(chain: readonly string[], leafUrl: string): boolean {
  if (chain.length === 0) return false;

  const origin = canonicalizeUrl(chain[0]);
  let changed = false;

  changed = ensureUrlInRegistry(origin) || changed;

  {
    const p = memoryRegistry.get(origin);
    if (p) {
      const next: SigilSharePayloadLoose = { ...p };
      if (!next.originUrl) next.originUrl = origin;
      changed = upsertRegistryPayload(origin, next) || changed;
    }
  }

  for (let i = 1; i < chain.length; i++) {
    const child = canonicalizeUrl(chain[i]);
    const parent = canonicalizeUrl(chain[i - 1]);

    changed = ensureUrlInRegistry(child) || changed;

    const p = memoryRegistry.get(child);
    if (p) {
      const next: SigilSharePayloadLoose = { ...p };
      if (!next.originUrl) next.originUrl = origin;
      if (!next.parentUrl) next.parentUrl = parent;
      changed = upsertRegistryPayload(child, next) || changed;
    }
  }

  const leafAbs = canonicalizeUrl(leafUrl);
  const leafPayload = memoryRegistry.get(leafAbs);
  if (leafPayload) {
    const next: SigilSharePayloadLoose = { ...leafPayload };
    if (!next.originUrl) next.originUrl = origin;
    if (!next.parentUrl) next.parentUrl = canonicalizeUrl(chain[chain.length - 1]);
    changed = upsertRegistryPayload(leafAbs, next) || changed;
  }

  return changed;
}

/* ─────────────────────────────────────────────────────────────────────
 *  LAH-MAH-TOR Sync: inhale queue (push)
 *  ───────────────────────────────────────────────────────────────────── */
const inhaleQueue: Map<string, Record<string, unknown>> = new Map();
let inhaleFlushTimer: number | null = null;
let inhaleInFlight = false;
let inhaleRetryMs = 0;

function saveInhaleQueueToStorage(): void {
  if (!canStorage) return;
  try {
    const json = JSON.stringify([...inhaleQueue.entries()]);
    localStorage.setItem(INHALE_QUEUE_LS_KEY, json);
  } catch {
    // ignore quota issues
  }
}

function loadInhaleQueueFromStorage(): void {
  if (!canStorage) return;
  const raw = localStorage.getItem(INHALE_QUEUE_LS_KEY);
  if (!raw) return;
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return;
    inhaleQueue.clear();
    for (const item of arr) {
      if (!Array.isArray(item) || item.length !== 2) continue;
      const [url, obj] = item;
      if (typeof url !== "string" || !isRecord(obj)) continue;
      inhaleQueue.set(canonicalizeUrl(url), obj);
    }
  } catch {
    // ignore corrupt
  }
}

function enqueueInhaleRawKrystal(krystal: Record<string, unknown>): void {
  const urlVal = krystal.url;
  if (typeof urlVal !== "string" || !urlVal.trim()) return;

  const abs = canonicalizeUrl(urlVal.trim());
  inhaleQueue.set(abs, { ...krystal, url: abs });
  saveInhaleQueueToStorage();

  if (!hasWindow) return;
  if (inhaleFlushTimer != null) window.clearTimeout(inhaleFlushTimer);
  inhaleFlushTimer = window.setTimeout(() => {
    inhaleFlushTimer = null;
    void flushInhaleQueue();
  }, INHALE_DEBOUNCE_MS);
}

function enqueueInhaleKrystal(url: string, payload: SigilSharePayloadLoose): void {
  const abs = canonicalizeUrl(url);
  const rec = payload as unknown as Record<string, unknown>;
  const krystal: Record<string, unknown> = { url: abs, ...rec };
  inhaleQueue.set(abs, krystal);
  saveInhaleQueueToStorage();

  if (!hasWindow) return;
  if (inhaleFlushTimer != null) window.clearTimeout(inhaleFlushTimer);
  inhaleFlushTimer = window.setTimeout(() => {
    inhaleFlushTimer = null;
    void flushInhaleQueue();
  }, INHALE_DEBOUNCE_MS);
}

/**
 * Seed inhaleQueue from ALL local registry entries.
 * This is the “OPEN inhale” that makes the system resilient to API restarts/resets.
 */
function seedInhaleFromRegistry(): void {
  for (const [rawUrl, payload] of memoryRegistry) {
    const url = canonicalizeUrl(rawUrl);
    const rec = payload as unknown as Record<string, unknown>;
    inhaleQueue.set(url, { url, ...rec });
  }
  saveInhaleQueueToStorage();
}

async function flushInhaleQueue(): Promise<void> {
  if (!hasWindow) return;
  if (!isOnline()) return;
  if (inhaleInFlight) return;
  if (inhaleQueue.size === 0) return;

  inhaleInFlight = true;

  try {
    const batch: Record<string, unknown>[] = [];
    const keys: string[] = [];

    for (const [k, v] of inhaleQueue) {
      batch.push(v);
      keys.push(k);
      if (batch.length >= INHALE_BATCH_MAX) break;
    }

    const json = JSON.stringify(batch);
    const blob = new Blob([json], { type: "application/json" });
    const fd = new FormData();
    fd.append("file", blob, `sigils_${randId()}.json`);

    const makeUrl = (base: string) => {
      const url = new URL(API_INHALE_PATH, base);
      url.searchParams.set("include_state", "false");
      url.searchParams.set("include_urls", "false");
      return url.toString();
    };

    const res = await apiFetchWithFailover(makeUrl, { method: "POST", body: fd });
    if (!res || !res.ok) throw new Error(`inhale failed: ${res?.status ?? 0}`);

    try {
      const _parsed = (await res.json()) as ApiInhaleResponse;
      void _parsed;
    } catch {
      // ignore
    }

    for (const k of keys) inhaleQueue.delete(k);
    saveInhaleQueueToStorage();
    inhaleRetryMs = 0;

    if (inhaleQueue.size > 0) {
      inhaleFlushTimer = window.setTimeout(() => {
        inhaleFlushTimer = null;
        void flushInhaleQueue();
      }, 10);
    }
  } catch {
    inhaleRetryMs = Math.min(inhaleRetryMs ? inhaleRetryMs * 2 : INHALE_RETRY_BASE_MS, INHALE_RETRY_MAX_MS);
    inhaleFlushTimer = window.setTimeout(() => {
      inhaleFlushTimer = null;
      void flushInhaleQueue();
    }, inhaleRetryMs);
  } finally {
    inhaleInFlight = false;
  }
}

/* ─────────────────────────────────────────────────────────────────────
 *  Add URL (local registry) — deterministic ingest + optional inhale enqueue
 *  ───────────────────────────────────────────────────────────────────── */
type AddOptions = {
  includeAncestry?: boolean;
  broadcast?: boolean;
  persist?: boolean;
  source?: AddSource;
  enqueueToApi?: boolean;
};

function addUrl(url: string, opts?: AddOptions): boolean {
  const abs = canonicalizeUrl(url);

  const extracted = extractPayloadFromUrl(abs);
  if (!extracted) return false;

  const includeAncestry = opts?.includeAncestry ?? true;
  const broadcast = opts?.broadcast ?? true;
  const persist = opts?.persist ?? true;
  const source = opts?.source ?? "local";
  const enqueueToApi = opts?.enqueueToApi ?? source === "local";

  let changed = false;

  const ctx = deriveWitnessContext(abs);
  const mergedLeaf = mergeDerivedContext(extracted, ctx);
  changed = upsertRegistryPayload(abs, mergedLeaf) || changed;

  if (includeAncestry && ctx.chain.length > 0) {
    for (const link of ctx.chain) changed = ensureUrlInRegistry(link) || changed;
    changed = synthesizeEdgesFromWitnessChain(ctx.chain, abs) || changed;
  }

  if (includeAncestry) {
    const fallbackChain = resolveLineageBackwards(abs);
    for (const link of fallbackChain) {
      const key = canonicalizeUrl(link);
      const p = extractPayloadFromUrl(key);
      if (!p) continue;
      const pCtx = deriveWitnessContext(key);
      const merged = mergeDerivedContext(p, pCtx);
      changed = upsertRegistryPayload(key, merged) || changed;
    }
  }

  if (changed) {
    if (persist) persistRegistryToStorage();
    if (channel && broadcast) channel.postMessage({ type: "sigil:add", url: abs });

    if (enqueueToApi) {
      const latest = memoryRegistry.get(abs);
      if (latest) enqueueInhaleKrystal(abs, latest);
    }
  }

  return changed;
}

/* ─────────────────────────────────────────────────────────────────────
 *  Import JSON (urls + optional krystals)
 *  ───────────────────────────────────────────────────────────────────── */
function parseImportedJson(value: unknown): { urls: string[]; rawKrystals: Record<string, unknown>[] } {
  const urls: string[] = [];
  const rawKrystals: Record<string, unknown>[] = [];

  const pushUrl = (u: string) => {
    const abs = canonicalizeUrl(u);
    if (!urls.includes(abs)) urls.push(abs);
  };

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") {
        if (item.trim()) pushUrl(item.trim());
        continue;
      }
      if (isRecord(item)) {
        const u = item.url;
        if (typeof u === "string" && u.trim()) {
          const abs = canonicalizeUrl(u.trim());
          if (!urls.includes(abs)) urls.push(abs);
          rawKrystals.push({ ...item, url: abs });
        }
      }
    }
    return { urls, rawKrystals };
  }

  if (isRecord(value)) {
    const maybeUrls = value.urls;
    if (Array.isArray(maybeUrls)) {
      for (const item of maybeUrls) {
        if (typeof item === "string" && item.trim()) pushUrl(item.trim());
      }
    }

    const u = value.url;
    if (typeof u === "string" && u.trim()) {
      const abs = canonicalizeUrl(u.trim());
      if (!urls.includes(abs)) urls.push(abs);
      rawKrystals.push({ ...value, url: abs });
    }

    return { urls, rawKrystals };
  }

  return { urls, rawKrystals };
}

/** Force inhale for URLs even if already present. */
function forceInhaleUrls(urls: readonly string[]): void {
  for (const u of urls) {
    const abs = canonicalizeUrl(u);

    const p0 = memoryRegistry.get(abs) ?? extractPayloadFromUrl(abs);
    if (!p0) continue;

    const ctx = deriveWitnessContext(abs);
    const merged = mergeDerivedContext(p0, ctx);
    enqueueInhaleKrystal(abs, merged);
  }
  void flushInhaleQueue();
}

/** Hydrate persisted URLs into registry without broadcasting; no auto inhale here. */
function hydrateRegistryFromStorage(): boolean {
  if (!canStorage) return false;

  const ingestList = (raw: string | null): boolean => {
    if (!raw) return false;
    try {
      const urls: unknown = JSON.parse(raw);
      if (!Array.isArray(urls)) return false;

      let changed = false;

      for (const u of urls) {
        if (typeof u !== "string") continue;
        if (
          addUrl(u, {
            includeAncestry: true,
            broadcast: false,
            persist: false,
            source: "hydrate",
            enqueueToApi: false,
          })
        ) {
          changed = true;
        }
      }

      return changed;
    } catch {
      return false;
    }
  };

  const changedA = ingestList(localStorage.getItem(REGISTRY_LS_KEY));
  const changedB = ingestList(localStorage.getItem(MODAL_FALLBACK_LS_KEY));

  if (changedA || changedB) persistRegistryToStorage();
  return changedA || changedB;
}

/* ─────────────────────────────────────────────────────────────────────
 *  Remote pull (seal → urls) — deterministic exhale
 *  ───────────────────────────────────────────────────────────────────── */
async function pullAndImportRemoteUrls(
  signal: AbortSignal,
): Promise<{ imported: number; remoteSeal?: string; remoteTotal?: number }> {
  let imported = 0;
  let remoteSeal: string | undefined;
  let remoteTotal: number | undefined;

  for (let page = 0; page < URLS_MAX_PAGES_PER_SYNC; page++) {
    const offset = page * URLS_PAGE_LIMIT;

    const r = await apiFetchJsonWithFailover<ApiUrlsPageResponse>(
      (base) => {
        const url = new URL(API_URLS_PATH, base);
        url.searchParams.set("offset", String(offset));
        url.searchParams.set("limit", String(URLS_PAGE_LIMIT));
        return url.toString();
      },
      { method: "GET", signal, cache: "no-store" },
    );

    if (!r.ok) break;

    remoteSeal = r.value.state_seal;
    remoteTotal = r.value.total;

    const urls = r.value.urls;
    if (!Array.isArray(urls) || urls.length === 0) break;

    for (const u of urls) {
      if (typeof u !== "string") continue;
      const abs = canonicalizeUrl(u);
      if (memoryRegistry.has(abs)) continue;

      const changed = addUrl(abs, {
        includeAncestry: true,
        broadcast: false,
        persist: false,
        source: "remote",
        enqueueToApi: false,
      });

      if (changed) imported += 1;
    }

    if (urls.length < URLS_PAGE_LIMIT) break;
    if (remoteTotal != null && offset + urls.length >= remoteTotal) break;
  }

  if (imported > 0) persistRegistryToStorage();
  return { imported, remoteSeal, remoteTotal };
}

/* ─────────────────────────────────────────────────────────────────────
 *  Tree building (parent-first /s forest)
 *  ───────────────────────────────────────────────────────────────────── */
type ContentEntry = {
  id: string;
  payload: SigilSharePayloadLoose;
  urls: Set<string>;
  primaryUrl: string;
  kind: ContentKind;
  momentKey: string;
  parentId?: string;
  originId: string;
  momentParentId: string;
};

type ContentAgg = {
  payload: SigilSharePayloadLoose;
  urls: Set<string>;
  kind: ContentKind;
  momentKey: string;
};

function buildContentIndex(reg: Registry): Map<string, ContentEntry> {
  const urlToContentId = new Map<string, string>();
  const idToAgg = new Map<string, ContentAgg>();

  for (const [rawUrl, payload] of reg) {
    const url = canonicalizeUrl(rawUrl);
    const kind = contentKindForUrl(url);

    const cid = contentIdFor(url, payload);
    const mkey = momentKeyFor(url, payload);

    urlToContentId.set(url, cid);

    const prev = idToAgg.get(cid);
    if (!prev) {
      idToAgg.set(cid, { payload, urls: new Set([url]), kind, momentKey: mkey });
      continue;
    }

    if (byKaiTime(payload, prev.payload) > 0) prev.payload = payload;
    prev.urls.add(url);

    const pm = prev.momentKey;
    const nm = mkey;
    if (pm.startsWith("u:") && !nm.startsWith("u:")) prev.momentKey = nm;
    if (pm.startsWith("h:") && (nm.startsWith("k:") || nm.startsWith("sig:") || nm.startsWith("tok:"))) {
      prev.momentKey = nm;
    }
  }

  type EntryPre = {
    id: string;
    payload: SigilSharePayloadLoose;
    urls: Set<string>;
    primaryUrl: string;
    kind: ContentKind;
    momentKey: string;
  };

  const entries = new Map<string, EntryPre>();

  for (const [id, agg] of idToAgg) {
    const urls = Array.from(agg.urls);
    const primaryUrl = pickPrimaryUrl(urls, agg.kind);

    entries.set(id, {
      id,
      payload: agg.payload,
      urls: agg.urls,
      primaryUrl,
      kind: agg.kind,
      momentKey: agg.momentKey,
    });
  }

  const momentGroups = new Map<string, string[]>();
  for (const e of entries.values()) {
    const k = e.momentKey;
    if (!momentGroups.has(k)) momentGroups.set(k, []);
    momentGroups.get(k)!.push(e.id);
  }

  const momentParentByMoment = new Map<string, string>();
  const momentParentById = new Map<string, string>();
  const momentParentByUrl = new Map<string, string>();

  for (const [mk, ids] of momentGroups) {
    const candidates = ids.map((id) => entries.get(id)).filter(Boolean) as EntryPre[];

    const postParents = candidates.filter((c) => c.kind === "post");
    let parent: EntryPre | undefined;

    if (postParents.length > 0) {
      parent = postParents
        .slice()
        .sort((a, b) => scoreUrlForView(b.primaryUrl, "post") - scoreUrlForView(a.primaryUrl, "post"))[0];
    } else {
      parent = candidates
        .slice()
        .sort((a, b) => scoreUrlForView(b.primaryUrl, b.kind) - scoreUrlForView(a.primaryUrl, a.kind))[0];
    }

    const parentId = parent?.id ?? ids[0]!;
    momentParentByMoment.set(mk, parentId);

    for (const id of ids) momentParentById.set(id, parentId);
    for (const id of ids) {
      const e = entries.get(id);
      if (!e) continue;
      for (const u of e.urls) momentParentByUrl.set(u, parentId);
    }
  }

  const momentOriginByParent = new Map<string, string>();

  for (const e of entries.values()) {
    const mp = momentParentById.get(e.id) ?? e.id;
    if (e.id !== mp) continue;

    const originUrlRaw = readStringField(e.payload as unknown, "originUrl");
    const originUrl = originUrlRaw ? canonicalizeUrl(originUrlRaw) : getOriginUrl(e.primaryUrl) ?? e.primaryUrl;

    const originAnyId = urlToContentId.get(originUrl);
    const originMomentParent =
      momentParentByUrl.get(originUrl) ?? (originAnyId ? momentParentById.get(originAnyId) : undefined);

    momentOriginByParent.set(mp, originMomentParent ?? mp);
  }

  const out = new Map<string, ContentEntry>();

  for (const e of entries.values()) {
    const momentParentId = momentParentById.get(e.id) ?? e.id;
    const originId = momentOriginByParent.get(momentParentId) ?? momentParentId;

    let parentId: string | undefined;

    if (e.id !== momentParentId) {
      parentId = momentParentId;
    } else {
      const parentUrlRaw = readStringField(e.payload as unknown, "parentUrl");
      if (parentUrlRaw) {
        const parentUrl = canonicalizeUrl(parentUrlRaw);
        const parentAnyId = urlToContentId.get(parentUrl);
        const parentMomentParent =
          momentParentByUrl.get(parentUrl) ?? (parentAnyId ? momentParentById.get(parentAnyId) : undefined);

        if (parentMomentParent && parentMomentParent !== e.id) parentId = parentMomentParent;
      }
    }

    out.set(e.id, {
      id: e.id,
      payload: e.payload,
      urls: e.urls,
      primaryUrl: e.primaryUrl,
      kind: e.kind,
      momentKey: e.momentKey,
      parentId,
      originId,
      momentParentId,
    });
  }

  void momentParentByMoment; // intentional: kept for conceptual clarity
  return out;
}

function contentChildrenOf(parentId: string, idx: Map<string, ContentEntry>): string[] {
  const out: string[] = [];
  for (const [id, e] of idx) {
    if (e.parentId === parentId) out.push(id);
  }
  out.sort((a, b) => byKaiTime(idx.get(b)!.payload, idx.get(a)!.payload)); // DESC
  return out;
}

function buildContentTree(rootId: string, idx: Map<string, ContentEntry>, seen = new Set<string>()): SigilNode | null {
  const e = idx.get(rootId);
  if (!e) return null;

  if (seen.has(rootId)) {
    return {
      id: e.id,
      url: e.primaryUrl,
      urls: Array.from(e.urls),
      payload: e.payload,
      children: [],
    };
  }
  seen.add(rootId);

  const kids = contentChildrenOf(rootId, idx)
    .map((cid) => buildContentTree(cid, idx, seen))
    .filter(Boolean) as SigilNode[];

  return {
    id: e.id,
    url: e.primaryUrl,
    urls: Array.from(e.urls),
    payload: e.payload,
    children: kids,
  };
}

function summarizeBranch(root: SigilNode): { nodeCount: number; latest: SigilSharePayloadLoose } {
  let nodeCount = 0;
  let latest = root.payload;

  const walk = (node: SigilNode) => {
    nodeCount += 1;
    if (byKaiTime(node.payload, latest) > 0) latest = node.payload;
    node.children.forEach(walk);
  };

  walk(root);
  return { nodeCount, latest };
}

function buildForest(reg: Registry): SigilNode[] {
  const idx = buildContentIndex(reg);

  const groups = new Map<string, string[]>();
  for (const [id, e] of idx) {
    const o = e.originId;
    if (!groups.has(o)) groups.set(o, []);
    groups.get(o)!.push(id);
  }

  const decorated: BranchSummary[] = [];

  for (const originId of groups.keys()) {
    const tree = buildContentTree(originId, idx);
    if (!tree) continue;
    const summary = summarizeBranch(tree);
    decorated.push({ root: tree, nodeCount: summary.nodeCount, latest: summary.latest });
  }

  decorated.sort((a, b) => {
    const timeCmp = byKaiTime(b.latest, a.latest);
    if (timeCmp !== 0) return timeCmp;
    if (b.nodeCount !== a.nodeCount) return b.nodeCount - a.nodeCount;
    return byKaiTime(b.root.payload, a.root.payload);
  });

  return decorated.map((d) => d.root);
}

/* ─────────────────────────────────────────────────────────────────────
 *  Memory Stream detail extraction (per content node)
 *  ───────────────────────────────────────────────────────────────────── */
function buildDetailEntries(node: SigilNode, usernameClaims: UsernameClaimRegistry): DetailEntry[] {
  const record = node.payload as unknown as Record<string, unknown>;
  const entries: DetailEntry[] = [];
  const usedKeys = new Set<string>();

  const phiSelf = getPhiFromPayload(node.payload);
  if (phiSelf !== undefined) entries.push({ label: "This glyph Φ", value: `${formatPhi(phiSelf)} Φ` });

  const feed = record.feed as FeedPostPayload | undefined;
  const authorRaw =
    typeof feed?.author === "string"
      ? feed.author
      : typeof record.author === "string"
        ? record.author
        : undefined;

  const claimEvidence = feed ? (feed as FeedPostPayload & { usernameClaim?: unknown }).usernameClaim : undefined;
  const normalizedFromClaim = claimEvidence
    ? normalizeUsername(
        (claimEvidence as { payload?: { normalized?: string; username?: string } }).payload?.normalized ||
          (claimEvidence as { payload?: { normalized?: string; username?: string } }).payload?.username ||
          "",
      )
    : "";
  const normalizedFromAuthor = normalizeUsername(authorRaw ?? "");
  const normalizedUsername = normalizedFromClaim || normalizedFromAuthor;

  if (normalizedUsername) {
    const claimEntry = usernameClaims[normalizedUsername];
    const displayName =
      typeof authorRaw === "string" && authorRaw.trim().length > 0 ? authorRaw.trim() : `@${normalizedUsername}`;

    if (claimEntry) {
      entries.push({
        label: "Username (claimed)",
        value: `${displayName} → glyph ${short(claimEntry.claimHash, 10)}`,
      });
      entries.push({ label: "Claim glyph", value: browserViewUrl(claimEntry.claimUrl) });
    } else {
      entries.push({ label: "Username", value: displayName });
    }
  }

  const addFromKey = (key: string, label: string) => {
    const v = record[key];
    if (typeof v === "string" && v.trim().length > 0 && !usedKeys.has(key)) {
      entries.push({ label, value: v.trim() });
      usedKeys.add(key);
    }
  };

  addFromKey("userPhiKey", "PhiKey");
  addFromKey("phiKey", "PhiKey");
  addFromKey("phikey", "PhiKey");
  addFromKey("kaiSignature", "Kai Signature");

  const parentRaw = record.parentUrl;
  if (typeof parentRaw === "string" && parentRaw.length > 0) {
    entries.push({ label: "Parent URL", value: browserViewUrl(parentRaw) });
    usedKeys.add("parentUrl");
  }

  const originRaw = record.originUrl;
  if (typeof originRaw === "string" && originRaw.length > 0) {
    entries.push({ label: "Origin URL", value: browserViewUrl(originRaw) });
    usedKeys.add("originUrl");
  }

  const labelCandidate = record.label ?? record.title ?? record.type ?? record.note ?? record.description;
  if (typeof labelCandidate === "string" && labelCandidate.trim().length > 0) {
    entries.push({ label: "Label / Type", value: labelCandidate.trim() });
  }

  const memoryKeys = ["memoryUrl", "memory_url", "streamUrl", "stream_url", "feedUrl", "feed_url", "stream"];
  for (const key of memoryKeys) {
    const v = record[key];
    if (typeof v === "string" && v.trim().length > 0 && !usedKeys.has(key)) {
      entries.push({ label: key, value: browserViewUrl(v.trim()) });
      usedKeys.add(key);
    }
  }

  for (const [key, value] of Object.entries(record)) {
    if (entries.length >= 12) break;
    if (usedKeys.has(key)) continue;
    if (value == null) continue;

    const lower = key.toLowerCase();
    const looksLikeStream = lower.includes("stream") || lower.includes("memory") || lower.includes("feed");
    if (!looksLikeStream) continue;

    if (typeof value === "string" && value.trim().length === 0) continue;

    const printable = typeof value === "string" ? browserViewUrl(value.trim()) : JSON.stringify(value);
    entries.push({ label: key, value: printable });
  }

  entries.push({ label: "Primary URL", value: browserViewUrl(node.url) });

  const visibleVariants = node.urls.filter((u) => !isPTildeUrl(u)).map((u) => browserViewUrl(u));

  if (node.urls.length > 1) {
    entries.push({
      label: "URL variants",
      value:
        visibleVariants.length === 0
          ? `${node.urls.length} urls (kept in data; hidden from browser view)`
          : visibleVariants.length <= 3
            ? visibleVariants.join(" | ")
            : `${node.urls.length} urls (kept in data; rendered once)`,
    });
  }

  return entries;
}

/* ─────────────────────────────────────────────────────────────────────
 *  Clipboard helper
 *  ───────────────────────────────────────────────────────────────────── */
async function copyText(text: string): Promise<void> {
  if (!hasWindow) return;

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // fall through
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  } catch {
    // ignore
  }
}

/* ─────────────────────────────────────────────────────────────────────
 *  Scoped inline styles (surgical)
 *  ───────────────────────────────────────────────────────────────────── */
const Styles: React.FC = () => (
  <style>{`
    /* glyph mark */
    .kx-glyph{
      display:flex;
      align-items:center;
      justify-content:center;
    }
    .kx-glyph__mark{
      width:72%;
      height:72%;
      display:block;
      object-fit:contain;
      user-select:none;
      -webkit-user-drag:none;
      pointer-events:none;
      filter: drop-shadow(0 8px 22px rgba(0,0,0,.34));
    }

    /* mobile scroll stability */
    .sigil-explorer,
    .sigil-explorer *{
      -webkit-tap-highlight-color: transparent;
    }
    .sigil-explorer{
      overscroll-behavior: none;
      overscroll-behavior-y: none;
      touch-action: pan-y;
    }
    .sigil-explorer .explorer-scroll{
      overscroll-behavior: contain;
      overscroll-behavior-y: contain;
      -webkit-overflow-scrolling: touch;
      touch-action: pan-y;
    }
  `}</style>
);

/* ─────────────────────────────────────────────────────────────────────
 *  UI Components
 *  ───────────────────────────────────────────────────────────────────── */
function KaiStamp({ p }: { p: SigilSharePayloadLoose }) {
  return (
    <span className="k-stamp" title={`pulse ${p.pulse} • beat ${p.beat} • step ${p.stepIndex}`}>
      <span className="k-pill">pulse {p.pulse}</span>
      <span className="k-dot">•</span>
      <span className="k-pill">beat {p.beat}</span>
      <span className="k-dot">•</span>
      <span className="k-pill">step {p.stepIndex}</span>
    </span>
  );
}

type SigilTreeNodeProps = {
  node: SigilNode;
  expanded: ReadonlySet<string>;
  toggle: (id: string) => void;
  phiTotalsByPulse: ReadonlyMap<number, number>;
  usernameClaims: UsernameClaimRegistry;
};

function SigilTreeNode({ node, expanded, toggle, phiTotalsByPulse, usernameClaims }: SigilTreeNodeProps) {
  const open = expanded.has(node.id);

  const hash = parseHashFromUrl(node.url);
  const sig = node.payload.kaiSignature;
  const chakraDay = node.payload.chakraDay;

  const pulseKey = typeof node.payload.pulse === "number" ? node.payload.pulse : undefined;
  const phiSentFromPulse = pulseKey != null ? phiTotalsByPulse.get(pulseKey) : undefined;

  const openHref = explorerOpenUrl(node.url);
  const detailEntries = open ? buildDetailEntries(node, usernameClaims) : [];

  return (
    <div
      className="node"
      style={chakraTintStyle(chakraDay)}
      data-chakra={String(chakraDay ?? "")}
      data-node-id={node.id}
    >
      <div className="node-row">
        <div className="node-main">
          <button
            className="twirl"
            aria-label={open ? "Collapse memories" : "Expand memories"}
            aria-expanded={open}
            onClick={() => toggle(node.id)}
            title={open ? "Collapse" : "Expand"}
            type="button"
          >
            <span className={`tw ${open ? "open" : ""}`} />
          </button>

          <a
            className="node-link"
            href={openHref}
            target="_blank"
            rel="noopener noreferrer"
            title={openHref}
          >
            <span>{short(sig ?? hash ?? "glyph", 12)}</span>
          </a>
        </div>

        <div className="node-meta">
          <KaiStamp p={node.payload} />

          {chakraDay && (
            <span className="chakra" title={String(chakraDay)}>
              {String(chakraDay)}
            </span>
          )}

          {phiSentFromPulse !== undefined && (
            <span className="phi-pill" title={`Total Φ sent from pulse ${node.payload.pulse}`}>
              Φ sent: {formatPhi(phiSentFromPulse)}Φ
            </span>
          )}

          <button
            className="node-copy"
            aria-label="Copy URL"
            onClick={() => void copyText(openHref)}
            title="Copy URL"
            type="button"
          >
            ⧉
          </button>
        </div>
      </div>

      {open && (
        <div className="node-open">
          <div className="node-detail">
            {detailEntries.length === 0 ? (
              <div className="node-detail-empty">No additional memory fields recorded on this glyph.</div>
            ) : (
              <div className="node-detail-grid">
                {detailEntries.map((entry) => (
                  <React.Fragment key={entry.label}>
                    <div className="detail-label">{entry.label}</div>
                    <div className="detail-value" title={entry.value}>
                      {entry.value}
                    </div>
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>

          {node.children.length > 0 && (
            <div className="node-children" aria-label="Memory Imprints">
              {node.children.map((c) => (
                <SigilTreeNode
                  key={c.id}
                  node={c}
                  expanded={expanded}
                  toggle={toggle}
                  phiTotalsByPulse={phiTotalsByPulse}
                  usernameClaims={usernameClaims}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OriginPanel({
  root,
  expanded,
  toggle,
  phiTotalsByPulse,
  usernameClaims,
}: {
  root: SigilNode;
  expanded: ReadonlySet<string>;
  toggle: (id: string) => void;
  phiTotalsByPulse: ReadonlyMap<number, number>;
  usernameClaims: UsernameClaimRegistry;
}) {
  const count = useMemo(() => {
    let n = 0;
    const walk = (s: SigilNode) => {
      n += 1;
      s.children.forEach(walk);
    };
    walk(root);
    return n;
  }, [root]);

  const originHash = parseHashFromUrl(root.url);
  const originSig = root.payload.kaiSignature;

  const openHref = explorerOpenUrl(root.url);

  return (
    <section
      className="origin"
      aria-label="Sigil origin stream"
      style={chakraTintStyle(root.payload.chakraDay)}
      data-chakra={String(root.payload.chakraDay ?? "")}
      data-node-id={root.id}
    >
      <header className="origin-head">
        <div className="o-meta">
          <span className="o-title">Origin</span>
          <a className="o-link" href={openHref} target="_blank" rel="noopener noreferrer" title={openHref}>
            {short(originSig ?? originHash ?? "origin", 14)}
          </a>
          {root.payload.chakraDay && (
            <span className="o-chakra" title={String(root.payload.chakraDay)}>
              {String(root.payload.chakraDay)}
            </span>
          )}
        </div>

        <div className="o-right">
          <KaiStamp p={root.payload} />
          <span className="o-count" title="Total content keys in this lineage">
            {count} keys
          </span>
          <button className="o-copy" onClick={() => void copyText(openHref)} title="Copy origin URL" type="button">
            Remember Origin
          </button>
        </div>
      </header>

      <div className="origin-body">
        {root.children.length === 0 ? (
          <div className="kx-empty">No memories yet. The stream begins here.</div>
        ) : (
          <div className="tree">
            {root.children.map((c) => (
              <SigilTreeNode
                key={c.id}
                node={c}
                expanded={expanded}
                toggle={toggle}
                phiTotalsByPulse={phiTotalsByPulse}
                usernameClaims={usernameClaims}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ExplorerToolbar({
  onAdd,
  onImport,
  onExport,
  total,
  lastAdded,
}: {
  onAdd: (u: string) => void;
  onImport: (f: File) => void;
  onExport: () => void;
  total: number;
  lastAdded?: string;
}) {
  const [input, setInput] = useState("");

  return (
    <div className="kx-toolbar" role="region" aria-label="Explorer toolbar">
      <div className="kx-toolbar-inner">
        <div className="kx-brand">
          <div className="kx-glyph" aria-hidden>
            <img
              className="kx-glyph__mark"
              src={PHI_MARK_SRC}
              alt=""
              aria-hidden="true"
              decoding="async"
              loading="eager"
              draggable={false}
            />
          </div>

          <div className="kx-title">
            <h1>
              KAIROS <span>Keystream</span>
            </h1>
            <div className="kx-tagline">Sovereign Lineage • No DB • Pure Φ</div>
          </div>
        </div>

        <div className="kx-controls">
          <form
            className="kx-add-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!input.trim()) return;
              onAdd(input.trim());
              setInput("");
            }}
          >
            <input
              className="kx-input"
              placeholder="Inhale a sigil (or memory)…"
              spellCheck={false}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              aria-label="Sigil Key"
            />
            <button className="kx-button" type="submit">
              Inhale
            </button>
          </form>

          <div className="kx-io" role="group" aria-label="Import and export">
            <label className="kx-import" title="Import a JSON list of Keys (or krystals)">
              <input
                type="file"
                accept="application/json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onImport(f);
                }}
                aria-label="Import JSON"
              />
              Inhale
            </label>

            <button className="kx-export" onClick={onExport} aria-label="Export registry to JSON" type="button">
              Exhale
            </button>
          </div>

          <div className="kx-stats" aria-live="polite">
            <span className="kx-pill" title="Total KEYS in registry (includes variants)">
              {total} KEYS
            </span>
            {lastAdded && (
              <span className="kx-pill subtle" title={lastAdded}>
                Last: {short(lastAdded, 8)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Main Page — Breath Sync Loop (Push⇄Pull)
 *  ───────────────────────────────────────────────────────────────────── */
const SigilExplorer: React.FC = () => {
  const [registryRev, setRegistryRev] = useState(0);
  const [lastAdded, setLastAdded] = useState<string | undefined>(undefined);
  const [usernameClaims, setUsernameClaims] = useState<UsernameClaimRegistry>(() => getUsernameClaimRegistry());

  const unmounted = useRef(false);
  const prefetchedRef = useRef<Set<string>>(new Set());

  // Scroll safety guards (prevents “refresh feel” on mobile while reading)
  const scrollElRef = useRef<HTMLDivElement | null>(null);
  const scrollingRef = useRef(false);
  const scrollIdleTimerRef = useRef<number | null>(null);

  // UI stability gate: during active scrolling/toggling, defer heavy bumps (registry re-render)
  const interactUntilRef = useRef(0);
  const flushTimerRef = useRef<number | null>(null);
  const pendingBumpRef = useRef(false);
  const pendingLastAddedRef = useRef<string | undefined>(undefined);
  const pendingClaimEntriesRef = useRef<
    Array<{
      normalized: string;
      claimHash: string;
      claimUrl: string;
      originHash?: string | null;
      ownerHint?: string | null;
    }>
  >([]);
  const syncNowRef = useRef<((reason: SyncReason) => Promise<void>) | null>(null);

  const markInteracting = useCallback((ms: number) => {
    const until = nowMs() + ms;
    if (until > interactUntilRef.current) interactUntilRef.current = until;
  }, []);

  const flushDeferredUi = useCallback(() => {
    if (!hasWindow) return;
    if (unmounted.current) return;

    const now = nowMs();
    const remaining = interactUntilRef.current - now;
    if (remaining > 0) {
      // still interacting → reschedule
      if (flushTimerRef.current != null) window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = window.setTimeout(() => {
        flushTimerRef.current = null;
        flushDeferredUi();
      }, remaining + UI_FLUSH_PAD_MS);
      return;
    }

    // Apply queued username-claim updates (batched)
    const queuedClaims = pendingClaimEntriesRef.current.splice(0);
    if (queuedClaims.length > 0) {
      startTransition(() => {
        setUsernameClaims((prev) => {
          let next = prev;

          for (const entry of queuedClaims) {
            const current = next[entry.normalized];
            if (
              current &&
              current.claimHash === entry.claimHash &&
              current.claimUrl === entry.claimUrl &&
              current.originHash === (entry.originHash ?? current.originHash) &&
              current.ownerHint === (entry.ownerHint ?? current.ownerHint)
            ) {
              continue;
            }

            next = {
              ...next,
              [entry.normalized]: {
                ...current,
                normalized: entry.normalized,
                claimHash: entry.claimHash,
                claimUrl: entry.claimUrl,
                originHash: entry.originHash ?? current?.originHash,
                ownerHint: entry.ownerHint ?? current?.ownerHint ?? null,
              },
            };
          }

          return next;
        });
      });
    }

    // Apply queued lastAdded change (if any)
    if (pendingLastAddedRef.current !== undefined) {
      const v = pendingLastAddedRef.current;
      pendingLastAddedRef.current = undefined;
      startTransition(() => setLastAdded(v));
    }

    // Apply queued bump (single)
    if (pendingBumpRef.current) {
      pendingBumpRef.current = false;
      startTransition(() => setRegistryRev((v) => v + 1));
    }
  }, []);

  const scheduleUiFlush = useCallback(() => {
    if (!hasWindow) return;
    if (flushTimerRef.current != null) return;

    const now = nowMs();
    const remaining = interactUntilRef.current - now;
    const delay = Math.max(0, remaining) + UI_FLUSH_PAD_MS;

    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      flushDeferredUi();
    }, delay);
  }, [flushDeferredUi]);

  const bump = useCallback(() => {
    if (unmounted.current) return;

    const now = nowMs();
    if (now < interactUntilRef.current || scrollingRef.current) {
      pendingBumpRef.current = true;
      scheduleUiFlush();
      return;
    }

    startTransition(() => setRegistryRev((v) => v + 1));
  }, [scheduleUiFlush]);

  const setLastAddedSafe = useCallback(
    (v: string | undefined) => {
      if (unmounted.current) return;

      const now = nowMs();
      if (now < interactUntilRef.current || scrollingRef.current) {
        pendingLastAddedRef.current = v;
        scheduleUiFlush();
        return;
      }

      startTransition(() => setLastAdded(v));
    },
    [scheduleUiFlush],
  );

  // Toggle anchor preservation (prevents mobile “snap/refresh” feel when opening nested)
  const lastToggleAnchorRef = useRef<{ id: string; scrollTop: number; rectTop: number } | null>(null);

  // Stable expand/collapse state (prevents “random refresh” feel)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggle = useCallback(
    (id: string) => {
      markInteracting(UI_TOGGLE_INTERACT_MS);

      const el = scrollElRef.current;
      if (el) {
        const sel = `[data-node-id="${cssEscape(id)}"]`;
        const nodeEl = el.querySelector(sel) as HTMLElement | null;

        lastToggleAnchorRef.current = {
          id,
          scrollTop: el.scrollTop,
          rectTop: nodeEl ? nodeEl.getBoundingClientRect().top : 0,
        };
      }

      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });

      scheduleUiFlush();
    },
    [markInteracting, scheduleUiFlush],
  );

  // Prevent browser-level pull-to-refresh / overscroll refresh while explorer is open.
  // Hardened: apply to html/body AND keep container guarded too.
  useEffect(() => {
    if (!hasWindow) return;

    const html = document.documentElement as HTMLElement | null;
    const body = document.body as HTMLElement | null;
    const root =
      (document.scrollingElement as HTMLElement | null) ||
      (document.documentElement as HTMLElement | null);

    const prev = {
      htmlOverscroll: html?.style.overscrollBehavior ?? "",
      htmlOverscrollY: html?.style.overscrollBehaviorY ?? "",
      bodyOverscroll: body?.style.overscrollBehavior ?? "",
      bodyOverscrollY: body?.style.overscrollBehaviorY ?? "",
      rootOverscroll: root?.style.overscrollBehavior ?? "",
      rootOverscrollY: root?.style.overscrollBehaviorY ?? "",
    };

    if (html) {
      html.style.overscrollBehavior = "none";
      html.style.overscrollBehaviorY = "none";
    }
    if (body) {
      body.style.overscrollBehavior = "none";
      body.style.overscrollBehaviorY = "none";
    }
    if (root) {
      root.style.overscrollBehavior = "none";
      root.style.overscrollBehaviorY = "none";
    }

    return () => {
      if (html) {
        html.style.overscrollBehavior = prev.htmlOverscroll;
        html.style.overscrollBehaviorY = prev.htmlOverscrollY;
      }
      if (body) {
        body.style.overscrollBehavior = prev.bodyOverscroll;
        body.style.overscrollBehaviorY = prev.bodyOverscrollY;
      }
      if (root) {
        root.style.overscrollBehavior = prev.rootOverscroll;
        root.style.overscrollBehaviorY = prev.rootOverscrollY;
      }
    };
  }, []);

  // Single unified guard: prevent top/bottom overdrag from triggering pull-to-refresh,
  // while preserving normal scroll in the container.
  useEffect(() => {
    if (!hasWindow) return;

    const el = scrollElRef.current;
    if (!el) return;

    let lastY = 0;
    let lastX = 0;

    const onTouchStart = (ev: TouchEvent) => {
      if (ev.touches.length !== 1) return;
      lastY = ev.touches[0]?.clientY ?? 0;
      lastX = ev.touches[0]?.clientX ?? 0;
    };

    const onTouchMove = (ev: TouchEvent) => {
      if (!ev.cancelable) return;
      if (ev.touches.length !== 1) return;

      const y = ev.touches[0]?.clientY ?? 0;
      const x = ev.touches[0]?.clientX ?? 0;

      const dy = y - lastY;
      const dx = x - lastX;

      lastY = y;
      lastX = x;

      // Only care about vertical intent
      if (Math.abs(dy) <= Math.abs(dx)) return;

      const maxScroll = el.scrollHeight - el.clientHeight;
      if (maxScroll <= 0) return;

      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop >= maxScroll - 1;

      const pullingDown = dy > 0;
      const pushingUp = dy < 0;

      if ((atTop && pullingDown && window.scrollY <= 0) || (atBottom && pushingUp)) {
        ev.preventDefault();
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  // Remote seal state
  const remoteSealRef = useRef<string | null>(null);

  // Sync concurrency guard
  const syncInFlightRef = useRef(false);

  // Full-seed guard: only repeat full seed if remote seal changed
  const lastFullSeedSealRef = useRef<string | null>(null);

  // Scroll listener (isolated; does not touch state)
  useEffect(() => {
    if (!hasWindow) return;

    const el = scrollElRef.current;
    if (!el) return;

    const onScroll = () => {
      scrollingRef.current = true;
      markInteracting(UI_SCROLL_INTERACT_MS);

      if (scrollIdleTimerRef.current != null) window.clearTimeout(scrollIdleTimerRef.current);
      scrollIdleTimerRef.current = window.setTimeout(() => {
        scrollingRef.current = false;
        scrollIdleTimerRef.current = null;
        // after scroll settles, flush any deferred UI updates
        scheduleUiFlush();
      }, 180);
    };

    el.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      el.removeEventListener("scroll", onScroll);
      if (scrollIdleTimerRef.current != null) window.clearTimeout(scrollIdleTimerRef.current);
      scrollIdleTimerRef.current = null;
      scrollingRef.current = false;
    };
  }, [markInteracting, scheduleUiFlush]);

  // Apply toggle anchor preservation AFTER expanded changes commit to DOM
  useLayoutEffect(() => {
    const anchor = lastToggleAnchorRef.current;
    if (!anchor) return;

    lastToggleAnchorRef.current = null;

    const el = scrollElRef.current;
    if (!el) return;

    const sel = `[data-node-id="${cssEscape(anchor.id)}"]`;
    const nodeEl = el.querySelector(sel) as HTMLElement | null;
    if (!nodeEl) return;

    const afterTop = nodeEl.getBoundingClientRect().top;
    const delta = afterTop - anchor.rectTop;

    if (Number.isFinite(delta) && Math.abs(delta) > 1) {
      el.scrollTop = Math.max(0, anchor.scrollTop + delta);
    }
  }, [expanded]);

  useEffect(() => {
    unmounted.current = false;

    // Load backup suppression + base hint first (so failover never “causes issues”)
    loadApiBackupDeadUntil();
    loadApiBaseHint();

    loadUrlHealthFromStorage();
    loadInhaleQueueFromStorage();

    const hydrated = hydrateRegistryFromStorage();
    if (hydrated) bump();

    if (hasWindow) {
      const here = canonicalizeUrl(window.location.href);
      if (extractPayloadFromUrl(here)) {
        const changed = addUrl(here, {
          includeAncestry: true,
          broadcast: false,
          persist: true,
          source: "local",
          enqueueToApi: true,
        });
        setLastAddedSafe(browserViewUrl(here));
        if (changed) bump();
      }
    }

    const prev = window.__SIGIL__?.registerSigilUrl;
    if (!window.__SIGIL__) window.__SIGIL__ = {};
    window.__SIGIL__.registerSigilUrl = (u: string) => {
      const changed = addUrl(u, {
        includeAncestry: true,
        broadcast: true,
        persist: true,
        source: "local",
        enqueueToApi: true,
      });
      if (changed) {
        setLastAddedSafe(browserViewUrl(u));
        bump();
      }
    };

    const onUrlRegistered = (e: Event) => {
      const anyEvent = e as CustomEvent<{ url: string }>;
      const u = anyEvent?.detail?.url;
      if (typeof u === "string" && u.length) {
        const changed = addUrl(u, {
          includeAncestry: true,
          broadcast: true,
          persist: true,
          source: "local",
          enqueueToApi: true,
        });
        if (changed) {
          setLastAddedSafe(browserViewUrl(u));
          bump();
        }
      }
    };
    window.addEventListener("sigil:url-registered", onUrlRegistered as EventListener);

    const onMint = (e: Event) => {
      const anyEvent = e as CustomEvent<{ url: string }>;
      const u = anyEvent?.detail?.url;
      if (typeof u === "string" && u.length) {
        const changed = addUrl(u, {
          includeAncestry: true,
          broadcast: true,
          persist: true,
          source: "local",
          enqueueToApi: true,
        });
        if (changed) {
          setLastAddedSafe(browserViewUrl(u));
          bump();
        }
      }
    };
    window.addEventListener("sigil:minted", onMint as EventListener);

    let onMsg: ((ev: MessageEvent) => void) | undefined;
    if (channel) {
      onMsg = (ev: MessageEvent) => {
        const data = ev.data as unknown as { type?: unknown; url?: unknown };
        if (data?.type === "sigil:add" && typeof data.url === "string") {
          const changed = addUrl(data.url, {
            includeAncestry: true,
            broadcast: false,
            persist: true,
            source: "local",
            enqueueToApi: true,
          });
          if (changed) {
            setLastAddedSafe(browserViewUrl(data.url));
            bump();
          }
        }
      };
      channel.addEventListener("message", onMsg);
    }

    // Always-hydrated: respond to BOTH storage keys (registry + modal fallback)
    const onStorage = (ev: StorageEvent) => {
      if (!ev.key) return;
      const isRegistryKey = ev.key === REGISTRY_LS_KEY;
      const isModalKey = ev.key === MODAL_FALLBACK_LS_KEY;
      if (!isRegistryKey && !isModalKey) return;
      if (!ev.newValue) return;

      try {
        const urls: unknown = JSON.parse(ev.newValue);
        if (!Array.isArray(urls)) return;

        let changed = false;
        for (const u of urls) {
          if (typeof u !== "string") continue;
          if (
            addUrl(u, {
              includeAncestry: true,
              broadcast: false,
              persist: false,
              source: "local",
              enqueueToApi: true,
            })
          ) {
            changed = true;
          }
        }

        setLastAddedSafe(undefined);
        if (changed) {
          persistRegistryToStorage();
          bump();
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener("storage", onStorage);

    const onPageHide = () => {
      saveInhaleQueueToStorage();
      void flushInhaleQueue();
    };
    window.addEventListener("pagehide", onPageHide);

    // Username claim registry subscription (deferred while scrolling/toggling)
    const unsubClaims = subscribeUsernameClaimRegistry((entry) => {
      const now = nowMs();
      if (now < interactUntilRef.current || scrollingRef.current) {
        pendingClaimEntriesRef.current.push({
          normalized: entry.normalized,
          claimHash: entry.claimHash,
          claimUrl: entry.claimUrl,
          originHash: entry.originHash,
          ownerHint: entry.ownerHint,
        });
        scheduleUiFlush();
        return;
      }

      startTransition(() => {
        setUsernameClaims((prevClaims) => {
          const current = prevClaims[entry.normalized];
          if (
            current &&
            current.claimHash === entry.claimHash &&
            current.claimUrl === entry.claimUrl &&
            current.originHash === entry.originHash &&
            current.ownerHint === entry.ownerHint
          ) {
            return prevClaims;
          }
          return { ...prevClaims, [entry.normalized]: entry };
        });
      });
    });

    // ── BREATH LOOP: inhale (push) ⇄ exhale (pull)
    const ac = new AbortController();

    const syncOnce = async (reason: SyncReason) => {
      if (unmounted.current) return;
      if (!isOnline()) return;
      if (syncInFlightRef.current) return;

      // ✅ mobile stability: never sync while user is scrolling/reading
      if (scrollingRef.current) return;

      // ✅ mobile stability: avoid heavy remote import while in interaction window
      if (nowMs() < interactUntilRef.current && (reason === "pulse" || reason === "import")) return;

      syncInFlightRef.current = true;

      try {
        // (A) INHALE — push whatever is queued
        await flushInhaleQueue();

        // (B) EXHALE — seal check
        const prevSeal = remoteSealRef.current;

        const res = await apiFetchWithFailover((base) => new URL(API_SEAL_PATH, base).toString(), {
          method: "GET",
          cache: "no-store",
          signal: ac.signal,
          headers: undefined,
        });

        if (!res) return;

        if (res.status === 304) return;
        if (!res.ok) return;

        let nextSeal = "";
        try {
          const body = (await res.json()) as ApiSealResponse;
          nextSeal = typeof body?.seal === "string" ? body.seal : "";
        } catch {
          // Soft-fail: if seal payload is weird, just stop this cycle.
          return;
        }

        if (prevSeal && nextSeal && prevSeal === nextSeal) {
          remoteSealRef.current = nextSeal;
          return;
        }

        // (C) EXHALE — pull urls + import
        const importedRes = await pullAndImportRemoteUrls(ac.signal);

        remoteSealRef.current = importedRes.remoteSeal ?? nextSeal ?? prevSeal ?? null;

        if (importedRes.imported > 0) {
          // defer UI bumps if user is actively reading
          setLastAddedSafe(undefined);
          bump();
        }

        // (D) OPEN/RETURN resilience:
        const sealNow = remoteSealRef.current;
        const shouldFullSeed =
          reason === "open" ||
          ((reason === "visible" || reason === "focus" || reason === "online" || reason === "import") &&
            sealNow !== lastFullSeedSealRef.current);

        if (shouldFullSeed) {
          seedInhaleFromRegistry();
          lastFullSeedSealRef.current = sealNow;
          await flushInhaleQueue();
        }
      } finally {
        syncInFlightRef.current = false;
      }
    };

    syncNowRef.current = syncOnce;

    // OPEN: do a full inhale seed immediately (guarantees repopulation power)
    seedInhaleFromRegistry();
    void syncOnce("open");

let breathTimer: number | null = null;

const scheduleNextBreath = (): void => {
  if (!hasWindow) return;
  if (unmounted.current) return;

  if (breathTimer != null) window.clearTimeout(breathTimer);

  const delay = msUntilNextKaiBreath();
  breathTimer = window.setTimeout(() => {
    breathTimer = null;

    // Stay phase-locked, but don’t do network work while hidden/offline.
    if (document.visibilityState !== "visible") {
      scheduleNextBreath();
      return;
    }
    if (!isOnline()) {
      scheduleNextBreath();
      return;
    }

    void syncOnce("pulse");
    scheduleNextBreath(); // re-locks every tick → no drift
  }, delay);
};

const resnapBreath = (): void => {
  // Re-phase immediately off “now”
  scheduleNextBreath();
};

// Start breath scheduler (phase-locked) after open sync is kicked
scheduleNextBreath();

const onVis = () => {
  if (document.visibilityState === "visible") {
    resnapBreath();
    void syncOnce("visible");
  }
};
document.addEventListener("visibilitychange", onVis);

const onFocus = () => {
  resnapBreath();
  void syncOnce("focus");
};

const onOnline = () => {
  resnapBreath();
  void syncOnce("online");
};

window.addEventListener("focus", onFocus);
window.addEventListener("online", onOnline);

    return () => {
      if (window.__SIGIL__) window.__SIGIL__.registerSigilUrl = prev;
      window.removeEventListener("sigil:url-registered", onUrlRegistered as EventListener);
      window.removeEventListener("sigil:minted", onMint as EventListener);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVis);
      if (channel && onMsg) channel.removeEventListener("message", onMsg);
      if (typeof unsubClaims === "function") unsubClaims();
      if (flushTimerRef.current != null) window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
      if (breathTimer != null) window.clearTimeout(breathTimer);
breathTimer = null;
      ac.abort();
      syncNowRef.current = null;
      unmounted.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bump, markInteracting, scheduleUiFlush, setLastAddedSafe]);

  const requestImmediateSync = useCallback(
    (reason: SyncReason) => {
      const fn = syncNowRef.current;
      if (fn) void fn(reason);
    },
    [],
  );

  useEffect(() => {
    if (!hasWindow) return;

    const onOpen = () => requestImmediateSync("visible");
    window.addEventListener(SIGIL_EXPLORER_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(SIGIL_EXPLORER_OPEN_EVENT, onOpen);
  }, [requestImmediateSync]);

  const forest = useMemo(() => buildForest(memoryRegistry), [registryRev]);

  const phiTotalsByPulse = useMemo((): ReadonlyMap<number, number> => {
    const totals = new Map<number, number>();
    const seenByPulse = new Map<number, Set<string>>();

    for (const [rawUrl, payload] of memoryRegistry) {
      const pulse = typeof payload.pulse === "number" ? payload.pulse : undefined;
      if (pulse == null) continue;

      const url = canonicalizeUrl(rawUrl);
      const mkey = momentKeyFor(url, payload);

      let seen = seenByPulse.get(pulse);
      if (!seen) {
        seen = new Set<string>();
        seenByPulse.set(pulse, seen);
      }
      if (seen.has(mkey)) continue;
      seen.add(mkey);

      const amt = getPhiFromPayload(payload);
      if (amt === undefined) continue;

      totals.set(pulse, (totals.get(pulse) ?? 0) + amt);
    }

    return totals;
  }, [registryRev]);

  const prefetchTargets = useMemo((): string[] => {
    const urls: string[] = [];

    for (const [rawUrl] of memoryRegistry) {
      const viewUrl = explorerOpenUrl(rawUrl);
      const canon = canonicalizeUrl(viewUrl);
      if (!urls.includes(canon)) urls.push(canon);
    }

    return urls;
  }, [registryRev]);

  // Warm the shell for every explorer URL so navigations are instant.
  useEffect(() => {
    if (!hasWindow) return;
    if (prefetchTargets.length === 0) return;

    const pending = prefetchTargets.filter((u) => !prefetchedRef.current.has(u));
    if (pending.length === 0) return;

    let cancelled = false;

    const runPrefetch = async () => {
      for (const u of pending) {
        if (cancelled) break;
        prefetchedRef.current.add(u);
        await prefetchViewUrl(u);
      }
    };

    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    let cancel: (() => void) | null = null;

    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(() => void runPrefetch(), { timeout: 1000 });
      cancel = () => w.cancelIdleCallback?.(id);
    } else {
      const id = window.setTimeout(() => void runPrefetch(), 120);
      cancel = () => window.clearTimeout(id);
    }

    return () => {
      cancelled = true;
      cancel?.();
    };
  }, [prefetchTargets]);

  /** Opportunistically probe URL variants so “the one that loads” becomes primary. */
  const probePrimaryCandidates = useCallback(async () => {
    if (!hasWindow) return;
    if (scrollingRef.current) return; // never probe while user is scrolling
    if (!isOnline()) return; // skip probes offline (prevents noise)
    if (nowMs() < interactUntilRef.current) return; // never probe during interaction window

    const candidates: string[] = [];

    const walk = (n: SigilNode) => {
      if (n.urls.length > 1) {
        const prefer = contentKindForUrl(n.url);

        const normalized = [...n.urls]
          .map((u) => canonicalizeUrl(browserViewUrl(u))) // /stream/p → /stream#p
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .sort((a, b) => scoreUrlForView(b, prefer) - scoreUrlForView(a, prefer));

        for (const u of normalized.slice(0, 2)) {
          const key = canonicalizeUrl(u);
          if (!urlHealth.has(key) && !candidates.includes(key)) candidates.push(key);
        }
      }
      n.children.forEach(walk);
    };

    for (const r of forest) walk(r);
    if (candidates.length === 0) return;

    for (const u of candidates.slice(0, URL_PROBE_MAX_PER_REFRESH)) {
      const res = await probeUrl(u);
      if (res === "ok") void setUrlHealth(u, 1);
      if (res === "bad") void setUrlHealth(u, -1);
    }
  }, [forest]);

  // After registry changes, probe a few URL candidates to improve primary URL selection.
  useEffect(() => {
    if (!hasWindow) return;

    let cancelled = false;

    const run = () => {
      if (cancelled) return;
      void probePrimaryCandidates();
    };

    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    let cancel: (() => void) | null = null;

    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(run, { timeout: 900 });
      cancel = () => w.cancelIdleCallback?.(id);
    } else {
      const id = window.setTimeout(run, 250);
      cancel = () => window.clearTimeout(id);
    }

    return () => {
      cancelled = true;
      cancel?.();
    };
  }, [registryRev, probePrimaryCandidates]);

  const handleAdd = useCallback(
    (url: string) => {
      markInteracting(UI_TOGGLE_INTERACT_MS);

      const changed = addUrl(url, {
        includeAncestry: true,
        broadcast: true,
        persist: true,
        source: "local",
        enqueueToApi: true,
      });
      if (changed) {
        setLastAddedSafe(browserViewUrl(url));
        bump();
      }
    },
    [bump, markInteracting, setLastAddedSafe],
  );

  const handleImport = useCallback(
    async (file: File) => {
      try {
        markInteracting(UI_TOGGLE_INTERACT_MS);

        const text = await file.text();
        const parsed = JSON.parse(text) as unknown;

        const { urls, rawKrystals } = parseImportedJson(parsed);
        if (urls.length === 0 && rawKrystals.length === 0) return;

        let changed = false;
        for (const u of urls) {
          if (
            addUrl(u, {
              includeAncestry: true,
              broadcast: false,
              persist: false,
              source: "local",
              enqueueToApi: true,
            })
          ) {
            changed = true;
          }
        }

        setLastAddedSafe(undefined);

        if (changed) {
          persistRegistryToStorage();
          bump();
        }

        if (rawKrystals.length > 0) {
          for (const k of rawKrystals) enqueueInhaleRawKrystal(k);
          void flushInhaleQueue();
        } else if (urls.length > 0) {
          forceInhaleUrls(urls);
        }

        requestImmediateSync("import");
      } catch {
        // ignore
      }
    },
    [bump, markInteracting, requestImmediateSync, setLastAddedSafe],
  );

  const handleExport = useCallback(() => {
    const data = JSON.stringify(Array.from(memoryRegistry.keys()), null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sigils.json";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  return (
    <div className="sigil-explorer">
      <Styles />

      <ExplorerToolbar
        onAdd={handleAdd}
        onImport={handleImport}
        onExport={handleExport}
        total={memoryRegistry.size}
        lastAdded={lastAdded}
      />

      <div
        className="explorer-scroll"
        ref={scrollElRef}
        role="region"
        aria-label="Kairos Sigil-Glyph Explorer Content"
      >
        <div className="explorer-inner">
          {forest.length === 0 ? (
            <div className="kx-empty">
              <p>No sigils in your keystream yet.</p>
              <ol>
                <li>Import your keystream memories.</li>
                <li>Seal a moment — auto-registered here.</li>
                <li>Inhale any sigil-glyph or memory key above — lineage reconstructs instantly.</li>
              </ol>
            </div>
          ) : (
            <div className="forest">
              {forest.map((root) => (
                <OriginPanel
                  key={root.id}
                  root={root}
                  expanded={expanded}
                  toggle={toggle}
                  phiTotalsByPulse={phiTotalsByPulse}
                  usernameClaims={usernameClaims}
                />
              ))}
            </div>
          )}

          <footer className="kx-footer" aria-label="About">
            <div className="row">
              <span>Determinate • Stateless • Kairos-remembered</span>
              <span className="dot">•</span>
              <span>No DB. No Server. Pure Φ.</span>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
};

export default SigilExplorer;
