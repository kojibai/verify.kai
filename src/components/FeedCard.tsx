// src/components/FeedCard.tsx
"use client";

/**
 * FeedCard — Sigil-Glyph Capsule Renderer
 * v4.5.0 — RELEASE: v27.6 — Remember copies full previous-chain (add=...) so a fresh browser
 *          repopulates the entire thread context with **zero local cache required**.
 *
 * ✅ True infinite-ready threading (URL refs + Content-ID mode)
 *    - Loop-safe (seen keys) + deep cap (THREAD_MAX_DEPTH)
 *    - Prefers explicit add= chain, then prevId/skip[1], then URL refs, then thread stitch
 *
 * ✅ Decode hardening:
 *    - Previous resolver scans *full decoded data* (not just capsule)
 *    - Ref-key recognition expanded (camelCase + snake_case + *Url variants)
 *
 * ✅ Content-ID mode:
 *    - Supports cid:<hex64> + /stream/c/<hex64> + ?id=
 *    - IndexedDB ContentStore (offline-first): id → payload
 *    - Auto-cache decoded nodes under contentId (computed or provided)
 *    - Prev chain can traverse by prevId with constant-size links
 *
 * ✅ Thread stitch fallback:
 *    - threadKey (threadId/thread_id + deep scan + root-derived)
 *    - Notifications are macrotask-deferred (no cascading “setState in effect” warnings)
 *
 * ✅ React correctness:
 *    - Content-ID loading uses an external store (useSyncExternalStore)
 *    - No derived contentId setState loops (explicitId memo; computedId async only)
 *    - InputKind typing hardened (id optional on union) — no TS2339 in deps
 *    - No conditional hooks (rules-of-hooks clean)
 *
 * ✅ v27.6 Remember guarantee:
 *    - Remember computes share URL at click-time from a chain graph populated by layout effects,
 *      plus any existing add= chain, then emits root→…→prev as add=...
 *    - Opening that URL reconstructs the full thread **without** relying on local caches/index.
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import KaiSigil from "../components/KaiSigil";
import { decodeSigilUrl } from "../utils/sigilDecode";
import {
  STEPS_BEAT,
  momentFromPulse,
  epochMsFromPulse,
  microPulsesSinceGenesis,
  N_DAY_MICRO,
  DAYS_PER_MONTH,
  DAYS_PER_YEAR,
  MONTHS_PER_YEAR,
  type ChakraDay,
} from "../utils/kai_pulse";
import type {
  Capsule,
  PostPayload,
  MessagePayload,
  SharePayload,
  ReactionPayload,
} from "../utils/sigilDecode";
import "./FeedCard.css";
import { TOKEN_HARD_LIMIT } from "../utils/feedPayload";

type Props = { url: string };

/** Safe string shortener */
const short = (s: string, head = 8, tail = 4): string =>
  s.length <= head + tail ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;

/** Host label helper */
const hostOf = (href?: string): string | undefined => {
  if (!href) return undefined;
  try {
    return new URL(href).host;
  } catch {
    return undefined;
  }
};

const isNonEmpty = (val: unknown): val is string =>
  typeof val === "string" && val.trim().length > 0;

/** Uppercase without type drama (guards union→never narrowing) */
const upper = (v: unknown): string => String(v ?? "").toUpperCase();

const TOKEN_HARD_LIMIT_SAFE =
  typeof TOKEN_HARD_LIMIT === "number" &&
  Number.isFinite(TOKEN_HARD_LIMIT) &&
  TOKEN_HARD_LIMIT > 0
    ? TOKEN_HARD_LIMIT
    : 140;

/** Defer notifications to a macrotask (prevents React “setState in effect” cascade warnings). */
function deferNotify(run: () => void): void {
  if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
    window.setTimeout(run, 0);
    return;
  }
  run();
}

/* ─────────────────────────────────────────────────────────────
   Decode normalization (ALL url/token forms) + Content-ID forms
   ───────────────────────────────────────────────────────────── */

type DecodeResult = ReturnType<typeof decodeSigilUrl>;
type SmartDecode = { decoded: DecodeResult; resolvedUrl: string };

function originFallback(): string {
  if (typeof window !== "undefined" && window.location?.origin)
    return window.location.origin;
  return "https://kaiklok.com";
}

