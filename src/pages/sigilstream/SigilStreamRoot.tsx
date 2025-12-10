// src/pages/sigilstream/SigilStreamRoot.tsx
"use client";

/**
 * SigilStreamRoot — Memory Stream Shell
 * v7.6.0 — FIX: KKS-1.0 deterministic Kai display for payload
 *
 * ✅ Critical fix:
 *    - payload.pulse is already correct (authoritative)
 *    - beat:step, weekday, and chakra MUST be derived from pulse using KKS-1.0
 *    - uses 17,491.270421 breaths per day (continuous), not 17,424 grid pulses
 *    - preserves 36 beats/day + 44 steps/beat (beat/step are computed by day-fraction)
 *
 * ✅ Keeps v7 features:
 *    - extractPayloadTokenFromLocation (ALL token forms)
 *    - Brotli-aware decodeFeedPayload (await-safe)
 *    - supports /p~ ingestion + hash fallback for huge tokens
 *    - per-thread verified session keyed off ANY token form
 *    - body renders: text | md (safe) | html (sanitized) | code
 *
 * ✅ Restores EXACT bottom behavior:
 *    - <StreamList urls={urls} /> ONLY (no RichList, no mirror)
 *
 * ✅ KOPY sound parity with v6.1:
 *    - NO await before toast push (preserves user-gesture audio gating)
 *    - Sync copy attempt first; async clipboard kicked off without await
 *
 * ✅ NEW (Private / Sealed UX):
 *    - If payload.seal is present and not yet opened, page shows a lock-screen gate
 *    - Gate includes SigilLogin (glyph upload) ONLY for sealed posts
 *    - Once ΦKey is inhaled (verified session + meta present), UNSEAL becomes available
 *    - Reply composer is hidden until sealed content is opened (prevents “reply blind”)
 *    - Bridge supports postSeal exports:
 *        • openSealedEnvelope/openSealedPayload/unsealEnvelope/unsealPayload (returns content)
 *        • unsealEnvelopeV1 (returns {ok, inner})
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./styles/sigilstream.css";

import { useLocation } from "react-router-dom";

/* Toasts */
import ToastsProvider from "./data/toast/Toasts";
import { useToasts } from "./data/toast/toast";

/* ✅ Auth provider (required for useSigilAuth + SigilLogin) */
import { SigilAuthProvider } from "../../components/KaiVoh/SigilAuthProvider";

/* Data: seeds + storage */
import { loadLinksJson } from "./data/seed";
import { LS_KEY, parseStringArray, prependUniqueToStorage } from "./data/storage";

/* Core: alias + utils */
import { normalizeAddParam } from "./core/alias";
import { coerceAuth, readStringProp, report, isRecord } from "./core/utils";

/* Identity */
import { IdentityBar } from "./identity/IdentityBar";
import { SigilActionUrl } from "./identity/SigilActionUrl";

/* Inhaler / Composer / Status / List */
import { InhaleSection } from "./inhaler/InhaleSection";
import { Composer } from "./composer/Composer";
import { KaiStatus } from "./status/KaiStatus";
import { StreamList } from "./list/StreamList";

/* External app hooks (existing app) */
import SigilLogin from "../../components/KaiVoh/SigilLogin";
import { useSigilAuth } from "../../components/KaiVoh/SigilAuthContext";

/* Payload token extractor + decoder */
import {
  extractPayloadTokenFromLocation,
  TOKEN_HARD_LIMIT,
  decodeFeedPayload,
  type FeedPostPayload,
  type PostBody,
} from "../../utils/feedPayload";

/* Explorer bridge: register any stream/sigil URL */
import { registerSigilUrl } from "../../utils/sigilRegistry";

/* Attachments (single source of truth) */
import { AttachmentGallery } from "./attachments/gallery";
import {
  isAttachmentManifest,
  isAttachmentItem,
  type AttachmentManifest,
  type AttachmentItem,
} from "./attachments/types";

/* PhiStream auto-add */
import { autoAddVisitedPayloadToPhiStream } from "./core/phiStreamAutoAdd";

/** Simple source shape */
type Source = { url: string };

/* ────────────────────────────────────────────────────────────────
   Kai display helpers (KKS-1.0 authoritative, derived from pulse)
──────────────────────────────────────────────────────────────── */

/**
 * KKS-1.0 constants (authoritative)
 * - Continuous breaths per day (NOT the 36*44*11 grid count)
 * - beat/step are computed by day-fraction to preserve 36 beats/day + 44 steps/beat
 */
const KKS_PULSES_PER_DAY = 17491.270421;
const KKS_BEATS_PER_DAY = 36;
const KKS_STEPS_PER_BEAT = 44;
const KKS_STEPS_PER_DAY = KKS_BEATS_PER_DAY * KKS_STEPS_PER_BEAT; // 1584
const KKS_DAYS_PER_WEEK = 6;
const KKS_WEEKS_PER_MONTH = 7;
const KKS_MONTHS_PER_YEAR = 8;

const KKS_DAYS_PER_MONTH = KKS_DAYS_PER_WEEK * KKS_WEEKS_PER_MONTH; // 42
const KKS_DAYS_PER_YEAR = KKS_DAYS_PER_MONTH * KKS_MONTHS_PER_YEAR; // 336

function pulseToDMY(pulse: number): { d: number; m: number; y: number } {
  const day = pulseToDayIndex(pulse); // absolute day index (0-based)
  const y = Math.floor(day / KKS_DAYS_PER_YEAR); // base-0 year
  const dayOfYear = safeModulo(day, KKS_DAYS_PER_YEAR); // 0..335 (euclidean)
  const m0 = Math.floor(dayOfYear / KKS_DAYS_PER_MONTH); // 0..7
  const d0 = dayOfYear % KKS_DAYS_PER_MONTH; // 0..41
  return { d: d0 + 1, m: m0 + 1, y };
}


const WEEKDAYS: readonly string[] = [
  "Solhara",
  "Aquaris",
  "Flamora",
  "Verdari",
  "Sonari",
  "Kaelith",
] as const;

