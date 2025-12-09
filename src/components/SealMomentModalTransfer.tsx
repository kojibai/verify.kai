/* ────────────────────────────────────────────────────────────────
   SealMomentModal.tsx — popover shown after "Seal This Moment"
   v3.2 — Top-layer dialog (works over Verifier dialog)
   - Renders as <dialog> in a portal to document.body
   - Uses showModal()/close(), blocks page scroll & focus
   - Keeps existing Explorer auto-register + share/copy UX
   - Download Bundle button removed (prop preserved; no API break)
────────────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { FC, MouseEventHandler } from "react";
import { createPortal } from "react-dom";
import "./SealMomentModal.css";

/* ── Explorer integration types (safe globals) ─────────────── */
/**
 * IMPORTANT:
 * This must match the existing Window.__SIGIL__ declaration in window.d.ts
 * so TypeScript can merge them without conflict.
 */
declare global {
  interface Window {
    __SIGIL__?: {
      /** Optional global hook the Explorer can provide */
      registerSigilUrl?: ((url: string) => void) | undefined;
      /** Optional hook for send events (kept for parity) */
      registerSend?: ((rec: unknown) => void) | undefined;
    } | undefined;
  }
}

interface Props {
  open: boolean;
  /** Full child-transfer URL (includes amount & nonce in its payload). */
  url: string;
  hash: string;
  onClose: () => void;
  /** Preserved for backward compat; unused now. */
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
    // Notify any listening Explorer instance to refresh
    const evt = new CustomEvent<{ url: string }>("sigil:url-registered", {
      detail: { url },
    });
    window.dispatchEvent(evt);
  } catch {
    // ignore; never let UX fail due to storage
  }
}

const SealMomentModal: FC<Props> = (props) => {
  const { open, url, hash, onClose } = props; // keep props shape; don't use onDownloadZip

  /* refs & state (Hooks must be unconditionally called) */
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const firstFocusRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [toast, setToast] = useState<string>("");

  /* ── ensure each minted URL is registered once ───────── */
  const lastRegisteredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !url) return;
    if (lastRegisteredRef.current === url) return;
    lastRegisteredRef.current = url;

    const usedGlobal =
      typeof window !== "undefined" &&
      window.__SIGIL__ &&
      typeof window.__SIGIL__.registerSigilUrl === "function";

    if (usedGlobal) {
      try {
        window.__SIGIL__!.registerSigilUrl!(url);
      } catch {
        registerLocally(url);
      }
    } else {
      registerLocally(url);
    }
  }, [open, url]);

  /* Mount/unmount + top-layer control */
  useEffect(() => {
    const d = dlgRef.current;
    if (!d) return;

    // Prevent ESC from closing implicitly; we only close via the ✕ button
    const onCancel = (e: Event) => e.preventDefault();
    d.addEventListener("cancel", onCancel);

    if (open) {
      // Memorize focus and block body scroll (native dialog does this visually via ::backdrop)
      previouslyFocusedRef.current = (document.activeElement as HTMLElement) ?? null;
      try {
        if (!d.open) {
          try {
            d.showModal(); // puts dialog in the browser's top layer
          } catch {
            d.show(); // fallback
          }
        }
        d.setAttribute("data-open", "true");
      } catch {
        // ignore
      }

      // Defer focus to our first actionable control
      const t = window.setTimeout(() => firstFocusRef.current?.focus({ preventScroll: true }), 0);
      return () => {
        clearTimeout(t);
        d.removeEventListener("cancel", onCancel);
      };
    } else {
      if (d.open) d.close();
      d.setAttribute("data-open", "false");
      d.removeEventListener("cancel", onCancel);
      // restore focus to where the user was before opening
      previouslyFocusedRef.current?.focus?.();
    }
  }, [open]);

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

  /* (Optional) extra focus trap on Tab — native dialog handles most cases,
     but we keep this to mirror your previous behavior exactly */
  const trapFocus = useCallback((e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
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

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => trapFocus(e);
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, trapFocus]);

  /* utils */
  const announce = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 900);
  };

  const copy = async (t: string, label: string) => {
    try {
      await navigator.clipboard.writeText(t);
      announce(`${label} copied to clipboard`);
    } catch {
      announce(`Could not copy ${label}`);
    }
  };

  const share = async () => {
    try {
      if (canShare && typeof navigator !== "undefined") {
        const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
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

  /* Render only when open to avoid unnecessary DOM */
  return open
    ? createPortal(
        <dialog
          ref={dlgRef}
          className="seal-dialog seal-toplayer glass-modal fullscreen"
          aria-label="Moment Sealed"
          // ensure nothing sneaks over it; the top layer wins, but this helps with custom overlays
          style={{ zIndex: 2147483647, padding: 0, border: "none", background: "transparent" }}
        >
          {/* Optional in-dialog veil to keep your current visual treatment */}
          <div className="seal-veil" aria-hidden="true" />

          <div
            ref={cardRef}
            className="seal-card"
            role="document"
            // keep events inside the card
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
                Your Kairos imprint is preserved. Proceed to the url below to Inhale Claimed Ownership.
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

            {/* url (full child-transfer URL; includes amount) */}
            <label className="field">
              <span className="field-label">URL</span>
              <div className="row">
                <input
                  className="url-input"
                  value={url}
                  readOnly
                  aria-readonly="true"
                  spellCheck={false}
                  dir="ltr"
                  title={url}
                  onFocus={(e) => e.currentTarget.select()}
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
              This moment is now sealed in time. Use the link above within the next 11 breaths to claim ownership & gain
              permanent access to this kairos moment.
            </p>

            {/* live region for copy/share feedback */}
            <div className="sr-only" aria-live="polite" aria-atomic="true">
              {toast}
            </div>
          </div>
        </dialog>,
        document.body
      )
    : null;
};

/* ── decorative icons (inline SVG) ───────────────────────── */
const CloseGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden className="seal-close-ico">
    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.25" opacity=".35" />
    <path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const ShareGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden className="ico">
    <path d="M15 8a3 3 0 100-6 3 3 0 000 6zM6 14a3 3 0 100-6 3 3 0 000 6zm9 12a3 3 0 100-6 3 3 0 000 6z" fill="currentColor" />
    <path d="M8.6 9.7l6.8-3.4M8.6 12.3l6.8 3.4" stroke="currentColor" strokeWidth="2" fill="none" />
  </svg>
);

const CopyGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden className="ico">
    <rect x="9" y="9" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="2" fill="none" />
    <rect x="5" y="5" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="2" fill="none" opacity=".5" />
  </svg>
);

const LinkGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden className="ico">
    <path d="M10 14a5 5 0 007.07 0l1.41-1.41a5 5 0 00-7.07-7.07L10 6" stroke="currentColor" strokeWidth="2" fill="none" />
    <path d="M14 10a5 5 0 00-7.07 0L5.5 11.43a5 5 0 007.07 7.07L14 18" stroke="currentColor" strokeWidth="2" fill="none" />
  </svg>
);

export default SealMomentModal;
