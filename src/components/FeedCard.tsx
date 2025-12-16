// src/components/FeedCard.tsx
"use client";

/**
 * FeedCard — Sigil-Glyph Capsule Renderer
 * v4.9.5 — STREAM TOKEN CANON (t=) + ORIGIN v→t FIX IN REPLIES
 *
 * CORE FIXES:
 * ✅ Stream links NEVER output /stream/p/<token> anymore
 * ✅ Token links ALWAYS output as /stream#t=<token> (hash-based = safest for very long tokens)
 * ✅ Any legacy token links using v=<LONG_TOKEN> are normalized → t=
 * ✅ FIX: thread “Origin” (especially for long-token origins) now always normalizes v=<token> → t=<token>
 *    (and will also look inside the payload for a token when the URL doesn’t carry it)
 *
 * KEEP (same behavior + same look/classes):
 * ✅ Replies no longer cause the Origin to appear again as separate feed items
 * ✅ Every rendered block has Open + Remember; Pack appears only when segmented overflow exists
 * ✅ Collapsible long-form behavior
 * ✅ Thread rendering + registry bridge behavior
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
import { canonicalPostLinkFromHash, STREAM_BASE_URL } from "../utils/streamLink";

/* ─────────────────────────────────────────────────────────────
   Types / Props
   ───────────────────────────────────────────────────────────── */

type Props = {
  url: string;
  /**
   * "thread" (default): card renders previous-chain recursively (full thread context)
   * "self": card renders ONLY itself (use when a parent renders a list)
   */
  threadMode?: "thread" | "self";
};

/* ─────────────────────────────────────────────────────────────
   Tiny helpers
   ───────────────────────────────────────────────────────────── */

const short = (s: string, head = 8, tail = 4): string =>
  s.length <= head + tail ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;

const hostOf = (href?: string): string | undefined => {
  if (!href) return undefined;
  try {
    return new URL(href).host;
  } catch (e: unknown) {
    void e;
    return undefined;
  }
};

const isNonEmpty = (val: unknown): val is string =>
  typeof val === "string" && val.trim().length > 0;

const upper = (v: unknown): string => String(v ?? "").toUpperCase();

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

/* ─────────────────────────────────────────────────────────────
   Long-form collapse helpers
   ───────────────────────────────────────────────────────────── */

type CollapseKind = "text" | "code";

function textMetrics(t: string): { lines: number; chars: number } {
  const s = String(t ?? "");
  const chars = s.length;
  const lines = s.length ? s.split(/\r\n|\r|\n/).length : 0;
  return { lines, chars };
}

function collapseSpecFor(text: string, kind: CollapseKind): {
  shouldCollapse: boolean;
  lines: number;
  chars: number;
  maxHeightPx: number;
} {
  const { lines, chars } = textMetrics(text);
  const maxLines = kind === "code" ? 18 : 10;
  const maxChars = kind === "code" ? 1400 : 700;
  const shouldCollapse = lines > maxLines || chars > maxChars;
  const maxHeightPx = kind === "code" ? 320 : 240;
  return { shouldCollapse, lines, chars, maxHeightPx };
}

function isInteractiveEl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'a,button,input,textarea,select,summary,[role="button"],[role="link"],[data-no-open="true"]',
    ),
  );
}

/* ─────────────────────────────────────────────────────────────
   URL / token normalization (NO /stream/p OUTPUT; token canon = t=)
   ───────────────────────────────────────────────────────────── */

type DecodeResult = ReturnType<typeof decodeSigilUrl>;
type SmartDecode = { decoded: DecodeResult; resolvedUrl: string };

const STREAM_PATH = "/stream";
const SIGIL_PATH = "/s";
const MEM_V = "2";

const URL_HARD_CAP = 120_000;

const PAYLOAD_PREFIX = "j:";
const SEG_PREFIX = "s:";

