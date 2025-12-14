// src/pages/SigilExplorer.tsx
// v3.9.0 — LAH-MAH-TOR Sync edition ✨
// - ✅ Composer replies auto-register (global hook + DOM event + BroadcastChannel + storage)
// - ✅ Thread reconstruction WITHOUT embedding parent/origin in payload:
//      - Uses hash-based add= witness chain (#add=...)
//      - Synthesizes parentUrl + originUrl in-registry (derived context), so trees render correctly
// - Kai-time ordering: MOST RECENT first (highest pulse at the top)
// - Branch priority: latest Kai moment + node count (bigger trees float higher)
// - Φ display: per-pulse total Φ sent (if any), shown on each node row
// - Node toggle: reveals per-glyph Memory Stream details, even for leaf nodes
// - Detail panel: stacked, mobile-first, page remains scrollable when open
// - ✅ Official Φ mark inside the top-left brand square (.kx-glyph)
//
// NEW v3.9.0 (Seamless Cloud Sync over KKS-1.0 pulses)
// - ✅ Every local add → POST /sigils/inhale (batched, deduped, fail-soft)
// - ✅ Every φ-pulse (~5.236s) → GET /sigils/seal; if changed → pull /sigils/urls and import new
// - ✅ No echo loops: remote imports do NOT re-inhale back to the API
// - ✅ Uses deterministic seals (ETag candidate) and Kai-only ordering; no Chronos ordering anywhere

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
  url: string;
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

type AddSource = "local" | "remote";

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
 *  Constants / Utilities
 *  ───────────────────────────────────────────────────────────────────── */
const REGISTRY_LS_KEY = "kai:sigils:v1"; // explorer’s persisted URL list
const MODAL_FALLBACK_LS_KEY = "sigil:urls"; // composer/modal fallback URL list
const BC_NAME = "kai-sigil-registry";

const WITNESS_ADD_MAX = 512;

/**
 * Φ mark source.
 * Expectation: phi.svg is served from /public/phi.svg (Vite/Next static).
 */
const PHI_MARK_SRC = "/phi.svg";

const hasWindow = typeof window !== "undefined";
const canStorage = hasWindow && typeof window.localStorage !== "undefined";

/** KKS-1.0 φ-breath pulse cadence (ms). Used ONLY for polling cadence, never for ordering. */
const PULSE_POLL_MS = 5236;

/** Remote sync endpoints (LAH-MAH-TOR). */
const API_BASE = LIVE_BASE_URL;
const API_SEAL = `${API_BASE}/sigils/seal`;
const API_URLS = `${API_BASE}/sigils/urls`;
const API_INHALE = `${API_BASE}/sigils/inhale`;

/** Remote pull limits. */
const URLS_PAGE_LIMIT = 5000;
const URLS_MAX_PAGES_PER_SYNC = 24; // hard cap safety (5000*24 = 120k)

/** Inhale batching. */
const INHALE_BATCH_MAX = 200;
const INHALE_DEBOUNCE_MS = 180;
const INHALE_RETRY_BASE_MS = 1200;
const INHALE_RETRY_MAX_MS = 12000;

/** Make an absolute, normalized URL (stable key). */
function canonicalizeUrl(url: string): string {
  try {
    return new URL(
      url,
      hasWindow ? window.location.origin : LIVE_BASE_URL,
    ).toString();
  } catch {
    return url;
  }
}

