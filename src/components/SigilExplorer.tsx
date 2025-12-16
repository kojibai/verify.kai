// src/pages/SigilExplorer.tsx
// v3.10.2 — LAH-MAH-TOR Breath Sync (Parent-First /s Branching) ✨
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
// NEW (this release):
// ✅ Parents are ALWAYS /s (post URLs). /s nodes ALWAYS display.
// ✅ /stream/* nodes are ALWAYS children of their /s parent for the SAME moment.
// ✅ Multiple /s derivatives for the SAME moment are shown as children under the moment’s /s parent.
// ✅ Stream URL preference: /stream/* with t= (or /stream/t) > /stream/p never ever p~ > /stream?p=… > /s fallback.
// ✅ Any localhost sigil/post URLs are auto-mapped to https://phi.network (stable canonical).
// ✅ /p~ links are NEVER displayed/selected in Explorer UI (browser view always uses /stream/*).
// ✅ CLICK OPEN OVERRIDE: Clicking a node ALWAYS opens the payload on the CURRENT host origin
//    (localhost / verify.kai / kaiklok.com / any host), regardless of what origin is stored in data.
//    Data stays the same; only the click-open URL is host-rooted.

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  extractPayloadFromUrl,
  resolveLineageBackwards,
  getOriginUrl,
} from "../utils/sigilUrl";
import type { SigilSharePayloadLoose } from "../utils/sigilUrl";
import "./SigilExplorer.css";

/* ─────────────────────────────────────────────────────────────────────
   Live base (API + canonical sync target)
────────────────────────────────────────────────────────────────────── */
const LIVE_BASE_URL = "https://align.kaiklok.com";

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

type Registry = Map<string, SigilSharePayloadLoose>; // key: absolute URL

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

/* ─────────────────────────────────────────────────────────────────────
 *  Chakra tint system (per node)
 *  ───────────────────────────────────────────────────────────────────── */
type ChakraKey =
  | "root"
  | "sacral"
  | "solar"
  | "heart"
  | "throat"
  | "thirdEye"
  | "crown";

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
  if (raw.includes("solar") || raw.includes("plexus") || raw.includes("sun"))
    return "solar";
  if (raw.includes("heart")) return "heart";
  if (raw.includes("throat")) return "throat";
  if (raw.includes("third") || raw.includes("eye") || raw.includes("indigo"))
    return "thirdEye";
  if (raw.includes("crown") || raw.includes("krown") || raw.includes("violet"))
    return "crown";

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
const PULSE_POLL_MS = 5236;

/** Remote sync endpoints (LAH-MAH-TOR). */
const API_BASE = LIVE_BASE_URL;
const API_SEAL = `${API_BASE}/sigils/seal`;
const API_URLS = `${API_BASE}/sigils/urls`;
const API_INHALE = `${API_BASE}/sigils/inhale`;

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

/** View base (used for canonicalizing *view* URLs). */
const VIEW_BASE_FALLBACK = "https://phi.network";

function isLocalHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h.endsWith(".localhost")
  );
}

function normalizeViewOrigin(origin: string): string {
  try {
    const u = new URL(origin);
    if (isLocalHostname(u.hostname)) {
      u.protocol = "https:";
      u.hostname = "phi.network";
      u.port = "";
      return u.origin;
    }
    if (u.hostname.toLowerCase() === "phi.network" && u.protocol !== "https:") {
      u.protocol = "https:";
      u.port = "";
      return u.origin;
    }
    return u.origin;
  } catch {
    return VIEW_BASE_FALLBACK;
  }
}

function viewBaseOrigin(): string {
  if (!hasWindow) return VIEW_BASE_FALLBACK;
  return normalizeViewOrigin(window.location.origin);
}