function stripEdgePunct(s: string): string {
  let t = s.trim();
  t = t.replace(/[)\].,;:!?]+$/g, "");
  t = t.replace(/^[([{"'`]+/g, "");
  return t.trim();
}

function normalizeToken(raw: string): string {
  let t = stripEdgePunct(raw);

  if (/%[0-9A-Fa-f]{2}/.test(t)) {
    try {
      t = decodeURIComponent(t);
    } catch (e: unknown) {
      void e;
    }
  }

  if (t.includes(" ")) t = t.replaceAll(" ", "+");

  // base64 -> base64url (keeps '.' if JWT-like)
  if (/[+/=]/.test(t)) {
    t = t.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
  }

  return stripEdgePunct(t);
}

/**
 * Token detector (supports base64url and JWT-like dot-separated base64url chunks).
 * MUST ignore numeric version markers like v=2.
 */
function looksLikeToken(sRaw: string): boolean {
  const s = normalizeToken(sRaw);
  if (!s) return false;
  if (/^\d{1,4}$/.test(s)) return false;
  if (s === MEM_V) return false;

  // base64url-ish
  if (/^[A-Za-z0-9_-]{16,}$/.test(s)) return true;

  // JWT-like: <b64url>.<b64url>(.<b64url>)?
  if (/^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(\.[A-Za-z0-9_-]{8,})?$/.test(s)) return true;

  return false;
}

function baseRootForLinks(): string {
  const sb = typeof STREAM_BASE_URL === "string" ? STREAM_BASE_URL.trim() : "";
  if (sb) return sb.replace(/\/+$/g, "").replace(/\/stream\/?$/g, "");
  if (typeof window === "undefined") return "";
  const o = window.location?.origin;
  if (o && o !== "null") return o.replace(/\/+$/g, "");
  return "";
}

function originForParse(): string {
  const base = baseRootForLinks();
  if (base) return base;
  return "https://x.invalid";
}

function streamBaseHref(): string {
  const base = baseRootForLinks();
  return base ? `${base}${STREAM_PATH}` : STREAM_PATH;
}

function sigilBaseHref(): string {
  const base = baseRootForLinks();
  return base ? `${base}${SIGIL_PATH}` : SIGIL_PATH;
}

function tryParseUrl(raw: string): URL | null {
  const t = raw.trim();
  try {
    return new URL(t);
  } catch (e1: unknown) {
    void e1;
    try {
      return new URL(t, originForParse());
    } catch (e2: unknown) {
      void e2;
      return null;
    }
  }
}

function isSPayloadUrl(raw: string): boolean {
  const t = stripEdgePunct(raw);
  const u = tryParseUrl(t);
  const path = u ? u.pathname : t;
  return /^\/s(?:\/|$)/.test(path);
}

function extractFromPath(pathname: string): string | null {
  // /s/<id>
  {
    const m = pathname.match(/\/s\/([^/?#]+)/);
    if (m?.[1]) return m[1];
  }
  // /p~TOKEN or /p~/TOKEN
  {
    const m = pathname.match(/\/p(?:\u007e|%7[Ee])\/?([^/?#]+)/);
    if (m?.[1]) return m[1];
  }
  // /stream/p/TOKEN or /feed/p/TOKEN (legacy INPUT only)
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

function paramGetAny(p: URLSearchParams, key: string): string | null {
  return p.get(key) ?? p.get(key.toUpperCase());
}

/**
 * Token extraction candidates:
 * - Looks for t/p/token/capsule in hash or query
 * - ALSO migrates legacy v=<LONG_TOKEN> → t= (but ignores v=2 / v=1 / short numeric versioning)
 * - Also checks path patterns (/stream/p, /p~, /p/)
 * - Also checks nested add= urls once (depth < 1)
 */
function extractTokenCandidates(rawUrl: string, depth = 0): string[] {
  const out: string[] = [];
  const push = (v: string | null | undefined) => {
    if (!v) return;
    const tok = normalizeToken(v);
    if (!tok) return;
    if (!looksLikeToken(tok)) return;
    if (!out.includes(tok)) out.push(tok);
  };

  const raw = stripEdgePunct(rawUrl);

  if (looksLikeToken(raw)) push(raw);

  const u = tryParseUrl(raw);
  if (!u) return out;

  const hashStr = u.hash && u.hash.startsWith("#") ? u.hash.slice(1) : "";
  const hash = new URLSearchParams(hashStr);
  const search = u.searchParams;

  const keys = ["t", "p", "token", "capsule"] as const;
  for (const k of keys) {
    push(paramGetAny(hash, k));
    push(paramGetAny(search, k));
  }

  // v=<token> migration (only if it looks like a token and is NOT a version marker)
  const vHash = paramGetAny(hash, "v");
  const vSearch = paramGetAny(search, "v");
  for (const vv of [vHash, vSearch]) {
    if (!vv) continue;
    const candidate = normalizeToken(vv);
    // ignore numeric/small versions (v=2 etc)
    if (/^\d{1,4}$/.test(candidate)) continue;
    if (candidate === MEM_V) continue;
    if (looksLikeToken(candidate)) push(candidate);
  }

  push(extractFromPath(u.pathname));

  if (depth < 1) {
    const adds = [...search.getAll("add"), ...hash.getAll("add")];
    for (const a of adds) {
      let decoded = stripEdgePunct(a);
      if (!decoded) continue;
      if (/%[0-9A-Fa-f]{2}/.test(decoded)) {
        try {
          decoded = decodeURIComponent(decoded);
        } catch (e: unknown) {
          void e;
        }
      }
      for (const tok of extractTokenCandidates(decoded, depth + 1)) push(tok);
    }
  }

  return out;
}

/**
 * If URL params contain legacy v=<LONG_TOKEN> (not version),
 * migrate it into t= and remove v=.
 */
function migrateLegacyVParamToT(p: URLSearchParams): void {
  if (p.get("t") || p.get("p") || p.get("token") || p.get("capsule")) return;

  const vv = paramGetAny(p, "v");
  if (!vv) return;

  const candidate = normalizeToken(vv);
  if (!looksLikeToken(candidate)) return;

  p.set("t", candidate);
  p.delete("v");
  p.delete("V");
}

/**
 * CANON: token open URL is always hash-based:
 *   /stream#t=<token>
 */
function makeStreamOpenUrlFromToken(tokenRaw: string): string {
  const base = streamBaseHref();
  const t = normalizeToken(tokenRaw);
  return `${base}#t=${encodeURIComponent(t)}`;
}

/**
 * Best-effort “moment” URL (URL-only; does NOT inspect nested add=):
 * - If a token exists in the input (including legacy /stream/p, or legacy v= token), return /stream#t=...
 * - Otherwise null.
 */
function makeStreamMomentUrl(rawUrl: string): string | null {
  const raw = stripEdgePunct(rawUrl);
  const tok = extractTokenCandidates(raw, 1)[0];
  return tok ? makeStreamOpenUrlFromToken(tok) : null;
}

/**
 * Normalize any non-/s URL into a browser-safe canonical:
 * - Memory streams with root/add → /stream#... (hash-only)
 * - Tokenized links → /stream#t=...
 * - /s payload stays as-is
 */
function normalizeResolvedUrlForBrowser(rawUrl: string): string {
  const raw = stripEdgePunct(rawUrl);

  const u = tryParseUrl(raw);
  if (u) {
    const hashStr = u.hash && u.hash.startsWith("#") ? u.hash.slice(1) : "";
    const hp = new URLSearchParams(hashStr);
    const sp = u.searchParams;

    // If it is a memory stream (root present), normalize to /stream#... (hash-only)
    const hasRoot = Boolean(paramGetAny(hp, "root") || paramGetAny(sp, "root"));
    if (hasRoot) {
      const base = streamBaseHref();
      const outUrl = new URL(base || STREAM_PATH, originForParse());
      const p = new URLSearchParams();
      for (const [k, v] of hp.entries()) p.append(k, v);
      for (const [k, v] of sp.entries()) p.append(k, v);

      // 🔥 migrate legacy v=<LONG_TOKEN> → t= inside hash/query normalization
      migrateLegacyVParamToT(p);

      outUrl.hash = p.toString() ? `#${p.toString()}` : "";
      outUrl.search = "";
      return outUrl.toString();
    }
  }

  if (isSPayloadUrl(raw)) return raw;

  const tok = extractTokenCandidates(raw, 1)[0] ?? extractTokenCandidates(raw)[0];
  return tok ? makeStreamOpenUrlFromToken(tok) : raw;
}

/** Candidates for decodeSigilUrl compatibility (INPUT support; output remains t= canon). */
function buildDecodeUrlCandidates(token: string): string[] {
  const base = streamBaseHref().replace(/\/stream\/?$/g, "");
  const t = normalizeToken(token);

  return [
    t,
    `${base}/stream#t=${t}`,
    `${base}/stream?t=${t}`,
    `${base}/stream/t=${t}`,
    `${base}/p#t=${t}`,
    `${base}/p?t=${t}`,
    // legacy input (do not output)
    `${base}/stream/p/${t}`,
    `${base}/p#p=${t}`,
    `${base}/p?p=${t}`,
    `${base}/p#token=${t}`,
    `${base}/p?token=${t}`,
    // legacy v= token input
    `${base}/stream#v=${t}`,
    `${base}/stream?v=${t}`,
    `${base}/stream#V=${t}`,
    `${base}/stream?V=${t}`,
  ];
}

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
   Capsule reader (loose, tolerant) — SINGLE implementation (no overload decl)
   ───────────────────────────────────────────────────────────── */

function readCapsuleLoose(v: unknown): Capsule | null {
  if (!isRecord(v)) return null;

  const hasDefined = (rec: Record<string, unknown>, k: string): boolean =>
    Object.prototype.hasOwnProperty.call(rec, k) && typeof rec[k] !== "undefined";

  const hasContent = (rec: Record<string, unknown>): boolean =>
    hasDefined(rec, "post") ||
    hasDefined(rec, "message") ||
    hasDefined(rec, "share") ||
    hasDefined(rec, "reaction");

  const mergeMissingContent = (base: Record<string, unknown>, src: Record<string, unknown>): void => {
    for (const k of ["post", "message", "share", "reaction"] as const) {
      if (hasDefined(src, k) && typeof base[k] === "undefined") base[k] = src[k];
    }
  };

  const root = v as Record<string, unknown>;
  const data = isRecord(root.data) ? (root.data as Record<string, unknown>) : null;

  const rootHasContent = hasContent(root);
  const dataHasContent = Boolean(data) && hasContent(data as Record<string, unknown>);

  const capsuleFromRoot = isRecord(root.capsule) ? (root.capsule as Record<string, unknown>) : null;
  const capsuleFromData = data && isRecord(data.capsule) ? (data.capsule as Record<string, unknown>) : null;

  const capsuleObj = capsuleFromRoot ?? capsuleFromData;

  if (capsuleObj && (rootHasContent || dataHasContent)) {
    const merged: Record<string, unknown> = { ...capsuleObj };
    if (dataHasContent && data) mergeMissingContent(merged, data);
    if (rootHasContent) mergeMissingContent(merged, root);
    return merged as unknown as Capsule;
  }

  if (capsuleObj) return capsuleObj as unknown as Capsule;

  if (rootHasContent) return root as unknown as Capsule;
  if (dataHasContent && data) return data as unknown as Capsule;

  return root as unknown as Capsule;
}

/* ─────────────────────────────────────────────────────────────
   Deterministic JSON canonicalization + base64url (payload refs)
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

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const sub = bytes.subarray(i, i + CHUNK);
    bin += String.fromCharCode(...sub);
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toBase64UrlFromUtf8(s: string): string {
  const enc = new TextEncoder();
  const bytes = enc.encode(s);
  const b64 = bytesToBase64(bytes);
  return b64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function fromBase64UrlToUtf8(b64url: string): string {
  const b64 =
    b64url.replaceAll("-", "+").replaceAll("_", "/") +
    "===".slice((b64url.length + 3) % 4);
  const bytes = base64ToBytes(b64);
  const dec = new TextDecoder();
  return dec.decode(bytes);
}

function encodePayloadRef(payload: unknown): string {
  const canon = JSON.stringify(deepSortForJson(payload));
  const b64url = toBase64UrlFromUtf8(canon);
  return `${PAYLOAD_PREFIX}${b64url}`;
}

function decodePayloadRef(refRaw: string): unknown | null {
  const t = stripEdgePunct(refRaw);
  const v = t.startsWith(PAYLOAD_PREFIX) ? t.slice(PAYLOAD_PREFIX.length) : t;

  if (!/^[A-Za-z0-9_-]{16,}$/.test(v)) return null;

  try {
    const json = fromBase64UrlToUtf8(v);
    return JSON.parse(json) as unknown;
  } catch (e: unknown) {
    void e;
    return null;
  }
}

/* ─────────────────────────────────────────────────────────────
   Fingerprints (FNV-1a 64) + Merkle root (FNV)
   ───────────────────────────────────────────────────────────── */

function fnv1a64Hex(s: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

function merkleRootFNV64Hex(leaves: readonly string[]): string {
  if (!leaves.length) return fnv1a64Hex("merkle:empty");
  let level = leaves.map((x) => fnv1a64Hex(`leaf:${x}`));
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1] ?? left;
      next.push(fnv1a64Hex(`node:${left}${right}`));
    }
    level = next;
  }
  return level[0]!;
}

function payloadKey(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const rec = payload as Record<string, unknown>;

    const id = rec["id"];
    if (typeof id === "string" && /^[0-9a-fA-F]{64}$/.test(id.trim()))
      return `cid:${id.trim().toLowerCase()}`;

    const contentId = rec["contentId"];
    if (typeof contentId === "string" && /^[0-9a-fA-F]{64}$/.test(contentId.trim()))
      return `cid:${contentId.trim().toLowerCase()}`;

    const cid = rec["cid"];
    if (typeof cid === "string" && /^[0-9a-fA-F]{64}$/.test(cid.trim()))
      return `cid:${cid.trim().toLowerCase()}`;

    const p = rec["pulse"];
    if (typeof p === "number" && Number.isFinite(p) && p > 0) return `p:${Math.floor(p)}`;

    const ks = rec["kaiSignature"];
    if (typeof ks === "string" && ks.trim()) return `ks:${ks.trim()}`;
  }

  const canon = JSON.stringify(deepSortForJson(payload));
  return `h:${fnv1a64Hex(canon)}`;
}

/* ─────────────────────────────────────────────────────────────
   Segment header (Merkle-sealed)
   ───────────────────────────────────────────────────────────── */

type SegMeta = {
  v: string;
  id: string;
  m: string;
  n: number;
  a: number;
  r: string;
};

function encodeSegMeta(meta: SegMeta): string {
  const canon = JSON.stringify(deepSortForJson(meta));
  const b64url = toBase64UrlFromUtf8(canon);
  return `${SEG_PREFIX}${b64url}`;
}

function decodeSegMeta(segRaw: string): SegMeta | null {
  const t = stripEdgePunct(segRaw);
  const v = t.startsWith(SEG_PREFIX) ? t.slice(SEG_PREFIX.length) : t;
  if (!/^[A-Za-z0-9_-]{16,}$/.test(v)) return null;
  try {
    const json = fromBase64UrlToUtf8(v);
    const obj = JSON.parse(json) as unknown;
    if (!obj || typeof obj !== "object") return null;
    const rec = obj as Record<string, unknown>;
    const vv = rec["v"];
    const id = rec["id"];
    const m = rec["m"];
    const n = rec["n"];
    const a = rec["a"];
    const r = rec["r"];
    if (typeof vv !== "string" || typeof id !== "string" || typeof m !== "string") return null;
    if (typeof n !== "number" || typeof a !== "number" || typeof r !== "string") return null;
    return { v: vv, id, m, n, a, r };
  } catch (e: unknown) {
    void e;
    return null;
  }
}

/* ─────────────────────────────────────────────────────────────
   KKS-1.0: D/M/Y from μpulses (exact)
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
  const ms = epochMsFromPulse(pulse);
  const pμ = microPulsesSinceGenesis(ms);

  const dayIdx = floorDivE(pμ, N_DAY_MICRO);
  const monthIdx = floorDivE(dayIdx, BigInt(DAYS_PER_MONTH));
  const yearIdx = floorDivE(dayIdx, BigInt(DAYS_PER_YEAR));

  const dayOfMonth = toSafeNumber(modE(dayIdx, BigInt(DAYS_PER_MONTH))) + 1;
  const month = toSafeNumber(modE(monthIdx, BigInt(MONTHS_PER_YEAR))) + 1;
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
  | "Ignite"
  | "Integrate"
  | "Harmonize"
  | "Reflekt"
  | "Purify"
  | "Dream" {
  const idx = Math.max(0, Math.min(5, Math.floor(beatZ / 6)));
  return ([
    "Ignite",
    "Integrate",
    "Harmonize",
    "Reflekt",
    "Purify",
    "Dream",
  ] as const)[idx];
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
   Previous-chain parsing from Memory Stream params
   ───────────────────────────────────────────────────────────── */

const THREAD_MAX_DEPTH = 256;

function extractAddChain(rawUrl: string): string[] {
  const u = tryParseUrl(stripEdgePunct(rawUrl));
  if (!u) return [];

  const hashStr = u.hash && u.hash.startsWith("#") ? u.hash.slice(1) : "";
  const hp = new URLSearchParams(hashStr);
  const sp = u.searchParams;

  const addsRaw = [...hp.getAll("add"), ...sp.getAll("add")];

  const out: string[] = [];
  for (const a of addsRaw) {
    let v = stripEdgePunct(a);
    if (!v) continue;

    if (/%[0-9A-Fa-f]{2}/.test(v)) {
      try {
        v = decodeURIComponent(v);
      } catch (e: unknown) {
        void e;
      }
    }

    if (v.startsWith(PAYLOAD_PREFIX) && v.length > PAYLOAD_PREFIX.length + 8) {
      out.push(v);
      continue;
    }

    const maybePayload = decodePayloadRef(v);
    if (maybePayload && readCapsuleLoose(maybePayload)) {
      const blob = stripEdgePunct(v.startsWith(PAYLOAD_PREFIX) ? v.slice(PAYLOAD_PREFIX.length) : v);
      out.push(`${PAYLOAD_PREFIX}${blob}`);
      continue;
    }

    const tok = extractTokenCandidates(v, 1)[0] ?? extractTokenCandidates(v)[0];
    if (tok) {
      out.push(makeStreamOpenUrlFromToken(tok));
      continue;
    }

    if (isSPayloadUrl(v)) {
      out.push(v);
      continue;
    }

    out.push(normalizeResolvedUrlForBrowser(v));
  }

  return out.slice(-THREAD_MAX_DEPTH);
}

function extractRootRef(rawUrl: string): string | null {
  const u = tryParseUrl(stripEdgePunct(rawUrl));
  if (!u) return null;

  const hashStr = u.hash && u.hash.startsWith("#") ? u.hash.slice(1) : "";
  const hp = new URLSearchParams(hashStr);
  const sp = u.searchParams;

  let r = paramGetAny(hp, "root") ?? paramGetAny(sp, "root");
  if (!r) return null;

  r = stripEdgePunct(r);

  if (/%[0-9A-Fa-f]{2}/.test(r)) {
    try {
      r = decodeURIComponent(r);
    } catch (e: unknown) {
      void e;
    }
  }

  if (r.startsWith(PAYLOAD_PREFIX)) return r;

  const p = decodePayloadRef(r);
  if (p && readCapsuleLoose(p)) return `${PAYLOAD_PREFIX}${stripEdgePunct(r)}`;

  return null;
}

function extractSegMeta(rawUrl: string): SegMeta | null {
  const u = tryParseUrl(stripEdgePunct(rawUrl));
  if (!u) return null;

  const hashStr = u.hash && u.hash.startsWith("#") ? u.hash.slice(1) : "";
  const hp = new URLSearchParams(hashStr);
  const sp = u.searchParams;

  const s = paramGetAny(hp, "seg") ?? paramGetAny(sp, "seg");
  if (!s) return null;

  let v = stripEdgePunct(s);
  if (/%[0-9A-Fa-f]{2}/.test(v)) {
    try {
      v = decodeURIComponent(v);
    } catch (e: unknown) {
      void e;
    }
  }
  return decodeSegMeta(v);
}

/* ─────────────────────────────────────────────────────────────
   Prev-ref resolver (payload walk)
   ───────────────────────────────────────────────────────────── */

function normalizeInternalRefString(raw: string): string | null {
  const s = stripEdgePunct(raw);
  if (!s) return null;

  if (s.startsWith(PAYLOAD_PREFIX)) return s;
  if (isSPayloadUrl(s)) return s;

  {
    const u = tryParseUrl(s);
    if (u) {
      const hashStr = u.hash && u.hash.startsWith("#") ? u.hash.slice(1) : "";
      const hp = new URLSearchParams(hashStr);
      const sp = u.searchParams;
      if (paramGetAny(hp, "root") || paramGetAny(sp, "root")) return normalizeResolvedUrlForBrowser(s);
    }
  }

  const tok = extractTokenCandidates(s, 1)[0] ?? extractTokenCandidates(s)[0];
  if (tok) return makeStreamOpenUrlFromToken(tok);

  return null;
}

function normalizeInternalRefLoose(v: unknown): string | null {
  if (typeof v === "string") return normalizeInternalRefString(v);
  if (v && typeof v === "object") {
    const rec = v as Record<string, unknown>;
    if (typeof rec.url === "string") return normalizeInternalRefString(rec.url);
    if (typeof rec.href === "string") return normalizeInternalRefString(rec.href);
  }
  return null;
}

function extractPrevRefFromPayload(payload: unknown, depth = 0): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (depth > 4) return null;

  const rec = payload as Record<string, unknown>;

  const sk = rec["skip"];
  if (Array.isArray(sk) && typeof sk[1] === "string") {
    const n = normalizeInternalRefString(sk[1]);
    if (n) return n;
  }

  const keys = [
    "prevUrl",
    "prevURL",
    "prev",
    "prevId",
    "prev_id",
    "previousUrl",
    "previousURL",
    "previous",
    "previousId",
    "previous_id",
    "parentUrl",
    "parentURL",
    "parent",
    "parentId",
    "parent_id",
    "replyToUrl",
    "replyToURL",
    "replyTo",
    "replyToId",
    "replyTo_id",
    "inReplyToUrl",
    "inReplyToURL",
    "inReplyTo",
    "inReplyToId",
    "inReplyTo_id",
    "refUrl",
    "ref_url",
    "ref",
  ] as const;

  for (const k of keys) {
    const n = normalizeInternalRefLoose(rec[k]);
    if (n) return n;
  }

  for (const wrap of ["capsule", "data", "payload"] as const) {
    const n = extractPrevRefFromPayload(rec[wrap], depth + 1);
    if (n) return n;
  }

  return null;
}

/* ─────────────────────────────────────────────────────────────
   φ / Fibonacci snap (stable tail sizing)
   ───────────────────────────────────────────────────────────── */

function fibFloor(n: number): number {
  const x = Math.max(0, Math.floor(n));
  if (x <= 2) return x;

  let a = 1;
  let b = 2;
  while (true) {
    const c = a + b;
    if (c > x) return b;
    a = b;
    b = c;
  }
}

/* ─────────────────────────────────────────────────────────────
   Memory Stream URL builder (hash-only) + segmented Pack
   ───────────────────────────────────────────────────────────── */

type BuiltSegment = {
  url: string;
  rootRef: string;
  adds: string[];
  meta: SegMeta;
};

function buildMemoryStreamUrl(rootRef: string, adds: readonly string[]): BuiltSegment {
  const base = streamBaseHref();
  const u = new URL(base || STREAM_PATH, originForParse());

  const leaves = [rootRef, ...adds];
  const merkle = merkleRootFNV64Hex(leaves);
  const segId = `seg:${merkle}:${leaves.length}`;

  const meta: SegMeta = {
    v: MEM_V,
    id: segId,
    m: merkle,
    n: leaves.length,
    a: adds.length,
    r: short(rootRef, 8, 6),
  };

  const hp = new URLSearchParams();
  hp.set("v", MEM_V);
  hp.set("root", rootRef);
  hp.set("seg", encodeSegMeta(meta));
  for (const a of adds) hp.append("add", a);

  u.hash = hp.toString() ? `#${hp.toString()}` : "";
  u.search = "";
  return { url: u.toString(), rootRef, adds: [...adds], meta };
}

function segmentTailToFit(rootRef: string, adds: readonly string[]): { keepFrom: number; kept: string[] } {
  let lo = 0;
  let hi = adds.length;

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const kept = adds.slice(mid);
    const href = buildMemoryStreamUrl(rootRef, kept).url;
    if (href.length <= URL_HARD_CAP) hi = mid;
    else lo = mid + 1;
  }

  const maxKept = adds.length - lo;
  const snap = fibFloor(maxKept);
  const keptCount = Math.max(0, Math.min(maxKept, snap > 0 ? snap : maxKept));
  const keepFrom = adds.length - keptCount;

  return { keepFrom, kept: adds.slice(keepFrom) };
}

function buildSegmentedPack(
  rootRef: string,
  adds: readonly string[],
  guard = 0,
): { primary: BuiltSegment; archives: BuiltSegment[] } {
  if (guard > 64) {
    return { primary: buildMemoryStreamUrl(rootRef, []), archives: [] };
  }

  const full = buildMemoryStreamUrl(rootRef, adds);
  if (full.url.length <= URL_HARD_CAP) return { primary: full, archives: [] };

  const { keepFrom, kept } = segmentTailToFit(rootRef, adds);

  const primary = buildMemoryStreamUrl(rootRef, kept);
  if (primary.url.length > URL_HARD_CAP) {
    return { primary: buildMemoryStreamUrl(rootRef, []), archives: [] };
  }

  if (keepFrom <= 0) return { primary, archives: [] };

  const dropped = adds.slice(0, keepFrom);
  const boundaryRoot = kept[0];
  if (!boundaryRoot) return { primary, archives: [] };

  const archivePack = buildSegmentedPack(boundaryRoot, dropped, guard + 1);
  return { primary, archives: [archivePack.primary, ...archivePack.archives] };
}

function dedupPreserveOrder(list: readonly string[]): string[] {
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

function countPayloadRefs(list: readonly string[]): number {
  let n = 0;
  for (const it of list) if (stripEdgePunct(it).startsWith(PAYLOAD_PREFIX)) n++;
  return n;
}

/* ─────────────────────────────────────────────────────────────
   Thread keys + loop safety
   ───────────────────────────────────────────────────────────── */

function threadSeenKey(rawRef: string, payloadMaybe?: unknown): string {
  const ref = stripEdgePunct(rawRef);

  if (payloadMaybe) return `k:${payloadKey(payloadMaybe)}`;

  if (ref.startsWith(PAYLOAD_PREFIX)) {
    const p = decodePayloadRef(ref);
    if (p) return `k:${payloadKey(p)}`;
    return `k:${fnv1a64Hex(ref)}`;
  }

  const tok = extractTokenCandidates(ref, 1)[0] ?? extractTokenCandidates(ref)[0];
  if (tok) return `t:${normalizeToken(tok)}`;

  return `u:${normalizeResolvedUrlForBrowser(ref)}`;
}

/* ─────────────────────────────────────────────────────────────
   In-memory chain graph (for Remember pack building)
   ───────────────────────────────────────────────────────────── */

const CHAIN_MAX_NODES = 4096;

type ChainNode = {
  key: string;
  prevKey: string | null;
  payloadRef: string | null;
  fallbackRef: string;
  tick: number;
};

const CHAIN: Map<string, ChainNode> = new Map();
let CHAIN_TICK = 0;

let CHAIN_VERSION = 0;
let CHAIN_NOTIFY_PENDING = false;
const CHAIN_LISTENERS: Set<() => void> = new Set();

function notifyChainBatched(): void {
  if (CHAIN_NOTIFY_PENDING) return;
  CHAIN_NOTIFY_PENDING = true;

  const run = (): void => {
    CHAIN_NOTIFY_PENDING = false;
    CHAIN_VERSION++;
    for (const fn of CHAIN_LISTENERS) fn();
  };

  if (typeof queueMicrotask === "function") queueMicrotask(run);
  else Promise.resolve().then(run);
}

function subscribeChain(cb: () => void): () => void {
  CHAIN_LISTENERS.add(cb);
  return () => CHAIN_LISTENERS.delete(cb);
}

function getChainSnapshot(): number {
  return CHAIN_VERSION;
}
function getChainServerSnapshot(): number {
  return 0;
}

function upsertChainNode(node: Omit<ChainNode, "tick">): void {
  const prev = CHAIN.get(node.key);
  if (
    prev &&
    prev.prevKey === node.prevKey &&
    prev.payloadRef === node.payloadRef &&
    prev.fallbackRef === node.fallbackRef
  ) {
    return;
  }

  if (CHAIN.has(node.key)) CHAIN.delete(node.key);
  CHAIN.set(node.key, { ...node, tick: ++CHAIN_TICK });
  notifyChainBatched();

  while (CHAIN.size > CHAIN_MAX_NODES) {
    const oldest = CHAIN.keys().next().value as string | undefined;
    if (!oldest) break;
    CHAIN.delete(oldest);
    notifyChainBatched();
  }
}

function buildPrevAddsFromChain(selfKey: string, limit: number): string[] {
  const adds: string[] = [];
  const seen = new Set<string>();

  const cur = CHAIN.get(selfKey);
  let prevKey = cur?.prevKey ?? null;
  let steps = 0;

  while (prevKey && steps < limit) {
    const pk = prevKey;
    if (seen.has(pk)) break;
    seen.add(pk);

    const n = CHAIN.get(pk);
    if (!n) break;

    adds.push(n.payloadRef ?? n.fallbackRef);

    prevKey = n.prevKey;
    steps++;
  }

  adds.reverse();
  return adds;
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

/* ─────────────────────────────────────────────────────────────
   v3 payload support (caption/body/attachments)
   ───────────────────────────────────────────────────────────── */

type V3BodyKind = "text" | "md" | "code" | "html";

type DerivedV3Post = {
  post?: PostPayload;
  bodyKind?: V3BodyKind;
};

function readStringLoose(obj: unknown, key: string): string | undefined {
  if (!isRecord(obj)) return undefined;
  const v = obj[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function readStringArrayLoose(obj: unknown, key: string): string[] {
  if (!isRecord(obj)) return [];
  const v = obj[key];
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const it of v) if (typeof it === "string" && it.trim()) out.push(it.trim());
  return out;
}

function extractV3TextAndKind(payload: unknown): { text?: string; kind?: V3BodyKind } {
  if (!isRecord(payload)) return {};

  const caption = readStringLoose(payload, "caption");
  const body = payload["body"];

  if (isRecord(body)) {
    const k = readStringLoose(body, "kind");
    const kind =
      k === "text" || k === "md" || k === "code" || k === "html" ? (k as V3BodyKind) : undefined;

    if (kind === "text") return { text: readStringLoose(body, "text") ?? caption, kind };
    if (kind === "md") return { text: readStringLoose(body, "md") ?? caption, kind };
    if (kind === "code") return { text: readStringLoose(body, "code") ?? caption, kind };
    if (kind === "html") return { text: readStringLoose(body, "html") ?? caption, kind };
  }

  return { text: caption, kind: undefined };
}

function extractV3MediaLinks(payload: unknown): Array<{ url: string }> {
  if (!isRecord(payload)) return [];
  const att = payload["attachments"];
  if (!isRecord(att)) return [];
  const items = att["items"];
  if (!Array.isArray(items)) return [];

  const out: Array<{ url: string }> = [];
  for (const it of items) {
    if (!isRecord(it)) continue;
    const url = readStringLoose(it, "url");
    if (url) {
      out.push({ url });
      continue;
    }
    const href = readStringLoose(it, "href");
    if (href) out.push({ url: href });
  }
  return out;
}

function deriveV3PostLike(capsule: Capsule | null, dataRaw: unknown): DerivedV3Post {
  const src: unknown = capsule ?? dataRaw;
  if (!src) return {};

  const { text, kind } = extractV3TextAndKind(src);
  const tags = readStringArrayLoose(src, "tags");
  const links = extractV3MediaLinks(src);

  const hasText = typeof text === "string" && text.trim().length > 0;
  const hasLinks = links.length > 0;
  const hasTags = tags.length > 0;

  if (!hasText && !hasLinks && !hasTags) return {};

  const post: PostPayload = {
    title: undefined,
    text: hasText ? text : undefined,
    tags: hasTags ? tags : undefined,
    media: hasLinks ? links.map((l) => ({ kind: "url" as const, url: l.url })) : undefined,
  };

  return { post, bodyKind: kind };
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

    const prevFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ta.focus();
    ta.select();

    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (prevFocus) prevFocus.focus();
    return ok;
  } catch (e: unknown) {
    void e;
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

function copyTextGestureSafe(
  text: string,
  onOk: () => void,
  onFail: (e?: unknown) => void,
): void {
  const okSync = tryCopyExecCommand(text);
  if (okSync) {
    onOk();
    return;
  }

  const p = clipboardWriteTextPromise(text);
  if (p) {
    onOk();
    p.catch((e: unknown) => onFail(e));
    return;
  }

  onFail();
}

/* ─────────────────────────────────────────────────────────────
   Explorer + Feed registry bridge (localStorage + BroadcastChannel)
   ───────────────────────────────────────────────────────────── */

const EXPLORER_LS_KEY = "sigil:urls";
const FEED_LS_KEY = "sigil:feed";
const EXPLORER_BC_NAME = "kai-sigil-registry";
const EXPLORER_GLOBAL_LS_KEY = "kai:sigils:v1";
const FEED_BC_NAME = "kai-feed-registry";

let REG_VERSION = 0;
let REG_NOTIFY_PENDING = false;
const REG_LISTENERS: Set<() => void> = new Set();

let REG_BRIDGE_INIT = false;
let REG_BC_EXPLORER: BroadcastChannel | null = null;
let REG_BC_FEED: BroadcastChannel | null = null;

function notifyRegistryBatched(): void {
  if (REG_NOTIFY_PENDING) return;
  REG_NOTIFY_PENDING = true;

  const run = (): void => {
    REG_NOTIFY_PENDING = false;
    REG_VERSION++;
    for (const fn of REG_LISTENERS) fn();
  };

  if (typeof queueMicrotask === "function") queueMicrotask(run);
  else Promise.resolve().then(run);
}

function subscribeRegistry(cb: () => void): () => void {
  REG_LISTENERS.add(cb);
  return () => REG_LISTENERS.delete(cb);
}

function getRegistrySnapshot(): number {
  return REG_VERSION;
}
function getRegistryServerSnapshot(): number {
  return 0;
}

function urlsFromUnknown(v: unknown): string[] {
  const out: string[] = [];

  if (Array.isArray(v)) {
    for (const it of v) if (typeof it === "string" && it.trim()) out.push(it.trim());
    return out;
  }

  if (isRecord(v)) {
    const maybeUrls = (v as { urls?: unknown }).urls;
    if (Array.isArray(maybeUrls)) {
      for (const it of maybeUrls) if (typeof it === "string" && it.trim()) out.push(it.trim());
      return out;
    }

    const keys = Object.keys(v);
    const urlishKeys = keys.filter(
      (k) =>
        k.startsWith("http") ||
        k.startsWith("/") ||
        k.includes("/stream") ||
        k.includes("/s/"),
    );
    if (urlishKeys.length) return urlishKeys;

    for (const vv of Object.values(v)) {
      if (isRecord(vv) && typeof vv.url === "string" && vv.url.trim()) out.push(vv.url.trim());
    }
    return out;
  }

  return out;
}

function readUrlList(lsKey: string): string[] {
  if (typeof window === "undefined") return [];
  if (typeof window.localStorage === "undefined") return [];
  const raw = window.localStorage.getItem(lsKey);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return urlsFromUnknown(parsed);
  } catch {
    return [];
  }
}

function canonicalizeForStorage(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  try {
    return new URL(t, originForParse()).toString();
  } catch {
    return t;
  }
}

function readExplorerGlobalUrls(): string[] {
  const merged = dedupPreserveOrder([
    ...readUrlList(FEED_LS_KEY),
    ...readUrlList(EXPLORER_LS_KEY),
    ...readUrlList(EXPLORER_GLOBAL_LS_KEY),
  ]);

  const out: string[] = [];
  for (const u of merged) {
    const c = canonicalizeForStorage(u);
    if (c) out.push(c);
  }
  return dedupPreserveOrder(out);
}

function normalizeSeedHrefFromRef(refRaw: string): string {
  const ref = stripEdgePunct(refRaw);
  if (!ref) return "";

  // payload ref → viewable memory stream url
  if (ref.startsWith(PAYLOAD_PREFIX)) {
    return buildMemoryStreamUrl(ref, []).url;
  }

  // prefer token moment (t= canon), else normalize
  return makeStreamMomentUrl(ref) ?? normalizeResolvedUrlForBrowser(ref);
}

/**
 * NOTE: This key is intentionally used by the Thread panel logic (existing behavior).
 * Do NOT repurpose it for feed-root de-dupe; use threadRootKeyFromUrlLike instead.
 */
function originKeyFromUrlLike(u: string): string {
  const chain = dedupPreserveOrder(extractAddChain(u));
  const originRef = chain[0] ?? u;
  const p = originRef.startsWith(PAYLOAD_PREFIX) ? decodePayloadRef(originRef) : null;
  return threadSeenKey(originRef, p ?? undefined);
}

/* ─────────────────────────────────────────────────────────────
   Feed-root derivation: collapse feed to THREAD ROOT only
   ───────────────────────────────────────────────────────────── */

function loadPayloadFromRef(ref: string): unknown | null {
  const r = stripEdgePunct(ref);
  if (!r) return null;

  if (r.startsWith(PAYLOAD_PREFIX)) return decodePayloadRef(r);

  const d = decodeSigilUrlSmart(r);
  if (d.decoded.ok) return d.decoded.data as unknown;

  return null;
}

function threadRootRefFromUrlLike(rawUrl: string, startPayload?: unknown): string {
  const u = stripEdgePunct(rawUrl);
  if (!u) return rawUrl;

  const chain = dedupPreserveOrder(extractAddChain(u));
  if (chain.length > 0) return chain[0]!;

  let curRef = u;
  let payload: unknown | null = typeof startPayload !== "undefined" ? startPayload : null;
  if (!payload) payload = loadPayloadFromRef(curRef);

  const seen = new Set<string>();
  for (let i = 0; i < 48; i++) {
    const k = threadSeenKey(curRef, payload ?? undefined);
    if (seen.has(k)) break;
    seen.add(k);

    const prev = payload ? extractPrevRefFromPayload(payload) : null;
    if (!prev) return curRef;

    curRef = prev;
    payload = loadPayloadFromRef(curRef);
  }

  return curRef;
}

function threadRootKeyFromUrlLike(rawUrl: string, startPayload?: unknown): string {
  const rootRef = threadRootRefFromUrlLike(rawUrl, startPayload);
  const p = rootRef.startsWith(PAYLOAD_PREFIX)
    ? decodePayloadRef(rootRef)
    : loadPayloadFromRef(rootRef);
  return threadSeenKey(rootRef, p ?? undefined);
}

/* ─────────────────────────────────────────────────────────────
   /s URL derivation (feed primary url requirement)
   ───────────────────────────────────────────────────────────── */

function makeSigilSUrlFromId(idRaw: string): string {
  const id = stripEdgePunct(idRaw);

  if (/^[0-9a-fA-F]{64}$/.test(id)) {
    try {
      return canonicalPostLinkFromHash(id.toLowerCase());
    } catch (e: unknown) {
      void e;
    }
  }

  const base = sigilBaseHref();
  return `${base}/${encodeURIComponent(id)}`;
}

function readStringField(obj: unknown, keys: readonly string[]): string | null {
  if (!isRecord(obj)) return null;
  for (const k of keys) {
    const v = (obj as Record<string, unknown>)[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function computeSigilSUrl(rawInputUrl: string, capsule: Capsule | null): string | null {
  const raw = stripEdgePunct(rawInputUrl);

  if (isSPayloadUrl(raw)) return raw;

  const fromCapsule =
    readStringField(capsule, [
      "sigilUrl",
      "sigilURL",
      "sigil_url",
      "sigilHref",
      "sigil_href",
      "sUrl",
      "s_url",
      "s",
    ]) ?? null;

  if (fromCapsule && isSPayloadUrl(fromCapsule)) return normalizeResolvedUrlForBrowser(fromCapsule);

  const hashLike =
    readStringField(capsule, ["id", "contentId", "cid", "hash", "contentHash"]) ?? null;

  if (hashLike && /^[0-9a-fA-F]{64}$/.test(hashLike)) return makeSigilSUrlFromId(hashLike);

  const sigilId = isRecord(capsule) ? (capsule as Record<string, unknown>).sigilId : undefined;
  if (typeof sigilId === "string" && sigilId.trim()) return makeSigilSUrlFromId(sigilId);

  const tok = extractTokenCandidates(raw, 1)[0] ?? extractTokenCandidates(raw)[0];
  if (tok && /^[0-9a-fA-F]{64}$/.test(tok)) return makeSigilSUrlFromId(tok);

  return null;
}

function threadRootHrefFromUrlLike(rawUrl: string, startPayload?: unknown): string {
  const rootRef = threadRootRefFromUrlLike(rawUrl, startPayload);
  const rootPayload = loadPayloadFromRef(rootRef);
  const rootCapsule = rootPayload ? readCapsuleLoose(rootPayload) : null;

  const sUrl = computeSigilSUrl(rootRef, rootCapsule);
  if (sUrl) return normalizeResolvedUrlForBrowser(sUrl);

  return normalizeSeedHrefFromRef(rootRef);
}

/* ─────────────────────────────────────────────────────────────
   Registry helpers (dedupe + upgrade)
   ───────────────────────────────────────────────────────────── */

function countAddsInUrl(raw: string): number {
  const u = tryParseUrl(raw);
  if (!u) return 0;
  const hashStr = u.hash && u.hash.startsWith("#") ? u.hash.slice(1) : "";
  const hp = new URLSearchParams(hashStr);
  const sp = u.searchParams;
  return hp.getAll("add").length + sp.getAll("add").length;
}

function registryScore(raw: string): number {
  const adds = countAddsInUrl(raw);
  const len = raw.length;
  return adds * 100_000 + len;
}

function keyForRegistryUrl(raw: string): string {
  const tok = extractTokenCandidates(raw, 1)[0] ?? extractTokenCandidates(raw)[0];
  if (tok) return `t:${normalizeToken(tok)}`;

  const rootRef = extractRootRef(raw);
  if (rootRef) {
    const p = decodePayloadRef(rootRef);
    return p ? `r:${payloadKey(p)}` : `r:${fnv1a64Hex(rootRef)}`;
  }

  return `u:${normalizeResolvedUrlForBrowser(raw)}`;
}

function upsertUrlList(
  lsKey: string,
  rawUrl: string,
): { changed: boolean; added: boolean; updated: boolean; value: string } {
  if (typeof window === "undefined") return { changed: false, added: false, updated: false, value: rawUrl };
  if (typeof window.localStorage === "undefined") return { changed: false, added: false, updated: false, value: rawUrl };

  const canonical = canonicalizeForStorage(rawUrl);
  if (!canonical) return { changed: false, added: false, updated: false, value: rawUrl };

  try {
    const raw = window.localStorage.getItem(lsKey);
    const existing: string[] = [];

    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) for (const v of parsed) if (typeof v === "string") existing.push(v);
    }

    const bestByKey = new Map<string, { url: string; score: number; index: number }>();
    const order: string[] = [];
    for (const v of existing) {
      const c = canonicalizeForStorage(v);
      if (!c) continue;
      const k = keyForRegistryUrl(c);
      const sc = registryScore(c);

      const prior = bestByKey.get(k);
      if (!prior) {
        bestByKey.set(k, { url: c, score: sc, index: order.length });
        order.push(k);
      } else if (sc > prior.score) {
        bestByKey.set(k, { url: c, score: sc, index: prior.index });
      }
    }

    const newKey = keyForRegistryUrl(canonical);
    const newScore = registryScore(canonical);

    const prior = bestByKey.get(newKey);
    let added = false;
    let updated = false;

    if (!prior) {
      bestByKey.set(newKey, { url: canonical, score: newScore, index: order.length });
      order.push(newKey);
      added = true;
    } else if (newScore > prior.score) {
      bestByKey.set(newKey, { url: canonical, score: newScore, index: prior.index });
      updated = true;
    }

    const next: string[] = [];
    for (const k of order) {
      const it = bestByKey.get(k);
      if (it) next.push(it.url);
    }

    const prevJson = JSON.stringify(existing);
    const nextJson = JSON.stringify(next);

    if (prevJson !== nextJson) {
      window.localStorage.setItem(lsKey, nextJson);
      return { changed: true, added, updated, value: canonical };
    }

    return { changed: false, added, updated, value: canonical };
  } catch {
    return { changed: false, added: false, updated: false, value: canonical };
  }
}

function notifyExplorer(url: string): void {
  if (typeof window === "undefined") return;

  try {
    const w = window as unknown as { __SIGIL__?: { registerSigilUrl?: (u: string) => void } };
    w.__SIGIL__?.registerSigilUrl?.(url);
  } catch (e: unknown) {
    void e;
  }

  try {
    window.dispatchEvent(new CustomEvent("sigil:url-registered", { detail: { url } }));
  } catch (e: unknown) {
    void e;
  }

  try {
    if ("BroadcastChannel" in window) {
      const bc = new BroadcastChannel(EXPLORER_BC_NAME);
      bc.postMessage({ type: "sigil:add", url });
      bc.close();
    }
  } catch (e: unknown) {
    void e;
  }
}

function notifyFeed(url: string): void {
  if (typeof window === "undefined") return;

  try {
    window.dispatchEvent(new CustomEvent("sigil:feed-registered", { detail: { url } }));
  } catch (e: unknown) {
    void e;
  }

  try {
    if ("BroadcastChannel" in window) {
      const bc = new BroadcastChannel(FEED_BC_NAME);
      bc.postMessage({ type: "feed:add", url });
      bc.close();
    }
  } catch (e: unknown) {
    void e;
  }
}

function scoreFeedRootUrl(u: string): number {
  let s = 0;
  const low = u.toLowerCase();

  if (isSPayloadUrl(u)) s += 5_000_000;
  if (/[?&#]t=/.test(low) || low.includes("/stream/t")) s += 2_000_000;
  if (low.includes("/stream/p/")) s -= 500_000;
  if (/[?&#]v=/.test(low)) s -= 250_000;

  s += registryScore(u);
  return s;
}

function pruneFeedDuplicatesForThread(rootKey: string, keepUrlHint: string): void {
  if (typeof window === "undefined") return;
  if (typeof window.localStorage === "undefined") return;

  const list = readUrlList(FEED_LS_KEY);
  if (!list.length) return;

  const kept: string[] = [];
  let bestUrl: string | null = null;
  let bestScore = -Infinity;

  for (const raw of list) {
    const u = canonicalizeForStorage(raw);
    if (!u) continue;

    const k = threadRootKeyFromUrlLike(u);
    if (k !== rootKey) {
      kept.push(u);
      continue;
    }

    const sc = scoreFeedRootUrl(u);
    if (sc > bestScore) {
      bestScore = sc;
      bestUrl = u;
    }
  }

  if (keepUrlHint) {
    const u = canonicalizeForStorage(keepUrlHint);
    if (u) {
      const sc = scoreFeedRootUrl(u);
      if (sc > bestScore) {
        bestScore = sc;
        bestUrl = u;
      }
    }
  }

  if (bestUrl) kept.push(bestUrl);

  const next = dedupPreserveOrder(kept);
  try {
    const prevRaw = window.localStorage.getItem(FEED_LS_KEY) ?? "[]";
    const prev = JSON.stringify(urlsFromUnknown(JSON.parse(prevRaw)));
    const nextJson = JSON.stringify(next);
    if (prev !== nextJson) {
      window.localStorage.setItem(FEED_LS_KEY, nextJson);
    }
  } catch (e: unknown) {
    void e;
  }
}

function ensureRegistryBridge(): void {
  if (typeof window === "undefined") return;
  if (REG_BRIDGE_INIT) return;

  REG_BRIDGE_INIT = true;

  const onStorage = (e: StorageEvent): void => {
    const k = e.key ?? "";
    if (
      k === EXPLORER_LS_KEY ||
      k === FEED_LS_KEY ||
      k === EXPLORER_GLOBAL_LS_KEY
    ) {
      notifyRegistryBatched();
    }
  };

  try {
    window.addEventListener("storage", onStorage);
  } catch (e: unknown) {
    void e;
  }

  // Persistent listeners (no echo; they only merge locally)
  try {
    if ("BroadcastChannel" in window) {
      REG_BC_EXPLORER = new BroadcastChannel(EXPLORER_BC_NAME);
      REG_BC_EXPLORER.onmessage = (ev: MessageEvent): void => {
        const msg = ev.data as unknown;
        const url =
          isRecord(msg) && typeof (msg as { url?: unknown }).url === "string"
            ? ((msg as { url: string }).url as string)
            : null;
        if (!url) return;

        // Merge into explorer list (local only)
        upsertUrlList(EXPLORER_LS_KEY, url);
        notifyRegistryBatched();
      };

      REG_BC_FEED = new BroadcastChannel(FEED_BC_NAME);
      REG_BC_FEED.onmessage = (ev: MessageEvent): void => {
        const msg = ev.data as unknown;
        const url =
          isRecord(msg) && typeof (msg as { url?: unknown }).url === "string"
            ? ((msg as { url: string }).url as string)
            : null;
        if (!url) return;

        // Merge into feed list (local only)
        upsertUrlList(FEED_LS_KEY, url);
        notifyRegistryBatched();
      };
    }
  } catch (e: unknown) {
    void e;
  }

  notifyRegistryBatched();
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
  threadMode?: "thread" | "self";
};

type InputKind =
  | { kind: "embedded"; rootRef: string; payload: unknown; openUrl: string }
  | { kind: "sigilUrl"; openUrl: string };

function readPulseLoose(v: unknown): number {
  if (isRecord(v) && typeof v.pulse === "number" && Number.isFinite(v.pulse)) return v.pulse;
  if (
    isRecord(v) &&
    isRecord(v.data) &&
    typeof (v.data as Record<string, unknown>).pulse === "number" &&
    Number.isFinite((v.data as Record<string, unknown>).pulse as number)
  ) {
    return (v.data as Record<string, unknown>).pulse as number;
  }
  return 0;
}

function readAppIdLoose(v: unknown): string | undefined {
  const a = isRecord(v) ? v.appId : undefined;
  if (typeof a === "string" && a.trim()) return a;
  const d = isRecord(v) && isRecord(v.data) ? (v.data as Record<string, unknown>).appId : undefined;
  if (typeof d === "string" && d.trim()) return d;
  return undefined;
}

function readUserIdLoose(v: unknown): unknown {
  const u = isRecord(v) ? v.userId : undefined;
  if (typeof u !== "undefined") return u;
  const d = isRecord(v) && isRecord(v.data) ? (v.data as Record<string, unknown>).userId : undefined;
  return d;
}

function extractTokenFromPayloadLoose(v: unknown, depth = 0): string | null {
  if (!v || depth > 4) return null;

  if (typeof v === "string") {
    const t = normalizeToken(v);
    return looksLikeToken(t) ? t : null;
  }

  if (!isRecord(v)) return null;

  // direct token-ish keys
  const direct =
    readStringField(v, ["t", "token", "streamToken", "capsuleToken", "momentToken"]) ??
    null;
  if (direct) {
    const t = normalizeToken(direct);
    if (looksLikeToken(t)) return t;
  }

  // legacy v=<token> stored in data (not version)
  const legacyV = readStringField(v, ["v", "V"]) ?? null;
  if (legacyV) {
    const t = normalizeToken(legacyV);
    if (looksLikeToken(t)) return t;
  }

  // ids that may function as tokens
  const idLike =
    readStringField(v, ["id", "contentId", "cid", "hash", "contentHash"]) ?? null;
  if (idLike) {
    const t = normalizeToken(idLike);
    if (looksLikeToken(t)) return t;
  }

  // recurse common wrappers
  for (const k of ["data", "capsule", "payload", "post", "message", "share", "reaction"] as const) {
    const inner = (v as Record<string, unknown>)[k];
    const t = extractTokenFromPayloadLoose(inner, depth + 1);
    if (t) return t;
  }

  return null;
}

function parseInputKind(rawUrl: string): InputKind {
  const raw = stripEdgePunct(rawUrl);

  if (raw.startsWith(PAYLOAD_PREFIX)) {
    const payload = decodePayloadRef(raw);
    if (payload) {
      const rootRef = raw.startsWith(PAYLOAD_PREFIX) ? raw : `${PAYLOAD_PREFIX}${raw}`;
      const openUrl = buildMemoryStreamUrl(rootRef, []).url;
      return { kind: "embedded", rootRef, payload, openUrl };
    }
  }

  const rootRef = extractRootRef(raw);
  if (rootRef) {
    const payload = decodePayloadRef(rootRef);
    if (payload) {
      const openUrl = buildMemoryStreamUrl(rootRef, []).url;
      return { kind: "embedded", rootRef, payload, openUrl };
    }
  }

  return { kind: "sigilUrl", openUrl: normalizeResolvedUrlForBrowser(raw) };
}

type ResolvedNodeOk = {
  ok: true;
  openUrl: string;
  dataRaw: unknown;
  storePayload: unknown;
  pulse: number;
  appId?: string;
  userId?: unknown;
  capsule: Capsule;
};

type ResolvedNodeErr = { ok: false; openUrl: string; error: string };
type ResolvedNode = ResolvedNodeOk | ResolvedNodeErr;

const FeedCardThread: React.FC<ThreadProps> = ({
  url,
  depth = 0,
  seen = [],
  addChain: addChainProp,
  addIndex: addIndexProp,
  threadMode = "thread",
}) => {
  const [copied, setCopied] = useState(false);
  const [packed, setPacked] = useState(false);
  const [bodyExpanded, setBodyExpanded] = useState<boolean>(false);

  const chainVersion = useSyncExternalStore(subscribeChain, getChainSnapshot, getChainServerSnapshot);

  const input = useMemo(() => parseInputKind(url), [url]);
  const smart = useMemo(() => decodeSigilUrlSmart(url), [url]);

  const node: ResolvedNode = useMemo(() => {
    if (input.kind === "embedded") {
      const payload = input.payload;
      const capsule = readCapsuleLoose(payload);
      if (!capsule) {
        return { ok: false, openUrl: input.openUrl, error: "Invalid embedded payload (missing capsule)." };
      }

      const pulse = readPulseLoose(payload);
      const appId = readAppIdLoose(payload);
      const userId = readUserIdLoose(payload);

      return {
        ok: true,
        openUrl: input.openUrl,
        dataRaw: payload,
        storePayload: payload,
        pulse,
        appId,
        userId,
        capsule,
      };
    }

    const decoded = smart.decoded;
    const openUrl = normalizeResolvedUrlForBrowser(smart.resolvedUrl || url);

    if (!decoded.ok) {
      return {
        ok: false,
        openUrl,
        error: ("error" in decoded ? (decoded as { error?: string }).error : undefined) ?? "Decode failed.",
      };
    }

    const data = decoded.data as unknown;
    const capsule = readCapsuleLoose(data);
    if (!capsule) {
      return { ok: false, openUrl, error: "Decode ok, but capsule missing." };
    }

    const pulse =
      typeof (decoded.data as { pulse?: unknown }).pulse === "number" &&
      Number.isFinite((decoded.data as { pulse?: unknown }).pulse)
        ? (decoded.data as { pulse: number }).pulse
        : readPulseLoose(decoded.data);

    const appId =
      typeof (decoded.data as { appId?: unknown }).appId === "string" && (decoded.data as { appId?: string }).appId
        ? (decoded.data as { appId: string }).appId
        : readAppIdLoose(decoded.data);

    const userId = (decoded.data as { userId?: unknown }).userId ?? readUserIdLoose(decoded.data);

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
  }, [input, smart.decoded, smart.resolvedUrl, url]);

  const nodeOk = node.ok;
  const nodeResolved = nodeOk ? (node as ResolvedNodeOk) : null;
  const nodeStorePayload: unknown | null = nodeOk ? nodeResolved!.storePayload : null;

  const capsuleForSUrl: Capsule | null = nodeOk ? nodeResolved!.capsule : null;
  const sigilSUrl = useMemo(() => computeSigilSUrl(url, capsuleForSUrl), [url, capsuleForSUrl]);

  const addChain = useMemo(() => {
    const chain = addChainProp ? [...addChainProp] : extractAddChain(url);
    return dedupPreserveOrder(chain).slice(-THREAD_MAX_DEPTH);
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

  const selfKey = useMemo(() => {
    if (nodeOk && nodeStorePayload) return threadSeenKey(url, nodeStorePayload);
    return threadSeenKey(url);
  }, [nodeOk, nodeStorePayload, url]);

  const nextSeen = useMemo(() => [...seen, selfKey], [seen, selfKey]);

  const prevUrl = useMemo(() => {
    if (depth >= THREAD_MAX_DEPTH) return null;

    const payloadForPrevScan = nodeOk ? (nodeResolved!.dataRaw ?? nodeStorePayload) : null;
    const candidate = prevUrlFromAdd ?? (payloadForPrevScan ? extractPrevRefFromPayload(payloadForPrevScan) : null);
    if (!candidate) return null;

    const prevPayload = candidate.startsWith(PAYLOAD_PREFIX) ? decodePayloadRef(candidate) : null;
    const prevKey = threadSeenKey(candidate, prevPayload ?? undefined);
    if (nextSeen.includes(prevKey)) return null;

    return candidate;
  }, [prevUrlFromAdd, depth, nextSeen, nodeOk, nodeResolved, nodeStorePayload]);

  const rootRef = useMemo(() => {
    if (!nodeOk || !nodeStorePayload) return null;
    try {
      return encodePayloadRef(nodeStorePayload);
    } catch (e: unknown) {
      void e;
      return null;
    }
  }, [nodeOk, nodeStorePayload]);

  const embeddedAddsForThisNode = useMemo(() => {
    if (!addChain.length) return [];
    const prefix = addChain.slice(0, Math.max(0, addIndex + 1));
    return dedupPreserveOrder(prefix).slice(-THREAD_MAX_DEPTH);
  }, [addChain, addIndex]);

  useLayoutEffect(() => {
    if (!nodeOk) return;

    const payloadRef = rootRef;
    const fallbackRef = normalizeResolvedUrlForBrowser(node.openUrl);

    let prevKey: string | null = null;
    if (prevUrl) {
      let prevPayload: unknown | null = null;
      if (prevUrl.startsWith(PAYLOAD_PREFIX)) {
        prevPayload = decodePayloadRef(prevUrl);
      } else {
        const r = decodeSigilUrlSmart(prevUrl);
        if (r.decoded.ok) prevPayload = r.decoded.data;
      }
      prevKey = threadSeenKey(prevUrl, prevPayload ?? undefined);
    }

    upsertChainNode({
      key: selfKey,
      prevKey,
      payloadRef: payloadRef ?? null,
      fallbackRef,
    });
  }, [nodeOk, node.openUrl, selfKey, prevUrl, rootRef]);

  type ThreadItem = { key: string; url: string; pulse: number };

  const registryVersion = useSyncExternalStore(subscribeRegistry, getRegistrySnapshot, getRegistryServerSnapshot);

  useEffect(() => {
    ensureRegistryBridge();
  }, []);

  const selfThreadKey = useMemo(() => {
    const base = normalizeSeedHrefFromRef(sigilSUrl ?? node.openUrl ?? url);
    return originKeyFromUrlLike(base);
  }, [sigilSUrl, node.openUrl, url]);

  const threadView = useMemo((): { origin: ThreadItem | null; replies: ThreadItem[] } => {
    if (!nodeOk) return { origin: null, replies: [] };

    const originRef = addChain.length > 0 ? addChain[0]! : sigilSUrl ?? url;
    const originHref = normalizeSeedHrefFromRef(originRef);
    const originKey = originKeyFromUrlLike(originHref);

    const pool = dedupPreserveOrder([
      normalizeSeedHrefFromRef(url),
      normalizeSeedHrefFromRef(node.openUrl),
      ...addChain.map((r) => normalizeSeedHrefFromRef(r)),
      ...readExplorerGlobalUrls(),
    ]).filter(Boolean);

    const bestByKey = new Map<string, { url: string; score: number; pulse: number }>();

    const scoreThreadUrl = (u: string, isOrigin: boolean): number => {
      let s = 0;
      const low = u.toLowerCase();

      if (isOrigin) {
        if (isSPayloadUrl(u)) s += 260;
        else s += 40;
      } else {
        // Replies: prefer token canon t= (hash or query)
        if (/[?&#]t=/.test(low) || low.includes("/stream/t")) s += 240;

        // Legacy /stream/p input: supported, but lower score so we migrate away
        if (low.includes("/stream/p/")) s -= 25;

        // Legacy v= token input: supported, but lower score so we migrate away
        if (/[?&#]v=/.test(low)) s -= 20;

        if (isSPayloadUrl(u)) s -= 40;
      }

      s += Math.max(0, 20 - Math.floor(u.length / 40));
      s += Math.min(200_000, registryScore(u));
      return s;
    };

    for (const u of pool) {
      const canon0 = canonicalizeForStorage(u);
      if (!canon0) continue;

      // 🔥 ensure v=<token> becomes /stream#t=<token> BEFORE keying/scoring
      const canon = normalizeResolvedUrlForBrowser(canon0);

      const candKey = originKeyFromUrlLike(canon);
      if (!candKey) continue;

      const candAdds = dedupPreserveOrder(extractAddChain(canon));
      let belongs = candKey === originKey;

      if (!belongs && candAdds.length > 0) {
        for (const r of candAdds) {
          const rr = normalizeSeedHrefFromRef(r);
          if (originKeyFromUrlLike(rr) === originKey) {
            belongs = true;
            break;
          }
        }
      }

      if (!belongs) continue;

      const dec = decodeSigilUrlSmart(canon);
      const p = dec.decoded.ok ? readPulseLoose(dec.decoded.data) : 0;

      const isOrigin = candKey === originKey;
      const sc = scoreThreadUrl(canon, isOrigin);

      const prior = bestByKey.get(candKey);
      if (!prior || sc > prior.score) {
        // normalize candidate to t= canon if token exists (and strip legacy v= token)
        const normalized = normalizeResolvedUrlForBrowser(makeStreamMomentUrl(canon) ?? canon);
        bestByKey.set(candKey, { url: normalized, score: sc, pulse: p });
      }
    }

    const originPickedRaw = bestByKey.get(originKey)?.url ?? originHref;
    const originPicked = normalizeResolvedUrlForBrowser(originPickedRaw);
    const originPulse = (() => {
      const d = decodeSigilUrlSmart(originPicked);
      return d.decoded.ok ? readPulseLoose(d.decoded.data) : 0;
    })();

    const origin: ThreadItem = { key: originKey, url: originPicked, pulse: originPulse };

    const replies: ThreadItem[] = [];
    for (const [k, v] of bestByKey.entries()) {
      if (k === originKey) continue;
      if (k === selfThreadKey) continue;
      if (isSPayloadUrl(v.url)) continue;
      replies.push({ key: k, url: normalizeResolvedUrlForBrowser(v.url), pulse: v.pulse });
    }

    replies.sort((a, b) => (b.pulse ?? 0) - (a.pulse ?? 0));

    return { origin, replies };
  }, [nodeOk, addChain, sigilSUrl, url, node.openUrl, selfThreadKey, registryVersion]);

  /* ─────────────────────────────────────────────────────────────
     Remember/Pack: compute now (gesture-safe) + UI tracks CHAIN
     ───────────────────────────────────────────────────────────── */

  type RememberPack = { primary: BuiltSegment; archives: BuiltSegment[] };

  const computeRememberPackNow = useCallback((): RememberPack => {
    if (!nodeOk || !nodeStorePayload) {
      const fallback = normalizeResolvedUrlForBrowser(node.openUrl);
      return {
        primary: {
          url: fallback,
          rootRef: "",
          adds: [],
          meta: { v: MEM_V, id: "seg:none", m: "", n: 0, a: 0, r: "" },
        },
        archives: [],
      };
    }

    const r = rootRef ?? encodePayloadRef(nodeStorePayload);

    const fromChain = dedupPreserveOrder(buildPrevAddsFromChain(selfKey, THREAD_MAX_DEPTH));
    const explicit = dedupPreserveOrder(embeddedAddsForThisNode);

    const explicitScore = countPayloadRefs(explicit);
    const chainScore = countPayloadRefs(fromChain);

    const chosen =
      explicitScore > chainScore
        ? explicit
        : explicitScore < chainScore
          ? fromChain
          : explicit.length > fromChain.length
            ? explicit
            : fromChain.length > explicit.length
              ? fromChain
              : explicit;

    const adds: string[] = [];

    for (const rawRef of chosen) {
      const ref = stripEdgePunct(rawRef);
      if (!ref) continue;

      if (ref.startsWith(PAYLOAD_PREFIX)) {
        adds.push(ref);
        continue;
      }

      const decoded = decodeSigilUrlSmart(ref);
      const payload = decoded.decoded.ok ? (decoded.decoded.data as unknown) : null;

      if (payload) {
        const k = threadSeenKey(ref, payload);
        const n = CHAIN.get(k);
        if (n?.payloadRef) {
          adds.push(n.payloadRef);
          continue;
        }

        try {
          adds.push(encodePayloadRef(payload));
          continue;
        } catch (e: unknown) {
          void e;
        }
      }

      // last resort: normalize → token canon t= if possible
      adds.push(normalizeResolvedUrlForBrowser(ref));
    }

    return buildSegmentedPack(r, dedupPreserveOrder(adds).slice(-THREAD_MAX_DEPTH));
  }, [nodeOk, nodeStorePayload, node.openUrl, rootRef, selfKey, embeddedAddsForThisNode]);

  const rememberPack = useMemo(() => computeRememberPackNow(), [computeRememberPackNow, chainVersion]);

  const rememberUrl = rememberPack.primary.url;
  const hasArchives = rememberPack.archives.length > 0;

  // ✅ token-canon moment stream for this node (NO /stream/p; NO v= token)
  // Now also checks the payload for an embedded token so Origin-in-replies can normalize to t=
  const momentStreamUrl = useMemo(() => {
    const tok =
      extractTokenCandidates(url, 1)[0] ??
      extractTokenCandidates(node.openUrl, 1)[0] ??
      (nodeOk && nodeStorePayload ? extractTokenFromPayloadLoose(nodeStorePayload) : null);

    return tok ? makeStreamOpenUrlFromToken(tok) : null;
  }, [url, node.openUrl, nodeOk, nodeStorePayload]);

  const v3Derived = useMemo(
    () => deriveV3PostLike(capsuleForSUrl, nodeOk ? nodeResolved!.dataRaw : null),
    [capsuleForSUrl, nodeOk, nodeResolved],
  );

  const isReplyNode = Boolean(prevUrl);

  const legacyContentPresent = useMemo(() => {
    if (!nodeOk || !capsuleForSUrl) return false;
    const cap = capsuleForSUrl;
    return Boolean(
      (cap as Capsule).post ||
        (cap as Capsule).message ||
        (cap as Capsule).share ||
        (cap as Capsule).reaction,
    );
  }, [nodeOk, capsuleForSUrl]);

  const manualMarkerPresent = useMemo(() => {
    if (!nodeOk || !capsuleForSUrl) return false;
    const cap = capsuleForSUrl;
    const kindText = kindFromDecodedData(nodeResolved!.dataRaw, "");
    const src =
      (isNonEmpty((cap as Capsule).source) ? (cap as Capsule).source : undefined) ??
      legacySourceFromData(nodeResolved!.dataRaw);
    return isManualMarkerText(kindText) || isManualMarkerText(src) || hasManualMarkerDeep(cap);
  }, [nodeOk, capsuleForSUrl, nodeResolved]);

  const contentPresent = useMemo(
    () => legacyContentPresent || Boolean(v3Derived.post),
    [legacyContentPresent, v3Derived.post],
  );

  const memoryMode = useMemo(() => manualMarkerPresent || contentPresent || isReplyNode, [
    manualMarkerPresent,
    contentPresent,
    isReplyNode,
  ]);

  const autoMemoryFlag = memoryMode;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (depth !== 0) return;

    ensureRegistryBridge();

    const visitHref =
      makeStreamMomentUrl(window.location.href) ??
      momentStreamUrl ??
      makeStreamMomentUrl(node.openUrl) ??
      rememberUrl ??
      normalizeResolvedUrlForBrowser(url);

    const seedRefs = dedupPreserveOrder([
      visitHref,
      ...addChain.map((r) => normalizeSeedHrefFromRef(r)).filter(Boolean),
    ]);

    for (const s of seedRefs) {
      const ex = upsertUrlList(EXPLORER_LS_KEY, s);
      if (ex.changed) notifyExplorer(ex.value);
    }

    if (autoMemoryFlag) {
      const startPayload = nodeOk ? (nodeResolved!.dataRaw ?? nodeStorePayload) : undefined;
      const threadRootHref = threadRootHrefFromUrlLike(visitHref, startPayload);

      const fd = upsertUrlList(FEED_LS_KEY, threadRootHref);
      if (fd.changed) notifyFeed(fd.value);

      const rootKey = threadRootKeyFromUrlLike(visitHref, startPayload);
      pruneFeedDuplicatesForThread(rootKey, threadRootHref);
    }

    notifyRegistryBatched();
  }, [
    depth,
    url,
    node.openUrl,
    momentStreamUrl,
    rememberUrl,
    autoMemoryFlag,
    addChain,
    nodeOk,
    nodeResolved,
    nodeStorePayload,
  ]);

  // ✅ Memory href preference:
  // - Prefer token-canon /stream#t=... (works for long tokens)
  // - Else fall back to self-contained Memory Stream (#v=2&root=...&add=...)
  const memoryHref = useMemo(() => momentStreamUrl ?? rememberUrl, [momentStreamUrl, rememberUrl]);

  const openHref = useMemo(() => {
    if (!nodeOk) return node.openUrl;
    return memoryMode ? memoryHref : sigilSUrl ?? memoryHref;
  }, [nodeOk, node.openUrl, memoryMode, memoryHref, sigilSUrl]);

  const rememberCopyHref = useMemo(() => openHref, [openHref]);

  const computePackCopyText = useCallback((): string => {
    const pack = computeRememberPackNow();
    return [pack.primary.url, ...pack.archives.map((s) => s.url)].join("\n");
  }, [computeRememberPackNow]);

  const onCopy = useCallback(() => {
    const text = rememberCopyHref;
    copyTextGestureSafe(
      text,
      () => {
        setCopied(true);
        if (typeof window !== "undefined") window.setTimeout(() => setCopied(false), 1100);
      },
      (e?: unknown) => {
        void e;
        setCopied(false);
      },
    );
  }, [rememberCopyHref]);

  const onCopyPack = useCallback(() => {
    const text = computePackCopyText();
    copyTextGestureSafe(
      text,
      () => {
        setPacked(true);
        if (typeof window !== "undefined") window.setTimeout(() => setPacked(false), 1100);
      },
      (e?: unknown) => {
        void e;
        setPacked(false);
      },
    );
  }, [computePackCopyText]);

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
          </header>

          <div className="fc-error" role="alert">
            {node.error}
          </div>

          <footer className="fc-actions" role="group" aria-label="Actions">
            <a
              className="fc-btn"
              href={openHref}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Open the best available href for this capsule"
            >
              ↗ Open
            </a>

            <button
              className="fc-btn"
              type="button"
              onClick={onCopy}
              aria-pressed={copied}
              data-state={copied ? "remembered" : "idle"}
              title="Copies the same href as Open for this block."
            >
              {copied ? "Remembered" : "Remember"}
            </button>
          </footer>
        </div>
      </article>
    );
  }

  const capsule: Capsule = nodeResolved!.capsule;

  const postLegacy: PostPayload | undefined = capsule.post;
  const message: MessagePayload | undefined = capsule.message;
  const share: SharePayload | undefined = capsule.share;
  const reaction: ReactionPayload | undefined = capsule.reaction;

  const post: PostPayload | undefined = postLegacy ?? v3Derived.post;

  const pulse =
    typeof nodeResolved!.pulse === "number" && Number.isFinite(nodeResolved!.pulse)
      ? nodeResolved!.pulse
      : 0;

  const m = momentFromPulse(pulse);
  const beatZ = Math.max(0, Math.floor(m.beat));
  const stepZ = Math.max(0, Math.floor(m.stepIndex));

  const chakraDay: ChakraDay = toChakra(m.chakraDay, m.chakraDay);
  const chakraDayDisplay = chakraDay === "Crown" ? "Krown" : String(chakraDay);

  const { day, month, year } = kaiDMYFromPulseKKS(pulse);

  const inferredKind = post ? "post" : message ? "message" : share ? "share" : reaction ? "reaction" : "sigil";
  const kind: string = kindFromDecodedData(nodeResolved!.dataRaw, inferredKind);
  const kindText = String(kind);

  const appBadge =
    typeof nodeResolved!.appId === "string" && nodeResolved!.appId
      ? `app ${short(nodeResolved!.appId, 10, 4)}`
      : undefined;

  const userBadge =
    typeof nodeResolved!.userId !== "undefined" && nodeResolved!.userId !== null
      ? `user ${short(String(nodeResolved!.userId), 10, 4)}`
      : undefined;

  const sigilId = isNonEmpty(capsule.sigilId) ? capsule.sigilId : undefined;
  const phiKey = isNonEmpty(capsule.phiKey) ? capsule.phiKey : undefined;
  const signaturePresent = isNonEmpty(capsule.kaiSignature);
  const verifiedTitle = signaturePresent ? "Signature present (Kai Signature)" : "Unsigned capsule";

  const authorBadge = isNonEmpty(capsule.author) ? capsule.author : undefined;

  const sourceBadge =
    (isNonEmpty(capsule.source) ? capsule.source : undefined) ?? legacySourceFromData(nodeResolved!.dataRaw);

  const kindChipLabel = memoryMode ? upper(PROOF_OF_MEMORY) : upper(PROOF_OF_BREATH);
  const ariaKindLabel = memoryMode ? PROOF_OF_MEMORY : PROOF_OF_BREATH;

  const sourceChipLabel = sourceBadge
    ? isManualMarkerText(sourceBadge)
      ? upper(PROOF_OF_MEMORY)
      : upper(sourceBadge)
    : undefined;

  const showSourceChip = Boolean(sourceChipLabel) && sourceChipLabel !== kindChipLabel;

  const postTitle = displayManualAsProof(post?.title);
  const postText = displayManualAsProof(post?.text);
  const messageText = displayManualAsProof(message?.text);
  const shareNote = displayManualAsProof(share?.note);

  const kai = buildKaiMetaLineZero(pulse, beatZ, stepZ, day, month, year);
  const stepPct = stepPctFromIndex(stepZ);

  const [ar, ag, ab] = CHAKRA_RGB[chakraDayDisplay] ?? CHAKRA_RGB.Crown ?? ([238, 241, 251] as const);

  const phase = ((pulse % 13) + 13) % 13;
  const styleVars: React.CSSProperties = {
    ["--fc-accent-r" as never]: String(ar),
    ["--fc-accent-g" as never]: String(ag),
    ["--fc-accent-b" as never]: String(ab),
    ["--fc-pulse-dur" as never]: "5236ms",
    ["--fc-pulse-offset" as never]: `${-(phase * 120)}ms`,
    ["--fc-thread-depth" as never]: String(depth),
  };

  const dataKindAttr = memoryMode ? "memory" : kindText;

  const openLabel = memoryMode ? "↗ Proof of Memory™" : "↗ Proof of Breath™";
  const openTitle = memoryMode ? `Open ${PROOF_OF_MEMORY}` : `Open ${PROOF_OF_BREATH}`;

  const isPrimaryCard = depth === 0 && threadMode !== "self";

  const primaryBodyText = (postText ?? messageText ?? shareNote ?? "") || "";
  const bodyKind: CollapseKind =
    v3Derived.bodyKind === "code" || v3Derived.bodyKind === "html" ? "code" : "text";

  const collapse = primaryBodyText ? collapseSpecFor(primaryBodyText, bodyKind) : null;
  const shouldCollapse = Boolean(collapse?.shouldCollapse);
  const collapsed = shouldCollapse && !bodyExpanded;

  const collapseId = `fc-body-${fnv1a64Hex(selfKey).slice(0, 10)}`;
  const onToggleBody = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    setBodyExpanded((v) => !v);
  };

  const onPreviewOpen = (
    e: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>,
  ): void => {
    if (isPrimaryCard) return;
    if (isInteractiveEl((e as React.MouseEvent).target ?? null)) return;

    if ("key" in e) {
      const k = e.key;
      if (k !== "Enter" && k !== " ") return;
      e.preventDefault();
    }

    try {
      window.open(openHref, "_blank", "noopener,noreferrer");
    } catch (err: unknown) {
      void err;
    }
  };

  const nextAddIndex = addIndex - 1;

  return (
    <>
      {threadMode !== "self" && prevUrl ? (
        <FeedCardThread
          url={prevUrl}
          depth={depth + 1}
          seen={nextSeen}
          addChain={addChain}
          addIndex={nextAddIndex}
          threadMode={threadMode}
        />
      ) : null}

      <article
        className={`fc fc--crystal ${signaturePresent ? "fc--signed" : "fc--unsigned"} ${
          isPrimaryCard ? "fc--primary" : "fc--preview"
        }`}
        role={isPrimaryCard ? "article" : "link"}
        tabIndex={isPrimaryCard ? -1 : 0}
        onClick={onPreviewOpen as unknown as React.MouseEventHandler<HTMLElement>}
        onKeyDown={onPreviewOpen as unknown as React.KeyboardEventHandler<HTMLElement>}
        aria-label={`${ariaKindLabel} glyph`}
        data-kind={dataKindAttr}
        data-chakra={chakraDayDisplay}
        data-signed={signaturePresent ? "true" : "false"}
        data-beat={pad2(beatZ)}
        data-step={pad2(stepZ)}
        data-collapsed={collapsed ? "true" : "false"}
        style={styleVars}
      >
        <div className="fc-crystal" aria-hidden="true" />
        <div className="fc-rim" aria-hidden="true" />
        <div className="fc-veil" aria-hidden="true" />

        <div className="fc-shell">
          <aside className="fc-left" aria-label={memoryMode ? PROOF_OF_MEMORY : PROOF_OF_BREATH}>
            <div className="fc-sigilStage">
              <div className="fc-sigilGlass" aria-hidden="true" />
              <div className="fc-sigil" aria-label={memoryMode ? PROOF_OF_MEMORY : PROOF_OF_BREATH}>
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
                  title={
                    memoryMode
                      ? `${PROOF_OF_MEMORY} • type: ${kindText}`
                      : `${PROOF_OF_BREATH} • type: ${kindText}`
                  }
                >
                  {kindChipLabel}
                </span>

                {appBadge && <span className="fc-chip">{appBadge}</span>}
                {userBadge && <span className="fc-chip">{userBadge}</span>}

                {!memoryMode && sigilId ? (
                  <span className="fc-chip fc-chip--sigil" title={`Sigil-Glyph: ${sigilId}`}>
                    SIGIL-GLYPH {short(sigilId, 6, 4)}
                  </span>
                ) : null}

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

                {(() => {
                  const seg = extractSegMeta(rememberUrl);
                  if (!seg) return null;
                  return (
                    <span className="fc-chip" title={`Merkle: ${seg.m}`}>
                      SEG {short(seg.id, 10, 6)}
                    </span>
                  );
                })()}
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

                {isNonEmpty(postText) ? (
                  <div className="fc-collapse" data-open={bodyExpanded ? "true" : "false"}>
                    <div
                      id={collapseId}
                      className="fc-collapse__content"
                      style={{
                        maxHeight: collapsed ? `${collapse?.maxHeightPx ?? 240}px` : "none",
                        overflow: collapsed ? "hidden" : "visible",
                      }}
                    >
                      {v3Derived.bodyKind === "code" || v3Derived.bodyKind === "html" ? (
                        <pre className="fc-body" style={{ whiteSpace: "pre-wrap" }}>
                          {postText}
                        </pre>
                      ) : (
                        <p className="fc-body">{postText}</p>
                      )}
                    </div>

                    {shouldCollapse ? (
                      <button
                        className="fc-btn fc-btn--ghost fc-collapse__toggle"
                        type="button"
                        onClick={onToggleBody}
                        aria-expanded={bodyExpanded}
                        aria-controls={collapseId}
                        data-no-open="true"
                        title="Expand/collapse long content"
                      >
                        {bodyExpanded ? "Collapse" : `Expand${collapse?.lines ? ` • ${collapse.lines} lines` : ""}`}
                      </button>
                    ) : null}
                  </div>
                ) : null}

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
                          onClick={(e) => e.stopPropagation()}
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
                <h3 className="fc-title">Message → {short(String(message.toUserId ?? "recipient"), 10, 4)}</h3>

                {isNonEmpty(messageText) ? (
                  <div className="fc-collapse" data-open={bodyExpanded ? "true" : "false"}>
                    <div
                      id={`${collapseId}-m`}
                      className="fc-collapse__content"
                      style={{
                        maxHeight: collapsed ? `${collapse?.maxHeightPx ?? 240}px` : "none",
                        overflow: collapsed ? "hidden" : "visible",
                      }}
                    >
                      <p className="fc-body">{messageText}</p>
                    </div>

                    {shouldCollapse ? (
                      <button
                        className="fc-btn fc-btn--ghost fc-collapse__toggle"
                        type="button"
                        onClick={onToggleBody}
                        aria-expanded={bodyExpanded}
                        aria-controls={`${collapseId}-m`}
                        data-no-open="true"
                      >
                        {bodyExpanded ? "Collapse" : "Expand"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
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
                  onClick={(e) => e.stopPropagation()}
                >
                  {hostOf(share.refUrl) ?? share.refUrl}
                </a>

                {isNonEmpty(shareNote) ? (
                  <div className="fc-collapse" data-open={bodyExpanded ? "true" : "false"}>
                    <div
                      id={`${collapseId}-s`}
                      className="fc-collapse__content"
                      style={{
                        maxHeight: collapsed ? `${collapse?.maxHeightPx ?? 240}px` : "none",
                        overflow: collapsed ? "hidden" : "visible",
                      }}
                    >
                      <p className="fc-body">{shareNote}</p>
                    </div>

                    {shouldCollapse ? (
                      <button
                        className="fc-btn fc-btn--ghost fc-collapse__toggle"
                        type="button"
                        onClick={onToggleBody}
                        aria-expanded={bodyExpanded}
                        aria-controls={`${collapseId}-s`}
                        data-no-open="true"
                      >
                        {bodyExpanded ? "Collapse" : "Expand"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
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
                  onClick={(e) => e.stopPropagation()}
                >
                  {hostOf(reaction.refUrl) ?? reaction.refUrl}
                </a>
              </section>
            )}

            {!post && !message && !share && !reaction && (
              <section className="fc-bodywrap" aria-label="Sigil body">
                {memoryMode && hasArchives ? (
                  <div className="fc-muted" style={{ marginTop: 8 }}>
                    Archive segments: {rememberPack.archives.length} (use <b>Pack</b> to copy them)
                  </div>
                ) : null}
              </section>
            )}

            {threadMode !== "self" && depth === 0 ? (
              <section className="fc-bodywrap" aria-label="Thread">
                <h3 className="fc-title">Thread</h3>

                {threadView.origin && threadView.origin.key !== selfThreadKey ? (
                  <div style={{ marginTop: 10 }}>
                    <div className="fc-muted" style={{ marginBottom: 10 }}>
                      Origin
                    </div>
                    <FeedCardThread url={threadView.origin.url} threadMode="self" depth={1} seen={[selfKey]} />
                  </div>
                ) : null}

                <div style={{ marginTop: 14 }}>
                  <div className="fc-muted" style={{ marginBottom: 10 }}>
                    Replies ({threadView.replies.length})
                  </div>

                  {threadView.replies.length ? (
                    threadView.replies.map((r) => (
                      <FeedCardThread key={r.key} url={r.url} threadMode="self" depth={1} seen={[selfKey]} />
                    ))
                  ) : (
                    <div className="fc-muted">No replies captured locally yet.</div>
                  )}
                </div>
              </section>
            ) : null}

            <footer className="fc-actions" role="group" aria-label="Actions">
              <a
                className="fc-btn"
                href={openHref}
                target="_blank"
                rel="noreferrer"
                title={openTitle}
                onClick={(e) => e.stopPropagation()}
              >
                {openLabel}
              </a>

              <button
                className="fc-btn"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCopy();
                }}
                aria-pressed={copied}
                data-state={copied ? "remembered" : "idle"}
                title="Copies the same href as Open for this block. If overflow exists, use Pack."
              >
                {copied ? "Remembered" : "Remember"}
              </button>

              {hasArchives ? (
                <button
                  className="fc-btn"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCopyPack();
                  }}
                  aria-pressed={packed}
                  data-state={packed ? "packed" : "idle"}
                  title="Copies the full segment pack (primary + archive segments) as newline-separated URLs."
                >
                  {packed ? "Packed" : `Pack ${1 + rememberPack.archives.length}`}
                </button>
              ) : null}

              <span className="fc-live" aria-live="polite">
                {copied ? "Inhaled to Memory" : packed ? "Packed to Memory" : ""}
              </span>
            </footer>
          </section>
        </div>
      </article>
    </>
  );
};

export const FeedCard: React.FC<Props> = ({ url, threadMode = "thread" }) => {
  const rootRef = useMemo(() => extractRootRef(url), [url]);
  const addChain = useMemo(() => dedupPreserveOrder(extractAddChain(url)), [url]);

  if (rootRef) {
    return (
      <FeedCardThread
        url={rootRef}
        threadMode={threadMode}
        addChain={addChain}
        addIndex={addChain.length - 1}
      />
    );
  }

  return <FeedCardThread url={url} threadMode={threadMode} />;
};

export default FeedCard;
