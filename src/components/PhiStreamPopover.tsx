// src/components/PhiStreamPopover.tsx
import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import PhiStream from "./SigilExplorer";

type Props = {
  open: boolean;
  onClose: () => void;
};

const hasWindow = typeof window !== "undefined";

export default function PhiStreamPopover({ open, onClose }: Props): React.JSX.Element | null {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const prevActiveRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open || !hasWindow) return;

    prevActiveRef.current = document.activeElement as HTMLElement | null;

    // lock document scroll (belt + suspenders)
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";

    // focus close button
    window.requestAnimationFrame(() => closeRef.current?.focus());

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;

      // restore focus
      prevActiveRef.current?.focus?.();
      prevActiveRef.current = null;
    };
  }, [open, onClose]);

  if (!open || !hasWindow) return null;

  return createPortal(
    <div className="phistream-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="phistream-card"
        role="dialog"
        aria-modal="true"
        aria-label="ΦStream"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          ref={closeRef}
          type="button"
          className="phistream-close"
          onClick={onClose}
          aria-label="Close ΦStream"
          title="Close"
        >
          ×
        </button>

        <div className="phistream-card-inner">
          <PhiStream />
        </div>
      </div>
    </div>,
    document.body,
  );
}
