/* ────────────────────────────────────────────────────────────────
   SealMomentModal.tsx — popover shown after "Seal This Moment"
   v3.1 — Explorer wiring: auto-register minted URL (no backend)
   - Tries window.__SIGIL__.registerSigilUrl(url)
   - Optional: window.__SIGIL__.registerSend({ type, url, hash })
   - Falls back to localStorage("sigil:urls") + DOM event
   - De-dupes; SSR-safe; no prop changes
────────────────────────────────────────────────────────────────── */

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { FC, MouseEventHandler } from "react";
import { createPortal } from "react-dom";
import "./SealMomentModal.css";

/* ── Explorer integration types (safe globals)
   IMPORTANT: This MUST match other declarations (eg. SealMomentModalTransfer.tsx)
   to avoid TS2717 "Subsequent property declarations must have the same type".
────────────────────────────────────────────────────────────────── */
declare global {
  interface Window {
    __SIGIL__?:
      | {
          /** Optional global hook the Explorer can provide */
          registerSigilUrl?: ((url: string) => void) | undefined;
          /** Optional global hook for send/record integrations */
          registerSend?: ((rec: unknown) => void) | undefined;
        }
      | undefined;
  }
}

interface Props {
  open: boolean;
  url: string;
  hash: string;
  onClose: () => void;
  onDownloadZip: () => void;
}

const LS_KEY = "sigil:urls";

/* Local, sovereign registry fallback (no backend)
   - Stores a unique, append-only set of URLs in localStorage
   - Emits a DOM CustomEvent for live Explorer updates
*/
function registerLocally(url: string) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    if (!list.includes(url)) {
      list.push(url);
      window.localStorage.setItem(LS_KEY, JSON.stringify(list));
    }
    window.dispatchEvent(
      new CustomEvent("sigil:url-registered", { detail: { url } })
    );
  } catch {
    // ignore; never let UX fail due to storage
  }
}

