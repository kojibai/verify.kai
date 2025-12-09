// src/pages/sigilstream/identity/SigilActionUrl.tsx
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

/** Pick the first useful URL-ish field out of sigil metadata. */
function extractFromMeta(meta: Record<string, unknown> | null): string {
  if (!meta || !isRecord(meta)) return "";
  // Priority order (most specific first)
  const keys = [
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
  for (const k of keys) {
    const v = readStringProp(meta, k);
    if (typeof v === "string" && v.trim().length) return v.trim();
  }
  return "";
}

/** Fallback URL scrape from raw SVG text (first http/https absolute URL). */
function extractFromSvg(svgText: string | null): string {
  if (!svgText) return "";
  try {
    const m = svgText.match(/https?:\/\/[^\s"'<>)#]+/i);
    return m?.[0] ?? "";
  } catch {
    return "";
  }
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

function safeParseUrl(s: string): URL | null {
  try {
    return new URL(s);
  } catch {
    return null;
  }
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
  const pretty =
    url ? `${url.hostname}${url.pathname}${url.search}${url.hash}`.replace(/\/{2,}/g, "/") : value;

  return (
    <div className="sf-reply-row sf-actionurl">
      <div className="sf-actionurl__head">
        <label className="sf-label sf-actionurl__label">
          Proof of Breath™ <span className="sf-muted">(URL)</span>
        </label>

        <span className={`sf-actionurl__pill ${isCanonical ? "is-ok" : "is-warn"}`}>
          {isCanonical ? "SEALED" : "EXTERNAL"}
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
            aria-label="Proof of Breath URL"
          />
          <div className="sf-actionurl__meta" aria-hidden="true">
            {host ? <span className="sf-actionurl__host">{host}</span> : <span className="sf-actionurl__host">URL</span>}
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
 * and a prebuilt UI node. Consumers can either use `.node` directly or read `.value`
 * and `.isCanonical` for custom layouts.
 */
export function SigilActionUrl({ meta, svgText }: Props): ReturnShape {
  const candidate = extractFromMeta(meta) || extractFromSvg(svgText) || "";
  const value = candidate;
  const isCanonical = value.length > 0 && isLikelySigilUrl(value);

  const node = value ? <SigilActionUrlNode value={value} isCanonical={isCanonical} /> : <SigilActionUrlEmpty />;

  return { value, isCanonical, node };
}

export default SigilActionUrl;