/** Attempt to parse hash from a /s/:hash URL (for display only). */
function parseHashFromUrl(url: string): string | undefined {
  try {
    const u = new URL(url, hasWindow ? window.location.origin : LIVE_BASE_URL);
    const m = u.pathname.match(/\/s\/([^/]+)/u);
    return m?.[1] ? decodeURIComponent(m[1]) : undefined;
  } catch {
    return undefined;
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
  return new URL(`/stream/p/${token}`, LIVE_BASE_URL).toString();
}

/** Extract add= witness chain from BOTH query and hash; normalize to absolute URLs. */
function extractWitnessChainFromUrl(url: string): string[] {
  try {
    const u = new URL(url, hasWindow ? window.location.origin : LIVE_BASE_URL);

    const hashStr = u.hash.startsWith("#") ? u.hash.slice(1) : "";
    const h = new URLSearchParams(hashStr);

    const rawAdds = [...u.searchParams.getAll("add"), ...h.getAll("add")];

    const out: string[] = [];
    for (const raw of rawAdds) {
      const decoded = safeDecodeURIComponent(String(raw)).trim();
      if (!decoded) continue;

      // If add= is a bare token, treat it as /stream/p/<token> on LIVE_BASE_URL
      if (looksLikeBareToken(decoded)) {
        const abs = canonicalizeUrl(streamUrlFromToken(decoded));
        if (!out.includes(abs)) out.push(abs);
        continue;
      }

      // If it's already URL-ish (absolute or relative), canonicalize it
      const abs = canonicalizeUrl(decoded);
      if (!out.includes(abs)) out.push(abs);
    }

    return out.slice(-WITNESS_ADD_MAX);
  } catch {
    return [];
  }
}

/** Derive originUrl/parentUrl from witness chain (#add=origin..parent). */
function deriveWitnessContext(url: string): WitnessCtx {
  const chain = extractWitnessChainFromUrl(url);
  if (chain.length === 0) return { chain: [] };
  return {
    chain,
    originUrl: chain[0],
    parentUrl: chain[chain.length - 1],
  };
}

/** Merge derived fields into a payload WITHOUT overriding explicit payload fields. */
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
 *  Global, in-memory registry + helpers
 *  (no backend required; can persist to localStorage, and sync via BroadcastChannel)
 *  ───────────────────────────────────────────────────────────────────── */
const memoryRegistry: Registry = new Map();
const channel =
  hasWindow && "BroadcastChannel" in window
    ? new BroadcastChannel(BC_NAME)
    : null;

/** Extract Φ sent from a payload (best-effort, tolerant to different field names). */
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
      if (!Number.isNaN(n) && Math.abs(n) >= 1e-12) {
        return n;
      }
    }
  }

  return undefined;
}

/** Sum of all Φ sent from a given pulse across the registry. */
function getPhiSentForPulse(pulse?: number): number | undefined {
  if (pulse == null) return undefined;

  let total = 0;
  let seen = false;

  for (const [, payload] of memoryRegistry) {
    if (payload.pulse === pulse) {
      const amt = getPhiFromPayload(payload);
      if (amt !== undefined) {
        total += amt;
        seen = true;
      }
    }
  }

  return seen ? total : undefined;
}

/** Persist memory registry to localStorage (Explorer’s canonical key). */
function persistRegistryToStorage(): void {
  if (!canStorage) return;
  const urls = Array.from(memoryRegistry.keys());
  localStorage.setItem(REGISTRY_LS_KEY, JSON.stringify(urls));
}

/** Upsert a payload into registry; returns true if changed. */
function upsertRegistryPayload(url: string, payload: SigilSharePayloadLoose): boolean {
  const key = canonicalizeUrl(url);
  const prev = memoryRegistry.get(key);
  if (!prev) {
    memoryRegistry.set(key, payload);
    return true;
  }

  // Only treat as changed if derived topology fields materially changed.
  const prevParent = prev.parentUrl ?? "";
  const prevOrigin = prev.originUrl ?? "";
  const nextParent = payload.parentUrl ?? "";
  const nextOrigin = payload.originUrl ?? "";

  if (prevParent !== nextParent || prevOrigin !== nextOrigin) {
    memoryRegistry.set(key, payload);
    return true;
  }

  return false;
}

/** Ensure a URL is present in registry (best-effort). Returns true if changed. */
function ensureUrlInRegistry(url: string): boolean {
  const abs = canonicalizeUrl(url);
  const extracted = extractPayloadFromUrl(abs);
  if (!extracted) return false;

  const ctx = deriveWitnessContext(abs);
  const merged = mergeDerivedContext(extracted, ctx);

  return upsertRegistryPayload(abs, merged);
}

/** Given a witness chain (origin..parent) and a new leaf URL, synthesize edges:
 *   origin.parentUrl = undefined
 *   chain[i].parentUrl = chain[i-1]
 *   leaf.parentUrl = chain[last]
 *  Also stamps originUrl across the whole chain + leaf.
 */