const CHAKRAS: readonly string[] = [
  "Root",
  "Sacral",
  "Solar",
  "Heart",
  "Throat",
  "Third Eye",
  "Crown",
] as const;

function normalizeWeekdayLabel(s: string): string {
  const t = s.trim();
  if (!t) return t;
  if (/^caelith$/i.test(t)) return "Kaelith";
  if (/^kaelith$/i.test(t)) return "Kaelith";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function normalizeChakraLabel(s: string): string {
  const t = s.trim();
  if (!t) return t;
  const u = t.toLowerCase();
  if (u === "third-eye" || u === "third eye" || u === "ajna") return "Third Eye";
  if (u === "solar plexus" || u === "solar-plexus" || u === "solar") return "Solar";
  if (u === "root") return "Root";
  if (u === "sacral") return "Sacral";
  if (u === "heart") return "Heart";
  if (u === "throat") return "Throat";
  if (u === "crown") return "Krown";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** ✅ ONLY CHANGE: display label translation (manual → Sovereign) */
function normalizeFeedSourceLabel(s: string): string {
  const t = s.trim();
  if (!t) return t;
  if (/^manual$/i.test(t)) return "Proof of Memory™";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function safeModulo(n: number, m: number): number {
  const r = n % m;
  return r < 0 ? r + m : r;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Finite-safe pulse read (payload.pulse is expected to be a number). */
function readPulse(pulse: number): number {
  return Number.isFinite(pulse) ? pulse : 0;
}

/** KKS day index (0-based) from continuous pulse count. */
function pulseToDayIndex(pulse: number): number {
  const p = readPulse(pulse);
  
  // floor() is correct for negative too (creates consistent day bins)
  return Math.floor(p / KKS_PULSES_PER_DAY);
}

/** Position within the KKS day in [0, KKS_PULSES_PER_DAY). */
function pulseToPulseOfDay(pulse: number): number {
  const p = readPulse(pulse);
  const day = pulseToDayIndex(p);
  const start = day * KKS_PULSES_PER_DAY;
  const within = p - start;

  // Guard float edge: ensure within is always [0, dayLen)
  const mod = within % KKS_PULSES_PER_DAY;
  const pos = mod < 0 ? mod + KKS_PULSES_PER_DAY : mod;

  // If float math ever yields dayLen exactly, clamp down.
  return pos >= KKS_PULSES_PER_DAY ? 0 : pos;
}

/**
 * KKS beat/step derived from pulse (authoritative):
 * - Compute day progress using continuous breaths/day (17491.270421)
 * - Quantize into 1584 steps/day (36*44)
 * - Derive beat and step from that quantized step-of-day
 */
function pulseToBeatStep(pulse: number): { beat: number; step: number } {
  const pod = pulseToPulseOfDay(pulse);
  const frac = clamp01(pod / KKS_PULSES_PER_DAY); // [0,1)
  const stepOfDay = Math.floor(frac * KKS_STEPS_PER_DAY); // 0..1583

  const beat = Math.floor(stepOfDay / KKS_STEPS_PER_BEAT); // 0..35
  const step = stepOfDay % KKS_STEPS_PER_BEAT; // 0..43

  return { beat, step };
}

function pulseToWeekday(pulse: number): string {
  const day = pulseToDayIndex(pulse);
  return WEEKDAYS[safeModulo(day, WEEKDAYS.length)] ?? "Kaelith";
}

/** Chakra-of-day (7-cycle) derived from day index, not from step. */
function pulseToChakraDay(pulse: number): string {
  const day = pulseToDayIndex(pulse);
  return CHAKRAS[safeModulo(day, CHAKRAS.length)] ?? "Crown";
}
const KKS_MONTH_NAMES: readonly string[] = [
  "Aethon",
  "Virelai",
  "Solari",
  "Amarin",
  "Kaelus",
  "Umbriel",
  "Noktura",
  "Liora",
] as const;

function pulseToMonthName(pulse: number): string {
  const day = pulseToDayIndex(pulse);
  const dayOfYear = safeModulo(day, KKS_DAYS_PER_YEAR); // 0..335
  const m0 = Math.floor(dayOfYear / KKS_DAYS_PER_MONTH); // 0..7
  return KKS_MONTH_NAMES[m0] ?? `Month ${m0 + 1}`;
}

/* ────────────────────────────────────────────────────────────────
   URL helpers
──────────────────────────────────────────────────────────────── */
function pad2(n: number): string {
  const v = Number.isFinite(n) ? Math.trunc(n) : 0;
  return String(v).padStart(2, "0");
}

function sessionTokenKey(token: string): string {
  if (token.length <= 140) return token;
  return `${token.slice(0, 96)}:${token.slice(-32)}`;
}

function canonicalizeCurrentStreamUrl(token: string): string {
  const origin = globalThis.location?.origin ?? "https://kaiklok.com";
  const base = origin.replace(/\/+$/, "");
  return token.length <= TOKEN_HARD_LIMIT
    ? `${base}/stream/p/${encodeURIComponent(token)}`
    : `${base}/stream#t=${token}`;
}

function shortAliasUrl(token: string): string {
  const origin = globalThis.location?.origin ?? "https://kaiklok.com";
  const base = origin.replace(/\/+$/, "");
  return `${base}/p~${token}`;
}

function preferredShareUrl(token: string): string {
  return token.length <= TOKEN_HARD_LIMIT ? shortAliasUrl(token) : canonicalizeCurrentStreamUrl(token);
}

function normalizeIncomingToken(raw: string): string {
  let t = raw.trim();

  // If someone passed a whole URL instead of just a token, extract from it.
  try {
    const u = new URL(t);
    const h = new URLSearchParams(u.hash.startsWith("#") ? u.hash.slice(1) : u.hash);
    const s = new URLSearchParams(u.search);
    const got =
      h.get("t") ??
      h.get("p") ??
      h.get("token") ??
      s.get("t") ??
      s.get("p") ??
      s.get("token");
    if (got) t = got;
    else if (/\/p~/.test(u.pathname)) t = u.pathname.split("/p~")[1] ?? t;
    else if (/\/stream\/p\//.test(u.pathname)) t = u.pathname.split("/stream/p/")[1] ?? t;
  } catch {
    // not a URL, ignore
  }

  // Decode %xx if present
  if (/%[0-9A-Fa-f]{2}/.test(t)) {
    try {
      t = decodeURIComponent(t);
    } catch {
      /* keep raw */
    }
  }

  // Query/base64 legacy: '+' may come through as space; restore it.
  if (t.includes(" ")) t = t.replaceAll(" ", "+");

  // If it looks like standard base64, normalize to base64url
  if (/[+/=]/.test(t)) {
    t = t.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
  }

  return t;
}

/* ────────────────────────────────────────────────────────────────
   Clipboard helpers (KOPY sound parity with v6.1)
   Key rule: DO NOT await before pushing the toast.
──────────────────────────────────────────────────────────────── */

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

/* ────────────────────────────────────────────────────────────────
   Render helpers (MD + HTML)
──────────────────────────────────────────────────────────────── */

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Minimal sanitizer:
 * - strips script/style/iframe/object/embed
 * - removes on* handlers
 * - blocks javascript:/data: URLs on href/src
 */
function sanitizeHtml(input: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(input, "text/html");

    const kill = doc.querySelectorAll("script,style,iframe,object,embed");
    kill.forEach((n) => n.remove());

    const all = doc.querySelectorAll<HTMLElement>("*");
    all.forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value;

        if (name.startsWith("on")) {
          el.removeAttribute(attr.name);
          continue;
        }

        if (name === "href" || name === "src") {
          const v = value.trim().toLowerCase();
          if (v.startsWith("javascript:") || v.startsWith("data:")) el.removeAttribute(attr.name);
        }
      }
    });

    return doc.body.innerHTML;
  } catch {
    return escapeHtml(input);
  }
}

function safeHttpUrl(u: string): string | null {
  try {
    const url = new URL(u);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
    return null;
  } catch {
    return null;
  }
}

function renderMarkdownToSafeHtml(md: string): string {
  const escaped = escapeHtml(md);

  const fenceRe = /```(\w+)?\n([\s\S]*?)```/g;
  let html = escaped.replace(fenceRe, (_m, langRaw: string | undefined, code: string) => {
    const lang = (langRaw || "").trim();
    const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
    return `<pre><code${cls}>${code}</code></pre>`;
  });

  html = html.replace(/^####\s(.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^###\s(.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^##\s(.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^#\s(.+)$/gm, "<h1>$1</h1>");

  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, urlRaw: string) => {
    const safe = safeHttpUrl(urlRaw);
    if (!safe) return `${text} (${escapeHtml(urlRaw)})`;
    return `<a href="${escapeHtml(safe)}" target="_blank" rel="noreferrer noopener">${text}</a>`;
  });

  html = html
    .split(/\n{2,}/g)
    .map((blk) => {
      const t = blk.trim();
      if (!t) return "";
      if (t.startsWith("<h") || t.startsWith("<pre>")) return t;
      return `<p>${t.replace(/\n/g, "<br/>")}</p>`;
    })
    .filter(Boolean)
    .join("\n");

  return html;
}