/** Make an absolute, normalized URL (stable key). Also rewrites localhost → https://phi.network. */
function canonicalizeUrl(url: string): string {
  try {
    const base = viewBaseOrigin();
    const u = new URL(url, base);

    // force localhost dev artifacts to canonical prod view base
    if (isLocalHostname(u.hostname)) {
      u.protocol = "https:";
      u.hostname = "phi.network";
      u.port = "";
    }

    // normalize phi.network to https
    if (u.hostname.toLowerCase() === "phi.network" && u.protocol !== "https:") {
      u.protocol = "https:";
      u.port = "";
    }

    return u.toString();
  } catch {
    return url;
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
    // best-effort fallback
    const low = url.toLowerCase();
    const pm = low.match(/\/p~([^/?#]+)/u);
    if (pm?.[1]) return safeDecodeURIComponent(pm[1]);
    return undefined;
  }
}

/** If a URL is /p~, convert ONLY for browser view (never stored-mutation, never shown as /p~). */
function browserViewUrl(u: string): string {
  const abs = canonicalizeUrl(u);
  if (!isPTildeUrl(abs)) return abs;
  const tok = parseStreamToken(abs);
  return tok ? canonicalizeUrl(streamUrlFromToken(tok)) : abs;
}

/**
 * CLICK OPEN URL: force opens on the CURRENT host origin, preserving path/search/hash.
 * (Does NOT mutate stored URLs; view-only override for anchor clicks.)
 */
function explorerOpenUrl(raw: string): string {
  if (!hasWindow) return browserViewUrl(raw);

  const safe = browserViewUrl(raw);
  const origin = window.location.origin; // preserves http vs https exactly as loaded

  try {
    const u = new URL(safe, origin);
    return `${origin}${u.pathname}${u.search}${u.hash}`;
  } catch {
    // Fallback: strip any protocol+host, keep path+search+hash
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
  const base = viewBaseOrigin(); // important: view URLs are on phi.network (not the API base)
  return new URL(`/stream/p/${token}`, base).toString();
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
    // ignore quota issues
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
  const viewHost = new URL(viewBaseOrigin()).host;
  const fallbackHost = new URL(VIEW_BASE_FALLBACK).host;
  return host === liveHost || host === viewHost || host === fallbackHost;
}

async function probeUrl(u: string): Promise<"ok" | "bad" | "unknown"> {
  // Only probe URLs on canonical hosts; everything else stays heuristic.
  try {
    const url = new URL(u, viewBaseOrigin());
    if (!isCanonicalHost(url.host)) return "unknown";
  } catch {
    return "unknown";
  }

  try {
    const ac = new AbortController();
    const t = window.setTimeout(() => ac.abort(), URL_PROBE_TIMEOUT_MS);

    // GET (not HEAD) because some deployments don’t handle HEAD well.
    const res = await fetch(u, {
      method: "GET",
      cache: "no-store",
      signal: ac.signal,
      redirect: "follow",
      mode: "cors",
    }).finally(() => window.clearTimeout(t));

    if (!res.ok) return "bad";

    // If it’s HTML, it’s almost certainly viewable.
    const ct = res.headers.get("content-type") ?? "";
    if (ct.toLowerCase().includes("text/html")) return "ok";

    // Still ok; but if it’s an API JSON error page, this might be misleading.
    return "ok";
  } catch {
    // CORS/blocked/timeout → unknown (do NOT mark bad).
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

    // SMS-safe short route acts like stream token identity, but must NEVER be chosen for browser view
    if (path.startsWith("/p~")) return "streamP";

    const isStream = path.includes("/stream");
    if (!isStream) return "other";

    // explicit /stream/p/<token>
    if (path.includes("/stream/p/")) return "streamP";

    // /stream/t... or t= param (query or hash)
    const tQ = url.searchParams.get("t");
    if (tQ && tQ.trim()) return "streamT";

    const hashStr = url.hash.startsWith("#") ? url.hash.slice(1) : "";
    const h = new URLSearchParams(hashStr);
    const tH = h.get("t");
    if (tH && tH.trim()) return "streamT";

    if (path.includes("/stream/t")) return "streamT";

    // query p=
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
 * Priority: (phiKey+pulse+beat+step) > kaiSignature > token > hash/time fallback.
 */
function momentKeyFor(url: string, p: SigilSharePayloadLoose): string {
  const phiKey = readPhiKeyFromPayload(p);
  const pulse = Number.isFinite(p.pulse ?? NaN) ? (p.pulse ?? 0) : 0;
  const beat = Number.isFinite(p.beat ?? NaN) ? (p.beat ?? 0) : 0;
  const step = Number.isFinite(p.stepIndex ?? NaN) ? (p.stepIndex ?? 0) : 0;

  if (phiKey && (p.pulse != null || p.beat != null || p.stepIndex != null)) {
    return `k:${phiKey}|${pulse}|${beat}|${step}`;
  }

  const sig = typeof p.kaiSignature === "string" ? p.kaiSignature.trim() : "";
  if (sig) return `sig:${sig}`;

  const tok = parseStreamToken(url);
  if (tok && tok.trim()) return `tok:${tok.trim()}`;

  const h = parseHashFromUrl(url) ?? "";
  if (h) return `h:${h}`;

  return `u:${canonicalizeUrl(url)}`;
}

/**
 * Content identity (kind-aware): keeps /s nodes DISTINCT from /stream nodes so /s always displays,
 * while /stream variants (/stream/t vs /stream/p) still dedupe together.
 */
function contentIdFor(url: string, p: SigilSharePayloadLoose): string {
  const kind = contentKindForUrl(url); // post | stream | other

  const sig = typeof p.kaiSignature === "string" ? p.kaiSignature.trim() : "";
  if (sig) return `sig:${sig}|${kind}`;

  const tok = parseStreamToken(url);
  if (tok && tok.trim()) return `tok:${tok.trim()}|${kind}`;

  const phiKey = readPhiKeyFromPayload(p);
  const pulse = p.pulse ?? 0;
  const beat = p.beat ?? 0;
  const step = p.stepIndex ?? 0;
  const h = parseHashFromUrl(url) ?? "";

  return `k:${phiKey}|${pulse}|${beat}|${step}|${h}|${kind}`;
}
const isPackedViewerUrl = (raw: string): boolean => {
  const u = raw.toLowerCase();
  if (!u.includes("/stream")) return false;

  // These are the giant “inline packed” viewers:
  // /stream#v=2&root=... (&seg=...&add=...)
  const hasPackedSignals =
    u.includes("root=") || u.includes("&seg=") || u.includes("&add=");
  const isHashViewer = u.includes("/stream#") || u.includes("#v=");

  return hasPackedSignals && isHashViewer;
};

function scoreUrlForView(u: string, prefer: ContentKind): number {
  // HARD RULE: /p~ must NEVER be selected for browser view
  if (isPTildeUrl(u)) return -1e9;

  const url = u.toLowerCase();
  const kind = classifyUrlKind(u);
  let s = 0;
  if (isPackedViewerUrl(url)) s -= 10_000; // never primary, ever

  // ── Kind-specific preference (this is the “always post when post, always stream when stream” rule)
  if (prefer === "post") {
    // /s is the parent view, always preferred for post nodes
    if (kind === "postS") s += 220;
    else s -= 25;
  } else if (prefer === "stream") {
    // stream view preference: t= > /stream/p > /stream?p= > fallback /s
    if (kind === "streamT") s += 220;
    else if (kind === "streamP") s += 190;
    else if (kind === "streamQ") s += 175;
    else if (kind === "stream") s += 160;
    else if (kind === "postS") s += 80; // fallback only
    else s -= 25;
  } else {
    // other: mild preference
    if (kind === "postS") s += 120;
    if (kind === "streamT") s += 125;
    if (kind === "streamP") s += 105;
    if (kind === "streamQ" || kind === "stream") s += 95;
  }

  // Prefer canonical view base and API base slightly
  const viewBase = viewBaseOrigin().toLowerCase();
  if (url.startsWith(viewBase)) s += 12;
  if (url.startsWith(LIVE_BASE_URL.toLowerCase())) s += 10;

  // Health override
  const h = urlHealth.get(canonicalizeUrl(u));
  if (h === 1) s += 200;
  if (h === -1) s -= 200;

  // Prefer shorter (often the “p” form)
  s += Math.max(0, 20 - Math.floor(u.length / 40));

  return s;
}

function pickPrimaryUrl(urls: string[], prefer: ContentKind): string {
  // HARD RULE: /p~ must NEVER be selected for browser view
  const nonPTilde = urls.filter((u) => !isPTildeUrl(u));
  const candidates = nonPTilde.length > 0 ? nonPTilde : urls;

  // If we ONLY have /p~ variants, synthesize a browser-safe /stream/p/<token> URL for view.
  if (nonPTilde.length === 0 && urls.length > 0) {
    const tok = parseStreamToken(urls[0] ?? "");
    if (tok) return canonicalizeUrl(streamUrlFromToken(tok));
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

      // Never propagate /p~ into witness topology (browser view must use /stream/*)
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

function mergeDerivedContext(
  payload: SigilSharePayloadLoose,
  ctx: WitnessCtx,
): SigilSharePayloadLoose {
  const next: SigilSharePayloadLoose = { ...payload };
  if (ctx.originUrl && !next.originUrl) next.originUrl = ctx.originUrl;
  if (ctx.parentUrl && !next.parentUrl) next.parentUrl = ctx.parentUrl;
  return next;
}

/* ─────────────────────────────────────────────────────────────────────
 *  Global in-memory registry (URL → payload)
 *  ───────────────────────────────────────────────────────────────────── */
const memoryRegistry: Registry = new Map();
const channel =
  hasWindow && "BroadcastChannel" in window ? new BroadcastChannel(BC_NAME) : null;

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

/**
 * Sum Φ sent from a pulse, but DO NOT double count:
 * - /stream/t vs /stream/p variants
 * - /stream vs /s parent/child representations of the SAME moment
 *
 * Dedup key MUST be momentKey (kindless), not contentId (kind-aware).
 */
function getPhiSentForPulse(pulse?: number): number | undefined {
  if (pulse == null) return undefined;

  let total = 0;
  let seenAny = false;

  const seenMoment = new Set<string>();

  for (const [rawUrl, payload] of memoryRegistry) {
    if (payload.pulse !== pulse) continue;

    const url = canonicalizeUrl(rawUrl);
    const mid = momentKeyFor(url, payload);
    if (seenMoment.has(mid)) continue;
    seenMoment.add(mid);

    const amt = getPhiFromPayload(payload);
    if (amt !== undefined) {
      total += amt;
      seenAny = true;
    }
  }

  return seenAny ? total : undefined;
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

  // allow payload to become “richer” (more fields) even if topology is same
  const prevKeys = Object.keys(prev as unknown as Record<string, unknown>).length;
  const nextKeys = Object.keys(payload as unknown as Record<string, unknown>).length;
  const richnessChanged = nextKeys !== prevKeys;

  // allow payload to advance in Kai time (if same URL represents newer pulse)
  const kaiChanged = byKaiTime(prev, payload) !== 0;

  if (topoChanged || richnessChanged || kaiChanged) {
    memoryRegistry.set(key, payload);
    return true;
  }

  return false;
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

  // stamp originUrl if missing
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

  // leaf
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
 * This is the “OPEN inhale” that makes the system resilient to API restarts/resets:
 * whoever still has the keystream can repopulate it deterministically.
 */
function seedInhaleFromRegistry(): void {
  // No Chronos decisions. Purely “if present, ensure queued”.
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

    const url = new URL(API_INHALE);
    url.searchParams.set("include_state", "false");
    url.searchParams.set("include_urls", "false");

    const res = await fetch(url.toString(), { method: "POST", body: fd });
    if (!res.ok) throw new Error(`inhale failed: ${res.status}`);

    // Optional read; do not block UX on parsing.
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
    inhaleRetryMs = Math.min(
      inhaleRetryMs ? inhaleRetryMs * 2 : INHALE_RETRY_BASE_MS,
      INHALE_RETRY_MAX_MS,
    );
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

  // 1) Apply witness-derived context to the leaf itself
  const ctx = deriveWitnessContext(abs);
  const mergedLeaf = mergeDerivedContext(extracted, ctx);
  changed = upsertRegistryPayload(abs, mergedLeaf) || changed;

  // 2) If witness chain exists, synthesize edges (origin..parent) + leaf
  if (includeAncestry && ctx.chain.length > 0) {
    for (const link of ctx.chain) changed = ensureUrlInRegistry(link) || changed;
    changed = synthesizeEdgesFromWitnessChain(ctx.chain, abs) || changed;
  }

  // 3) Fallback ancestry from older payload formats
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

    // On local user additions, enqueue this leaf for inhale (batched & deduped).
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
function parseImportedJson(value: unknown): {
  urls: string[];
  rawKrystals: Record<string, unknown>[];
} {
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
function hydrateRegistryFromStorage(): void {
  if (!canStorage) return;

  const ingestList = (raw: string | null) => {
    if (!raw) return;
    try {
      const urls: unknown = JSON.parse(raw);
      if (!Array.isArray(urls)) return;

      let changed = false;

      for (const u of urls) {
        if (typeof u !== "string") continue;
        // hydrate: do NOT broadcast; do NOT enqueue per-URL (we do a single full inhale on open)
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

      if (changed) persistRegistryToStorage();
    } catch {
      // ignore
    }
  };

  ingestList(localStorage.getItem(REGISTRY_LS_KEY));
  ingestList(localStorage.getItem(MODAL_FALLBACK_LS_KEY));
}

/* ─────────────────────────────────────────────────────────────────────
 *  Remote pull (seal → urls) — deterministic exhale
 *  ───────────────────────────────────────────────────────────────────── */
async function fetchJson<T>(
  input: string,
  init?: RequestInit,
): Promise<{ ok: true; value: T; status: number } | { ok: false; status: number }> {
  try {
    const res = await fetch(input, init);
    if (!res.ok) return { ok: false, status: res.status };
    const value = (await res.json()) as T;
    return { ok: true, value, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** Pull remote urls list (paged) and import any new urls into local registry. */
async function pullAndImportRemoteUrls(
  signal: AbortSignal,
): Promise<{ imported: number; remoteSeal?: string; remoteTotal?: number }> {
  let imported = 0;
  let remoteSeal: string | undefined;
  let remoteTotal: number | undefined;

  for (let page = 0; page < URLS_MAX_PAGES_PER_SYNC; page++) {
    const offset = page * URLS_PAGE_LIMIT;
    const url = new URL(API_URLS);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", String(URLS_PAGE_LIMIT));

    const r = await fetchJson<ApiUrlsPageResponse>(url.toString(), {
      method: "GET",
      signal,
      cache: "no-store",
    });

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

    // end conditions (authoritative)
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
  payload: SigilSharePayloadLoose; // “latest” payload for this content
  urls: Set<string>;
  primaryUrl: string;
  kind: ContentKind; // post | stream | other
  momentKey: string; // groups post+stream of same moment
  parentId?: string; // content parent (thread)
  originId: string; // thread origin (always mapped to /s parent if possible)
  momentParentId: string; // /s parent for this moment group
};

type ContentAgg = {
  payload: SigilSharePayloadLoose;
  urls: Set<string>;
  kind: ContentKind;
  momentKey: string;
};

function buildContentIndex(reg: Registry): Map<string, ContentEntry> {
  // url → (kind-aware) contentId
  const urlToContentId = new Map<string, string>();
  // url → momentKey (kindless)
  const urlToMomentKey = new Map<string, string>();

  // 1) aggregate by kind-aware contentId (keeps /s separate from /stream)
  const idToAgg = new Map<string, ContentAgg>();

  for (const [rawUrl, payload] of reg) {
    const url = canonicalizeUrl(rawUrl);
    const kind = contentKindForUrl(url);

    const cid = contentIdFor(url, payload);
    const mkey = momentKeyFor(url, payload);

    urlToContentId.set(url, cid);
    urlToMomentKey.set(url, mkey);

    const prev = idToAgg.get(cid);
    if (!prev) {
      idToAgg.set(cid, { payload, urls: new Set([url]), kind, momentKey: mkey });
      continue;
    }

    // keep “latest” payload for this content id
    if (byKaiTime(payload, prev.payload) > 0) prev.payload = payload;
    prev.urls.add(url);

    // keep the “best” moment key if either becomes more informative
    // (prefer k:phiKey|pulse|beat|step, else keep existing)
    const pm = prev.momentKey;
    const nm = mkey;
    if (pm.startsWith("u:") && !nm.startsWith("u:")) prev.momentKey = nm;
    if (
      pm.startsWith("h:") &&
      (nm.startsWith("k:") || nm.startsWith("sig:") || nm.startsWith("tok:"))
    )
      prev.momentKey = nm;
  }

  // 2) materialize entries with primary URL (kind-aware preference)
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

  // 3) group by momentKey and choose a /s parent for each moment
  const momentGroups = new Map<string, string[]>();
  for (const e of entries.values()) {
    const k = e.momentKey;
    if (!momentGroups.has(k)) momentGroups.set(k, []);
    momentGroups.get(k)!.push(e.id);
  }

  // momentKey → momentParentId (prefer /s post parent)
  const momentParentByMoment = new Map<string, string>();
  // entryId → momentParentId
  const momentParentById = new Map<string, string>();
  // url → momentParentId (so parentUrl/originUrl can map to the /s parent)
  const momentParentByUrl = new Map<string, string>();

  for (const [mk, ids] of momentGroups) {
    const candidates = ids
      .map((id) => entries.get(id))
      .filter(Boolean) as EntryPre[];

    const postParents = candidates.filter((c) => c.kind === "post");
    let parent: EntryPre | undefined;

    if (postParents.length > 0) {
      // best post parent: always /s, but pick the most “viewable” among /s variants
      parent = postParents
        .slice()
        .sort(
          (a, b) =>
            scoreUrlForView(b.primaryUrl, "post") -
            scoreUrlForView(a.primaryUrl, "post"),
        )[0];
    } else {
      // fallback (rare): no /s present, promote best stream to moment parent
      parent = candidates
        .slice()
        .sort(
          (a, b) =>
            scoreUrlForView(b.primaryUrl, b.kind) -
            scoreUrlForView(a.primaryUrl, a.kind),
        )[0];
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

  // 4) compute originId for each moment parent (thread origin, mapped to /s parent where possible)
  const momentOriginByParent = new Map<string, string>();

  for (const e of entries.values()) {
    const mp = momentParentById.get(e.id) ?? e.id;
    if (e.id !== mp) continue; // only compute from moment parent node

    const originUrlRaw = readStringField(e.payload as unknown, "originUrl");
    const originUrl =
      originUrlRaw
        ? canonicalizeUrl(originUrlRaw)
        : (getOriginUrl(e.primaryUrl) ?? e.primaryUrl);

    const originAnyId = urlToContentId.get(originUrl);
    const originMomentParent =
      momentParentByUrl.get(originUrl) ??
      (originAnyId ? momentParentById.get(originAnyId) : undefined);

    momentOriginByParent.set(mp, originMomentParent ?? mp);
  }

  // 5) finalize ContentEntry: parent-first /s for moment; thread parent for moment parent
  const out = new Map<string, ContentEntry>();

  for (const e of entries.values()) {
    const momentParentId = momentParentById.get(e.id) ?? e.id;
    const originId = momentOriginByParent.get(momentParentId) ?? momentParentId;

    let parentId: string | undefined;

    if (e.id !== momentParentId) {
      // stream nodes + /s derivatives of same moment ALWAYS hang under the moment’s /s parent
      parentId = momentParentId;
    } else {
      // moment parent participates in thread topology (reply edges)
      const parentUrlRaw = readStringField(e.payload as unknown, "parentUrl");
      if (parentUrlRaw) {
        const parentUrl = canonicalizeUrl(parentUrlRaw);
        const parentAnyId = urlToContentId.get(parentUrl);
        const parentMomentParent =
          momentParentByUrl.get(parentUrl) ??
          (parentAnyId ? momentParentById.get(parentAnyId) : undefined);

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

function buildContentTree(
  rootId: string,
  idx: Map<string, ContentEntry>,
  seen = new Set<string>(),
): SigilNode | null {
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

  // group by originId (thread root)
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
function buildDetailEntries(node: SigilNode): DetailEntry[] {
  const record = node.payload as unknown as Record<string, unknown>;
  const entries: DetailEntry[] = [];
  const usedKeys = new Set<string>();

  const phiSelf = getPhiFromPayload(node.payload);
  if (phiSelf !== undefined)
    entries.push({ label: "This glyph Φ", value: `${formatPhi(phiSelf)} Φ` });

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

  const labelCandidate =
    record.label ?? record.title ?? record.type ?? record.note ?? record.description;
  if (typeof labelCandidate === "string" && labelCandidate.trim().length > 0) {
    entries.push({ label: "Label / Type", value: labelCandidate.trim() });
  }

  const memoryKeys = [
    "memoryUrl",
    "memory_url",
    "streamUrl",
    "stream_url",
    "feedUrl",
    "feed_url",
    "stream",
  ];
  for (const key of memoryKeys) {
    const v = record[key];
    if (typeof v === "string" && v.trim().length > 0 && !usedKeys.has(key)) {
      entries.push({ label: key, value: v.trim() });
      usedKeys.add(key);
    }
  }

  for (const [key, value] of Object.entries(record)) {
    if (entries.length >= 12) break;
    if (usedKeys.has(key)) continue;
    if (value == null) continue;

    const lower = key.toLowerCase();
    const looksLikeStream =
      lower.includes("stream") || lower.includes("memory") || lower.includes("feed");
    if (!looksLikeStream) continue;

    if (typeof value === "string" && value.trim().length === 0) continue;

    const printable = typeof value === "string" ? value.trim() : JSON.stringify(value);
    entries.push({ label: key, value: printable });
  }

  entries.push({ label: "Primary URL", value: node.url });

  const visibleVariants = node.urls.filter((u) => !isPTildeUrl(u));

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

function SigilTreeNode({ node }: { node: SigilNode }) {
  const [open, setOpen] = useState(false);

  const hash = parseHashFromUrl(node.url);
  const sig = node.payload.kaiSignature;
  const chakraDay = node.payload.chakraDay;
  const phiSentFromPulse = getPhiSentForPulse(node.payload.pulse);
  const detailEntries = buildDetailEntries(node);

  const openHref = explorerOpenUrl(node.url);

  return (
    <div className="node" style={chakraTintStyle(chakraDay)} data-chakra={String(chakraDay ?? "")}>
      <div className="node-row">
        <div className="node-main">
          <button
            className="twirl"
            aria-label={open ? "Collapse branch" : "Expand branch"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
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
            onClick={() => void copyText(node.url)}
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
            <div className="node-children" aria-label="Branch children">
              {node.children.map((c) => (
                <SigilTreeNode key={c.id} node={c} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OriginPanel({ root }: { root: SigilNode }) {
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
      aria-label="Sigil origin branch"
      style={chakraTintStyle(root.payload.chakraDay)}
      data-chakra={String(root.payload.chakraDay ?? "")}
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
          <span className="o-count" title="Total content nodes in this lineage">
            {count} nodes
          </span>
          <button className="o-copy" onClick={() => void copyText(root.url)} title="Copy origin URL" type="button">
            Remember Origin
          </button>
        </div>
      </header>

      <div className="origin-body">
        {root.children.length === 0 ? (
          <div className="kx-empty">No branches yet. The tree begins here.</div>
        ) : (
          <div className="tree">
            {root.children.map((c) => (
              <SigilTreeNode key={c.id} node={c} />
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
              aria-label="Sigil URL"
            />
            <button className="kx-button" type="submit">
              Inhale
            </button>
          </form>

          <div className="kx-io" role="group" aria-label="Import and export">
            <label className="kx-import" title="Import a JSON list of URLs (or krystals)">
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
            <span className="kx-pill" title="Total URLs in registry (includes variants)">
              {total} URLs
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
  const [, force] = useState(0);
  const [forest, setForest] = useState<SigilNode[]>([]);
  const [lastAdded, setLastAdded] = useState<string | undefined>(undefined);

  const unmounted = useRef(false);

  // Remote seal state
  const remoteSealRef = useRef<string | null>(null);

  // Sync concurrency guard
  const syncInFlightRef = useRef(false);

  // Full-seed guard: only repeat full seed if remote seal changed
  const lastFullSeedSealRef = useRef<string | null>(null);

  /** Rebuild derived forest + light re-render (so toolbar totals update). */
  const refresh = () => {
    if (unmounted.current) return;
    setForest(buildForest(memoryRegistry));
    force((v) => v + 1);
  };

  /** Opportunistically probe URL variants so “the one that loads” becomes primary. */
  const probePrimaryCandidates = async () => {
    // Find nodes with multiple URLs, probe a limited number of their candidates.
    const candidates: string[] = [];

    const walk = (n: SigilNode) => {
      if (n.urls.length > 1) {
        const prefer = contentKindForUrl(n.url);
        // probe the top-scoring few (including current primary)
        const sorted = [...n.urls].sort((a, b) => scoreUrlForView(b, prefer) - scoreUrlForView(a, prefer));
        for (const u of sorted.slice(0, 2)) {
          const key = canonicalizeUrl(u);
          if (!urlHealth.has(key) && !candidates.includes(key)) candidates.push(key);
        }
      }
      n.children.forEach(walk);
    };

    for (const r of forest) walk(r);
    if (candidates.length === 0) return;

    let changed = false;
    for (const u of candidates.slice(0, URL_PROBE_MAX_PER_REFRESH)) {
      const res = await probeUrl(u);
      if (res === "ok") changed = setUrlHealth(u, 1) || changed;
      if (res === "bad") changed = setUrlHealth(u, -1) || changed;
    }

    if (changed) refresh();
  };

  useEffect(() => {
    unmounted.current = false;

    loadUrlHealthFromStorage();
    loadInhaleQueueFromStorage();
    hydrateRegistryFromStorage();

    // Seed with current URL if it contains a payload we can extract
    if (hasWindow) {
      const here = canonicalizeUrl(window.location.href);
      if (extractPayloadFromUrl(here)) {
        addUrl(here, {
          includeAncestry: true,
          broadcast: false,
          persist: true,
          source: "local",
          enqueueToApi: true,
        });
        setLastAdded(browserViewUrl(here));
      }
    }

    // (1) Global hook: composer/modal calls
    const prev = window.__SIGIL__?.registerSigilUrl;
    if (!window.__SIGIL__) window.__SIGIL__ = {};
    window.__SIGIL__.registerSigilUrl = (u: string) => {
      if (
        addUrl(u, {
          includeAncestry: true,
          broadcast: true,
          persist: true,
          source: "local",
          enqueueToApi: true,
        })
      ) {
        setLastAdded(browserViewUrl(u));
        refresh();
      }
    };

    // (2) DOM event
    const onUrlRegistered = (e: Event) => {
      const anyEvent = e as CustomEvent<{ url: string }>;
      const u = anyEvent?.detail?.url;
      if (typeof u === "string" && u.length) {
        if (
          addUrl(u, {
            includeAncestry: true,
            broadcast: true,
            persist: true,
            source: "local",
            enqueueToApi: true,
          })
        ) {
          setLastAdded(browserViewUrl(u));
          refresh();
        }
      }
    };
    window.addEventListener("sigil:url-registered", onUrlRegistered as EventListener);

    // (3) Back-compat event
    const onMint = (e: Event) => {
      const anyEvent = e as CustomEvent<{ url: string }>;
      const u = anyEvent?.detail?.url;
      if (typeof u === "string" && u.length) {
        if (
          addUrl(u, {
            includeAncestry: true,
            broadcast: true,
            persist: true,
            source: "local",
            enqueueToApi: true,
          })
        ) {
          setLastAdded(browserViewUrl(u));
          refresh();
        }
      }
    };
    window.addEventListener("sigil:minted", onMint as EventListener);

    // (4) Cross-tab sync
    let onMsg: ((ev: MessageEvent) => void) | undefined;
    if (channel) {
      onMsg = (ev: MessageEvent) => {
        const data = ev.data as unknown as { type?: unknown; url?: unknown };
        if (data?.type === "sigil:add" && typeof data.url === "string") {
          if (
            addUrl(data.url, {
              includeAncestry: true,
              broadcast: false,
              persist: true,
              source: "local",
              enqueueToApi: true,
            })
          ) {
            setLastAdded(browserViewUrl(data.url));
            refresh();
          }
        }
      };
      channel.addEventListener("message", onMsg);
    }

    // (5) Storage updates (composer fallback list)
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === MODAL_FALLBACK_LS_KEY && ev.newValue) {
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

          if (changed) {
            setLastAdded(undefined);
            persistRegistryToStorage();
            refresh();
          }
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener("storage", onStorage);

    const onPageHide = () => {
      saveInhaleQueueToStorage();
      void flushInhaleQueue();
    };
    window.addEventListener("pagehide", onPageHide);

    refresh();

    // ── BREATH LOOP: inhale (push) ⇄ exhale (pull)
    const ac = new AbortController();

    const syncOnce = async (reason: "open" | "pulse" | "visible" | "focus" | "online") => {
      if (unmounted.current) return;
      if (!isOnline()) return;
      if (syncInFlightRef.current) return;

      syncInFlightRef.current = true;

      try {
        // (A) INHALE — push whatever is queued
        await flushInhaleQueue();

        // (B) EXHALE — seal check
        const prevSeal = remoteSealRef.current;

        const res = await fetch(API_SEAL, {
          method: "GET",
          cache: "no-store",
          signal: ac.signal,
          headers: prevSeal ? { "If-None-Match": `"${prevSeal}"` } : undefined,
        });

        if (res.status === 304) {
          // Still inhale on cadence (done above). Nothing new to exhale.
          return;
        }
        if (!res.ok) return;

        const body = (await res.json()) as ApiSealResponse;
        const nextSeal = typeof body?.seal === "string" ? body.seal : "";

        // If the API ignores 304 but returns identical seal, treat as no-change.
        if (prevSeal && nextSeal && prevSeal === nextSeal) {
          remoteSealRef.current = nextSeal;
          return;
        }

        // (C) EXHALE — pull urls + import
        const importedRes = await pullAndImportRemoteUrls(ac.signal);

        // advance our seal pointer (prevents repeated pulls)
        remoteSealRef.current = importedRes.remoteSeal ?? nextSeal ?? prevSeal ?? null;

        if (importedRes.imported > 0) {
          setLastAdded(undefined);
          refresh();
        }

        // (D) OPEN/RETURN resilience:
        // If we’re opening/returning AND the remote seal changed since our last full-seed,
        // seed inhaleQueue from the entire local keystream and begin pushing it.
        const sealNow = remoteSealRef.current;
        const shouldFullSeed =
          reason === "open" ||
          ((reason === "visible" || reason === "focus" || reason === "online") &&
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

    // OPEN: do a full inhale seed immediately (guarantees repopulation power)
    seedInhaleFromRegistry();
    void syncOnce("open");

    // Every pulse: inhale + seal check + exhale if changed
    const intervalId = window.setInterval(() => void syncOnce("pulse"), PULSE_POLL_MS);

    // When user returns to the tab/app: re-sync
    const onVis = () => {
      if (document.visibilityState === "visible") void syncOnce("visible");
    };
    document.addEventListener("visibilitychange", onVis);

    // Focus + online hooks (mobile + desktop)
    const onFocus = () => void syncOnce("focus");
    const onOnline = () => void syncOnce("online");
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
      window.clearInterval(intervalId);
      ac.abort();
      unmounted.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After forest changes, probe a few URL candidates to improve primary URL selection.
  useEffect(() => {
    if (!hasWindow) return;
    void probePrimaryCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forest.length]);

  const handleAdd = (url: string) => {
    const changed = addUrl(url, {
      includeAncestry: true,
      broadcast: true,
      persist: true,
      source: "local",
      enqueueToApi: true,
    });
    if (changed) {
      setLastAdded(browserViewUrl(url));
      refresh();
    }
  };

  const handleImport = async (file: File) => {
    try {
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

      if (changed) {
        setLastAdded(undefined);
        persistRegistryToStorage();
        refresh();
      } else {
        setLastAdded(undefined);
      }

      if (rawKrystals.length > 0) {
        for (const k of rawKrystals) enqueueInhaleRawKrystal(k);
        void flushInhaleQueue();
      } else if (urls.length > 0) {
        forceInhaleUrls(urls);
      }
    } catch {
      // ignore
    }
  };

  const handleExport = () => {
    const data = JSON.stringify(Array.from(memoryRegistry.keys()), null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sigils.json";
    a.click();
    URL.revokeObjectURL(url);
  };

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

      <div className="explorer-scroll" role="region" aria-label="Kairos Sigil-Glyph Explorer Content">
        <div className="explorer-inner">
          {forest.length === 0 ? (
            <div className="kx-empty">
              <p>No sigils in your keystream yet.</p>
              <ol>
                <li>Import your keystream data.</li>
                <li>Seal a moment — auto-registered here.</li>
                <li>Inhale any sigil-glyph or memory URL above — lineage reconstructs instantly.</li>
              </ol>
            </div>
          ) : (
            <div className="forest">
              {forest.map((root) => (
                <OriginPanel key={root.id} root={root} />
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