function synthesizeEdgesFromWitnessChain(
  chain: readonly string[],
  leafUrl: string,
): boolean {
  if (chain.length === 0) return false;

  const origin = canonicalizeUrl(chain[0]);
  let changed = false;

  // Ensure origin exists
  changed = ensureUrlInRegistry(origin) || changed;

  // Patch origin payload to have originUrl=self (only if missing) and clear parentUrl
  {
    const p = memoryRegistry.get(origin);
    if (p) {
      const next: SigilSharePayloadLoose = { ...p };
      if (!next.originUrl) next.originUrl = origin;
      // do not forcefully delete parentUrl if it exists; only set if missing
      if (!next.parentUrl) {
        // leave undefined
      }
      changed = upsertRegistryPayload(origin, next) || changed;
    }
  }

  // Walk chain nodes and synthesize parent relations
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

  // Patch leaf with parent=last chain entry and origin=origin
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
 *  LAH-MAH-TOR Sync (API inhale/exhale)
 *  ───────────────────────────────────────────────────────────────────── */

const inhaleQueue: Map<string, Record<string, unknown>> = new Map();
let inhaleFlushTimer: number | null = null;
let inhaleInFlight = false;
let inhaleRetryMs = 0;

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

/** Enqueue one krystal for /sigils/inhale (deduped by URL). */
function enqueueInhaleKrystal(url: string, payload: SigilSharePayloadLoose): void {
  const abs = canonicalizeUrl(url);
  const rec = payload as unknown as Record<string, unknown>;
  // Krystal format: payload fields at top-level + url for identity.
  const krystal: Record<string, unknown> = { url: abs, ...rec };
  inhaleQueue.set(abs, krystal);

  if (!hasWindow) return;
  if (inhaleFlushTimer != null) window.clearTimeout(inhaleFlushTimer);
  inhaleFlushTimer = window.setTimeout(() => {
    inhaleFlushTimer = null;
    void flushInhaleQueue();
  }, INHALE_DEBOUNCE_MS);
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

    // Keep response light; we only need server to ingest.
    const url = new URL(API_INHALE);
    url.searchParams.set("include_state", "false");
    url.searchParams.set("include_urls", "false");

    const res = await fetch(url.toString(), {
      method: "POST",
      body: fd,
      // keepalive helps when user navigates away mid-upload (supported in most modern browsers)
      keepalive: true,
    });

    if (!res.ok) {
      throw new Error(`inhale failed: ${res.status}`);
    }

    // Optional read; do not block UX on parsing.
    let parsed: ApiInhaleResponse | null = null;
    try {
      parsed = (await res.json()) as ApiInhaleResponse;
    } catch {
      parsed = null;
    }

    // Remove successfully submitted batch from queue (idempotent server-side).
    for (const k of keys) inhaleQueue.delete(k);

    // Reset retry
    inhaleRetryMs = 0;

    // If server reported errors, we still continue; the queue is already drained for this batch.
    // If anything remains, schedule next flush.
    if (inhaleQueue.size > 0) {
      inhaleFlushTimer = window.setTimeout(() => {
        inhaleFlushTimer = null;
        void flushInhaleQueue();
      }, 10);
    }

    // If server returns urls/state, we intentionally ignore here: remote pull handles convergence.
    void parsed;
  } catch {
    inhaleRetryMs = Math.min(
      inhaleRetryMs ? inhaleRetryMs * 2 : INHALE_RETRY_BASE_MS,
      INHALE_RETRY_MAX_MS,
    );

    // Retry later (fail-soft).
    inhaleFlushTimer = window.setTimeout(() => {
      inhaleFlushTimer = null;
      void flushInhaleQueue();
    }, inhaleRetryMs);
  } finally {
    inhaleInFlight = false;
  }
}

/* ─────────────────────────────────────────────────────────────────────
 *  Add URL (local registry) — now with seamless API inhale
 *  ───────────────────────────────────────────────────────────────────── */