/* ────────────────────────────────────────────────────────────────
   Attachments: coerce payload attachments into AttachmentManifest
──────────────────────────────────────────────────────────────── */

function sumBytes(items: AttachmentItem[]): { total: number; inlined: number } {
  let total = 0;
  let inlined = 0;

  for (const it of items) {
    if (it.kind === "file-inline") {
      if (typeof it.size === "number" && Number.isFinite(it.size) && it.size >= 0) {
        total += it.size;
        inlined += it.size;
      }
      continue;
    }
    if (it.kind === "file-ref") {
      if (typeof it.size === "number" && Number.isFinite(it.size) && it.size >= 0) {
        total += it.size;
      }
      continue;
    }
  }

  return { total, inlined };
}

function coerceAttachmentManifest(v: unknown): AttachmentManifest | null {
  if (isAttachmentManifest(v)) return v;

  if (!isRecord(v)) return null;
  const versionRaw = v["version"];
  const itemsRaw = v["items"];

  if (versionRaw !== 1) return null;
  if (!Array.isArray(itemsRaw)) return null;

  const items: AttachmentItem[] = itemsRaw.filter(isAttachmentItem);
  const totals = sumBytes(items);

  const totalBytes =
    typeof v["totalBytes"] === "number" && Number.isFinite(v["totalBytes"]) ? v["totalBytes"] : totals.total;

  const inlinedBytes =
    typeof v["inlinedBytes"] === "number" && Number.isFinite(v["inlinedBytes"]) ? v["inlinedBytes"] : totals.inlined;

  return { version: 1, totalBytes, inlinedBytes, items };
}

/* ────────────────────────────────────────────────────────────────
   Post body renderer (HTML mode correctness)
──────────────────────────────────────────────────────────────── */

function PostBodyView({
  body,
  caption,
  isSealed,
}: {
  body?: PostBody;
  caption?: string;
  isSealed?: boolean;
}): React.JSX.Element {
  const effectiveBody: PostBody | null =
    body ?? (!isSealed && caption && caption.trim().length ? { kind: "text", text: caption } : null);

  if (!effectiveBody) return <></>;

  if (effectiveBody.kind === "text") return <div className="sf-text">— {`"${effectiveBody.text}"`}</div>;

  if (effectiveBody.kind === "code") {
    return (
      <pre className="sf-code">
        <code>{effectiveBody.code}</code>
      </pre>
    );
  }

  if (effectiveBody.kind === "md") {
    const html = renderMarkdownToSafeHtml(effectiveBody.md);
    return <div className="sf-md" dangerouslySetInnerHTML={{ __html: html }} />;
  }

  // html
  const mode = effectiveBody.mode ?? "code";
  if (mode === "code") {
    return (
      <pre className="sf-code sf-code--html">
        <code>{effectiveBody.html}</code>
      </pre>
    );
  }

  const cleaned = sanitizeHtml(effectiveBody.html);
  return <div className="sf-html" dangerouslySetInnerHTML={{ __html: cleaned }} />;
}

