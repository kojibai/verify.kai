// src/components/SovereignDeclarations/SovereignDeclarations.tsx
// Kai Vault Popover — concise + official (icon-only X, Seal Acknowledged)
// ✅ Drop-in: same class names
// ✅ No truncation on small screens (text wraps; CSS will handle visuals next)

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./SovereignDeclarations.css";

function getScrollbarWidth(): number {
  // Safe: only used in effects (client-side)
  return window.innerWidth - document.documentElement.clientWidth;
}

function getFocusable(root: HTMLElement): HTMLElement[] {
  const selectors =
    'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';
  return Array.from(root.querySelectorAll<HTMLElement>(selectors)).filter(
    (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1
  );
}

export default function SovereignDeclarations(): React.JSX.Element {
  const [open, setOpen] = useState(false);

  const panelId = useId();
  const titleId = useId();
  const descId = useId();

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const ctaRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => setOpen(false), []);
  const openVault = useCallback(() => setOpen(true), []);

  const triggerSummary = useMemo(
    () => "Kairos Notes — Legal Tender",
    []
  );

  // Scroll lock + Escape + focus restore + (light) focus trap
  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;

    const sw = getScrollbarWidth();
    document.body.style.overflow = "hidden";
    if (sw > 0) document.body.style.paddingRight = `${sw}px`;

    const activeEl = document.activeElement;
    const prevFocused =
      activeEl instanceof HTMLElement ? activeEl : triggerRef.current;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }

      // Keep focus inside vault while open (no heavy dependency)
      if (e.key === "Tab") {
        const panel = panelRef.current;
        if (!panel) return;

        const focusables = getFocusable(panel);
        if (focusables.length === 0) return;

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const current = document.activeElement as HTMLElement | null;

        if (e.shiftKey) {
          if (!current || current === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (current === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });

    // Prefer focusing the bottom “Seal Acknowledged” (primary action)
    requestAnimationFrame(() => {
      (ctaRef.current ?? closeRef.current)?.focus();
    });

    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });

      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;

      requestAnimationFrame(() => {
        if (prevFocused && "focus" in prevFocused) prevFocused.focus();
        else triggerRef.current?.focus();
      });
    };
  }, [open, close]);

  return (
    <>
      {/* Footer trigger */}
      <div className="nav-foot" aria-label="Sovereign declarations">
        <button
          ref={triggerRef}
          type="button"
          className="nav-foot__toggle"
          onClick={openVault}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={panelId}
        >
         <span className="nav-foot__badge" aria-hidden="true">
  <img
    className="nav-foot__phiLogo"
    src="/phi.svg"
    alt=""
    draggable={false}
  />
</span>


          <span className="nav-foot__main">
            <span className="nav-foot__kicker">SOVEREIGN WRIT</span>
            <span className="nav-foot__summary">{triggerSummary}</span>
          </span>

          <span className="nav-foot__chev" aria-hidden="true">

            <span className="nav-foot__chevIcon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M9 18l6-6-6-6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </span>
        </button>
      </div>

      {/* Vault */}
      {open &&
        createPortal(
          <div
            className="nav-footSheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            id={panelId}
          >
            {/* Backdrop click closes */}
            <button
              type="button"
              className="nav-footSheet__backdrop"
              aria-label="Dismiss"
              onClick={close}
            />

            {/* Panel */}
            <div ref={panelRef} className="nav-footSheet__panel" role="document">
              <div className="nav-footSheet__head">
                <div className="nav-footSheet__titleWrap">
                  <div className="nav-footSheet__title" id={titleId}>
                    <img
  className="nav-footSheet__phiLogo"
  src="/phi.svg"
  alt=""
  aria-hidden="true"
  draggable={false}
/>{" "}
Sovereign Writ

                  </div>

                  <div className="nav-footSheet__sub">
                    Official instrument of value & transfer — Kairos-native, offline-auditable.
                  </div>
                </div>

                {/* Icon-only X (no “Close” text) */}
                <button
                  ref={closeRef}
                  type="button"
                  className="nav-footSheet__close"
                  onClick={close}
                  aria-label="Dismiss"
                  title="Dismiss"
                >
                  <span className="nav-footSheet__closeIcon" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M18 6L6 18"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                      <path
                        d="M6 6L18 18"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                </button>
              </div>

              <div className="nav-footSheet__body" id={descId}>
                <p className="nav-foot__line">
                  <strong>Kairos Notes</strong> are legal tender — sealed by <strong>Proof of Breath™</strong>, pulsed by{" "}
                  <strong>Kai-Signature™</strong>, verifiable offline (Σ → SHA-256(Σ) → Φ).
                </p>

                <p className="nav-foot__line">
                  <strong>Sigil-Glyphs</strong> are origin ΦKey seals for mint, custody, and lawful transfer. Derivatives
                  preserve lineage and remain redeemable by re-inhale.
                </p>

                <div className="nav-footSheet__divider" role="separator" aria-hidden="true" />

                <p className="nav-foot__line nav-foot__line--fine">
                Operational Mandate: readable offline; provable by breath writ; bound to determinate seals.
                </p>
              </div>

              <div className="nav-footSheet__foot">
                <button ref={ctaRef} type="button" className="nav-footSheet__cta" onClick={close}>
                  Seal Acknowledged
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