/** Remove trailing punctuation often introduced by chat apps / markdown */
function stripEdgePunct(s: string): string {
  let t = s.trim();
  t = t.replace(/[)\].,;:!?]+$/g, "");
  t = t.replace(/^[([{"'`]+/g, "");
  return t.trim();
}

/** Normalize token: decode %xx, restore +, normalize base64 -> base64url, strip '=' */
function normalizeToken(raw: string): string {
  let t = stripEdgePunct(raw);

  if (/%[0-9A-Fa-f]{2}/.test(t)) {
    try {
      t = decodeURIComponent(t);
    } catch {
      /* keep raw */
    }
  }

  // query/base64 legacy: '+' may come through as space
  if (t.includes(" ")) t = t.replaceAll(" ", "+");

  // base64 -> base64url
  if (/[+/=]/.test(t)) {
    t = t.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
  }

  return stripEdgePunct(t);
}

function makeStreamOpenUrlFromToken(tokenRaw: string): string {
  const base = originFallback().replace(/\/+$/g, "");
  const t = normalizeToken(tokenRaw);

  // ✅ SHORT: server-safe path form
  if (t.length <= TOKEN_HARD_LIMIT_SAFE) {
    return `${base}/stream/p/${encodeURIComponent(t)}`;
  }

  // ✅ HUGE: hash form (never hits server, always reloads)
  return `${base}/stream#t=${t}`;
}

function isLikelyToken(s: string): boolean {
  return /^[A-Za-z0-9_-]{16,}$/.test(s);
}

/* ─────────────────────────────────────────────────────────────
   Content-ID (constant-size link) support
   ───────────────────────────────────────────────────────────── */

function isLikelyContentId(s: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(s.trim());
}

function normalizeContentId(raw: string): string {
  return raw.trim().toLowerCase();
}

function makeStreamOpenUrlFromContentId(idRaw: string): string {
  const base = originFallback().replace(/\/+$/g, "");
  const id = normalizeContentId(idRaw);
  return `${base}/stream/c/${encodeURIComponent(id)}`;
}

function extractContentIdFromPath(pathname: string): string | null {
  // /stream/c/<id>
  {
    const m = pathname.match(/\/stream\/c\/([0-9a-fA-F]{64})(?:\/|$)/);
    if (m?.[1]) return m[1];
  }
  // /c/<id>
  {
    const m = pathname.match(/\/c\/([0-9a-fA-F]{64})(?:\/|$)/);
    if (m?.[1]) return m[1];
  }
  return null;
}

function tryParseUrl(raw: string): URL | null {
  const t = raw.trim();
  try {
    return new URL(t);
  } catch {
    try {
      return new URL(t, originFallback());
    } catch {
      return null;
    }
  }
}

/** Extract content-id candidates from a raw URL (also tries nested add= urls once). */
function extractContentIdCandidates(rawUrl: string, depth = 0): string[] {
  const out: string[] = [];
  const push = (v: string | null | undefined) => {
    if (!v) return;
    const s = stripEdgePunct(v);
    if (!s) return;

    // cid:HEX
    const m = s.match(/^cid:([0-9a-fA-F]{64})$/);
    if (m?.[1]) {
      const id = normalizeContentId(m[1]);
      if (!out.includes(id)) out.push(id);
      return;
    }

    if (!isLikelyContentId(s)) return;
    const id = normalizeContentId(s);
    if (!out.includes(id)) out.push(id);
  };

  const raw = stripEdgePunct(rawUrl);

  // bare id support
  push(raw);

  const u = tryParseUrl(raw);
  if (!u) return out;

  const hashStr = u.hash && u.hash.startsWith("#") ? u.hash.slice(1) : "";
  const hash = new URLSearchParams(hashStr);
  const search = u.searchParams;

  const keys = ["id", "cid", "contentId", "content_id"];
  for (const k of keys) {
    push(hash.get(k));
    push(search.get(k));
  }

  push(extractContentIdFromPath(u.pathname));

  // nested add= urls (common in reply/share wrappers)
  if (depth < 1) {
    const adds = [...search.getAll("add"), ...hash.getAll("add")];
    for (const a of adds) {
      const maybeUrl = stripEdgePunct(a);
      if (!maybeUrl) continue;

      let decoded = maybeUrl;
      if (/%[0-9A-Fa-f]{2}/.test(decoded)) {
        try {
          decoded = decodeURIComponent(decoded);
        } catch {
          /* ignore */
        }
      }
      for (const id of extractContentIdCandidates(decoded, depth + 1)) push(id);
    }
  }

  return out;
}

function extractFromPath(pathname: string): string | null {
  // Legacy p-tilde path (allow /p~TOKEN and /p~/TOKEN), including percent-encoded tilde
  {
    const m = pathname.match(/\/p(?:\u007e|%7[Ee])\/?([^/?#]+)/);
    if (m?.[1]) return m[1];
  }
  // /stream/p/TOKEN or /feed/p/TOKEN
  {
    const m = pathname.match(/\/(?:stream|feed)\/p\/([^/?#]+)/);
    if (m?.[1]) return m[1];
  }
  // /p/TOKEN (older)
  {
    const m = pathname.match(/\/p\/([^/?#]+)/);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Extract token candidates from a raw URL (also tries nested add= urls once). */
function extractTokenCandidates(rawUrl: string, depth = 0): string[] {
  const out: string[] = [];
  const push = (v: string | null | undefined) => {
    if (!v) return;
    const tok = normalizeToken(v);
    if (!tok) return;
    if (!isLikelyToken(tok)) return;
    if (!out.includes(tok)) out.push(tok);
  };

  const raw = stripEdgePunct(rawUrl);

  // bare token support
  if (isLikelyToken(raw)) push(raw);

  const u = tryParseUrl(raw);
  if (!u) return out;

  const hashStr = u.hash && u.hash.startsWith("#") ? u.hash.slice(1) : "";
  const hash = new URLSearchParams(hashStr);
  const search = u.searchParams;

  const keys = ["t", "p", "token", "capsule"];
  for (const k of keys) {
    push(hash.get(k));
    push(search.get(k));
  }

  push(extractFromPath(u.pathname));

  // nested add= urls (common in reply/share wrappers)
  if (depth < 1) {
    const adds = [...search.getAll("add"), ...hash.getAll("add")];
    for (const a of adds) {
      const maybeUrl = stripEdgePunct(a);
      if (!maybeUrl) continue;

      let decoded = maybeUrl;
      if (/%[0-9A-Fa-f]{2}/.test(decoded)) {
        try {
          decoded = decodeURIComponent(decoded);
        } catch {
          /* ignore */
        }
      }
      for (const tok of extractTokenCandidates(decoded, depth + 1)) push(tok);
    }
  }

  return out;
}

/** Keep sigil payload (/s/...) untouched. */
function isSPayloadUrl(raw: string): boolean {
  const t = stripEdgePunct(raw);
  const u = tryParseUrl(t);
  const path = u ? u.pathname : t;
  return /^\/s(?:\/|$)/.test(path);
}

/** Normalize any non-/s URL into /stream/(c|p)/... when possible. */
function normalizeResolvedUrlForBrowser(rawUrl: string): string {
  const raw = stripEdgePunct(rawUrl);
  if (isSPayloadUrl(raw)) return raw;

  const cid = extractContentIdCandidates(raw)[0];
  if (cid) return makeStreamOpenUrlFromContentId(cid);

  const tok = extractTokenCandidates(raw)[0];
  return tok ? makeStreamOpenUrlFromToken(tok) : raw;
}

/** Build canonical url candidates to satisfy whatever decodeSigilUrl already supports. */
function buildDecodeUrlCandidates(token: string): string[] {
  const base = originFallback().replace(/\/+$/g, "");
  const t = normalizeToken(token);

  return [
    t,
    `${base}/stream/p/${t}`,
    `${base}/p#t=${t}`,
    `${base}/p?t=${t}`,
    `${base}/p#p=${t}`,
    `${base}/p?p=${t}`,
    `${base}/p#token=${t}`,
    `${base}/p?token=${t}`,
  ];
}

/** Smart decode: try raw url, then extracted tokens across multiple canonical forms. */
function decodeSigilUrlSmart(rawUrl: string): SmartDecode {
  const tried = new Set<string>();

  const attempt = (candidate: string): DecodeResult | null => {
    const c = candidate.trim();
    if (!c || tried.has(c)) return null;
    tried.add(c);
    const r = decodeSigilUrl(c);
    return r.ok ? r : null;
  };

  const rawTrim = stripEdgePunct(rawUrl);

  const rawOk = attempt(rawTrim);
  if (rawOk) {
    return { decoded: rawOk, resolvedUrl: normalizeResolvedUrlForBrowser(rawTrim) };
  }

  const tokens = extractTokenCandidates(rawTrim);
  for (const tok of tokens) {
    for (const cand of buildDecodeUrlCandidates(tok)) {
      const ok = attempt(cand);
      if (ok) return { decoded: ok, resolvedUrl: makeStreamOpenUrlFromToken(tok) };
    }
  }

  return {
    decoded: decodeSigilUrl(rawTrim),
    resolvedUrl: normalizeResolvedUrlForBrowser(rawTrim),
  };
}

/* ─────────────────────────────────────────────────────────────
   Offline-first ContentStore (IndexedDB): id → payload
   ───────────────────────────────────────────────────────────── */

const CONTENT_DB_NAME = "kai_content_store_v1";
const CONTENT_STORE = "content";
const CONTENT_DB_VERSION = 1;

type ContentRow = { id: string; payload: unknown; savedAt: number };

let CONTENT_DB_PROMISE: Promise<IDBDatabase> | null = null;

function openContentDb(): Promise<IDBDatabase> {
  if (CONTENT_DB_PROMISE) return CONTENT_DB_PROMISE;

  CONTENT_DB_PROMISE = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === "undefined" || typeof window.indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }

    const req = window.indexedDB.open(CONTENT_DB_NAME, CONTENT_DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CONTENT_STORE)) {
        const store = db.createObjectStore(CONTENT_STORE, { keyPath: "id" });
        store.createIndex("savedAt", "savedAt", { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });

  return CONTENT_DB_PROMISE;
}

function idbGetContent(idRaw: string): Promise<unknown | null> {
  const id = normalizeContentId(idRaw);
  return openContentDb()
    .then(
      (db) =>
        new Promise<unknown | null>((resolve, reject) => {
          const tx = db.transaction(CONTENT_STORE, "readonly");
          const store = tx.objectStore(CONTENT_STORE);
          const req = store.get(id);

          req.onsuccess = () => {
            const row = req.result as ContentRow | undefined;
            resolve(row?.payload ?? null);
          };
          req.onerror = () => reject(req.error ?? new Error("IndexedDB get failed"));
        }),
    )
    .catch(() => null);
}

function idbPutContent(idRaw: string, payload: unknown): Promise<void> {
  const id = normalizeContentId(idRaw);
  return openContentDb()
    .then(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(CONTENT_STORE, "readwrite");
          const store = tx.objectStore(CONTENT_STORE);
          const row: ContentRow = { id, payload, savedAt: Date.now() };
          const req = store.put(row);

          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error ?? new Error("IndexedDB put failed"));
        }),
    )
    .catch(() => undefined);
}

async function fetchContentById(idRaw: string): Promise<unknown | null> {
  const id = normalizeContentId(idRaw);
  if (typeof window === "undefined") return null;

  const base = originFallback().replace(/\/+$/g, "");
  const candidates: string[] = [
    `${base}/content/${id}`,
    `${base}/keystream/content/${id}`,
    `${base}/api/content/${id}`,
    `${base}/content?id=${encodeURIComponent(id)}`,
    `${base}/keystream/content?id=${encodeURIComponent(id)}`,
    `${base}/api/content?id=${encodeURIComponent(id)}`,
  ];

  for (const href of candidates) {
    try {
      const res = await fetch(href, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) continue;
      const json: unknown = await res.json();
      return json;
    } catch {
      // try next candidate
    }
  }

  return null;
}

async function getOrFetchContentById(idRaw: string): Promise<unknown | null> {
  const id = normalizeContentId(idRaw);

  const local = await idbGetContent(id);
  if (local) return local;

  const remote = await fetchContentById(id);
  if (remote) {
    void idbPutContent(id, remote);
    return remote;
  }

  return null;
}

/* ─────────────────────────────────────────────────────────────
   Content load external store (removes sync setState-from-effect)
   ───────────────────────────────────────────────────────────── */

type ContentState =
  | { status: "idle"; payload: null }
  | { status: "loading"; payload: null }
  | { status: "ok"; payload: unknown }
  | { status: "error"; payload: null; error: string };

const CONTENT_STATE: Map<string, ContentState> = new Map();
const CONTENT_STATE_VERSION: Map<string, number> = new Map();
const CONTENT_STATE_LISTENERS: Set<(id: string) => void> = new Set();
const CONTENT_INFLIGHT: Map<string, Promise<void>> = new Map();

function contentStateGet(idRaw: string): ContentState {
  const id = normalizeContentId(idRaw);
  return CONTENT_STATE.get(id) ?? { status: "idle", payload: null };
}

function contentStateSame(a: ContentState, b: ContentState): boolean {
  if (a.status !== b.status) return false;
  if (a.status === "ok" && b.status === "ok") return a.payload === b.payload;
  if (a.status === "error" && b.status === "error") return a.error === b.error;
  return true;
}

function notifyContentStateChanged(idRaw: string): void {
  const id = normalizeContentId(idRaw);
  const listeners = Array.from(CONTENT_STATE_LISTENERS);
  deferNotify(() => {
    for (const fn of listeners) {
      try {
        fn(id);
      } catch {
        /* ignore */
      }
    }
  });
}

function contentStateSet(idRaw: string, next: ContentState): void {
  const id = normalizeContentId(idRaw);
  const prev = CONTENT_STATE.get(id) ?? { status: "idle", payload: null };

  if (contentStateSame(prev, next)) return;

  CONTENT_STATE.set(id, next);
  const v = (CONTENT_STATE_VERSION.get(id) ?? 0) + 1;
  CONTENT_STATE_VERSION.set(id, v);

  notifyContentStateChanged(id);
}

function subscribeContentState(listener: (id: string) => void): () => void {
  CONTENT_STATE_LISTENERS.add(listener);
  return () => {
    CONTENT_STATE_LISTENERS.delete(listener);
  };
}

function ensureContentLoaded(idRaw: string): void {
  const id = normalizeContentId(idRaw);
  if (!isLikelyContentId(id)) return;

  const cur = contentStateGet(id);
  if (cur.status === "ok" || cur.status === "loading") return;

  const inflight = CONTENT_INFLIGHT.get(id);
  if (inflight) return;

  contentStateSet(id, { status: "loading", payload: null });

  const p = (async () => {
    const payload = await getOrFetchContentById(id);
    if (!payload) {
      contentStateSet(id, {
        status: "error",
        payload: null,
        error: "Content not found (id → payload).",
      });
      return;
    }
    contentStateSet(id, { status: "ok", payload });
  })()
    .catch(() => {
      contentStateSet(id, {
        status: "error",
        payload: null,
        error: "Content load failed.",
      });
    })
    .finally(() => {
      CONTENT_INFLIGHT.delete(id);
    });

  CONTENT_INFLIGHT.set(id, p);
}

/* ─────────────────────────────────────────────────────────────
   Canonical SHA256 (for transitional auto-contentId)
   ───────────────────────────────────────────────────────────── */

function deepSortForJson(v: unknown): unknown {
  if (v === null) return null;

  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" || typeof v === "boolean") return v;

  if (typeof v === "bigint") return v.toString();

  if (Array.isArray(v)) return v.map(deepSortForJson);

  if (v && typeof v === "object") {
    const rec = v as Record<string, unknown>;
    const keys = Object.keys(rec).sort((a, b) => a.localeCompare(b));
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = deepSortForJson(rec[k]);
    return out;
  }

  return null;
}

async function sha256HexFromString(s: string): Promise<string | null> {
  try {
    if (typeof window === "undefined") return null;
    const c = window.crypto;
    if (!c || !c.subtle) return null;

    const enc = new TextEncoder();
    const data = enc.encode(s);
    const hash = await c.subtle.digest("SHA-256", data);
    const bytes = new Uint8Array(hash);

    let out = "";
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      out += (b < 16 ? "0" : "") + b.toString(16);
    }
    return out;
  } catch {
    return null;
  }
}

async function computeContentIdFromPayload(payload: unknown): Promise<string | null> {
  const canon = JSON.stringify(deepSortForJson(payload));
  return sha256HexFromString(canon);
}

/* ─────────────────────────────────────────────────────────────
   KKS-1.0: D/M/Y from μpulses (exact, deterministic)
   ───────────────────────────────────────────────────────────── */

const modE = (a: bigint, m: bigint): bigint => {
  const r = a % m;
  return r >= 0n ? r : r + m;
};

const floorDivE = (a: bigint, d: bigint): bigint => {
  if (d === 0n) throw new Error("Division by zero");
  const q = a / d;
  const r = a % d;
  return r === 0n ? q : a >= 0n ? q : q - 1n;
};

const toSafeNumber = (x: bigint): number => {
  const MAX = BigInt(Number.MAX_SAFE_INTEGER);
  const MIN = BigInt(Number.MIN_SAFE_INTEGER);
  if (x > MAX) return Number.MAX_SAFE_INTEGER;
  if (x < MIN) return Number.MIN_SAFE_INTEGER;
  return Number(x);
};

function kaiDMYFromPulseKKS(pulse: number): { day: number; month: number; year: number } {
  const ms = epochMsFromPulse(pulse); // bigint
  const pμ = microPulsesSinceGenesis(ms); // bigint μpulses

  const dayIdx = floorDivE(pμ, N_DAY_MICRO);
  const monthIdx = floorDivE(dayIdx, BigInt(DAYS_PER_MONTH));
  const yearIdx = floorDivE(dayIdx, BigInt(DAYS_PER_YEAR));

  const dayOfMonth = toSafeNumber(modE(dayIdx, BigInt(DAYS_PER_MONTH))) + 1; // 1..42
  const month = toSafeNumber(modE(monthIdx, BigInt(MONTHS_PER_YEAR))) + 1; // 1..8
  const year = toSafeNumber(yearIdx);

  return { day: dayOfMonth, month, year };
}

function toChakra(value: unknown, fallback: ChakraDay): ChakraDay {
  if (typeof value === "string") {
    const v = value.trim();
    if (v === "Krown") return "Crown";
    if (
      v === "Root" ||
      v === "Sacral" ||
      v === "Solar Plexus" ||
      v === "Heart" ||
      v === "Throat" ||
      v === "Third Eye" ||
      v === "Crown"
    ) {
      return v as ChakraDay;
    }
  }
  return fallback;
}

function arcFromBeat(
  beatZ: number,
):
  | "Ignition"
  | "Integration"
  | "Harmonization"
  | "Reflection"
  | "Purification"
  | "Dream" {
  const idx = Math.max(0, Math.min(5, Math.floor(beatZ / 6)));
  return (["Ignition", "Integration", "Harmonization", "Reflection", "Purification", "Dream"] as const)[
    idx
  ];
}

const pad2 = (n: number): string => String(Math.max(0, Math.floor(n))).padStart(2, "0");

function buildKaiMetaLineZero(
  pulse: number,
  beatZ: number,
  stepZ: number,
  day: number,
  month: number,
  year: number,
): { arc: string; label: string; line: string } {
  const arc = arcFromBeat(beatZ);
  const label = `${pad2(beatZ)}:${pad2(stepZ)}`;
  const d = Math.max(1, Math.floor(day));
  const m = Math.max(1, Math.floor(month));
  const y = Math.floor(year);
  const line = `☤KAI:${pulse} • ${label} D${d}/M${m}/Y${y}`;
  return { arc, label, line };
}

function stepPctFromIndex(stepZ: number): number {
  const s = Math.max(0, Math.min(STEPS_BEAT - 1, Math.floor(stepZ)));
  const pct = s / STEPS_BEAT;
  return pct >= 1 ? 1 - 1e-12 : pct;
}

const CHAKRA_RGB: Record<string, readonly [number, number, number]> = {
  Root: [255, 88, 88],
  Sacral: [255, 146, 88],
  "Solar Plexus": [255, 215, 128],
  Heart: [88, 255, 174],
  Throat: [42, 197, 255],
  "Third Eye": [164, 126, 255],
  Crown: [238, 241, 251],
  Krown: [238, 241, 251],
} as const;

function legacySourceFromData(data: unknown): string | undefined {
  if (data && typeof data === "object" && "source" in data) {
    const v = (data as { source?: unknown }).source;
    return typeof v === "string" ? v : undefined;
  }
  return undefined;
}

function kindFromDecodedData(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "kind" in data) {
    const k = (data as { kind?: unknown }).kind;
    if (typeof k === "string" && k.trim().length > 0) return k;
  }
  return fallback;
}

/* ─────────────────────────────────────────────────────────────
   Thread context (previous → previous → …)
   ───────────────────────────────────────────────────────────── */

const THREAD_MAX_DEPTH = 256;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

type RefScore = 0 | 1 | 2 | 3 | 8 | 9 | 10;

const normalizeRefKey = (k: string): string =>
  k.trim().toLowerCase().replace(/[_-]/g, "");

const REF_KEYS_SET = new Set<string>([
  "prev",
  "previous",
  "previd",
  "previousid",
  "prevurl",
  "previousurl",
  "parent",
  "parentid",
  "parenturl",
  "inreplyto",
  "inreplytoid",
  "inreplytourl",
  "replyto",
  "replytoid",
  "replytourl",
  "reply",
  "replyid",
  "replyurl",
  "thread",
  "threadid",
  "threadurl",
  "root",
  "rootid",
  "rooturl",
  "ref",
  "refid",
  "refurl",
]);

function isRefKey(k: string): boolean {
  return REF_KEYS_SET.has(normalizeRefKey(k));
}

function scoreRefKey(k: string): RefScore {
  const key = normalizeRefKey(k);

  if (key === "previd" || key === "previousid") return 0;
  if (key === "prev" || key === "previous" || key === "prevurl" || key === "previousurl") return 0;

  if (key === "parentid") return 1;
  if (key === "parent" || key === "parenturl") return 1;

  if (key === "inreplytoid" || key === "replytoid") return 2;
  if (
    key === "inreplyto" ||
    key === "inreplytourl" ||
    key === "replyto" ||
    key === "replytourl"
  )
    return 2;

  if (key === "replyid") return 3;
  if (key === "reply" || key === "replyurl") return 3;

  if (key === "threadid") return 8;
  if (key === "thread" || key === "threadurl") return 8;

  if (key === "rootid") return 9;
  if (key === "root" || key === "rooturl") return 9;

  if (key === "refid") return 10;
  if (key === "ref" || key === "refurl") return 10;

  return 10;
}

const REF_VALUE_KEYS: readonly string[] = [
  "url",
  "href",
  "refUrl",
  "ref",
  "link",
  "token",
  "t",
  "p",
  "id",
  "cid",
  "contentId",
  "content_id",
] as const;

function isInternalHost(host: string): boolean {
  try {
    const cur = new URL(originFallback()).host;
    return host === cur || host === "kaiklok.com";
  } catch {
    return host === "kaiklok.com";
  }
}

function resolveThreadUrlCandidate(raw: string): string | null {
  const s = stripEdgePunct(raw);
  if (!s) return null;

  // cid:...
  const m = s.match(/^cid:([0-9a-fA-F]{64})$/);
  if (m?.[1]) return makeStreamOpenUrlFromContentId(m[1]);

  // /s/... payload: keep untouched ONLY if same-origin; otherwise fall through to token/id extraction
  if (isSPayloadUrl(s)) {
    const u = tryParseUrl(s);
    if (u && isInternalHost(u.host)) return u.toString();
    // else: continue, try extracting id/token below
  }

  // content-id anywhere → internal stream open
  const cid = extractContentIdCandidates(s)[0];
  if (cid) return makeStreamOpenUrlFromContentId(cid);

  // token anywhere → internal stream open
  const tok = extractTokenCandidates(s)[0];
  if (tok) return makeStreamOpenUrlFromToken(tok);

  // otherwise: only accept internal stream-ish urls
  const u = tryParseUrl(s);
  if (!u) return null;
  if (!isInternalHost(u.host)) return null;

  const p = u.pathname || "";
  if (/^\/(stream|p|c)(\/|$)/.test(p) || /^\/p~/.test(p)) {
    return normalizeResolvedUrlForBrowser(u.toString());
  }

  return null;
}

function threadSeenKey(rawUrl: string): string {
  const cid = extractContentIdCandidates(rawUrl)[0];
  if (cid) return `cid:${normalizeContentId(cid)}`;

  const tok = extractTokenCandidates(rawUrl)[0];
  if (tok) return `t:${normalizeToken(tok)}`;

  return `u:${normalizeResolvedUrlForBrowser(rawUrl)}`;
}

/* ─────────────────────────────────────────────────────────────
   Remember chain graph (full prev-chain → add=... URL)
   ───────────────────────────────────────────────────────────── */

const REMEMBER_CHAIN_MAX_ITEMS = 256;
const REMEMBER_CHAIN_MAX_URL_CHARS = 6500;
const CHAIN_GRAPH_MAX_NODES = 4096;

type ChainEdge = {
  key: string; // canonical key (cid:/t:/u:)
  selfRef: string; // compact ref to represent THIS node in add= (id/token/url)
  prevKey: string | null; // canonical-ish (may be raw, canonicalized on read)
  savedAt: number;
};

const CHAIN_GRAPH: Map<string, ChainEdge> = new Map();
const CHAIN_ALIAS: Map<string, string> = new Map();

function canonicalChainKey(rawKey: string): string {
  let k = rawKey;
  for (let i = 0; i < 6; i++) {
    const next = CHAIN_ALIAS.get(k);
    if (!next || next === k) break;
    k = next;
  }
  return k;
}

function setChainAlias(aliasKeyRaw: string, canonicalKeyRaw: string): void {
  const aliasKey = aliasKeyRaw.trim();
  const canonicalKey = canonicalKeyRaw.trim();
  if (!aliasKey || !canonicalKey) return;
  if (aliasKey === canonicalKey) return;
  CHAIN_ALIAS.set(aliasKey, canonicalKey);
}

/** Prefer bare contentId, else bare token, else normalized url for compact add= refs. */
function encodeChainRef(raw: string): string {
  const cid = extractContentIdCandidates(raw)[0];
  if (cid) return normalizeContentId(cid);

  const tok = extractTokenCandidates(raw)[0];
  if (tok) return normalizeToken(tok);

  return normalizeResolvedUrlForBrowser(raw);
}

function chainGraphUpsert(
  canonicalKeyRaw: string,
  selfRefRaw: string,
  prevUrlRaw: string | null,
  aliasKeys: readonly string[],
): void {
  const canonicalKey = canonicalChainKey(canonicalKeyRaw);
  if (!canonicalKey) return;

  // Bind aliases → canonical (so token-key can resolve to cid-key later)
  for (const ak of aliasKeys) setChainAlias(ak, canonicalKey);

  const prevKey =
    prevUrlRaw && isNonEmpty(prevUrlRaw)
      ? canonicalChainKey(threadSeenKey(prevUrlRaw))
      : null;

  const next: ChainEdge = {
    key: canonicalKey,
    selfRef: selfRefRaw,
    prevKey,
    savedAt: Date.now(),
  };

  const prev = CHAIN_GRAPH.get(canonicalKey);
  if (prev && prev.selfRef === next.selfRef && prev.prevKey === next.prevKey) return;

  CHAIN_GRAPH.set(canonicalKey, next);

  // Evict oldest (in insertion order) if over cap
  while (CHAIN_GRAPH.size > CHAIN_GRAPH_MAX_NODES) {
    const oldest = CHAIN_GRAPH.keys().next().value as string | undefined;
    if (!oldest) break;
    CHAIN_GRAPH.delete(oldest);
  }
}

function buildPrevChainAddsFromGraph(selfKeyRaw: string, limit: number): string[] {
  const adds: string[] = [];
  const seen = new Set<string>();

  const startKey = canonicalChainKey(selfKeyRaw);
  const edge = CHAIN_GRAPH.get(startKey);
  let prevKey = edge?.prevKey ?? null;

  let steps = 0;
  while (prevKey && steps < limit) {
    const pk = canonicalChainKey(prevKey);
    if (!pk || seen.has(pk)) break;
    seen.add(pk);

    const e = CHAIN_GRAPH.get(pk);
    if (!e) break;

    adds.push(e.selfRef);
    prevKey = e.prevKey;
    steps++;
  }

  adds.reverse(); // root → … → immediate prev
  return adds;
}

function buildRememberUrlWithAdds(baseUrlRaw: string, adds: readonly string[]): string {
  const base = normalizeResolvedUrlForBrowser(baseUrlRaw);
  if (!adds.length) return base;

  const u0 = tryParseUrl(base);
  if (!u0) return base;

  const baseSearch = new URLSearchParams(u0.searchParams);
  baseSearch.delete("add");

  const baseHashStr = u0.hash && u0.hash.startsWith("#") ? u0.hash.slice(1) : "";
  const baseHash = new URLSearchParams(baseHashStr);
  baseHash.delete("add");

  // If the base already uses hash params (e.g. /stream#t=...), keep the chain in hash.
  const useHashForAdds = baseHashStr.length > 0;

  // Drop oldest adds until under URL length cap (keeps immediate context if needed)
  for (let cut = 0; cut <= adds.length; cut++) {
    const slice = adds.slice(cut);

    const u = new URL(u0.toString());

    if (useHashForAdds) {
      const hp = new URLSearchParams(baseHash);
      for (const a of slice) hp.append("add", a);
      u.hash = hp.toString() ? `#${hp.toString()}` : "";
      u.search = baseSearch.toString() ? `?${baseSearch.toString()}` : "";
    } else {
      const sp = new URLSearchParams(baseSearch);
      for (const a of slice) sp.append("add", a);
      u.search = sp.toString() ? `?${sp.toString()}` : "";
      u.hash = baseHash.toString() ? `#${baseHash.toString()}` : "";
    }

    const out = u.toString();
    if (out.length <= REMEMBER_CHAIN_MAX_URL_CHARS || slice.length === 0) return out;
  }

  return base;
}

function dedupAddsPreserveOrder(list: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of list) {
    const s = String(it ?? "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function chooseAddsLongest(a: readonly string[], b: readonly string[]): string[] {
  const aa = dedupAddsPreserveOrder(a);
  const bb = dedupAddsPreserveOrder(b);
  return aa.length >= bb.length ? aa : bb;
}

/* ─────────────────────────────────────────────────────────────
   Thread index (fallback stitching via threadKey)
   ───────────────────────────────────────────────────────────── */

type ThreadIndexItem = { pulse: number; url: string };

const THREAD_INDEX_MAX_THREADS = 96;
const THREAD_INDEX_MAX_ITEMS_PER_THREAD = 96;

// In-memory (session)
const THREAD_INDEX: Map<string, ThreadIndexItem[]> = new Map();
const THREAD_INDEX_VERSION: Map<string, number> = new Map();

// Light persistence (best effort)
const THREAD_INDEX_LS_KEY = "kai_thread_index_v1";
let THREAD_INDEX_PERSIST_LOADED = false;
let THREAD_INDEX_LAST_PERSIST_MS = 0;

function safeNowMs(): number {
  return Date.now();
}

function loadThreadIndexFromStorageOnce(): void {
  if (THREAD_INDEX_PERSIST_LOADED) return;
  THREAD_INDEX_PERSIST_LOADED = true;

  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(THREAD_INDEX_LS_KEY);
    if (!raw) return;

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;

    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const threadId = typeof k === "string" ? k.trim() : "";
      if (!threadId) continue;
      if (!Array.isArray(v)) continue;

      const items: ThreadIndexItem[] = [];
      for (const it of v) {
        if (!it || typeof it !== "object") continue;
        const rec = it as Record<string, unknown>;
        const p = rec.pulse;
        const u = rec.url;
        if (typeof p !== "number" || !Number.isFinite(p)) continue;
        if (typeof u !== "string" || !u.trim()) continue;
        items.push({ pulse: p, url: normalizeResolvedUrlForBrowser(u) });
      }

      if (!items.length) continue;

      items.sort((a, b) => a.pulse - b.pulse);
      const capped = items.slice(-THREAD_INDEX_MAX_ITEMS_PER_THREAD);
      THREAD_INDEX.set(threadId, capped);
      if (THREAD_INDEX.size > THREAD_INDEX_MAX_THREADS) {
        const oldest = THREAD_INDEX.keys().next().value as string | undefined;
        if (oldest) THREAD_INDEX.delete(oldest);
      }
    }
  } catch {
    // ignore
  }
}

function persistThreadIndexThrottled(): void {
  if (typeof window === "undefined") return;

  const now = safeNowMs();
  if (now - THREAD_INDEX_LAST_PERSIST_MS < 700) return;
  THREAD_INDEX_LAST_PERSIST_MS = now;

  try {
    const obj: Record<string, Array<{ pulse: number; url: string }>> = {};
    for (const [threadId, items] of THREAD_INDEX.entries()) {
      obj[threadId] = items.slice(-THREAD_INDEX_MAX_ITEMS_PER_THREAD).map((it) => ({
        pulse: it.pulse,
        url: it.url,
      }));
    }
    window.localStorage.setItem(THREAD_INDEX_LS_KEY, JSON.stringify(obj));
  } catch {
    // ignore
  }
}

type ThreadIndexListener = (threadId: string) => void;
const THREAD_INDEX_LISTENERS: Set<ThreadIndexListener> = new Set();

function notifyThreadIndexChanged(threadId: string): void {
  // ✅ Macrotask defer eliminates “setState synchronously within an effect” warnings.
  const listeners = Array.from(THREAD_INDEX_LISTENERS);
  deferNotify(() => {
    for (const fn of listeners) {
      try {
        fn(threadId);
      } catch {
        /* ignore */
      }
    }
  });
}

function subscribeThreadIndex(listener: ThreadIndexListener): () => void {
  THREAD_INDEX_LISTENERS.add(listener);
  return () => {
    THREAD_INDEX_LISTENERS.delete(listener);
  };
}

function sameThreadList(a: ThreadIndexItem[], b: ThreadIndexItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    if (!ai || !bi) return false;
    if (ai.url !== bi.url) return false;
    if (ai.pulse !== bi.pulse) return false;
  }
  return true;
}

function threadIndexAdd(threadIdRaw: string, item: ThreadIndexItem): void {
  loadThreadIndexFromStorageOnce();

  const threadId = threadIdRaw.trim();
  if (!threadId) return;

  const url = normalizeResolvedUrlForBrowser(item.url);
  const pulse = item.pulse;
  if (!isNonEmpty(url) || !Number.isFinite(pulse) || pulse <= 0) return;

  const prevList = THREAD_INDEX.get(threadId) ?? [];
  const next = [...prevList];

  const idx = next.findIndex((x) => x.url === url);
  if (idx >= 0) {
    const prev = next[idx];
    if (prev && prev.pulse !== pulse) next[idx] = { pulse, url };
  } else {
    next.push({ pulse, url });
  }

  next.sort((a, b) => a.pulse - b.pulse);

  // Dedup by url after sort
  const deduped: ThreadIndexItem[] = [];
  const seenUrl = new Set<string>();
  for (const it of next) {
    if (seenUrl.has(it.url)) continue;
    seenUrl.add(it.url);
    deduped.push(it);
  }

  const capped = deduped.slice(-THREAD_INDEX_MAX_ITEMS_PER_THREAD);

  // If no real change, bail (prevents strict-mode double-effect noise)
  if (sameThreadList(prevList, capped)) return;

  THREAD_INDEX.set(threadId, capped);

  // ✅ bump version exactly once
  const nextVer = (THREAD_INDEX_VERSION.get(threadId) ?? 0) + 1;
  THREAD_INDEX_VERSION.set(threadId, nextVer);

  // Evict oldest threads if needed
  while (THREAD_INDEX.size > THREAD_INDEX_MAX_THREADS) {
    const oldest = THREAD_INDEX.keys().next().value as string | undefined;
    if (!oldest) break;
    THREAD_INDEX.delete(oldest);
  }

  persistThreadIndexThrottled();
  notifyThreadIndexChanged(threadId);
}

function threadIndexPrevUrl(threadIdRaw: string, pulse: number): string | null {
  loadThreadIndexFromStorageOnce();

  const threadId = threadIdRaw.trim();
  if (!threadId) return null;

  const list = THREAD_INDEX.get(threadId);
  if (!list || !list.length) return null;

  // find greatest pulse < current
  let best: ThreadIndexItem | null = null;
  for (const it of list) {
    if (it.pulse < pulse) best = it;
    else break; // list sorted asc
  }

  return best?.url ?? null;
}

function threadIndexRootUrl(threadIdRaw: string): string | null {
  loadThreadIndexFromStorageOnce();

  const threadId = threadIdRaw.trim();
  if (!threadId) return null;

  const list = THREAD_INDEX.get(threadId);
  if (!list || !list.length) return null;

  return list[0]?.url ?? null; // earliest (root-ish) by pulse
}

function isLikelyThreadId(raw: string): boolean {
  const t = raw.trim();
  if (t.length < 6 || t.length > 160) return false;
  if (/\s/.test(t)) return false;
  if (t.includes("/")) return false;
  if (/^[a-z]+:\/\//i.test(t)) return false; // reject URLs
  return true;
}

function readThreadIdLoose(v: unknown): string | undefined {
  if (!isRecord(v)) return undefined;

  const cand =
    (v.threadId ?? v.thread_id ?? v.threadID ?? v.thread ?? undefined) as unknown;

  if (typeof cand === "string") {
    const t = cand.trim();
    return isLikelyThreadId(t) ? t : undefined;
  }
  return undefined;
}

function extractThreadAnchorUrlFromAny(root: unknown): string | null {
  type Cand = { url: string; score: RefScore; order: number };
  const cands: Cand[] = [];
  let order = 0;

  const pushMaybe = (k: string, v: unknown) => {
    if (!isRefKey(k)) return;
    const sc = scoreRefKey(k);
    if (sc < 8) return; // only thread/root/ref anchors
    if (typeof v !== "string") return;

    const resolved = resolveThreadUrlCandidate(v);
    if (!resolved) return;
    cands.push({ url: resolved, score: sc, order: order++ });
  };

  const scan = (v: unknown, depth = 0) => {
    if (depth > 7) return;
    if (Array.isArray(v)) {
      for (const it of v) scan(it, depth + 1);
      return;
    }
    if (!isRecord(v)) return;

    for (const [k, val] of Object.entries(v)) {
      pushMaybe(k, val);
      scan(val, depth + 1);
    }
  };

  scan(root, 0);
  if (!cands.length) return null;

  // Prefer thread (8) over root (9), then newest occurrence
  cands.sort((a, b) => (a.score !== b.score ? a.score - b.score : b.order - a.order));
  return cands[0]?.url ?? null;
}

/* ─────────────────────────────────────────────────────────────
   PrevId / RootId / Skip extraction (constant-size threading)
   ───────────────────────────────────────────────────────────── */

type SkipMap = Record<number, string>;

function parseSkipMap(v: unknown): SkipMap | null {
  if (!isRecord(v)) return null;
  const out: SkipMap = {};
  for (const [k, val] of Object.entries(v)) {
    const n = Number(k);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (typeof val !== "string") continue;
    const id = val.trim();
    if (!isLikelyContentId(id)) continue;
    out[Math.floor(n)] = normalizeContentId(id);
  }
  return Object.keys(out).length ? out : null;
}

function extractIdLinksFromAny(root: unknown): {
  id?: string;
  prevId?: string;
  rootId?: string;
  height?: number;
  skip?: SkipMap;
} {
  let id: string | undefined;
  let prevId: string | undefined;
  let rootId: string | undefined;
  let height: number | undefined;
  let skip: SkipMap | undefined;

  const scan = (v: unknown, depth = 0) => {
    if (depth > 7) return;
    if (Array.isArray(v)) {
      for (const it of v) scan(it, depth + 1);
      return;
    }
    if (!isRecord(v)) return;

    for (const [k, val] of Object.entries(v)) {
      const nk = normalizeRefKey(k);

      if (!id && (nk === "id" || nk === "contentid" || nk === "cid") && typeof val === "string") {
        const t = val.trim();
        if (isLikelyContentId(t)) id = normalizeContentId(t);
      }

      if (!prevId && (nk === "previd" || nk === "previousid") && typeof val === "string") {
        const t = val.trim();
        if (isLikelyContentId(t)) prevId = normalizeContentId(t);
      }

      if (!rootId && nk === "rootid" && typeof val === "string") {
        const t = val.trim();
        if (isLikelyContentId(t)) rootId = normalizeContentId(t);
      }

      if (
        typeof height !== "number" &&
        nk === "height" &&
        typeof val === "number" &&
        Number.isFinite(val)
      ) {
        height = Math.max(0, Math.floor(val));
      }

      if (!skip && nk === "skip") {
        const m = parseSkipMap(val);
        if (m) skip = m;
      }

      scan(val, depth + 1);
    }
  };

  scan(root, 0);

  // if prevId missing but skip[1] exists, treat it as prevId
  if (!prevId && skip && typeof skip[1] === "string") prevId = skip[1];

  return { id, prevId, rootId, height, skip };
}

function extractThreadKeyFromDecoded(decodedData: unknown, capsule: Capsule | null): string | undefined {
  // 0) if explicit rootId exists, use it as constant-size thread key
  const ids = extractIdLinksFromAny(decodedData);
  if (ids.rootId) return `rootid:${normalizeContentId(ids.rootId)}`;

  // 1) direct payload fields (message/post/share/reaction + capsule)
  if (capsule) {
    const tMsg = readThreadIdLoose((capsule as Capsule).message as unknown);
    if (tMsg) return tMsg;

    const tPost = readThreadIdLoose((capsule as Capsule).post as unknown);
    if (tPost) return tPost;

    const tShare = readThreadIdLoose((capsule as Capsule).share as unknown);
    if (tShare) return tShare;

    const tReact = readThreadIdLoose((capsule as Capsule).reaction as unknown);
    if (tReact) return tReact;

    const tCaps = readThreadIdLoose(capsule as unknown);
    if (tCaps) return tCaps;
  }

  // 2) deep scan: any key that normalizes to "threadid" (covers threadId/thread_id)
  const found: string[] = [];
  const scan = (v: unknown, depth = 0) => {
    if (depth > 7) return;
    if (Array.isArray(v)) {
      for (const it of v) scan(it, depth + 1);
      return;
    }
    if (!isRecord(v)) return;

    for (const [k, val] of Object.entries(v)) {
      const nk = normalizeRefKey(k); // removes _ and -
      if (nk === "threadid" && typeof val === "string") {
        const t = val.trim();
        if (isLikelyThreadId(t)) found.push(t);
      }
      scan(val, depth + 1);
    }
  };
  scan(decodedData, 0);
  if (found.length) return found[0];

  // 3) derive stable key from thread/root anchor url (lets stitching work even without threadId)
  const anchor = extractThreadAnchorUrlFromAny(decodedData);
  if (anchor) return `root:${threadSeenKey(anchor)}`;

  return undefined;
}

/**
 * Extract the “previous message” URL from ANY decoded shape (best effort).
 * Priority: previous/prev → parent → inReplyTo/replyTo → reply → thread → root → ref.
 * Returns {url,score} so we can treat thread/root/ref as low-confidence.
 */
type PrevExtract = { url: string; score: RefScore };

function extractPreviousUrlFromAnyDetailed(root: unknown): PrevExtract | null {
  type Cand = { url: string; score: RefScore; order: number };
  const cands: Cand[] = [];
  let order = 0;

  const pushResolved = (resolved: string, score: RefScore) => {
    cands.push({ url: resolved, score, order: order++ });
  };

  const pushMaybeString = (v: unknown, score: RefScore) => {
    if (typeof v !== "string") return;
    const resolved = resolveThreadUrlCandidate(v);
    if (!resolved) return;
    pushResolved(resolved, score);
  };

  const pushMaybeFromRecord = (v: unknown, score: RefScore) => {
    if (!isRecord(v)) return;
    for (const kk of REF_VALUE_KEYS) pushMaybeString(v[kk], score);
  };

  // Fast path: scan top-level keys if object-like
  if (isRecord(root)) {
    for (const [k, val] of Object.entries(root)) {
      if (!isRefKey(k)) continue;
      const sc = scoreRefKey(k);

      if (typeof val === "string") pushMaybeString(val, sc);
      else if (Array.isArray(val)) {
        for (const it of val) {
          if (typeof it === "string") pushMaybeString(it, sc);
          else pushMaybeFromRecord(it, sc);
        }
      } else {
        pushMaybeFromRecord(val, sc);
      }
    }
  }

  // Deep scan (best effort)
  const scan = (v: unknown, depth = 0) => {
    if (depth > 7) return;

    if (Array.isArray(v)) {
      for (const it of v) scan(it, depth + 1);
      return;
    }

    if (!isRecord(v)) return;

    for (const [k, val] of Object.entries(v)) {
      if (isRefKey(k)) {
        const sc = scoreRefKey(k);
        if (typeof val === "string") pushMaybeString(val, sc);
        else if (Array.isArray(val)) for (const it of val) scan(it, depth + 1);
        else pushMaybeFromRecord(val, sc);
      }

      scan(val, depth + 1);
    }
  };

  scan(root, 0);

  if (!cands.length) return null;

  const minScore = cands.reduce((m, c) => (c.score < m ? c.score : m), cands[0].score);
  const same = cands.filter((c) => c.score === minScore);

  // for thread/root/ref, newest encountered tends to be most relevant
  if (minScore >= 8) same.sort((a, b) => b.order - a.order);
  else same.sort((a, b) => a.order - b.order);

  const best = same[0];
  return best ? { url: best.url, score: best.score } : null;
}

/* ─────────────────────────────────────────────────────────────
   Manual marker → Proof of Memory™
   ───────────────────────────────────────────────────────────── */

const TM = "\u2122";
const PROOF_OF_MEMORY = `Proof of Memory${TM}`;
const PROOF_OF_BREATH = `Proof of Breath${TM}`;

const isManualMarkerText = (v: unknown): v is string =>
  typeof v === "string" && v.trim().toLowerCase() === "manual";

const displayManualAsProof = (v: unknown): string | undefined => {
  if (!isNonEmpty(v)) return undefined;
  return isManualMarkerText(v) ? PROOF_OF_MEMORY : v;
};

function hasManualMarkerDeep(v: unknown, depth = 0): boolean {
  if (depth > 5) return false;
  if (isManualMarkerText(v)) return true;

  if (Array.isArray(v)) {
    for (const it of v) if (hasManualMarkerDeep(it, depth + 1)) return true;
    return false;
  }

  if (v && typeof v === "object") {
    const rec = v as Record<string, unknown>;
    for (const k of Object.keys(rec)) {
      if (hasManualMarkerDeep(rec[k], depth + 1)) return true;
    }
  }
  return false;
}

function extractAddChainResolved(rawUrl: string): string[] {
  const u = tryParseUrl(stripEdgePunct(rawUrl));
  if (!u) return [];

  const hashStr = u.hash && u.hash.startsWith("#") ? u.hash.slice(1) : "";
  const hash = new URLSearchParams(hashStr);
  const search = u.searchParams;

  const addsRaw = [...search.getAll("add"), ...hash.getAll("add")];

  const out: string[] = [];
  for (const a of addsRaw) {
    let v = stripEdgePunct(a);
    if (!v) continue;

    if (/%[0-9A-Fa-f]{2}/.test(v)) {
      try {
        v = decodeURIComponent(v);
      } catch {
        /* ignore */
      }
    }

    const resolved = resolveThreadUrlCandidate(v);
    if (!resolved) continue;
    if (!out.includes(resolved)) out.push(resolved);
  }

  return out.slice(-THREAD_MAX_DEPTH);
}

/* ─────────────────────────────────────────────────────────────
   Clipboard helpers (gesture-safe)
   ───────────────────────────────────────────────────────────── */

function tryCopyExecCommand(text: string): boolean {
  if (typeof document === "undefined") return false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);

    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ta.focus();
    ta.select();

    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (prevFocus) prevFocus.focus();
    return ok;
  } catch {
    return false;
  }
}

function clipboardWriteTextPromise(text: string): Promise<void> | null {
  if (typeof window === "undefined") return null;
  const nav = window.navigator;
  const canClipboard =
    typeof nav !== "undefined" &&
    typeof nav.clipboard !== "undefined" &&
    typeof nav.clipboard.writeText === "function" &&
    window.isSecureContext;
  if (!canClipboard) return null;
  return nav.clipboard.writeText(text);
}

/* ─────────────────────────────────────────────────────────────
   Component (thread-recursive renderer)
   ───────────────────────────────────────────────────────────── */

type ThreadProps = {
  url: string;
  depth?: number;
  seen?: readonly string[];
  addChain?: readonly string[];
  addIndex?: number;
};

type InputKind =
  | { kind: "contentId"; id: string; openUrl: string }
  | { kind: "sigilUrl"; openUrl: string; id?: undefined }; // ✅ id exists on union (optional)

function parseInputKind(rawUrl: string): InputKind {
  const raw = stripEdgePunct(rawUrl);

  // cid:HEX
  const m = raw.match(/^cid:([0-9a-fA-F]{64})$/);
  if (m?.[1]) {
    const id = normalizeContentId(m[1]);
    return { kind: "contentId", id, openUrl: makeStreamOpenUrlFromContentId(id) };
  }

  // URL/path/query forms with id
  const cid = extractContentIdCandidates(raw)[0];
  if (cid) {
    const id = normalizeContentId(cid);
    return { kind: "contentId", id, openUrl: makeStreamOpenUrlFromContentId(id) };
  }

  // otherwise token/url mode
  return { kind: "sigilUrl", openUrl: normalizeResolvedUrlForBrowser(raw) };
}

type ResolvedNodeOk = {
  ok: true;
  openUrl: string;
  dataRaw: unknown; // original object used for scans/badges
  storePayload: unknown; // what we cache under contentId
  pulse: number;
  appId?: string;
  userId?: unknown;
  capsule: Capsule;
};

type ResolvedNodeErr = { ok: false; openUrl: string; error: string };

type ResolvedNode = ResolvedNodeOk | ResolvedNodeErr;

function readCapsuleLoose(v: unknown): Capsule | null {
  // Prefer envelope.capsule
  if (isRecord(v) && isRecord(v.capsule)) return v.capsule as unknown as Capsule;

  // If it already looks like a Capsule (post/message/share/reaction/sigilId/etc)
  if (isRecord(v) && ("post" in v || "message" in v || "share" in v || "reaction" in v)) {
    return v as unknown as Capsule;
  }

  // Sometimes payloads nest under `data`
  if (isRecord(v) && isRecord(v.data)) {
    const d = v.data;
    if (isRecord(d.capsule)) return d.capsule as unknown as Capsule;
    if ("post" in d || "message" in d || "share" in d || "reaction" in d)
      return d as unknown as Capsule;
  }

  return null;
}

function readPulseLoose(v: unknown): number {
  if (isRecord(v) && typeof v.pulse === "number" && Number.isFinite(v.pulse)) return v.pulse;
  if (
    isRecord(v) &&
    isRecord(v.data) &&
    typeof v.data.pulse === "number" &&
    Number.isFinite(v.data.pulse)
  )
    return v.data.pulse;
  return 0;
}

function readAppIdLoose(v: unknown): string | undefined {
  const a = isRecord(v) ? v.appId : undefined;
  if (typeof a === "string" && a.trim()) return a;
  const d = isRecord(v) && isRecord(v.data) ? v.data.appId : undefined;
  if (typeof d === "string" && d.trim()) return d;
  return undefined;
}

function readUserIdLoose(v: unknown): unknown {
  const u = isRecord(v) ? v.userId : undefined;
  if (typeof u !== "undefined") return u;
  const d = isRecord(v) && isRecord(v.data) ? v.data.userId : undefined;
  return d;
}

const FeedCardThread: React.FC<ThreadProps> = ({
  url,
  depth = 0,
  seen = [],
  addChain: addChainProp,
  addIndex: addIndexProp,
}) => {
  const [copied, setCopied] = useState(false);

  // ✅ Input mode (token/url vs contentId)
  const input = useMemo(() => parseInputKind(url), [url]);

  // ✅ Sigil decode (always computed, safe even if not used)
  const smart = useMemo(() => decodeSigilUrlSmart(url), [url]);

  // ✅ Content store subscription (no sync setState in effects)
  const contentIdKey = input.kind === "contentId" && input.id ? normalizeContentId(input.id) : "";

  const contentVersion = useSyncExternalStore(
    (onStoreChange) => {
      if (!contentIdKey) return () => {};
      return subscribeContentState((changedId) => {
        if (changedId === contentIdKey) onStoreChange();
      });
    },
    () => (contentIdKey ? (CONTENT_STATE_VERSION.get(contentIdKey) ?? 0) : 0),
    () => 0,
  );

  // Ensure content load when entering contentId mode (effect has NO setState)
  useEffect(() => {
    if (!contentIdKey) return;
    ensureContentLoaded(contentIdKey);
  }, [contentIdKey]);

  const contentState = useMemo<ContentState>(() => {
    if (!contentIdKey) return { status: "idle", payload: null };
    // contentVersion exists solely to re-run this memo when the store updates
    void contentVersion;
    return contentStateGet(contentIdKey);
  }, [contentIdKey, contentVersion]);

  // ✅ Build unified node (no conditional hooks; all branches inside memo)
  const node: ResolvedNode = useMemo(() => {
    if (input.kind === "contentId" && input.id) {
      const openUrl = input.openUrl;

      if (contentState.status === "loading" || contentState.status === "idle") {
        return { ok: false, openUrl, error: "Loading content…" };
      }
      if (contentState.status === "error") {
        return { ok: false, openUrl, error: contentState.error };
      }

      const payload = contentState.payload;
      const capsule = readCapsuleLoose(payload);
      if (!capsule) return { ok: false, openUrl, error: "Invalid content payload (missing capsule)." };

      const pulse = readPulseLoose(payload);
      const appId = readAppIdLoose(payload);
      const userId = readUserIdLoose(payload);

      return {
        ok: true,
        openUrl,
        dataRaw: payload,
        storePayload: payload,
        pulse,
        appId,
        userId,
        capsule,
      };
    }

    // token/url mode
    const decoded = smart.decoded;
    const openUrl = normalizeResolvedUrlForBrowser(smart.resolvedUrl || url);

    if (!decoded.ok) {
      return {
        ok: false,
        openUrl,
        error:
          ("error" in decoded ? (decoded as { error?: string }).error : undefined) ??
          "Decode failed.",
      };
    }

    const data = decoded.data as unknown;
    const capsule = (decoded.data as { capsule: Capsule }).capsule;

    const pulse =
      typeof (decoded.data as { pulse?: unknown }).pulse === "number" &&
      Number.isFinite((decoded.data as { pulse?: unknown }).pulse)
        ? (decoded.data as { pulse: number }).pulse
        : 0;

    const appId =
      typeof (decoded.data as { appId?: unknown }).appId === "string" &&
      (decoded.data as { appId?: string }).appId
        ? (decoded.data as { appId: string }).appId
        : undefined;

    const userId = (decoded.data as { userId?: unknown }).userId;

    return {
      ok: true,
      openUrl,
      dataRaw: data,
      storePayload: decoded.data,
      pulse,
      appId,
      userId,
      capsule,
    };
  }, [input.kind, input.id, input.openUrl, url, smart.decoded, smart.resolvedUrl, contentState]);

  // Helpful stable projections for deps (avoid touching ok-only props on union in deps)
  const nodeOk = node.ok;
  const nodeDataRaw: unknown | null = nodeOk ? node.dataRaw : null;
  const nodeCapsule: Capsule | null = nodeOk ? node.capsule : null;
  const nodeStorePayload: unknown | null = nodeOk ? node.storePayload : null;
  const nodePulse: number = nodeOk && Number.isFinite(node.pulse) ? node.pulse : 0;

  // Derive id-links (prevId/rootId/skip/id)
  const idLinks = useMemo(
    () => (nodeOk && nodeDataRaw ? extractIdLinksFromAny(nodeDataRaw) : null),
    [nodeOk, nodeDataRaw],
  );

  // ✅ Explicit contentId (derived, no setState)
  const explicitContentId = useMemo(() => {
    if (input.kind === "contentId" && input.id && isLikelyContentId(input.id))
      return normalizeContentId(input.id);
    const id = idLinks?.id;
    return id && isLikelyContentId(id) ? normalizeContentId(id) : undefined;
  }, [input.kind, input.id, idLinks?.id]);

  // ✅ Computed contentId (async only)
  const [computedContentId, setComputedContentId] = useState<string | undefined>(undefined);

  // Cache node payload under explicit id immediately; otherwise compute id once and cache
  useEffect(() => {
    let alive = true;
    if (!nodeOk || !nodeStorePayload || !nodeCapsule) return;

    if (explicitContentId && isLikelyContentId(explicitContentId)) {
      void idbPutContent(explicitContentId, nodeStorePayload);
      return;
    }

    void (async () => {
      const computed = await computeContentIdFromPayload(nodeCapsule as unknown);
      if (!alive) return;
      if (!computed || !isLikelyContentId(computed)) return;

      const norm = normalizeContentId(computed);
      setComputedContentId((prev) => (prev === norm ? prev : norm));
      void idbPutContent(norm, nodeStorePayload);
    })();

    return () => {
      alive = false;
    };
  }, [nodeOk, nodeStorePayload, nodeCapsule, explicitContentId]);

  const contentId = explicitContentId ?? computedContentId;

  // ✅ For copy base: prefer constant-size /stream/c/<contentId> when we have one
  const copyBaseUrl = useMemo(() => {
    if (contentId && isLikelyContentId(contentId)) return makeStreamOpenUrlFromContentId(contentId);
    return node.openUrl;
  }, [contentId, node.openUrl]);

  const rememberUrl = node.openUrl;

  const selfKey = useMemo(() => threadSeenKey(copyBaseUrl), [copyBaseUrl]);
  const nextSeen = useMemo(() => [...seen, selfKey], [seen, selfKey]);

  // ✅ Thread key: supports message/post threadId, snake_case, deep scan, root-derived fallback
  const threadKey = useMemo(() => {
    if (!nodeOk || !nodeDataRaw || !nodeCapsule) return undefined;
    return extractThreadKeyFromDecoded(nodeDataRaw, nodeCapsule);
  }, [nodeOk, nodeDataRaw, nodeCapsule]);

  // ✅ IMPORTANT: threadVersion MUST exist before any memo depends on it (no TDZ)
  const threadVersion = useSyncExternalStore(
    (onStoreChange) => {
      if (!threadKey) return () => {};
      return subscribeThreadIndex((changedId) => {
        if (changedId === threadKey) onStoreChange();
      });
    },
    () => {
      loadThreadIndexFromStorageOnce();
      return threadKey ? (THREAD_INDEX_VERSION.get(threadKey) ?? 0) : 0;
    },
    () => 0,
  );

  // ✅ Render-time thread index registration MUST be an effect (side effect), not useMemo
  useEffect(() => {
    if (!nodeOk) return;
    if (!threadKey) return;
    if (nodePulse <= 0) return;
    threadIndexAdd(threadKey, { pulse: nodePulse, url: copyBaseUrl });
  }, [nodeOk, threadKey, nodePulse, copyBaseUrl]);

  // add= chain (explicit wrapper context)
  const addChain = useMemo(() => {
    const chain = addChainProp ? [...addChainProp] : extractAddChainResolved(url);
    return chain.slice(-THREAD_MAX_DEPTH);
  }, [addChainProp, url]);

  const addIndex = useMemo(() => {
    if (typeof addIndexProp === "number" && Number.isFinite(addIndexProp)) return addIndexProp;
    return addChain.length - 1;
  }, [addIndexProp, addChain.length]);

  const prevUrlFromAdd = useMemo(() => {
    if (!addChain.length) return null;
    if (addIndex < 0 || addIndex >= addChain.length) return null;
    return addChain[addIndex] ?? null;
  }, [addChain, addIndex]);

  // Primary previous resolution: constant-size prevId (or skip[1]) if present
  const prevUrlFromId = useMemo(() => {
    if (!nodeOk || !nodeDataRaw) return null;
    const pid = idLinks?.prevId;
    if (!pid || !isLikelyContentId(pid)) return null;
    return `cid:${normalizeContentId(pid)}`;
  }, [nodeOk, nodeDataRaw, idLinks?.prevId]);

  // Primary URL previous resolution: scan full decoded data (covers composer variants)
  const prevFromRefs = useMemo(() => {
    if (!nodeOk || !nodeDataRaw) return null;
    return extractPreviousUrlFromAnyDetailed(nodeDataRaw);
  }, [nodeOk, nodeDataRaw]);

  const prevUrlFromRefs = prevFromRefs?.url ?? null;
  const prevRefsScore = prevFromRefs?.score ?? null;

  // Fallback previous resolution: stitch within a thread using thread index (pulse order)
  const prevUrlFromThread = useMemo(() => {
    if (!nodeOk) return null;
    if (!threadKey) return null;
    if (nodePulse <= 0) return null;
    return threadIndexPrevUrl(threadKey, nodePulse);
  }, [nodeOk, threadKey, nodePulse, threadVersion]);

  const threadRootUrl = useMemo(() => {
    if (!threadKey) return null;
    return threadIndexRootUrl(threadKey);
  }, [threadKey, threadVersion]);

  // ✅ Previous selection:
  // 1) add= chain always wins (explicit wrapper ordering)
  // 2) prevId/skip[1] wins (constant-size threading)
  // 3) URL refs (prev/parent/replyTo/...) unless low-confidence root/thread/ref
  // 4) thread stitch fallback
  const prevUrlRaw = useMemo(() => {
    if (prevUrlFromAdd) return prevUrlFromAdd;
    if (prevUrlFromId) return prevUrlFromId;

    const refs = prevUrlFromRefs;
    const threadPrev = prevUrlFromThread;

    if (!refs) return threadPrev;
    if (!threadPrev) return refs;

    const refsLooksRoot = threadRootUrl ? refs === threadRootUrl : false;
    const lowConfidence = typeof prevRefsScore === "number" ? prevRefsScore >= 8 : false;

    if ((refsLooksRoot || lowConfidence) && threadPrev !== refs) return threadPrev;

    return refs;
  }, [prevUrlFromAdd, prevUrlFromId, prevUrlFromRefs, prevUrlFromThread, threadRootUrl, prevRefsScore]);

  const prevFromAddChain = useMemo(
    () => Boolean(prevUrlFromAdd && prevUrlRaw === prevUrlFromAdd),
    [prevUrlFromAdd, prevUrlRaw],
  );

  const prevUrl = useMemo(() => {
    if (!prevUrlRaw) return null;
    if (depth >= THREAD_MAX_DEPTH) return null;

    const prevKey = threadSeenKey(prevUrlRaw);
    if (nextSeen.includes(prevKey)) return null;

    return prevUrlRaw;
  }, [prevUrlRaw, depth, nextSeen]);

  // ✅ Register chain edges + aliases (so Remember can export full prev-chain reliably)
  const selfRef = useMemo(() => encodeChainRef(contentId ? `cid:${contentId}` : copyBaseUrl), [contentId, copyBaseUrl]);

  const aliasKeys = useMemo(() => {
    const keys: string[] = [];

    keys.push(selfKey);
    keys.push(threadSeenKey(url));
    keys.push(threadSeenKey(node.openUrl));
    keys.push(threadSeenKey(copyBaseUrl));

    if (contentId && isLikelyContentId(contentId)) keys.push(`cid:${normalizeContentId(contentId)}`);

    // Also bind token alias if we can see one in the open url (common in token-mode)
    const tok = extractTokenCandidates(node.openUrl)[0] ?? extractTokenCandidates(url)[0];
    if (tok) keys.push(`t:${normalizeToken(tok)}`);

    // Deterministic + dedup
    const uniq = Array.from(new Set(keys)).filter((k) => k.trim().length > 0);
    uniq.sort((a, b) => a.localeCompare(b));
    return uniq;
  }, [selfKey, url, node.openUrl, copyBaseUrl, contentId]);

  // ✅ Layout effect: populate chain graph BEFORE user can interact (v27.6 Remember guarantee)
  useLayoutEffect(() => {
    chainGraphUpsert(selfKey, selfRef, prevUrl, aliasKeys);
  }, [selfKey, selfRef, prevUrl, aliasKeys]);

  // ✅ Build “Remember” URL at click-time: graph chain (root→…→prev) + existing add= chain
  const computeRememberCopyUrl = useCallback((): string => {
    // Ensure current edge is present (covers ultra-fast clicks / strict-mode timing)
    chainGraphUpsert(selfKey, selfRef, prevUrl, aliasKeys);

    const fromGraph = buildPrevChainAddsFromGraph(selfKey, REMEMBER_CHAIN_MAX_ITEMS);
    const fromAddParam = addChain.length ? addChain.map((u) => encodeChainRef(u)) : [];
    const adds = chooseAddsLongest(fromGraph, fromAddParam);

    return buildRememberUrlWithAdds(copyBaseUrl, adds);
  }, [selfKey, selfRef, prevUrl, aliasKeys, addChain, copyBaseUrl]);

  const onCopy = useCallback(() => {
    const text = computeRememberCopyUrl();

    const okSync = tryCopyExecCommand(text);
    if (okSync) {
      setCopied(true);
      if (typeof window !== "undefined") window.setTimeout(() => setCopied(false), 1100);
      return;
    }

    const p = clipboardWriteTextPromise(text);
    if (p) {
      setCopied(true);
      if (typeof window !== "undefined") window.setTimeout(() => setCopied(false), 1100);
      p.catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.warn("Remember failed:", e);
        setCopied(false);
      });
      return;
    }

    // eslint-disable-next-line no-console
    console.warn("Remember failed: no clipboard available");
  }, [computeRememberCopyUrl]);

  if (!node.ok) {
    return (
      <article className="fc fc--error" role="group" aria-label="Invalid Sigil-Glyph">
        <div className="fc-crystal" aria-hidden="true" />
        <div className="fc-shell">
          <header className="fc-head">
            <div className="fc-titleRow">
              <span className="fc-chip fc-chip--danger">INVALID</span>
              <span className="fc-muted">Sigil-Glyph capsule could not be resolved</span>
            </div>
            <div className="fc-url mono" title={url}>
              {url}
            </div>
          </header>

          <div className="fc-error" role="alert">
            {node.error}
          </div>

          <footer className="fc-actions" role="group" aria-label="Actions">
            <button
              className="fc-btn"
              type="button"
              onClick={onCopy}
              aria-pressed={copied}
              data-state={copied ? "remembered" : "idle"}
              title="Copies a shareable URL that includes the full previous-chain (add=...)"
            >
              {copied ? "Remembered" : "Remember"}
            </button>
          </footer>
        </div>
      </article>
    );
  }

  const capsule: Capsule = node.capsule;

  const post: PostPayload | undefined = capsule.post;
  const message: MessagePayload | undefined = capsule.message;
  const share: SharePayload | undefined = capsule.share;
  const reaction: ReactionPayload | undefined = capsule.reaction;

  const pulse = typeof node.pulse === "number" && Number.isFinite(node.pulse) ? node.pulse : 0;

  const m = momentFromPulse(pulse);
  const beatZ = Math.max(0, Math.floor(m.beat));
  const stepZ = Math.max(0, Math.floor(m.stepIndex));

  const chakraDay: ChakraDay = toChakra(m.chakraDay, m.chakraDay);
  const chakraDayDisplay = chakraDay === "Crown" ? "Krown" : String(chakraDay);

  const { day, month, year } = kaiDMYFromPulseKKS(pulse);

  const inferredKind =
    post ? "post" : message ? "message" : share ? "share" : reaction ? "reaction" : "sigil";

  const kind: string = kindFromDecodedData(node.dataRaw, inferredKind);
  const kindText = String(kind);

  const appBadge =
    typeof node.appId === "string" && node.appId ? `app ${short(node.appId, 10, 4)}` : undefined;

  const userBadge =
    typeof node.userId !== "undefined" && node.userId !== null
      ? `user ${short(String(node.userId), 10, 4)}`
      : undefined;

  const sigilId = isNonEmpty(capsule.sigilId) ? capsule.sigilId : undefined;
  const phiKey = isNonEmpty(capsule.phiKey) ? capsule.phiKey : undefined;
  const signaturePresent = isNonEmpty(capsule.kaiSignature);
  const verifiedTitle = signaturePresent ? "Signature present (Kai Signature)" : "Unsigned capsule";

  const authorBadge = isNonEmpty(capsule.author) ? capsule.author : undefined;

  const sourceBadge =
    (isNonEmpty(capsule.source) ? capsule.source : undefined) ?? legacySourceFromData(node.dataRaw);

  const manualMarkerPresent =
    isManualMarkerText(kindText) || isManualMarkerText(sourceBadge) || hasManualMarkerDeep(capsule);

  const kindChipLabel = manualMarkerPresent ? PROOF_OF_MEMORY : upper(kindText);
  const ariaKindLabel = manualMarkerPresent ? PROOF_OF_MEMORY : kindText;

  const sourceChipLabel = sourceBadge
    ? isManualMarkerText(sourceBadge)
      ? PROOF_OF_MEMORY
      : upper(sourceBadge)
    : undefined;

  const showSourceChip = Boolean(sourceChipLabel) && sourceChipLabel !== kindChipLabel;

  const postTitle = displayManualAsProof(post?.title);
  const postText = displayManualAsProof(post?.text);
  const messageText = displayManualAsProof(message?.text);
  const shareNote = displayManualAsProof(share?.note);

  const kai = buildKaiMetaLineZero(pulse, beatZ, stepZ, day, month, year);
  const stepPct = stepPctFromIndex(stepZ);

  const [ar, ag, ab] =
    CHAKRA_RGB[chakraDayDisplay] ?? CHAKRA_RGB.Crown ?? ([238, 241, 251] as const);

  const phase = ((pulse % 13) + 13) % 13;
  const styleVars: React.CSSProperties = {
    ["--fc-accent-r" as never]: String(ar),
    ["--fc-accent-g" as never]: String(ag),
    ["--fc-accent-b" as never]: String(ab),
    ["--fc-pulse-dur" as never]: "5236ms",
    ["--fc-pulse-offset" as never]: `${-(phase * 120)}ms`,
    ["--fc-thread-depth" as never]: String(depth),
  };

  const dataKindAttr = manualMarkerPresent ? "proof_of_memory" : kindText;

  const openLabel = manualMarkerPresent ? "↗ Memory" : "↗ Sigil-Glyph";
  const openTitle = manualMarkerPresent ? "Open memory" : "Open sigil";

  const nextAddIndex = prevFromAddChain ? addIndex - 1 : undefined;

  return (
    <>
      {prevUrl ? (
        <FeedCardThread
          url={prevUrl}
          depth={depth + 1}
          seen={nextSeen}
          addChain={prevFromAddChain ? addChain : undefined}
          addIndex={prevFromAddChain ? nextAddIndex : undefined}
        />
      ) : null}

      <article
        className={`fc fc--crystal ${signaturePresent ? "fc--signed" : "fc--unsigned"}`}
        role="article"
        aria-label={`${ariaKindLabel} glyph`}
        data-kind={dataKindAttr}
        data-chakra={chakraDayDisplay}
        data-signed={signaturePresent ? "true" : "false"}
        data-beat={pad2(beatZ)}
        data-step={pad2(stepZ)}
        style={styleVars}
      >
        <div className="fc-crystal" aria-hidden="true" />
        <div className="fc-rim" aria-hidden="true" />
        <div className="fc-veil" aria-hidden="true" />

        <div className="fc-shell">
          <aside className="fc-left" aria-label="Sigil">
            <div className="fc-sigilStage">
              <div className="fc-sigilGlass" aria-hidden="true" />
              <div className="fc-sigil">
                {/* ✅ KaiSigil receives INTERNAL chakra ("Crown"), never "Krown" */}
                <KaiSigil pulse={pulse} beat={beatZ} stepPct={stepPct} chakraDay={chakraDay} />
              </div>

              <div className="fc-stamp mono" aria-label="Kai stamp">
                <span className="fc-stamp__pulse" title="Pulse">
                  {pulse}
                </span>
                <span className="fc-stamp__sep">•</span>
                <span className="fc-stamp__bbss" title="Beat:Step (zero-based)">
                  {kai.label}
                </span>
              </div>
            </div>
          </aside>

          <section className="fc-right">
            <header className="fc-head" aria-label="Glyph metadata">
              <div className="fc-metaRow">
                <span
                  className="fc-chip fc-chip--kind"
                  title={manualMarkerPresent ? PROOF_OF_MEMORY : `Kind: ${kindText}-glyph`}
                >
                  {kindChipLabel}
                </span>

                {appBadge && <span className="fc-chip">{appBadge}</span>}
                {userBadge && <span className="fc-chip">{userBadge}</span>}

                {sigilId && (
                  <span className="fc-chip fc-chip--sigil" title={`Sigil-Glyph: ${sigilId}`}>
                    SIGIL-GLYPH {short(sigilId, 6, 4)}
                  </span>
                )}

                {phiKey && (
                  <span className="fc-chip fc-chip--phikey" title={`ΦKey: ${phiKey}`}>
                    ΦKEY {short(phiKey, 6, 4)}
                  </span>
                )}

                {authorBadge && (
                  <span className="fc-chip fc-chip--author" title="Author handle / origin">
                    {authorBadge}
                  </span>
                )}

                {showSourceChip && sourceChipLabel && (
                  <span className="fc-chip fc-chip--source" title="Source">
                    {sourceChipLabel}
                  </span>
                )}

                <span className="fc-chip fc-chip--chakra" title="Chakra day">
                  {chakraDayDisplay}
                </span>

                <span
                  className={`fc-sig ${signaturePresent ? "fc-sig--ok" : "fc-sig--warn"}`}
                  title={verifiedTitle}
                  aria-label={verifiedTitle}
                >
                  {signaturePresent ? "SIGNED" : "UNSIGNED"}
                </span>
              </div>

              <div className="fc-kaiRow" aria-label="Kai meta">
                <span className="fc-kai mono" title="Kai meta line">
                  {kai.line}
                </span>
                <span className="fc-arc" title="Arc">
                  {kai.arc}
                </span>
              </div>
            </header>

            {post && (
              <section className="fc-bodywrap" aria-label="Post body">
                {isNonEmpty(postTitle) && <h3 className="fc-title">{postTitle}</h3>}
                {isNonEmpty(postText) && <p className="fc-body">{postText}</p>}

                {Array.isArray(post.tags) && post.tags.length > 0 && (
                  <div className="fc-tags" aria-label="Tags">
                    {post.tags.map((t) => (
                      <span key={t} className="fc-tag">
                        #{t}
                      </span>
                    ))}
                  </div>
                )}

                {Array.isArray(post.media) && post.media.length > 0 && (
                  <div className="fc-media" aria-label="Attached media">
                    {post.media.map((mm) => {
                      const key = `${mm.kind}:${mm.url}`;
                      const label = hostOf(mm.url) ?? mm.kind;
                      return (
                        <a
                          key={key}
                          className="fc-btn fc-btn--ghost"
                          href={mm.url}
                          target="_blank"
                          rel="noreferrer"
                          title={mm.url}
                        >
                          {label}
                        </a>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {message && (
              <section className="fc-bodywrap" aria-label="Message body">
                <h3 className="fc-title">
                  Message → {short(String(message.toUserId ?? "recipient"), 10, 4)}
                </h3>
                {isNonEmpty(messageText) && <p className="fc-body">{messageText}</p>}
              </section>
            )}

            {share && (
              <section className="fc-bodywrap" aria-label="Share body">
                <h3 className="fc-title">Share</h3>
                <a
                  className="fc-link"
                  href={share.refUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={share.refUrl}
                >
                  {hostOf(share.refUrl) ?? share.refUrl}
                </a>
                {isNonEmpty(shareNote) && <p className="fc-body">{shareNote}</p>}
              </section>
            )}

            {reaction && (
              <section className="fc-bodywrap" aria-label="Reaction body">
                <h3 className="fc-title">Reaction</h3>
                <div className="fc-body">
                  {isNonEmpty(reaction.emoji) ? reaction.emoji : "❤️"}
                  {typeof reaction.value === "number" ? ` × ${reaction.value}` : null}
                </div>
                <a
                  className="fc-link"
                  href={reaction.refUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={reaction.refUrl}
                >
                  {hostOf(reaction.refUrl) ?? reaction.refUrl}
                </a>
              </section>
            )}

            {!post && !message && !share && !reaction && (
              <section className="fc-bodywrap" aria-label="Sigil body">
                {/* ✅ Above the URL */}
                <h3 className="fc-title">{manualMarkerPresent ? PROOF_OF_MEMORY : PROOF_OF_BREATH}</h3>

                <a
                  className="fc-link"
                  href={rememberUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={rememberUrl}
                >
                  {hostOf(rememberUrl) ?? rememberUrl}
                </a>
              </section>
            )}

            <footer className="fc-actions" role="group" aria-label="Actions">
              <a className="fc-btn" href={rememberUrl} target="_blank" rel="noreferrer" title={openTitle}>
                {openLabel}
              </a>

              <button
                className="fc-btn"
                type="button"
                onClick={onCopy}
                aria-pressed={copied}
                data-state={copied ? "remembered" : "idle"}
                title="Copies a shareable URL that includes the full previous-chain (add=...)"
              >
                {copied ? "Remembered" : "Remember"}
              </button>

              <span className="fc-live" aria-live="polite">
                {copied ? "Inhaled to Memory" : ""}
              </span>
            </footer>
          </section>
        </div>
      </article>
    </>
  );
};

export const FeedCard: React.FC<Props> = ({ url }) => <FeedCardThread url={url} />;

export default FeedCard;