/** Add a single URL (and optionally its ancestry chain) to the registry. */
function addUrl(
  url: string,
  includeAncestry = true,
  broadcast = true,
  persist = true,
  source: AddSource = "local",
): boolean {
  const abs = canonicalizeUrl(url);

  const extracted = extractPayloadFromUrl(abs);
  if (!extracted) return false;

  let changed = false;

  // 1) Apply witness-derived context (from #add=) to the leaf itself
  const ctx = deriveWitnessContext(abs);
  const mergedLeaf = mergeDerivedContext(extracted, ctx);
  changed = upsertRegistryPayload(abs, mergedLeaf) || changed;

  // 2) If witness chain exists, synthesize edges for the whole chain (origin..parent) + leaf
  if (includeAncestry && ctx.chain.length > 0) {
    // ensure every URL in chain exists in registry
    for (const link of ctx.chain) {
      changed = ensureUrlInRegistry(link) || changed;
    }
    changed = synthesizeEdgesFromWitnessChain(ctx.chain, abs) || changed;
  }

  // 3) Fallback ancestry from older payload formats (where parentUrl/originUrl were embedded)
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

    if (channel && broadcast) {
      channel.postMessage({ type: "sigil:add", url: abs });
    }

    // NEW: On any local add, inhale to LAH-MAH-TOR (deduped + batched).
    // Remote-sourced imports do NOT echo back.
    if (source === "local") {
      const latest = memoryRegistry.get(abs);
      if (latest) enqueueInhaleKrystal(abs, latest);
    }
  }

  return changed;
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Enqueue a raw krystal object (already shaped) for /sigils/inhale.
 * Must include or imply a `url` field (string). We canonicalize it.
 */
function enqueueInhaleRawKrystal(krystal: Record<string, unknown>): void {
  const urlVal = krystal.url;
  if (typeof urlVal !== "string" || !urlVal.trim()) return;

  const abs = canonicalizeUrl(urlVal.trim());
  // Ensure canonical URL is stamped into the object (server dedupe key).
  inhaleQueue.set(abs, { ...krystal, url: abs });

  if (!hasWindow) return;
  if (inhaleFlushTimer != null) window.clearTimeout(inhaleFlushTimer);
  inhaleFlushTimer = window.setTimeout(() => {
    inhaleFlushTimer = null;
    void flushInhaleQueue();
  }, INHALE_DEBOUNCE_MS);
}

/**
 * Parse an imported JSON file into:
 * - urls: any URLs we can add to the local registry (for rendering)
 * - rawKrystals: if the file already contains krystal objects, preserve them for API upload
 */
