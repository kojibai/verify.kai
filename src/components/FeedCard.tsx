// src/components/FeedCard.tsx
"use client";

/**
 * FeedCard — Sigil-Glyph Capsule Renderer
 * v4.3.3 — PROD: Infinite thread context (render previous → previous → … until root)
 *          + Loop-safe (seen keys) + deep cap (THREAD_MAX_DEPTH)
 *          + Prefers previous/parent/replyTo/inReplyTo refs; ignores external links
 *          + FIX: Previous resolver scans *full decoded data* (not just capsule)
 *          + FIX: Ref-key recognition expanded (camelCase + snake_case + *Url variants)
 *          + FIX: Fallback thread stitching via threadKey (threadId/thread_id/deep scan + root-derived)
 *          + FIX: Thread index now notifies + cards subscribe to updates so prev stitches appear live
 *          + FIX: When refs point to thread/root (or low-confidence), stitched previous wins (reply→reply→reply)
 *          FIX: No conditional hooks (rules-of-hooks clean)
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  typeof TOKEN_HARD_LIMIT === "number" && Number.isFinite(TOKEN_HARD_LIMIT) && TOKEN_HARD_LIMIT > 0
    ? TOKEN_HARD_LIMIT
    : 140;

/* ─────────────────────────────────────────────────────────────
   Decode normalization (ALL url/token forms)
   ───────────────────────────────────────────────────────────── */

type DecodeResult = ReturnType<typeof decodeSigilUrl>;
type SmartDecode = { decoded: DecodeResult; resolvedUrl: string };

