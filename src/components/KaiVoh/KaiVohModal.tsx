// src/components/KaiVoh/KaiVohModal.tsx
"use client";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import "./styles/KaiVohModal.css";
import KaiVohBoundary from "./KaiVohBoundary";
import { SigilAuthProvider } from "./SigilAuthProvider";
import { useSigilAuth } from "./useSigilAuth";

/** Lazy chunks */
const KaiVohApp = lazy(() => import("./KaiVohApp"));
const KaiRealmsApp = lazy(() => import("../KaiRealms")); // default export with optional onClose

type ViewMode = "voh" | "realms";

interface KaiVohModalProps {
  open: boolean;
  onClose: () => void;
}

/** Golden constants for inline SVG ratios (used by CSS too) */
const PHI = (1 + Math.sqrt(5)) / 2;
const BREATH_SEC = 5.236;

/** Hoisted (no nested components in render) */
const SPIRAL_W = 610;
const SPIRAL_H = 377;

function SpiralSVG({ className }: { className?: string }) {
  const gradientId = useId();
  return (
    <svg
      className={className}
      width={SPIRAL_W}
      height={SPIRAL_H}
      viewBox={`0 0 ${SPIRAL_W} ${SPIRAL_H}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.0" />
          <stop offset="40%" stopColor="currentColor" stopOpacity="0.5" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <g fill="none" stroke={`url(#${gradientId})`} strokeWidth="2">
        <path d="M377 0 A377 377 0 0 1 0 377" />
        <path d="M233 0 A233 233 0 0 1 0 233" />
        <path d="M144 0 A144 144 0 0 1 0 144" />
        <path d="M89 0 A89 89 0 0 1 0 89" />
        <path d="M55 0 A55 55 0 0 1 0 55" />
        <path d="M34 0 A34 34 0 0 1 0 34" />
        <path d="M21 0 A21 21 0 0 1 0 21" />
      </g>
    </svg>
  );
}

function SealEmblem({ className }: { className?: string }) {
  return (
    <div className={`seal-emblem ${className ?? ""}`} aria-hidden="true">
      <div className="seal-ring seal-ring--outer" />
      <div className="seal-ring seal-ring--inner" />
      <div className="seal-core" />
    </div>
  );
}

/** Uses SigilAuth context so the import is real + useful (fixes unused-vars). */
function SigilAuthPill({ className }: { className?: string }) {
  const { auth } = useSigilAuth();
  const meta = auth.meta;
  if (!meta) return null;

  const titleParts: string[] = [
    `Pulse: ${meta.pulse}`,
    `Beat: ${meta.beat}`,
    `Step: ${meta.stepIndex}`,
    `Day: ${meta.chakraDay}`,
  ];
  if (meta.sigilId) titleParts.push(`Sigil: ${meta.sigilId}`);
  if (meta.userPhiKey) titleParts.push(`PhiKey: ${meta.userPhiKey}`);

  return (
    <div
      className={`sigil-auth-pill ${className ?? ""}`}
      role="status"
      aria-live="polite"
      title={titleParts.join(" • ")}
      style={{
        maxWidth: "100%",
        overflowX: "auto",
        whiteSpace: "nowrap",
      }}
    >
      <span className="sigil-auth-pill__dot" aria-hidden="true" />
      <span className="sigil-auth-pill__text mono">
        Sealed • {meta.pulse} • {meta.chakraDay}
        {meta.sigilId ? ` • ${meta.sigilId}` : ""}
      </span>
    </div>
  );
}

export default function KaiVohModal({ open, onClose }: KaiVohModalProps) {
  // Hooks MUST run unconditionally (rules-of-hooks)
  const firstFocusableRef = useRef<HTMLButtonElement | null>(null);

  const [view, setView] = useState<ViewMode>("voh");
  const [realmsMounted, setRealmsMounted] = useState(false);

  const switchTo = useCallback(
    (next: ViewMode): void => {
      if (next === "realms" && !realmsMounted) setRealmsMounted(true);
      setView(next);
    },
    [realmsMounted]
  );

  // Side-effects only when open (but effect itself is unconditional)
  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    const prevDocOverscroll = document.documentElement.style.getPropertyValue("overscroll-behavior");
    const prevBodyOverscroll = document.body.style.getPropertyValue("overscroll-behavior");
    const prevBreath = document.documentElement.style.getPropertyValue("--kai-breath");
    const prevPhi = document.documentElement.style.getPropertyValue("--kai-phi");

    document.body.style.overflow = "hidden";
    document.documentElement.style.setProperty("overscroll-behavior", "contain");
    document.body.style.setProperty("overscroll-behavior", "contain");

    // set CSS custom props globally for timing/phi
    document.documentElement.style.setProperty("--kai-breath", `${BREATH_SEC}s`);
    document.documentElement.style.setProperty("--kai-phi", `${PHI}`);

    // focus first interactive (if present)
    firstFocusableRef.current?.focus();

    return () => {
      document.body.style.overflow = prevOverflow;

      // restore prior values (avoid leaking globals across app)
      if (prevDocOverscroll)
        document.documentElement.style.setProperty("overscroll-behavior", prevDocOverscroll);
      else document.documentElement.style.removeProperty("overscroll-behavior");

      if (prevBodyOverscroll) document.body.style.setProperty("overscroll-behavior", prevBodyOverscroll);
      else document.body.style.removeProperty("overscroll-behavior");

      if (prevBreath) document.documentElement.style.setProperty("--kai-breath", prevBreath);
      else document.documentElement.style.removeProperty("--kai-breath");

      if (prevPhi) document.documentElement.style.setProperty("--kai-phi", prevPhi);
      else document.documentElement.style.removeProperty("--kai-phi");
    };
  }, [open, onClose]);

  // Close button handlers
  const handleClosePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>): void => {
      e.stopPropagation();
      onClose();
    },
    [onClose]
  );

  const handleCloseKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    },
    [onClose]
  );

  // After hooks are declared, it's safe to early-return
  if (!open) return null;

  const node = (
    <div
      className="kai-voh-modal-backdrop atlantean-veil"
      role="dialog"
      aria-modal="true"
      aria-labelledby="kaivoh-title"
      data-view={view}
    >
      {/* Dim stars + parallax halos */}
      <div className="atlantean-stars" aria-hidden="true" />
      <div className="atlantean-halo atlantean-halo--1" aria-hidden="true" />
      <div className="atlantean-halo atlantean-halo--2" aria-hidden="true" />

      <div className="kai-voh-container kai-pulse-border glass-omni" role="document">
        {/* Sacred border rings + phi grid */}
        <div className="breath-ring breath-ring--outer" aria-hidden="true" />
        <div className="breath-ring breath-ring--inner" aria-hidden="true" />
        <div className="phi-grid" aria-hidden="true" />

        {/* Corner spirals */}
        <SpiralSVG className="phi-spiral phi-spiral--tl" />
        <SpiralSVG className="phi-spiral phi-spiral--br" />

        <SigilAuthProvider>
          {/* Close (hidden while in Realms to avoid double-X on mobile) */}
          {view !== "realms" && (
            <button
              ref={firstFocusableRef}
              type="button"
              className="kai-voh-close auric-btn"
              aria-label="Close portal"
              onPointerDown={handleClosePointerDown}
              onKeyDown={handleCloseKeyDown}
            >
              <X size={22} aria-hidden="true" />
            </button>
          )}

          {/* Top-center orb (hide in Realms to avoid double orb) */}
          {view !== "realms" && (
            <div className="voh-top-orb" aria-hidden="true">
              <SealEmblem />
            </div>
          )}

          {/* Tab bar */}
          <div className="kai-voh-tabbar" role="tablist" aria-label="Kai portal views">
            <button
              type="button"
              role="tab"
              aria-selected={view === "voh"}
              className={`kai-voh-tab auric-tab ${view === "voh" ? "active" : ""}`}
              onClick={() => switchTo("voh")}
            >
              <span className="tab-glyph" aria-hidden="true">
                🜂
              </span>{" "}
              Voh
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={view === "realms"}
              className={`kai-voh-tab auric-tab ${view === "realms" ? "active" : ""}`}
              onClick={() => switchTo("realms")}
            >
              <span className="tab-glyph" aria-hidden="true">
                ⚚
              </span>{" "}
              Realms
            </button>

            {/* Breath progress (phi-timed) */}
            <div className="breath-meter" aria-hidden="true">
              <div className="breath-meter__dot" />
            </div>

            {/* Optional auth indicator (uses hook, no truncation; scrolls if long) */}
            <SigilAuthPill className="sigil-auth-pill--tabbar" />
          </div>

          {/* Body */}
          <div className="kai-voh-body">
            <h2 id="kaivoh-title" className="sr-only">
              Kai Portal
            </h2>

            <KaiVohBoundary>
              <section
                className="portal-pane"
                style={{ display: view === "voh" ? "block" : "none" }}
                aria-hidden={view !== "voh"}
              >
                <Suspense
                  fallback={
                    <div className="kai-voh-center">
                      <div className="kai-voh-spinner" />
                      <div>Summoning Voh…</div>
                    </div>
                  }
                >
                  <KaiVohApp />
                </Suspense>
              </section>

              <section
                className="portal-pane"
                style={{ display: view === "realms" ? "block" : "none" }}
                aria-hidden={view !== "realms"}
              >
                {realmsMounted ? (
                  <Suspense
                    fallback={
                      <div className="kai-voh-center">
                        <div className="kai-voh-spinner" />
                        <div>Opening Kai Realms…</div>
                      </div>
                    }
                  >
                    <KaiRealmsApp onClose={() => switchTo("voh")} />
                  </Suspense>
                ) : null}
              </section>
            </KaiVohBoundary>
          </div>
        </SigilAuthProvider>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