function pickString(obj: unknown, keys: readonly string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v.trim().length) return v.trim();
  }
  return null;
}

function readNumberLoose(obj: unknown, key: string): number | null {
  if (!obj || typeof obj !== "object") return null;
  const v = (obj as Record<string, unknown>)[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim().length) {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}
const KKS_ARKS_PER_DAY = 6;
const KKS_BEATS_PER_ARK = KKS_BEATS_PER_DAY / KKS_ARKS_PER_DAY; // 6

const ARKS: readonly string[] = [
  "Ignite",
  "Integrate",
  "Harmonize",
  "Reflekt",
  "Purify",
  "Dream",
] as const;



function pulseToArkIndex(pulse: number): number {
  const { beat } = pulseToBeatStep(pulse); // 0..35
  const idx = Math.floor(beat / KKS_BEATS_PER_ARK); // 0..5
  if (idx < 0) return 0;
  if (idx >= ARKS.length) return ARKS.length - 1;
  return idx;
}

function pulseToArkName(pulse: number): string {
  return ARKS[pulseToArkIndex(pulse)] ?? "Dream";
}

/* ────────────────────────────────────────────────────────────────
   Private (Sealed) unseal bridge (dynamic import)
──────────────────────────────────────────────────────────────── */

type UnsealedContent = {
  body?: PostBody;
  attachments?: unknown;
  caption?: string;
};

type UnsealState =
  | { status: "none" }
  | { status: "sealed" }
  | { status: "opening" }
  | { status: "open"; content: UnsealedContent }
  | { status: "error"; message: string };

function isUnsealedContent(x: unknown): x is UnsealedContent {
  if (!isRecord(x)) return false;
  const body = x["body"];
  const attachments = x["attachments"];
  const caption = x["caption"];

  const bodyOk = body === undefined || isRecord(body);
  const captionOk = caption === undefined || typeof caption === "string";
  const attOk = attachments === undefined || isRecord(attachments) || Array.isArray(attachments);

  return bodyOk && captionOk && attOk;
}

function isFunction(x: unknown): x is (...args: readonly unknown[]) => unknown {
  return typeof x === "function";
}

type UnsealOkShape = { ok: true; inner: unknown };

function isUnsealOkShape(x: unknown): x is UnsealOkShape {
  return isRecord(x) && x["ok"] === true && "inner" in x;
}

function extractSealTeaser(payload: FeedPostPayload): string | null {
  const seal = isRecord(payload as unknown) ? (payload as unknown as Record<string, unknown>)["seal"] : undefined;
  if (!seal) return null;
  return pickString(seal, ["teaser", "preview", "hint", "caption"]) ?? null;
}

async function tryUnsealWithPostSealModule(args: {
  seal: unknown;
  meta: unknown;
  svgText: string | null;
}): Promise<UnsealedContent> {
  const modUnknown = (await import("../../utils/postSeal")) as unknown;
  const mod = isRecord(modUnknown) ? modUnknown : {};

  const fnUnknown =
    mod["openSealedEnvelope"] ??
    mod["openSealedPayload"] ??
    mod["unsealEnvelope"] ??
    mod["unsealPayload"] ??
    mod["unsealEnvelopeV1"] ??
    null;

  if (!isFunction(fnUnknown)) throw new Error("postSeal module is missing an unseal function.");

  const fnName =
    (isRecord(mod) && Object.entries(mod).find(([, v]) => v === fnUnknown)?.[0]) ?? "unseal";

  // If module exposes unsealEnvelopeV1(env, creds), pass creds extracted from meta.
  if (fnName === "unsealEnvelopeV1") {
    const kaiSignature =
      typeof args.meta === "object" && args.meta !== null ? readStringProp(args.meta, "kaiSignature") : undefined;
    const phiKey =
      typeof args.meta === "object" && args.meta !== null ? readStringProp(args.meta, "userPhiKey") : undefined;

    if (!kaiSignature) throw new Error("Missing kaiSignature in meta (cannot unlock sealed envelope).");

    const outUnknown = await Promise.resolve(fnUnknown(args.seal, { kaiSignature, phiKey }));
    if (isUnsealOkShape(outUnknown)) {
      const inner = outUnknown.inner;
      if (!isRecord(inner)) throw new Error("Unseal returned non-object inner payload.");
      const body = inner["body"];
      const attachments = inner["attachments"];
      const caption = inner["caption"];

      const content: UnsealedContent = {};
      if (body !== undefined && isRecord(body)) content.body = body as unknown as PostBody;
      if (attachments !== undefined) content.attachments = attachments;
      if (typeof caption === "string") content.caption = caption;
      return content;
    }

    // Some implementations may return the content directly.
    if (isUnsealedContent(outUnknown)) return outUnknown;

    throw new Error("Unseal returned an unexpected shape.");
  }

  // Default contract: fn(seal, { meta, svgText? }) -> { body?, attachments?, caption? }
  const outUnknown = await Promise.resolve(
    fnUnknown(args.seal, { meta: args.meta, svgText: args.svgText ?? undefined }),
  );
  if (!isUnsealedContent(outUnknown)) throw new Error("Unseal returned an unexpected shape.");
  return outUnknown;
}

/* ────────────────────────────────────────────────────────────────
   Payload card (uses AttachmentGallery + Private (Sealed) lock screen)
──────────────────────────────────────────────────────────────── */

function PayloadCard(props: {
  token: string;
  payload: FeedPostPayload;
  manifest: AttachmentManifest | null;
  copied: boolean;
  onKopy: () => void;

  // Private / sealed
  isSealed: boolean;
  unsealState: UnsealState;
  canUnseal: boolean;
  verifiedThisSession: boolean;
  hasComposerMeta: boolean;
  onVerifiedNow: () => void;
  onResetVerified: () => void;
  onUnseal: () => void;
  onForgetUnsealed: () => void;

  // Rendered content (may be unsealed)
  body?: PostBody;
  caption?: string;
}): React.JSX.Element {
  const {
    token,
    payload,
    manifest,
    copied,
    onKopy,
    isSealed,
    unsealState,
    canUnseal,
    verifiedThisSession,
    hasComposerMeta,
    onVerifiedNow,
    onResetVerified,
    onUnseal,
    onForgetUnsealed,
    body,
    caption,
  } = props;
  const gateRef = useRef<HTMLDivElement | null>(null);

  const promptGate = useCallback(() => {
    const el = gateRef.current;
    if (!el) return;

    try {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {
      /* ignore */
    }

    // Try to open the file picker inside SigilLogin (best effort).
    const file = el.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (file) {
      file.click();
      return;
    }

    // Fallback: click the first button in the gate.
    const btn = el.querySelector("button") as HTMLButtonElement | null;
    btn?.click();
  }, []);

  const unsealLabel =
    unsealState.status === "opening"
      ? "UNSEALING…"
      : canUnseal
        ? "UNSEAL"
        : !verifiedThisSession
          ? "🔐 Sealed"
          : !hasComposerMeta
            ? "RE-INHALE"
            : "UNSEAL";

  const handleUnsealPress = useCallback(() => {
    if (!canUnseal) {
      promptGate();
      return;
    }
    onUnseal();
  }, [canUnseal, onUnseal, promptGate]);

  // ✅ KKS-1.0 authoritative display derived ONLY from pulse (payload pulse is correct)
  const pulse = readPulse(payload.pulse);
  const { beat, step } = pulseToBeatStep(pulse);
  const { d, m, y } = pulseToDMY(pulse);
  const monthName = pulseToMonthName(pulse);
  const weekday = normalizeWeekdayLabel(pulseToWeekday(pulse));
 const ark = pulseToArkName(pulse);



  const phiKey =
    pickString(payload, ["userPhiKey", "phiKey", "phikey", "authorPhiKey"]) ??
    pickString((payload as unknown as { meta?: unknown }).meta, ["userPhiKey", "phiKey", "phikey"]) ??
    "";

  const modeLabelRaw =
    pickString(payload, ["mode", "source", "origin", "transport"]) ??
    pickString((payload as unknown as { meta?: unknown }).meta, ["mode", "source", "origin"]) ??
    "Manual";

  // ✅ ONLY CHANGE: translate "manual" → "Sovereign" for display
  const modeLabel = normalizeFeedSourceLabel(modeLabelRaw);

  useEffect(() => {
    try {
      registerSigilUrl(preferredShareUrl(token));
    } catch (e) {
      report("register share url (PayloadCard)", e);
    }
    if (typeof payload.url === "string" && payload.url.length) {
      try {
        registerSigilUrl(payload.url);
      } catch (e) {
        report("register payload.url (PayloadCard)", e);
      }
    }
  }, [token, payload.url]);

  const locked = isSealed && unsealState.status !== "open";
  const teaser = useMemo(() => (isSealed ? extractSealTeaser(payload) : null), [isSealed, payload]);

  const sealPill =
    isSealed ? (
      <span className="sf-pill sf-pill--sealed" title="Private (Sealed)">
        🔒 SEALED
      </span>
    ) : null;

  return (
    <section className="sf-payload" role="region" aria-label="Loaded payload">
      <div className="sf-payload-line sf-tags">
        <span className="sf-pill sf-pill--mode">{modeLabel || "Proof of Memory™"}</span>
        {sealPill}
        {phiKey ? (
          <span className="sf-pill sf-pill--phikey" title={phiKey}>
            ΦKey <span className="sf-key">{phiKey}</span>
          </span>
        ) : null}
      </div>

      <div className="sf-payload-core">
        <span>☤Kai: {pulse}</span>
        <span className="sf-muted"> · </span>
      <span className="sf-kai-label">
  {pad2(beat)}:{pad2(step)} — D{d}/M{m}/Y{y} · {ark} 
</span>

        <span className="sf-muted"> · </span>
        <span className="sf-kai-label"> {weekday} · {monthName} </span>
<span className="sf-kai-label">
 
</span>
      </div>

      {isSealed ? (
        <div className="sf-seal" role="group" aria-label="Private sealed content">
          {unsealState.status === "open" ? (
            <div className="sf-seal__row">
              <span className="sf-seal__label">Unsealed</span>
              <button type="button" className="sf-seal__btn" onClick={onForgetUnsealed} aria-label="Seal view">
                SEAL
              </button>
            </div>
          ) : (
            <>
              <div className="sf-seal__row">
                <span className="sf-seal__label">Private</span>

                <button
                  type="button"
                  className="sf-seal__btn"
                  onClick={handleUnsealPress}
                  disabled={unsealState.status === "opening"} // ✅ only disable while opening
                  aria-label="Unseal private content"
                >
                  {unsealLabel}
                </button>
              </div>

              {teaser ? (
                <div className="sf-seal__hint" role="note">
                  {teaser}
                </div>
              ) : null}

              {/* 🔒 LOCK SCREEN: glyph upload gate (ONLY for sealed posts) */}
              <div ref={gateRef} className="sf-seal__gate" role="region" aria-label="Unlock gate">
                {!verifiedThisSession ? (
                  <>
                    <div className="sf-seal__hint" role="note">
                      Inhale your ΦKey, then unseal.
                    </div>
                    <div className="sf-seal__login" aria-label="Glyph upload">
                      <SigilLogin onVerified={onVerifiedNow} />
                    </div>
                  </>
                ) : !hasComposerMeta ? (
                  <>
                    <div className="sf-seal__hint" role="note">
                      Verified session detected, but no sigil metadata is present. Re-inhale your glyph.
                    </div>
                    <div className="sf-seal__login" aria-label="Glyph re-upload">
                      <SigilLogin onVerified={onVerifiedNow} />
                    </div>
                    <div className="sf-seal__row">
                      <button
                        type="button"
                        className="sf-seal__btn"
                        onClick={onResetVerified}
                        aria-label="Use a different key"
                      >
                        USE DIFFERENT ΦKEY
                      </button>
                    </div>
                  </>
                ) : !canUnseal ? (
                  <div className="sf-seal__hint" role="note">
                    Inhale your ΦKey to unseal.
                  </div>
                ) : null}

                {unsealState.status === "error" ? (
                  <div className="sf-seal__hint" role="note">
                    {unsealState.message}
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : null}

      {/* If sealed and not open, do NOT render body/attachments (lock-screen view). */}
      {!locked ? (
        <>
          <PostBodyView body={body} caption={caption} isSealed={false} />
          {manifest ? <AttachmentGallery manifest={manifest} /> : null}
        </>
      ) : null}

      <div className="sf-reply-actions">
        <button
          type="button"
          className="sf-kopyBtn"
          onClick={onKopy}
          disabled={copied}
          data-state={copied ? "copied" : "idle"}
          aria-label="Remember share link"
        >
          {copied ? "REMEMBERED" : "REMEMBER"}
        </button>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────
   Root
──────────────────────────────────────────────────────────────── */

export function SigilStreamRoot(): React.JSX.Element {
  return (
    <ToastsProvider>
      <SigilAuthProvider>
        <SigilStreamInner />
      </SigilAuthProvider>
    </ToastsProvider>
  );
}

function SigilStreamInner(): React.JSX.Element {
  const toasts = useToasts();
  const loc = useLocation();

  /** ---------- Sources list (seed + storage + ?add ingestion) ---------- */
  const [sources, setSources] = useState<Source[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const seed = await loadLinksJson();
        const stored = parseStringArray(typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null);

        const merged: Source[] = [...stored.map((u) => ({ url: u })), ...seed];
        const seen = new Set<string>();
        const unique = merged.filter(({ url }) => (seen.has(url) ? false : (seen.add(url), true)));

        setSources(unique);
        for (const { url } of unique) registerSigilUrl(url);
      } catch (e) {
        report("initial seed load", e);
      }
    })().catch((e) => report("initial seed load outer", e));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const search = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(
        window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash,
      );

      const addsRaw = [...search.getAll("add"), ...hash.getAll("add")];
      const adds = addsRaw.map(normalizeAddParam).filter((x): x is string => Boolean(x));
      if (adds.length === 0) return;

      setSources((prev) => {
        const seen = new Set(prev.map((s) => s.url));
        const fresh = adds.filter((u) => !seen.has(u));
        if (fresh.length) {
          prependUniqueToStorage(fresh);
          for (const u of fresh) registerSigilUrl(u);
          return [...fresh.map((u) => ({ url: u })), ...prev];
        }
        return prev;
      });
    } catch (e) {
      report("add ingestion", e);
    }
  }, []);

  /** ---------- Payload (decoded from token) ---------- */
  const [activeToken, setActiveToken] = useState<string | null>(null);
  const [payload, setPayload] = useState<FeedPostPayload | null>(null);
  const [payloadError, setPayloadError] = useState<string | null>(null);

  const autoAddGuardRef = useRef<string | null>(null);

  /** ---------- Private: unseal state (in-memory only) ---------- */
  const [unsealState, setUnsealState] = useState<UnsealState>({ status: "none" });

  // reset unseal state when token changes / payload changes
  useEffect(() => {
    if (!payload) {
      setUnsealState({ status: "none" });
      return;
    }
    const hasSeal = isRecord(payload as unknown) && (payload as unknown as Record<string, unknown>)["seal"] !== undefined;
    setUnsealState(hasSeal ? { status: "sealed" } : { status: "none" });
  }, [payload]);

  const refreshPayloadFromLocation = useCallback(async () => {
    if (typeof window === "undefined") return;

    const raw = extractPayloadTokenFromLocation();
    const token = raw ? normalizeIncomingToken(raw) : null;

    setActiveToken(token);

    if (!token) {
      setPayload(null);
      setPayloadError(null);
      autoAddGuardRef.current = null;
      return;
    }

    try {
      registerSigilUrl(canonicalizeCurrentStreamUrl(token));
    } catch (e) {
      report("register current stream url (pre-decode)", e);
    }

    try {
      const decoded = (await decodeFeedPayload(token)) || (raw && raw !== token ? await decodeFeedPayload(raw) : null);

      if (!decoded) {
        setPayload(null);
        setPayloadError("Invalid or unreadable payload token.");
        return;
      }

      setPayload(decoded);
      setPayloadError(null);

      if (decoded.url && typeof decoded.url === "string" && decoded.url.length) {
        if (autoAddGuardRef.current !== token) {
          autoAddGuardRef.current = token;

          try {
            prependUniqueToStorage([decoded.url]);
          } catch (e) {
            report("prependUniqueToStorage (payload url)", e);
          }

          const res = autoAddVisitedPayloadToPhiStream({
            token,
            payloadUrl: decoded.url,
            toast: (kind, msg) => toasts.push(kind, msg),
          });

          setSources((prev) => {
            const seen = new Set(prev.map((s) => s.url));
            if (seen.has(decoded.url)) return prev;
            return [{ url: decoded.url }, ...prev];
          });

          if (!res.ok) report("phistream auto-add", res.reason);
        } else {
          setSources((prev) => {
            const seen = new Set(prev.map((s) => s.url));
            if (seen.has(decoded.url)) return prev;
            return [{ url: decoded.url }, ...prev];
          });
        }

        try {
          registerSigilUrl(decoded.url);
        } catch (e) {
          report("register payload.url (post-decode)", e);
        }
      }

      try {
        registerSigilUrl(shortAliasUrl(token));
      } catch (e) {
        report("register short alias url", e);
      }
    } catch (e) {
      report("payload decode", e);
      setPayload(null);
      setPayloadError("Payload decode failed.");
    }
  }, [toasts]);

  useEffect(() => {
    void refreshPayloadFromLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname, loc.search, loc.hash, refreshPayloadFromLocation]);

  /** ---------- Derived Kai attrs for theming (KKS-1.0 from pulse) ---------- */
  const kaiTheme = useMemo(() => {
    if (!payload) return { weekday: undefined as string | undefined, chakra: undefined as string | undefined };

    const pulse = readPulse(payload.pulse);
    const weekday = normalizeWeekdayLabel(pulseToWeekday(pulse));
    const chakra = normalizeChakraLabel(pulseToChakraDay(pulse));

    return { weekday, chakra };
  }, [payload]);

  /** ---------- Verified session flag (per-thread) ---------- */
  const sessionKey = useMemo(() => {
    const token = activeToken ?? (typeof window !== "undefined" ? extractPayloadTokenFromLocation() : null) ?? "root";
    return `sf.verifiedSession:${sessionTokenKey(token)}`;
  }, [activeToken]);

  const [verifiedThisSession, setVerifiedThisSession] = useState<boolean>(() => {
    try {
      if (typeof window === "undefined") return false;
      const t = extractPayloadTokenFromLocation() || "root";
      const k = `sf.verifiedSession:${sessionTokenKey(t)}`;
      return sessionStorage.getItem(k) === "1";
    } catch (e) {
      report("sessionStorage.getItem (init)", e);
      return false;
    }
  });

  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      setVerifiedThisSession(sessionStorage.getItem(sessionKey) === "1");
    } catch (e) {
      report("sessionStorage.getItem (sync)", e);
      setVerifiedThisSession(false);
    }
  }, [sessionKey]);

  const onVerifiedNow = () => {
    setVerifiedThisSession(true);
    try {
      sessionStorage.setItem(sessionKey, "1");
    } catch (e) {
      report("sessionStorage.setItem", e);
    }
    toasts.push("success", "ΦKey inhaled.");
  };

  const onResetVerified = () => {
    setVerifiedThisSession(false);
    try {
      sessionStorage.removeItem(sessionKey);
    } catch (e) {
      report("sessionStorage.removeItem", e);
    }
  };

  /** ---------- Auth metadata (from app context) ---------- */
  const rawSigilAuth = useSigilAuth() as unknown;
  const authLike = useMemo(() => coerceAuth(rawSigilAuth), [rawSigilAuth]);

  const composerMeta = useMemo(() => (verifiedThisSession ? authLike.meta : null), [verifiedThisSession, authLike.meta]);
  const composerSvgText = useMemo(() => (verifiedThisSession ? authLike.svgText : null), [
    verifiedThisSession,
    authLike.svgText,
  ]);

  const composerPhiKey = useMemo(
    () => (composerMeta ? readStringProp(composerMeta, "userPhiKey") : undefined),
    [composerMeta],
  );
  const composerKaiSig = useMemo(
    () => (composerMeta ? readStringProp(composerMeta, "kaiSignature") : undefined),
    [composerMeta],
  );

  /** ---------- Optional sigil tint vars (if present in meta) ---------- */
  type CSSVarStyle = React.CSSProperties & { [key: `--${string}`]: string };

  const sigilTintStyle = useMemo<React.CSSProperties>(() => {
    const r =
      readNumberLoose(composerMeta, "sigil_r") ??
      readNumberLoose(composerMeta, "sigilR") ??
      readNumberLoose(composerMeta, "tintR") ??
      null;

    const g =
      readNumberLoose(composerMeta, "sigil_g") ??
      readNumberLoose(composerMeta, "sigilG") ??
      readNumberLoose(composerMeta, "tintG") ??
      null;

    const b =
      readNumberLoose(composerMeta, "sigil_b") ??
      readNumberLoose(composerMeta, "sigilB") ??
      readNumberLoose(composerMeta, "tintB") ??
      null;

    if (r === null || g === null || b === null) return {};

    const style: CSSVarStyle = {};
    style["--sigil-r"] = String(clamp255(r));
    style["--sigil-g"] = String(clamp255(g));
    style["--sigil-b"] = String(clamp255(b));
    return style;
  }, [composerMeta]);

  /** ---------- Inhaler: add a link to list ---------- */
  const onAddInhaled = (u: string) => {
    setSources((prev) => {
      const seen = new Set(prev.map((s) => s.url));
      if (!seen.has(u)) {
        prependUniqueToStorage([u]);
        registerSigilUrl(u);
        return [{ url: u }, ...prev];
      }
      return prev;
    });
  };

  /** ---------- Private (Sealed): unseal/forget ---------- */
  const isSealed = useMemo(() => {
    if (!payload) return false;
    return isRecord(payload as unknown) && (payload as unknown as Record<string, unknown>)["seal"] !== undefined;
  }, [payload]);

  const canUnseal = useMemo(() => {
    // Require inhaled ΦKey + meta; sealed content is keyed.
    return Boolean(isSealed && verifiedThisSession && composerMeta);
  }, [isSealed, verifiedThisSession, composerMeta]);

  const onForgetUnsealed = useCallback(() => {
    if (!payload) return;
    setUnsealState(isSealed ? { status: "sealed" } : { status: "none" });
    toasts.push("success", "Sealed");
  }, [payload, isSealed, toasts]);

  const onUnseal = useCallback(async () => {
    if (!payload) return;

    const seal = (payload as unknown as Record<string, unknown>)["seal"];
    if (!seal) {
      setUnsealState({ status: "error", message: "No seal present on this payload." });
      return;
    }

    if (!verifiedThisSession || !composerMeta) {
      setUnsealState({ status: "error", message: "Inhale your ΦKey to unseal." });
      return;
    }

    setUnsealState({ status: "opening" });

    try {
      const content = await tryUnsealWithPostSealModule({
        seal,
        meta: composerMeta,
        svgText: composerSvgText ?? null,
      });

      setUnsealState({ status: "open", content });
      toasts.push("success", "Unsealed");
    } catch (e) {
      report("unseal", e);
      setUnsealState({
        status: "error",
        message: "Unseal failed. Wrong key, wrong seal, or missing postSeal implementation.",
      });
      toasts.push("warn", "Unseal failed.");
    }
  }, [payload, verifiedThisSession, composerMeta, composerSvgText, toasts]);

  const lockedSealedView = useMemo(() => isSealed && unsealState.status !== "open", [isSealed, unsealState.status]);

  /** ---------- Manifest/body/caption source (unsealed overrides) ---------- */
  const effectiveBody = useMemo<PostBody | undefined>(() => {
    if (unsealState.status === "open") return unsealState.content.body;
    return payload?.body;
  }, [payload, unsealState]);

  const effectiveCaption = useMemo<string | undefined>(() => {
    if (unsealState.status === "open") return unsealState.content.caption ?? payload?.caption;
    return payload?.caption;
  }, [payload, unsealState]);

  const effectiveAttachmentsUnknown = useMemo<unknown>(() => {
    if (unsealState.status === "open") {
      return unsealState.content.attachments ?? (payload as unknown as { attachments?: unknown })?.attachments;
    }
    return (payload as unknown as { attachments?: unknown })?.attachments;
  }, [payload, unsealState]);

  const payloadManifest = useMemo<AttachmentManifest | null>(() => {
    return effectiveAttachmentsUnknown ? coerceAttachmentManifest(effectiveAttachmentsUnknown) : null;
  }, [effectiveAttachmentsUnknown]);

  /** ---------- KOPY (toast-driven sound + label flip; v6.1 parity) ---------- */
  const [copied, setCopied] = useState<boolean>(false);
  const copiedTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    };
  }, []);

  const onKopy = useCallback(() => {
    const tokenRaw = activeToken ?? (typeof window !== "undefined" ? extractPayloadTokenFromLocation() : null);
    const token = tokenRaw ? normalizeIncomingToken(tokenRaw) : null;
    if (!token) return;

    // ✅ FIX: Always copy the canonical /stream/p link (hash fallback if oversized).
    const share = canonicalizeCurrentStreamUrl(token);

    // 1) Prefer sync copy: keeps toast-sound inside the click gesture (v6.1 behavior)
    const okSync = tryCopyExecCommand(share);
    if (okSync) {
      setCopied(true);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1200);

      toasts.push("success", "Remembered");
      return;
    }

    // 2) Clipboard API: start write INSIDE gesture (no await), toast immediately for sound parity,
    // then warn if it actually fails.
    const p = clipboardWriteTextPromise(share);
    if (p) {
      setCopied(true);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1200);

      toasts.push("success", "Remembered");

      p.catch((e: unknown) => {
        report("kopy clipboard.writeText", e);
        setCopied(false);
        toasts.push("warn", "Remember failed. Select the address bar.");
      });

      return;
    }

    // 3) Total failure
    toasts.push("warn", "Remember failed. Select the address bar.");
  }, [activeToken, toasts]);

  /** ---------- Derived list: show payload first if present ---------- */
  const urls: string[] = useMemo(() => {
    const base = sources.map((s) => s.url);

    const payloadUrl = payload && typeof payload.url === "string" && payload.url.length ? payload.url : null;
    if (!payloadUrl) return base;

    const rest = base.filter((u) => u !== payloadUrl);
    return [payloadUrl, ...rest];
  }, [sources, payload]);

  /** ---------- Render ---------- */
  const sigilBlock =
    verifiedThisSession && (composerMeta || composerSvgText)
      ? SigilActionUrl({ meta: composerMeta, svgText: composerSvgText || "" })
      : null;

  return (
    <main className="sf" data-weekday={kaiTheme.weekday} data-chakra={kaiTheme.chakra} style={sigilTintStyle}>
      <header className="sf-head" role="region" aria-labelledby="glyph-stream-title">
        <h1 id="glyph-stream-title">Memory Stream</h1>

        <KaiStatus />

        {payload && activeToken ? (
          <PayloadCard
            token={activeToken}
            payload={payload}
            manifest={payloadManifest}
            copied={copied}
            onKopy={onKopy}
            isSealed={isSealed}
            unsealState={unsealState}
            canUnseal={canUnseal}
            verifiedThisSession={verifiedThisSession}
            hasComposerMeta={Boolean(composerMeta)}
            onVerifiedNow={onVerifiedNow}
            onResetVerified={onResetVerified}
            onUnseal={onUnseal}
            onForgetUnsealed={onForgetUnsealed}
            body={effectiveBody}
            caption={effectiveCaption}
          />
        ) : payloadError ? (
          <div className="sf-error" role="alert">
            {payloadError}
          </div>
        ) : (
          <p className="sf-sub">
            Open a payload link at <code>/stream/p/&lt;token&gt;</code> (or <code>/stream#t=&lt;token&gt;</code>).
            Replies are Kai-sealed and thread via <code>?add=</code>. Short alias accepted: <code>/p~&lt;token&gt;</code>{" "}
            (and legacy <code>/p#t=</code>, <code>/p?t=</code>, <code>/stream?p=</code>).
          </p>
        )}

        {!payload && (
          <section className="sf-inhaler" aria-labelledby="inhaler-title">
            <InhaleSection onAdd={onAddInhaled} />
          </section>
        )}

        <IdentityBar phiKey={composerPhiKey} kaiSignature={composerKaiSig} />

        {/* ✅ Sigil stage wrapper (keeps SVG big/centered) */}
        {sigilBlock?.node ? (
          <section className="sf-sigilWrap" aria-label="Sigil stage">
            <div className="sf-sigilWrap__inner">{sigilBlock.node}</div>
          </section>
        ) : null}

        {/* 🔒 For sealed posts: hide Reply until unlocked (lock-screen flow). */}
        {payload && !lockedSealedView ? (
          <section className="sf-reply" aria-labelledby="reply-title">
            <h2 id="reply-title" className="sf-reply-title">
              Reply
            </h2>

            {!verifiedThisSession ? (
              <div className="sf-reply-login">
                <p className="sf-sub">Inhale ΦKey to resonate a reply.</p>
                <SigilLogin onVerified={onVerifiedNow} />
              </div>
            ) : !composerMeta ? (
              <div className="sf-error" role="alert">
                Verified, but no sigil metadata found. Re-inhale your glyph.
              </div>
            ) : (
              <Composer meta={composerMeta} svgText={composerSvgText} onUseDifferentKey={onResetVerified} />
            )}
          </section>
        ) : null}
      </header>

      {/* ✅ EXACT v6.1 bottom behavior */}
      <section className="sf-list">
        {urls.length === 0 ? (
          <div className="sf-empty">
            No items yet. Paste a link above or open a <code>/stream/p/&lt;payload&gt;</code> link and reply to start a
            thread.
          </div>
        ) : (
          <StreamList urls={urls} />
        )}
      </section>
    </main>
  );
}

export default SigilStreamRoot;