function originFallback(): string {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
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

/** Normalize any non-/s URL into /stream/p/<token> when possible (supports nested add=). */
function normalizeResolvedUrlForBrowser(rawUrl: string): string {
  const raw = stripEdgePunct(rawUrl);
  if (isSPayloadUrl(raw)) return raw;

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

  return { decoded: decodeSigilUrl(rawTrim), resolvedUrl: normalizeResolvedUrlForBrowser(rawTrim) };
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

const normalizeRefKey = (k: string): string => k.trim().toLowerCase().replace(/[_-]/g, "");

const REF_KEYS_SET = new Set<string>([
  "prev",
  "previous",
  "prevurl",
  "previousurl",
  "parent",
  "parenturl",
  "inreplyto",
  "inreplytourl",
  "replyto",
  "replytourl",
  "reply",
  "replyurl",
  "thread",
  "threadurl",
  "root",
  "rooturl",
  "ref",
  "refurl",
]);

function isRefKey(k: string): boolean {
  return REF_KEYS_SET.has(normalizeRefKey(k));
}

function scoreRefKey(k: string): RefScore {
  const key = normalizeRefKey(k);

  if (key === "prev" || key === "previous" || key === "prevurl" || key === "previousurl") return 0;
  if (key === "parent" || key === "parenturl") return 1;
  if (
    key === "inreplyto" ||
    key === "inreplytourl" ||
    key === "replyto" ||
    key === "replytourl"
  )
    return 2;
  if (key === "reply" || key === "replyurl") return 3;
  if (key === "thread" || key === "threadurl") return 8;
  if (key === "root" || key === "rooturl") return 9;

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

  // /s/... payload: keep untouched ONLY if same-origin; otherwise fall through to token extraction
  if (isSPayloadUrl(s)) {
    const u = tryParseUrl(s);
    if (u && isInternalHost(u.host)) return u.toString();
    // else: continue, try extracting token below
  }

  // token anywhere → internal stream open
  const tok = extractTokenCandidates(s)[0];
  if (tok) return makeStreamOpenUrlFromToken(tok);

  // otherwise: only accept internal stream-ish urls
  const u = tryParseUrl(s);
  if (!u) return null;
  if (!isInternalHost(u.host)) return null;

  const p = u.pathname || "";
  if (/^\/(stream|p)(\/|$)/.test(p) || /^\/p~/.test(p)) {
    return normalizeResolvedUrlForBrowser(u.toString());
  }

  return null;
}

function threadSeenKey(rawUrl: string): string {
  const tok = extractTokenCandidates(rawUrl)[0];
  if (tok) return `t:${normalizeToken(tok)}`;
  return `u:${normalizeResolvedUrlForBrowser(rawUrl)}`;
}

/* ─────────────────────────────────────────────────────────────
   Thread index (fallback stitching via threadKey)
   ───────────────────────────────────────────────────────────── */

type ThreadIndexItem = { pulse: number; url: string };

const THREAD_INDEX_MAX_THREADS = 96;
const THREAD_INDEX_MAX_ITEMS_PER_THREAD = 96;

// In-memory (session)
const THREAD_INDEX: Map<string, ThreadIndexItem[]> = new Map();

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
  for (const fn of THREAD_INDEX_LISTENERS) {
    try {
      fn(threadId);
    } catch {
      /* ignore */
    }
  }
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
    (v.threadId ??
      v.thread_id ??
      v.threadID ??
      v.thread ??
      v.thread_id ??
      undefined) as unknown;

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

function extractThreadKeyFromDecoded(decodedData: unknown, capsule: Capsule | null): string | undefined {
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

const FeedCardThread: React.FC<ThreadProps> = ({
  url,
  depth = 0,
  seen = [],
  addChain: addChainProp,
  addIndex: addIndexProp,
}) => {
  const [copied, setCopied] = useState(false);

  // ✅ tick to re-evaluate thread stitching when thread index changes
  const [threadTick, setThreadTick] = useState(0);

  // ✅ Smart decode
  const smart = useMemo(() => decodeSigilUrlSmart(url), [url]);
  const decoded = smart.decoded;

  // ✅ Single canonical URL for UI + copy (hard normalized)
  const rememberUrl = useMemo(
    () => normalizeResolvedUrlForBrowser(smart.resolvedUrl || url),
    [smart.resolvedUrl, url],
  );

  const selfKey = useMemo(() => threadSeenKey(rememberUrl), [rememberUrl]);
  const nextSeen = useMemo(() => [...seen, selfKey], [seen, selfKey]);

  // ✅ MUST be above any early return (rules-of-hooks)
  const decodedData = decoded.ok ? decoded.data : null;
  const capsuleOrNull: Capsule | null = decoded.ok ? decoded.data.capsule : null;

  // ✅ Stable pulse value used by hooks (no touching decoded.data inside deps)
  const pulseSafe = decoded.ok
    ? typeof decoded.data.pulse === "number" && Number.isFinite(decoded.data.pulse)
      ? decoded.data.pulse
      : 0
    : 0;

  // ✅ Thread key: supports message/post threadId, snake_case, deep scan, root-derived fallback
  const threadKey = useMemo(() => {
    if (!decoded.ok) return undefined;
    return extractThreadKeyFromDecoded(decodedData, capsuleOrNull);
  }, [decoded.ok, decodedData, capsuleOrNull]);

  // Subscribe to index updates for THIS threadKey so prev stitches appear immediately
  useEffect(() => {
    if (!threadKey) return;
    return subscribeThreadIndex((changedId) => {
      if (changedId !== threadKey) return;
      setThreadTick((x) => x + 1);
    });
  }, [threadKey]);

  // ✅ Render-time thread index registration MUST be an effect (side effect), not useMemo
  useEffect(() => {
    if (!decoded.ok) return;
    if (!threadKey) return;
    if (pulseSafe <= 0) return;
    threadIndexAdd(threadKey, { pulse: pulseSafe, url: rememberUrl });
  }, [decoded.ok, threadKey, pulseSafe, rememberUrl]);

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

  // Primary previous resolution: scan full decoded data (covers composer variants)
  const prevFromRefs = useMemo(() => {
    if (!decodedData) return null;
    return extractPreviousUrlFromAnyDetailed(decodedData);
  }, [decodedData]);

  const prevUrlFromRefs = prevFromRefs?.url ?? null;
  const prevRefsScore = prevFromRefs?.score ?? null;

  // Fallback previous resolution: stitch within a thread using thread index
  const prevUrlFromThread = useMemo(() => {
    if (!decoded.ok) return null;
    if (!threadKey) return null;
    if (pulseSafe <= 0) return null;
    return threadIndexPrevUrl(threadKey, pulseSafe);
  }, [decoded.ok, threadKey, pulseSafe, threadTick]);

  const threadRootUrl = useMemo(() => {
    if (!threadKey) return null;
    return threadIndexRootUrl(threadKey);
  }, [threadKey, threadTick]);

  // ✅ REAL FIX: if refs only point at root/thread/ref (or low-confidence), let stitched previous win
  const prevUrlRaw = useMemo(() => {
    // 1) explicit add= chain always wins
    if (prevUrlFromAdd) return prevUrlFromAdd;

    const refs = prevUrlFromRefs;
    const threadPrev = prevUrlFromThread;

    if (!refs) return threadPrev;
    if (!threadPrev) return refs;

    const refsLooksRoot = threadRootUrl ? refs === threadRootUrl : false;
    const lowConfidence = typeof prevRefsScore === "number" ? prevRefsScore >= 8 : false;

    if ((refsLooksRoot || lowConfidence) && threadPrev !== refs) return threadPrev;

    return refs;
  }, [prevUrlFromAdd, prevUrlFromRefs, prevUrlFromThread, threadRootUrl, prevRefsScore]);

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

  const onCopy = useCallback(() => {
    const text = normalizeResolvedUrlForBrowser(rememberUrl);

    const okSync = tryCopyExecCommand(text);
    if (okSync) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1100);
      return;
    }

    const p = clipboardWriteTextPromise(text);
    if (p) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1100);
      p.catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.warn("Remember failed:", e);
        setCopied(false);
      });
      return;
    }

    // eslint-disable-next-line no-console
    console.warn("Remember failed: no clipboard available");
  }, [rememberUrl]);

  if (!decoded.ok) {
    return (
      <article className="fc fc--error" role="group" aria-label="Invalid Sigil-Glyph">
        <div className="fc-crystal" aria-hidden="true" />
        <div className="fc-shell">
          <header className="fc-head">
            <div className="fc-titleRow">
              <span className="fc-chip fc-chip--danger">INVALID</span>
              <span className="fc-muted">Sigil-Glyph capsule could not be decoded</span>
            </div>
            <div className="fc-url mono" title={url}>
              {url}
            </div>
          </header>

          <div className="fc-error" role="alert">
            {"error" in decoded ? (decoded as { error?: string }).error : "Decode failed."}
          </div>

          <footer className="fc-actions" role="group" aria-label="Actions">
            <button
              className="fc-btn"
              type="button"
              onClick={onCopy}
              aria-pressed={copied}
              data-state={copied ? "remembered" : "idle"}
            >
              {copied ? "Remembered" : "Remember"}
            </button>
          </footer>
        </div>
      </article>
    );
  }

  const { data } = decoded;
  const capsule: Capsule = data.capsule;

  const post: PostPayload | undefined = capsule.post;
  const message: MessagePayload | undefined = capsule.message;
  const share: SharePayload | undefined = capsule.share;
  const reaction: ReactionPayload | undefined = capsule.reaction;

  const pulse = typeof data.pulse === "number" && Number.isFinite(data.pulse) ? data.pulse : 0;

  const m = momentFromPulse(pulse);
  const beatZ = Math.max(0, Math.floor(m.beat));
  const stepZ = Math.max(0, Math.floor(m.stepIndex));

  const chakraDay: ChakraDay = toChakra(m.chakraDay, m.chakraDay);
  const chakraDayDisplay = chakraDay === "Crown" ? "Krown" : String(chakraDay);

  const { day, month, year } = kaiDMYFromPulseKKS(pulse);

  const inferredKind =
    post ? "post" : message ? "message" : share ? "share" : reaction ? "reaction" : "sigil";

  const kind: string = kindFromDecodedData(data as unknown, inferredKind);
  const kindText = String(kind);

  const appBadge =
    typeof data.appId === "string" && data.appId ? `app ${short(data.appId, 10, 4)}` : undefined;

  const userBadge =
    typeof data.userId !== "undefined" && data.userId !== null
      ? `user ${short(String(data.userId), 10, 4)}`
      : undefined;

  const sigilId = isNonEmpty(capsule.sigilId) ? capsule.sigilId : undefined;
  const phiKey = isNonEmpty(capsule.phiKey) ? capsule.phiKey : undefined;
  const signaturePresent = isNonEmpty(capsule.kaiSignature);
  const verifiedTitle = signaturePresent ? "Signature present (Kai Signature)" : "Unsigned capsule";

  const authorBadge = isNonEmpty(capsule.author) ? capsule.author : undefined;

  const sourceBadge =
    (isNonEmpty(capsule.source) ? capsule.source : undefined) ?? legacySourceFromData(data);

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
              <a
                className="fc-btn"
                href={rememberUrl}
                target="_blank"
                rel="noreferrer"
                title={openTitle}
              >
                {openLabel}
              </a>

              <button
                className="fc-btn"
                type="button"
                onClick={onCopy}
                aria-pressed={copied}
                data-state={copied ? "remembered" : "idle"}
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