const SealMomentModal: FC<Props> = ({
  open,
  url,
  hash,
  onClose,
}) => {
  /* refs & state (Hooks must be unconditionally called) */
  const cardRef = useRef<HTMLDivElement | null>(null);
  const firstFocusRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [toast, setToast] = useState<string>("");

  /* ── NEW: ensure each minted URL is registered once ───────── */
  const lastRegisteredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !url) return;

    // prevent duplicate registration on re-renders
    if (lastRegisteredRef.current === url) return;
    lastRegisteredRef.current = url;

    const hasGlobal =
      typeof window !== "undefined" &&
      typeof window.__SIGIL__?.registerSigilUrl === "function";

    if (hasGlobal) {
      try {
        window.__SIGIL__!.registerSigilUrl!(url);
      } catch {
        registerLocally(url);
      }
    } else {
      registerLocally(url);
    }

    // Optional send hook (never required)
    const canSend =
      typeof window !== "undefined" &&
      typeof window.__SIGIL__?.registerSend === "function";

    if (canSend) {
      try {
        window.__SIGIL__!.registerSend!({
          type: "sigil:mint",
          url,
          hash,
        } satisfies { type: string; url: string; hash: string });
      } catch {
        // ignore
      }
    }
  }, [open, url, hash]);

  /* share support — SSR-safe & no `any` */
  const canShare = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    const nav = navigator as Navigator & {
      share?: (data: ShareData) => Promise<void>;
      canShare?: (data: ShareData) => boolean;
    };
    if (typeof nav.share !== "function") return false;
    if (!url) return true;
    return typeof nav.canShare === "function" ? nav.canShare({ url }) : true;
  }, [url]);

  /* focus trap util (stable reference) */
  const trapFocus = useCallback((e: KeyboardEvent) => {
    const root = cardRef.current;
    if (!root) return;

    const focusables = root.querySelectorAll<HTMLElement>(
      [
        "a[href]",
        "button:not([disabled])",
        "input:not([disabled])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        "[tabindex]:not([tabindex='-1'])",
      ].join(",")
    );
    if (focusables.length === 0) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  }, []);

  /* effects: focus trap, scroll lock — only when open === true */
  useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current =
      (document.activeElement as HTMLElement) ?? null;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const t = window.setTimeout(
      () => firstFocusRef.current?.focus({ preventScroll: true }),
      0
    );

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") trapFocus(e);
      // No ESC close by design
    };
    document.addEventListener("keydown", onKey, true);

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey, true);
      window.clearTimeout(t);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open, trapFocus]);

  /* utils */
  const announce = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 900);
  };

  const copy = async (t: string, label: string) => {
    try {
      if (typeof navigator === "undefined") throw new Error("no navigator");
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(t);
      announce(`${label} copied to clipboard`);
    } catch {
      announce(`Could not copy ${label}`);
    }
  };

  const share = async () => {
    try {
      if (canShare && typeof navigator !== "undefined") {
        const nav = navigator as Navigator & {
          share?: (data: ShareData) => Promise<void>;
        };
        await nav.share?.({
          title: "Kairos Sigil-Glyph",
          text: "Sealed Kairos Moment",
          url,
        });
        announce("Share sheet opened");
      } else {
        await copy(url, "Link");
      }
    } catch {
      /* user canceled; ignore */
    }
  };

  const shortHash = useMemo(() => (hash ? hash.slice(0, 16) : "—"), [hash]);

  /* SAFE handlers (no capture-phase swallowing) */
  const handleClose: MouseEventHandler<HTMLButtonElement> = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClose?.();
  };

  const handleOverlayPointerDown: React.PointerEventHandler<HTMLDivElement> = (
    e
  ) => {
    // Only block background interactions when the user clicks the overlay itself,
    // never when clicking inside the card (otherwise buttons can stop working).
    if (e.target === e.currentTarget) e.preventDefault();
  };

  return open
    ? createPortal(
        <div
          className="seal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="seal-title"
          aria-describedby="seal-desc"
          data-state="open"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={handleOverlayPointerDown}
        >
          {/* Background veil blocks page interactions by z-index + pointer-events in CSS */}
          <div className="seal-veil" aria-hidden="true" />

          <div
            ref={cardRef}
            className="seal-card"
            role="document"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ornaments */}
            <div className="seal-ornament seal-ornament--tl" aria-hidden="true" />
            <div className="seal-ornament seal-ornament--tr" aria-hidden="true" />
            <div className="seal-ornament seal-ornament--bl" aria-hidden="true" />
            <div className="seal-ornament seal-ornament--br" aria-hidden="true" />

            {/* Close (✕ is the ONLY closer) */}
            <button
              ref={firstFocusRef}
              className="seal-close"
              aria-label="Close"
              onClick={handleClose}
              type="button"
            >
              <CloseGlyph />
            </button>

            <header className="seal-header">
              <h3 id="seal-title" className="seal-title">
                Moment Sealed
              </h3>
              <p id="seal-desc" className="seal-subtitle">
                Your Kairos imprint is preserved. Proceed to the URL below to Inhale
                Claimed Ownership.
              </p>
            </header>

            {/* hash */}
            <label className="field">
              <span className="field-label">Hash</span>
              <div className="row">
                <code className="hash" title={hash || "—"}>
                  {hash ? shortHash : "—"}
                </code>
                <button
                  className="icon-btn"
                  onClick={() => copy(hash, "Hash")}
                  disabled={!hash}
                  aria-label="Copy hash"
                  title="Copy hash"
                  type="button"
                >
                  <CopyGlyph />
                </button>
              </div>
              {hash && (
                <p className="micro">
                  Full: <span className="mono">{hash}</span>
                </p>
              )}
            </label>

            {/* url */}
            <label className="field">
              <span className="field-label">URL</span>
              <div className="row">
                <input
                  className="url-input"
                  value={url}
                  readOnly
                  aria-readonly="true"
                  spellCheck={false}
                />
                <button
                  className="icon-btn"
                  onClick={() => copy(url, "Link")}
                  disabled={!url}
                  aria-label="Copy link"
                  title="Copy link"
                  type="button"
                >
                  <CopyGlyph />
                </button>
                {url && (
                  <a
                    className="open-link"
                    href={url}
                    target="_blank"
                    rel="noopener"
                    aria-label="Open link in new tab"
                    title="Open link"
                  >
                    <LinkGlyph />
                  </a>
                )}
              </div>
            </label>

            {/* CTAs */}
            <div className="cta-row">
             

              <button className="secondary cta" onClick={share} type="button">
                <ShareGlyph />
                <span>{canShare ? "Share" : "Remember Link"}</span>
              </button>
            </div>

            <p className="fine">
              This moment is now sealed in time. Use the link above within the next
              11 breaths to claim ownership &amp; gain permanent access to this
              Kairos moment.
            </p>

            {/* live region for copy/share feedback */}
            <div className="sr-only" aria-live="polite" aria-atomic="true">
              {toast}
            </div>
          </div>
        </div>,
        document.body
      )
    : null;
};

/* ── decorative icons (inline SVG) ───────────────────────── */
const CloseGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden className="seal-close-ico">
    <circle
      cx="12"
      cy="12"
      r="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      opacity=".35"
    />
    <path
      d="M7 7l10 10M17 7L7 17"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

const ShareGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden className="ico">
    <path
      d="M15 8a3 3 0 100-6 3 3 0 000 6zM6 14a3 3 0 100-6 3 3 0 000 6zm9 12a3 3 0 100-6 3 3 0 000 6z"
      fill="currentColor"
    />
    <path
      d="M8.6 9.7l6.8-3.4M8.6 12.3l6.8 3.4"
      stroke="currentColor"
      strokeWidth="2"
      fill="none"
    />
  </svg>
);

const CopyGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden className="ico">
    <rect
      x="9"
      y="9"
      width="10"
      height="10"
      rx="2"
      stroke="currentColor"
      strokeWidth="2"
      fill="none"
    />
    <rect
      x="5"
      y="5"
      width="10"
      height="10"
      rx="2"
      stroke="currentColor"
      strokeWidth="2"
      fill="none"
      opacity=".5"
    />
  </svg>
);

const LinkGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden className="ico">
    <path
      d="M10 14a5 5 0 007.07 0l1.41-1.41a5 5 0 00-7.07-7.07L10 6"
      stroke="currentColor"
      strokeWidth="2"
      fill="none"
    />
    <path
      d="M14 10a5 5 0 00-7.07 0L5.5 11.43a5 5 0 007.07 7.07L14 18"
      stroke="currentColor"
      strokeWidth="2"
      fill="none"
    />
  </svg>
);


export default SealMomentModal;
