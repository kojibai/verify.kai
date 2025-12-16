// src/pages/sigilstream/identity/SigilActionUrl.tsx
// v1.1.0 — Proof-of-Memory URL Normalization (prefer t=, fallback p=, NEVER v=)
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readStringProp, isRecord } from "../core/utils";
import { isLikelySigilUrl } from "../core/alias";
import "./SigilActionUrl.css";

type Props = {
  /** Parsed sigil metadata object (or null if none available) */
  meta: Record<string, unknown> | null;
  /** Raw SVG text for fallback URL extraction (or null) */
  svgText: string | null;
};

type ReturnShape = {
  /** The best-effort URL string we found ("" if none) */
  value: string;
  /** True iff `value` already looks like a canonical/short sigil link we accept */
  isCanonical: boolean;
  /** Ready-to-render UI block (readonly input + warning if needed) */
  node: React.JSX.Element;
};

/** Priority order (most specific first) */
const META_URL_KEYS: ReadonlyArray<string> = [
  "sigilActionUrl",
  "sigilUrl",
  "actionUrl",
  "claimedUrl",
  "loginUrl",
  "sourceUrl",
  "originUrl",
  "url",
  "link",
  "href",
];

/** Collect URL-ish candidates out of sigil metadata (keeps priority order). */
function collectFromMeta(meta: Record<string, unknown> | null): string[] {
  if (!meta || !isRecord(meta)) return [];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const k of META_URL_KEYS) {
    const v = readStringProp(meta, k);
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Collect absolute http(s) URLs from raw SVG text (best-effort). */
function collectFromSvg(svgText: string | null): string[] {
  if (!svgText) return [];
  try {
    const re = /https?:\/\/[^\s"'<>)#]+/gi;
    const matches = svgText.match(re) ?? [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const m of matches) {
      const t = (m ?? "").trim();
      if (!t) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out;
  } catch {
    return [];
  }
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test((s ?? "").trim());
}

function safeParseUrl(s: string): URL | null {
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

/**
 * Legacy cleanup:
 * - NEVER allow `v=` in returned URLs (cards must not render v= anymore)
 * - If `v=` exists and `t=` does not, treat `v` as `t`
 * - Prefer `t=` over `p=` when both exist
 * - Keep everything else intact (including add-chains, etc.)
 */
function normalizeProofUrl(raw: string): string {
  const input = (raw ?? "").trim();
  if (!input) return "";

  // String-level normalization (works even when URL parsing fails)
  let s = input;

  // Path variants (rare but we harden anyway)
  s = s.replace(/\/stream\/v=/gi, "/stream/t=");
  s = s.replace(/\/stream\/v\//gi, "/stream/t/");
  s = s.replace(/\/stream\/v(\?|&|#)/gi, "/stream/t$1");

  // Query/hash param rename (v= -> t=)
  // - only transforms key name; value stays the same
  s = s.replace(/([?&#])v=/gi, "$1t=");

  const u = safeParseUrl(s);
  if (!u) {
    // Non-parseable strings: at least guarantee no remaining "v="
    return s.replace(/([?&#])v=/gi, "$1t=");
  }

  // Query params: enforce t>p, drop v
  const qp = u.searchParams;
  const hasT = (qp.get("t") ?? "").trim().length > 0;
  const vVal = (qp.get("v") ?? "").trim();

  if (!hasT && vVal) qp.set("t", vVal);
  qp.delete("v");

  // Prefer t= when available (long memories)
  if ((qp.get("t") ?? "").trim().length > 0) {
    qp.delete("p");
  }

  // Hash params: ensure no v= leaks through in query-like hashes
  // (We only touch hashes that look like k=v&k2=v2; we avoid pathy hashes.)
  if (u.hash && u.hash.length > 1) {
    const h0 = u.hash.startsWith("#") ? u.hash.slice(1) : u.hash;
    const looksQueryLike = h0.includes("=") && !h0.startsWith("/");
    if (looksQueryLike) {
      const parts = h0.split("&").filter(Boolean);
      const kept: string[] = [];
      let hasHashT = false;

      for (const part of parts) {
        const eq = part.indexOf("=");
        if (eq <= 0) {
          kept.push(part);
          continue;
        }
        const k = part.slice(0, eq);
        const v = part.slice(eq + 1);

        const keyLower = k.toLowerCase();

        if (keyLower === "v") {
          // convert v -> t (only if hash doesn't already have t)
          if (!hasHashT && v.trim().length) {
            kept.push(`t=${v}`);
            hasHashT = true;
          }
          continue;
        }

        if (keyLower === "t") hasHashT = true;
        kept.push(part);
      }

      // Prefer t over p in hash too (only if BOTH exist)
      if (hasHashT) {
        const kept2: string[] = [];
        for (const part of kept) {
          const eq = part.indexOf("=");
          const k = eq > 0 ? part.slice(0, eq).toLowerCase() : "";
          if (k === "p") continue;
          kept2.push(part);
        }
        u.hash = kept2.length ? `#${kept2.join("&")}` : "";
      } else {
        u.hash = kept.length ? `#${kept.join("&")}` : "";
      }
    } else {
      // Still guarantee no raw v= pattern leaks
      u.hash = u.hash.replace(/([?&#])v=/gi, "$1t=");
    }
  }

  return u.toString();
}

function scoreProofUrl(value: string): number {
  const v = (value ?? "").trim();
  if (!v) return -1;

  const lower = v.toLowerCase();
  let s = 0;

  // Hard rule: never allow v=
  if (/[?&#]v=/.test(lower) || lower.includes("/stream/v")) s -= 10_000;

  // Prefer t= (long memory/thread form)
  if (/[?&#]t=/.test(lower) || lower.includes("/stream/t") || lower.includes("stream/t=")) s += 500;

  // Fallback: p= (short memory/pulse form)
  if (/[?&#]p=/.test(lower) || lower.includes("/stream/p") || lower.includes("stream/p=")) s += 280;

  // Prefer sealed/canonical sigil URLs
  if (isLikelySigilUrl(v)) s += 160;

  // Prefer https
  if (lower.startsWith("https://")) s += 20;
  else if (lower.startsWith("http://")) s += 10;

  // Slight preference for shorter strings (but t= still dominates)
  s += Math.max(0, 120 - Math.min(120, Math.floor(v.length / 6)));

  return s;
}

function pickBestCandidate(candidates: string[]): string {
  let best = "";
  let bestScore = -1;

  for (const raw of candidates) {
    const norm = normalizeProofUrl(raw);
    const sc = scoreProofUrl(norm);
    if (sc > bestScore) {
      bestScore = sc;
      best = norm;
    }
  }
  return best;
}

async function copyToClipboard(text: string): Promise<boolean> {
  const t = text ?? "";
  if (!t) return false;

  // Modern async clipboard (best)
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(t);
      return true;
    }
  } catch {
    // fall through to legacy
  }

  // Legacy fallback
  try {
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function SigilActionUrlNode({ value, isCanonical }: { value: string; isCanonical: boolean }) {
  const url = useMemo(() => safeParseUrl(value), [value]);
  const openHref = useMemo(() => (isHttpUrl(value) ? value : ""), [value]);

  const [copied, setCopied] = useState(false);
  const [copyFail, setCopyFail] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  const flashCopied = useCallback((ok: boolean) => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setCopied(ok);
    setCopyFail(!ok);
    timerRef.current = window.setTimeout(() => {
      setCopied(false);
      setCopyFail(false);
      timerRef.current = null;
    }, 1400);
  }, []);

  const onCopy = useCallback(async () => {
    const ok = await copyToClipboard(value);
    flashCopied(ok);
  }, [flashCopied, value]);

  const onSelect = useCallback((e: React.SyntheticEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    try {
      el.focus();
      el.select();
      el.setSelectionRange(0, el.value.length);
    } catch {
      // ignore
    }
  }, []);

  const host = url?.host ?? "";
  const pretty = url
    ? `${url.hostname}${url.pathname}${url.search}${url.hash}`.replace(/\/{2,}/g, "/")
    : value;

  return (
    <div className="sf-reply-row sf-actionurl">
      <div className="sf-actionurl__head">
        <label className="sf-label sf-actionurl__label">
          Proof of Breath™ <span className="sf-muted">(Sigil-Glyph)</span>
        </label>

        <span className={`sf-actionurl__pill ${isCanonical ? "is-ok" : "is-warn"}`}>
          {isCanonical ? "SIGNED" : "EXTERNAL"}
        </span>
      </div>

      <div className="sf-actionurl__field">
        <div className="sf-actionurl__inputWrap">
          <input
            className="sf-input sf-input--locked sf-actionurl__input"
            type="url"
            value={value}
            readOnly
            onClick={onSelect}
            onFocus={onSelect}
            aria-label="Proof of Breath™ Sigil-Glyph"
          />
          <div className="sf-actionurl__meta" aria-hidden="true">
            {host ? (
              <span className="sf-actionurl__host">{host}</span>
            ) : (
              <span className="sf-actionurl__host">URL</span>
            )}
            <span className="sf-actionurl__dot">•</span>
            <span className="sf-actionurl__pretty">{pretty}</span>
          </div>
        </div>

        <div className="sf-actionurl__btns">
          <button
            type="button"
            className={`sf-actionurl__btn ${copied ? "is-copied" : ""} ${copyFail ? "is-fail" : ""}`}
            onClick={onCopy}
            aria-live="polite"
          >
            {copied ? "✓ Remembered" : copyFail ? "Remember failed" : "Remember"}
          </button>

          {openHref ? (
            <a
              className="sf-actionurl__btn sf-actionurl__btn--link"
              href={openHref}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Open Proof of Breath URL in a new tab"
            >
              ↗
            </a>
          ) : (
            <button type="button" className="sf-actionurl__btn sf-actionurl__btn--disabled" disabled>
              ↗
            </button>
          )}
        </div>
      </div>

      {!isCanonical && (
        <div className="sf-warn sf-actionurl__warn" role="status">
          Not recognized as a sealed Proof of Breath™ link; fallback rules may apply.
        </div>
      )}
    </div>
  );
}

function SigilActionUrlEmpty() {
  return (
    <div className="sf-reply-row sf-actionurl sf-actionurl--empty">
      <div className="sf-actionurl__head">
        <label className="sf-label sf-actionurl__label">
          Proof of Breath™ <span className="sf-muted">(Sigil-Glyph)</span>
        </label>
        <span className="sf-actionurl__pill is-warn">MISSING</span>
      </div>

      <div className="sf-warn sf-actionurl__warn" role="status">
        No Proof of Breath™ sigil-glyph detected; a fallback will be used.
      </div>
    </div>
  );
}

/**
 * SigilActionUrl — extracts a canonical sigil/action URL and returns both the value
 * and a prebuilt UI node. Returned URL is normalized to:
 * - Prefer t= (long/thread) if present (or if legacy v= was present)
 * - Otherwise use p= (short/pulse)
 * - NEVER return v=
 */
export function SigilActionUrl({ meta, svgText }: Props): ReturnShape {
  const metaCandidates = collectFromMeta(meta);
  const svgCandidates = collectFromSvg(svgText);

  const candidates = [...metaCandidates, ...svgCandidates];

  const value = candidates.length ? pickBestCandidate(candidates) : "";
  const isCanonical = value.length > 0 && isLikelySigilUrl(value);

  const node = value ? <SigilActionUrlNode value={value} isCanonical={isCanonical} /> : <SigilActionUrlEmpty />;

  return { value, isCanonical, node };
}

export default SigilActionUrl;