function parseImportedJson(
  value: unknown,
): { urls: string[]; rawKrystals: Record<string, unknown>[] } {
  const urls: string[] = [];
  const rawKrystals: Record<string, unknown>[] = [];

  const pushUrl = (u: string) => {
    const abs = canonicalizeUrl(u);
    if (!urls.includes(abs)) urls.push(abs);
  };

  // Case A: [ "url", "url", ... ]
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") {
        if (item.trim()) pushUrl(item.trim());
        continue;
      }
      // Case B: [ { url: "...", ... }, ... ]
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

  // Case C: { urls: [...] } (e.g. exhale response)
  if (isRecord(value)) {
    const maybeUrls = value.urls;
    if (Array.isArray(maybeUrls)) {
      for (const item of maybeUrls) {
        if (typeof item === "string" && item.trim()) pushUrl(item.trim());
      }
    }

    // Case D: single { url: "...", ... }
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

/**
 * Force an API inhale for a set of URLs (even if registry already had them),
 * by deriving krystals from the URL payloads or registry payloads.
 */
function forceInhaleUrls(urls: readonly string[]): void {
  for (const u of urls) {
    const abs = canonicalizeUrl(u);

    // Prefer the registry payload (already merged with witness-derived context).
    const p0 = memoryRegistry.get(abs) ?? extractPayloadFromUrl(abs);
    if (!p0) continue;

    const ctx = deriveWitnessContext(abs);
    const merged = mergeDerivedContext(p0, ctx);

    // Ensures inhale happens even if addUrl() reported "no change".
    enqueueInhaleKrystal(abs, merged);
  }

  // Kick an immediate flush (still batched + fail-soft).
  void flushInhaleQueue();
}

/** Load persisted URLs (if any) into memory registry. Includes modal/composer fallback list.
 *  IMPORTANT: hydrate via addUrl() so witness-chain topology gets synthesized.
 */
function hydrateRegistryFromStorage(): void {
  if (!canStorage) return;

  const ingestList = (raw: string | null) => {
    if (!raw) return;
    try {
      const urls: unknown = JSON.parse(raw);
      if (!Array.isArray(urls)) return;
      for (const u of urls) {
        if (typeof u !== "string") continue;
        // Local hydrate: treat as local so it can converge to API over time (batched).
        addUrl(u, true, false, true, "local");
      }
    } catch {
      /* ignore bad entries */
    }
  };

  ingestList(localStorage.getItem(REGISTRY_LS_KEY));
  ingestList(localStorage.getItem(MODAL_FALLBACK_LS_KEY));
}

/* ─────────────────────────────────────────────────────────────────────
 *  Remote pull (seal → urls) — every φ-pulse
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
): Promise<{ imported: number; remoteSeal?: string }> {
  let imported = 0;
  let remoteSeal: string | undefined;

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

    const urls = r.value.urls;
    if (!Array.isArray(urls) || urls.length === 0) break;

    let pageAdded = 0;

    // Batch import without persisting each time; persist once if anything changes.
    for (const u of urls) {
      if (typeof u !== "string") continue;
      const abs = canonicalizeUrl(u);
      if (memoryRegistry.has(abs)) continue;

      const changed = addUrl(abs, true, false, false, "remote");
      if (changed) {
        imported += 1;
        pageAdded += 1;
      }
    }

    // If this page had nothing new, we can stop early (urls are newest-first).
    if (pageAdded === 0) break;

    // If fewer than limit, no more pages.
    if (urls.length < URLS_PAGE_LIMIT) break;
  }

  if (imported > 0) {
    persistRegistryToStorage();
  }

  return { imported, remoteSeal };
}

/* ─────────────────────────────────────────────────────────────────────
 *  Tree building (pure, derived from registry)
 *  ───────────────────────────────────────────────────────────────────── */

/** Children: sorted by Kai time, MOST RECENT first (descending). */
function childrenOf(url: string, reg: Registry): string[] {
  const out: string[] = [];
  for (const [u, p] of reg) {
    if (p.parentUrl && canonicalizeUrl(p.parentUrl) === canonicalizeUrl(url)) {
      out.push(u);
    }
  }
  // sort by Kai timing for coherent branches — DESCENDING (most recent first)
  out.sort((a, b) => byKaiTime(reg.get(b)!, reg.get(a)!));
  return out;
}

function buildTree(
  rootUrl: string,
  reg: Registry,
  seen = new Set<string>(),
): SigilNode | null {
  const url = canonicalizeUrl(rootUrl);
  const payload = reg.get(url);
  if (!payload) return null;

  if (seen.has(url)) {
    // Break cycles defensively
    return { url, payload, children: [] };
  }
  seen.add(url);

  const kids = childrenOf(url, reg)
    .map((child) => buildTree(child, reg, seen))
    .filter(Boolean) as SigilNode[];

  return { url, payload, children: kids };
}

/** Compute branch size and latest Kai moment in that branch. */
function summarizeBranch(
  root: SigilNode,
): { nodeCount: number; latest: SigilSharePayloadLoose } {
  let nodeCount = 0;
  let latest = root.payload;

  const walk = (node: SigilNode) => {
    nodeCount += 1;
    if (byKaiTime(node.payload, latest) > 0) {
      latest = node.payload;
    }
    node.children.forEach(walk);
  };

  walk(root);
  return { nodeCount, latest };
}

/** Build a forest grouped by origin (each origin becomes a root).
 *  If origin itself is missing from the registry, we promote the earliest
 *  (by Kai timing) entry in that group as the root.
 *
 *  Forest ordering:
 *    1) Most recent latest Kai moment in branch (desc).
 *    2) Larger branch (more nodes) ranks higher.
 *    3) Fallback: root Kai time (desc).
 */
function buildForest(reg: Registry): SigilNode[] {
  const groups = new Map<string, string[]>(); // originUrl -> [urls]
  for (const [url, payload] of reg) {
    const origin = payload.originUrl
      ? canonicalizeUrl(payload.originUrl)
      : getOriginUrl(url) ?? url;
    if (!groups.has(origin)) groups.set(origin, []);
    groups.get(origin)!.push(url);
  }

  const decorated: BranchSummary[] = [];

  for (const origin of groups.keys()) {
    const node = buildTree(origin, reg);
    if (node) {
      const summary = summarizeBranch(node);
      decorated.push({
        root: node,
        nodeCount: summary.nodeCount,
        latest: summary.latest,
      });
    } else {
      // Origin missing: pick earliest by Kai-time within this group as synthetic root
      const urls = groups.get(origin)!;
      urls.sort((a, b) => byKaiTime(reg.get(a)!, reg.get(b)!)); // ascending: earliest first
      const syntheticRootUrl = urls[0];
      const synthetic = buildTree(syntheticRootUrl, reg);
      if (synthetic) {
        const summary = summarizeBranch(synthetic);
        decorated.push({
          root: synthetic,
          nodeCount: summary.nodeCount,
          latest: summary.latest,
        });
      }
    }
  }

  // Sort forest by:
  // 1) Latest Kai time in branch (most recent first)
  // 2) Node count (bigger branches float higher)
  // 3) Root Kai time (desc) as tie-breaker
  decorated.sort((a, b) => {
    const timeCmp = byKaiTime(b.latest, a.latest);
    if (timeCmp !== 0) return timeCmp;

    if (b.nodeCount !== a.nodeCount) return b.nodeCount - a.nodeCount;

    return byKaiTime(b.root.payload, a.root.payload);
  });

  return decorated.map((d) => d.root);
}

/* ─────────────────────────────────────────────────────────────────────
 *  Memory Stream detail extraction for each node
 *  ───────────────────────────────────────────────────────────────────── */

function buildDetailEntries(node: SigilNode): DetailEntry[] {
  const record = node.payload as unknown as Record<string, unknown>;
  const entries: DetailEntry[] = [];
  const usedKeys = new Set<string>();

  const phiSelf = getPhiFromPayload(node.payload);
  if (phiSelf !== undefined) {
    entries.push({
      label: "This glyph Φ",
      value: `${formatPhi(phiSelf)} Φ`,
    });
  }

  const addFromKey = (key: string, label: string) => {
    const v = record[key];
    if (typeof v === "string" && v.trim().length > 0 && !usedKeys.has(key)) {
      entries.push({ label, value: v.trim() });
      usedKeys.add(key);
    }
  };

  // Core identity
  addFromKey("userPhiKey", "PhiKey");
  addFromKey("phiKey", "PhiKey");
  addFromKey("phikey", "PhiKey");
  addFromKey("kaiSignature", "Kai Signature");

  // Parent / origin URLs
  const parentRaw = record.parentUrl;
  if (typeof parentRaw === "string" && parentRaw.length > 0) {
    entries.push({
      label: "Parent URL",
      value: canonicalizeUrl(parentRaw),
    });
    usedKeys.add("parentUrl");
  }

  const originRaw = record.originUrl;
  if (typeof originRaw === "string" && originRaw.length > 0) {
    entries.push({
      label: "Origin URL",
      value: canonicalizeUrl(originRaw),
    });
    usedKeys.add("originUrl");
  }

  // Basic label / description
  const labelCandidate =
    record.label ??
    record.title ??
    record.type ??
    record.note ??
    record.description;

  if (typeof labelCandidate === "string" && labelCandidate.trim().length > 0) {
    entries.push({
      label: "Label / Type",
      value: labelCandidate.trim(),
    });
  }

  // Explicit memory / stream URLs
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
      entries.push({
        label: key,
        value: v.trim(),
      });
      usedKeys.add(key);
    }
  }

  // Any extra fields that smell like memory / stream / feed
  for (const [key, value] of Object.entries(record)) {
    if (entries.length >= 10) break;
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

  // Fallback: hidden textarea
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
 *  Scoped inline styles (tiny surgical rules only; CSS file still owns layout)
 *  ───────────────────────────────────────────────────────────────────── */
const Styles: React.FC = () => (
  <style>{`
    /* Φ mark inside the brand square */
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
      filter: drop-shadow(0 6px 18px rgba(0,0,0,.28));
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
  // default CLOSED; only opens when toggle is clicked
  const [open, setOpen] = useState(false);
  const hash = parseHashFromUrl(node.url);
  const sig = node.payload.kaiSignature;
  const chakraDay = node.payload.chakraDay;
  const phiSentFromPulse = getPhiSentForPulse(node.payload.pulse);
  const detailEntries = buildDetailEntries(node);

  return (
    <div className="node">
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

          <a className="node-link" href={node.url} target="_blank" rel="noopener noreferrer" title={node.url}>
            <span style={{ opacity: 0.9 }}>{short(sig ?? hash ?? "glyph", 12)}</span>
          </a>
        </div>

        <div className="node-meta">
          <KaiStamp p={node.payload} />
          {chakraDay && (
            <span className="chakra" title={chakraDay}>
              {chakraDay}
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
        <div className="node-children">
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

          {node.children.map((c) => (
            <SigilTreeNode key={c.url} node={c} />
          ))}
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

  return (
    <section className="origin" aria-label="Sigil origin branch">
      <header className="origin-head">
        <div className="o-meta">
          <span className="o-title">Origin</span>
          <a className="o-link" href={root.url} target="_blank" rel="noopener noreferrer" title={root.url}>
            {short(originSig ?? originHash ?? "origin", 14)}
          </a>
        </div>
        <div className="o-right">
          <KaiStamp p={root.payload} />
          <span className="o-count" title="Total glyphs in this lineage">
            {count} nodes
          </span>
          <button
            className="o-copy"
            onClick={() => void copyText(root.url)}
            title="Copy origin URL"
            type="button"
          >
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
              <SigilTreeNode key={c.url} node={c} />
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
            <label className="kx-import" title="Import a JSON list of URLs">
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
            <span className="kx-pill" title="Total URLs in registry">
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
 *  Main Page
 *  ───────────────────────────────────────────────────────────────────── */
const SigilExplorer: React.FC = () => {
  const [, force] = useState(0);
  const [forest, setForest] = useState<SigilNode[]>([]);
  const [lastAdded, setLastAdded] = useState<string | undefined>(undefined);
  const unmounted = useRef(false);

  // Remote sync state (seal-based)
  const remoteSealRef = useRef<string | null>(null);
  const remotePollInFlightRef = useRef(false);

  /** Rebuild derived forest + light re-render. */
  const refresh = () => {
    if (unmounted.current) return;
    const f = buildForest(memoryRegistry);
    setForest(f);
    force((v) => v + 1);
  };

  // Initial hydrate, global hook, event listeners, and LAH-MAH-TOR pulse polling
  useEffect(() => {
    hydrateRegistryFromStorage();

    // Seed with current URL if it contains a payload we can extract
    if (hasWindow) {
      const here = window.location.href;
      if (extractPayloadFromUrl(here)) {
        addUrl(here, true, false, true, "local");
        setLastAdded(canonicalizeUrl(here));
      }
    }

    // (1) Expose the global hook that the composer/modal will call
    const prev = window.__SIGIL__?.registerSigilUrl;
    if (!window.__SIGIL__) window.__SIGIL__ = {};
    window.__SIGIL__.registerSigilUrl = (u: string) => {
      if (addUrl(u, true, true, true, "local")) {
        setLastAdded(canonicalizeUrl(u));
        refresh();
      }
    };

    // (2) Listen for composer/modal DOM event
    const onUrlRegistered = (e: Event) => {
      const anyEvent = e as CustomEvent<{ url: string }>;
      const u = anyEvent?.detail?.url;
      if (typeof u === "string" && u.length) {
        if (addUrl(u, true, true, true, "local")) {
          setLastAdded(canonicalizeUrl(u));
          refresh();
        }
      }
    };
    window.addEventListener("sigil:url-registered", onUrlRegistered as EventListener);

    // (3) Back-compat: still listen for sigil:minted if other parts dispatch it
    const onMint = (e: Event) => {
      const anyEvent = e as CustomEvent<{ url: string }>;
      if (anyEvent?.detail?.url) {
        if (addUrl(anyEvent.detail.url, true, true, true, "local")) {
          setLastAdded(canonicalizeUrl(anyEvent.detail.url));
          refresh();
        }
      }
    };
    window.addEventListener("sigil:minted", onMint as EventListener);

    // (4) Cross-tab sync via BroadcastChannel
    let onMsg: ((ev: MessageEvent) => void) | undefined;
    if (channel) {
      onMsg = (ev: MessageEvent) => {
        const data = ev.data as unknown as { type?: unknown; url?: unknown };
        if (data?.type === "sigil:add" && typeof data.url === "string") {
          if (addUrl(data.url, true, false, true, "local")) {
            setLastAdded(canonicalizeUrl(data.url));
            refresh();
          }
        }
      };
      channel.addEventListener("message", onMsg);
    }

    // (5) Also watch storage updates to the composer/modal fallback list
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === MODAL_FALLBACK_LS_KEY && ev.newValue) {
        try {
          const urls: unknown = JSON.parse(ev.newValue);
          if (!Array.isArray(urls)) return;

          let changed = false;
          for (const u of urls) {
            if (typeof u !== "string") continue;
            if (addUrl(u, true, false, false, "local")) changed = true;
          }

          if (changed) {
            setLastAdded(undefined);
            persistRegistryToStorage();
            refresh();
          }
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("storage", onStorage);

    refresh();

    // ── LAH-MAH-TOR: pulse polling loop (seal → urls)
    const ac = new AbortController();

    const pollOnce = async () => {
      if (unmounted.current) return;
      if (!isOnline()) return;
      if (remotePollInFlightRef.current) return;

      remotePollInFlightRef.current = true;

      try {
        // 1) Check seal
        const sealRes = await fetchJson<ApiSealResponse>(API_SEAL, {
          method: "GET",
          signal: ac.signal,
          cache: "no-store",
        });

        if (!sealRes.ok) return;

        const nextSeal = sealRes.value.seal;
        const prevSeal = remoteSealRef.current;

        // If unchanged, nothing to do
        if (prevSeal && nextSeal === prevSeal) return;

        // 2) Pull urls and import
        const importedRes = await pullAndImportRemoteUrls(ac.signal);

        // 3) Update seal if we got one (prefer urls state_seal if present)
        if (importedRes.remoteSeal) {
          remoteSealRef.current = importedRes.remoteSeal;
        } else {
          remoteSealRef.current = nextSeal;
        }

        if (importedRes.imported > 0) {
          setLastAdded(undefined);
          refresh();
        }
      } finally {
        remotePollInFlightRef.current = false;
      }
    };

    // Immediate pull on mount (so you converge instantly)
    void pollOnce();

    // Then every φ-pulse
    const intervalId = window.setInterval(() => {
      void pollOnce();
    }, PULSE_POLL_MS);

    return () => {
      // restore previous hook (if any)
      if (window.__SIGIL__) window.__SIGIL__.registerSigilUrl = prev;
      window.removeEventListener("sigil:url-registered", onUrlRegistered as EventListener);
      window.removeEventListener("sigil:minted", onMint as EventListener);
      window.removeEventListener("storage", onStorage);
      if (channel && onMsg) channel.removeEventListener("message", onMsg);
      window.clearInterval(intervalId);
      ac.abort();
      unmounted.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handlers
  const handleAdd = (url: string) => {
    const changed = addUrl(url, true, true, true, "local");
    if (changed) {
      setLastAdded(canonicalizeUrl(url));
      refresh();
    }
  };

const handleImport = async (file: File) => {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text) as unknown;

    const { urls, rawKrystals } = parseImportedJson(parsed);
    if (urls.length === 0 && rawKrystals.length === 0) return;

    // 1) Always ingest into local registry (for rendering)
    //    (keeps exact behavior: addUrl() builds witness topology, then we persist once)
    let changed = false;
    for (const u of urls) {
      if (addUrl(u, true, false, false, "local")) changed = true;
    }

    if (changed) {
      setLastAdded(undefined);
      persistRegistryToStorage();
      refresh();
    } else {
      // Even if nothing "changed", the user still intentionally inhaled this file.
      // We keep UI stable, but still ensure API inhale below.
      setLastAdded(undefined);
    }

    // 2) NEW: Force-send the imported JSON to the API (deduped, batched, fail-soft)
    //    - If the file contains krystal objects already, upload those as-is.
    //    - Otherwise derive krystals from the URLs and upload them.
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

      {/* Scroll viewport so content never gets cut off, even with details open */}
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
                <OriginPanel key={root.url} root={root} />
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
