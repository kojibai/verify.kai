// src/components/FeedCard.tsx
"use client";

/**
 * FeedCard — Sigil-Glyph Capsule Renderer
 * v4.1.3 — FIX: Proof of Memory™ shown ONCE (top kind chip only)
 *          + Open button label stays “Memory” for manual capsules
 *          + Sigil-body title (above the URL) becomes “Proof of Memory™” (not “Memory”)
 *
 * ✅ Manual marker rendering:
 *    - Any displayed string equal to "manual" becomes "Proof of Memory™"
 *    - If a nested previous/reply payload contains "manual", the card kind label becomes Proof of Memory™
 *    - NO duplicate Proof of Memory™ chip (source chip hidden if it matches kind chip)
 *    - Sigil-body title above the URL becomes "Proof of Memory™"
 *
 * ✅ Lint/TS hardening:
 *    - No `.toUpperCase()` called on a value that TS might narrow to `never`
 *    - Use `upper()` (unknown→string→uppercase) helper
 */

import React, { useCallback, useMemo, useState } from "react";
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

/* ─────────────────────────────────────────────────────────────
   Manual marker → Proof of Memory™
   ───────────────────────────────────────────────────────────── */

const TM = "\u2122";
const PROOF_OF_MEMORY = `Proof of Memory${TM}`;
const PROOF_OF_BREATH = `Proof Of Breath${TM}`;

const isManualMarkerText = (v: unknown): v is string =>
  typeof v === "string" && v.trim().toLowerCase() === "manual";

/** Map ONLY the exact "manual" marker to Proof of Memory™ */
const displayManualAsProof = (v: unknown): string | undefined => {
  if (!isNonEmpty(v)) return undefined;
  return isManualMarkerText(v) ? PROOF_OF_MEMORY : v;
};

/**
 * Deep scan for a strict "manual" marker anywhere in a payload
 * (covers "previous message" / "reply message" nested objects too).
 */
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
  // common trailing punctuation
  t = t.replace(/[)\].,;:!?]+$/g, "");
  // common leading punctuation
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

  // final trim again
  return stripEdgePunct(t);
}

function isLikelyToken(s: string): boolean {
  // base64url-ish token (avoid tiny strings)
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

  // hash params
  const hashStr = u.hash && u.hash.startsWith("#") ? u.hash.slice(1) : "";
  const hash = new URLSearchParams(hashStr);

  // search params
  const search = u.searchParams;

  // common token keys
  const keys = ["t", "p", "token", "capsule"];
  for (const k of keys) {
    push(hash.get(k));
    push(search.get(k));
  }

  // path forms
  push(extractFromPath(u.pathname));

  // nested add= urls (common in reply/share wrappers)
  if (depth < 1) {
    const adds = [...search.getAll("add"), ...hash.getAll("add")];
    for (const a of adds) {
      const maybeUrl = stripEdgePunct(a);
      if (!maybeUrl) continue;

      // add may be percent-encoded url
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

/** Always build browser-openable URL (never return legacy paths). */
function makeBrowserOpenUrlFromToken(tokenRaw: string): string {
  const base = originFallback().replace(/\/+$/g, "");
  const t = normalizeToken(tokenRaw);
  return `${base}/stream/p/${t}`;
}

/** Normalize any non-/s URL into /stream/p/<token> when possible (supports nested add=). */
function normalizeResolvedUrlForBrowser(rawUrl: string): string {
  const raw = stripEdgePunct(rawUrl);
  if (isSPayloadUrl(raw)) return raw;

  const tok = extractTokenCandidates(raw)[0];
  return tok ? makeBrowserOpenUrlFromToken(tok) : raw;
}

/** Build canonical url candidates to satisfy whatever decodeSigilUrl already supports. */
function buildDecodeUrlCandidates(token: string): string[] {
  const base = originFallback().replace(/\/+$/g, "");
  const t = normalizeToken(token);

  return [
    t, // in case decoder accepts raw token
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

  // 1) raw first
  const rawOk = attempt(rawTrim);
  if (rawOk) {
    return { decoded: rawOk, resolvedUrl: normalizeResolvedUrlForBrowser(rawTrim) };
  }

  // 2) tokens from raw url
  const tokens = extractTokenCandidates(rawTrim);
  for (const tok of tokens) {
    for (const cand of buildDecodeUrlCandidates(tok)) {
      const ok = attempt(cand);
      if (ok) {
        return { decoded: ok, resolvedUrl: makeBrowserOpenUrlFromToken(tok) };
      }
    }
  }

  // 3) last resort: return original decoder error (raw), but still normalize the resolved URL for copy/open
  return { decoded: decodeSigilUrl(rawTrim), resolvedUrl: normalizeResolvedUrlForBrowser(rawTrim) };
}

/* ─────────────────────────────────────────────────────────────
   KKS-1.0: D/M/Y from μpulses (exact, deterministic)
   ───────────────────────────────────────────────────────────── */

/** Euclidean mod (always 0..m-1) */
const modE = (a: bigint, m: bigint): bigint => {
  const r = a % m;
  return r >= 0n ? r : r + m;
};

/** Euclidean floor division (toward −∞) */
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

/** Exact KKS calendar indices from a pulse (no payload heuristics). */
function kaiDMYFromPulseKKS(pulse: number): { day: number; month: number; year: number } {
  const ms = epochMsFromPulse(pulse); // bigint
  const pμ = microPulsesSinceGenesis(ms); // bigint μpulses

  const dayIdx = floorDivE(pμ, N_DAY_MICRO); // bigint days since genesis (can be negative)
  const monthIdx = floorDivE(dayIdx, BigInt(DAYS_PER_MONTH)); // bigint
  const yearIdx = floorDivE(dayIdx, BigInt(DAYS_PER_YEAR)); // bigint

  const dayOfMonth = toSafeNumber(modE(dayIdx, BigInt(DAYS_PER_MONTH))) + 1; // 1..42
  const month = toSafeNumber(modE(monthIdx, BigInt(MONTHS_PER_YEAR))) + 1; // 1..8
  const year = toSafeNumber(yearIdx); // display year (0-based is allowed; keep exact)

  return { day: dayOfMonth, month, year };
}

/**
 * Chakra coercion:
 * - KaiSigil expects "Crown" internally
 * - UI should DISPLAY "Krown"
 */
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

/** Arc name from *zero-based* beat (0..35) — 6 beats per arc */
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
  return (["Ignite", "Integrate", "Harmonize", "Reflekt", "Purify", "Dream"] as const)[idx];
}

/** Two-digit pad: 0 → "00" */
const pad2 = (n: number): string => String(Math.max(0, Math.floor(n))).padStart(2, "0");

/** Build a Kai-first meta line with **zero-based**, **two-digit** BB:SS label. NEVER display Chronos. */
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

/** Compute stepPct for KaiSigil from a *zero-based* step index */
function stepPctFromIndex(stepZ: number): number {
  const s = Math.max(0, Math.min(STEPS_BEAT - 1, Math.floor(stepZ)));
  const pct = s / STEPS_BEAT;
  return pct >= 1 ? 1 - 1e-12 : pct;
}

/** Chakra → accent RGB (support both spellings for theming) */
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

/** Legacy-safe “source” read without any-casts. */
function legacySourceFromData(data: unknown): string | undefined {
  if (data && typeof data === "object" && "source" in data) {
    const v = (data as { source?: unknown }).source;
    return typeof v === "string" ? v : undefined;
  }
  return undefined;
}

/** Safe kind read (avoids union → never collapse). */
function kindFromDecodedData(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "kind" in data) {
    const k = (data as { kind?: unknown }).kind;
    if (typeof k === "string" && k.trim().length > 0) return k;
  }
  return fallback;
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
   Component
   ───────────────────────────────────────────────────────────── */

export const FeedCard: React.FC<Props> = ({ url }) => {
  const [copied, setCopied] = useState(false);

  // ✅ Smart decode
  const smart = useMemo(() => decodeSigilUrlSmart(url), [url]);
  const decoded = smart.decoded;

  // ✅ Single canonical URL for UI + copy (hard normalized)
  const rememberUrl = useMemo(() => normalizeResolvedUrlForBrowser(smart.resolvedUrl || url), [
    smart.resolvedUrl,
    url,
  ]);

  const onCopy = useCallback(() => {
    const text = normalizeResolvedUrlForBrowser(rememberUrl || url);

    // 1) sync attempt (best for gesture constraints)
    const okSync = tryCopyExecCommand(text);
    if (okSync) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1100);
      return;
    }

    // 2) async clipboard (do NOT await)
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

    // 3) total failure
    // eslint-disable-next-line no-console
    console.warn("Remember failed: no clipboard available");
  }, [rememberUrl, url]);

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

  // ✅ Single source of truth: derive moment from pulse (KKS-1.0)
  const m = momentFromPulse(pulse);

  // ✅ Never trust capsule beat/step/chakra; derive from pulse
  const beatZ = Math.max(0, Math.floor(m.beat));
  const stepZ = Math.max(0, Math.floor(m.stepIndex));

  // INTERNAL chakra value (what KaiSigil expects)
  const chakraDay: ChakraDay = toChakra(m.chakraDay, m.chakraDay);
  // DISPLAY chakra value (what user sees)
  const chakraDayDisplay = chakraDay === "Crown" ? "Krown" : String(chakraDay);

  // ✅ Exact KKS v1.0 D/M/Y (1-based day & month)
  const { day, month, year } = kaiDMYFromPulseKKS(pulse);

  const inferredKind =
    post ? "post" : message ? "message" : share ? "share" : reaction ? "reaction" : "sigil";

  // ✅ Hardened kind read (prevents TS union drift → never)
  const kind: string = kindFromDecodedData(data as unknown, inferredKind);
  const kindText = String(kind); // always safe

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

  // ✅ Manual marker: deep scan (previous/reply/etc) + immediate fields
  const manualMarkerPresent =
    isManualMarkerText(kindText) || isManualMarkerText(sourceBadge) || hasManualMarkerDeep(capsule);

  // Display labels (only affect rendering; never leak raw "manual")
  const kindChipLabel = manualMarkerPresent ? PROOF_OF_MEMORY : upper(kindText);
  const ariaKindLabel = manualMarkerPresent ? PROOF_OF_MEMORY : kindText;

  const sourceChipLabel = sourceBadge
    ? isManualMarkerText(sourceBadge)
      ? PROOF_OF_MEMORY
      : upper(sourceBadge)
    : undefined;

  // ✅ Remove duplicate Proof of Memory™ chip (keep ONLY the top kind chip)
  const showSourceChip = Boolean(sourceChipLabel) && sourceChipLabel !== kindChipLabel;

  const postTitle = displayManualAsProof(post?.title);
  const postText = displayManualAsProof(post?.text);
  const messageText = displayManualAsProof(message?.text);
  const shareNote = displayManualAsProof(share?.note);

  const kai = buildKaiMetaLineZero(pulse, beatZ, stepZ, day, month, year);
  const stepPct = stepPctFromIndex(stepZ);

  // Accent vars
  const [ar, ag, ab] =
    CHAKRA_RGB[chakraDayDisplay] ?? CHAKRA_RGB.Crown ?? ([238, 241, 251] as const);

  const phase = ((pulse % 13) + 13) % 13; // safe Euclidean mod for negative pulses
  const styleVars: React.CSSProperties = {
    ["--fc-accent-r" as never]: String(ar),
    ["--fc-accent-g" as never]: String(ag),
    ["--fc-accent-b" as never]: String(ab),
    ["--fc-pulse-dur" as never]: "5236ms",
    ["--fc-pulse-offset" as never]: `${-(phase * 120)}ms`,
  };

  const dataKindAttr = manualMarkerPresent ? "proof_of_memory" : kindText;

  // ✅ ONLY the Open button label stays "Memory" (as requested)
  const openLabel = manualMarkerPresent ? "↗ Memory" : "↗ Sigil-Glyph";
  const openTitle = manualMarkerPresent ? "Open memory" : "Open sigil";

  return (
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
              <span className="fc-arc" title="Ark">
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
              {/* ✅ THIS is the line you wanted changed (above the URL) */}
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
  );
};

export default FeedCard;
 