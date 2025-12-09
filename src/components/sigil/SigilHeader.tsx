// src/components/sigil/SigilHeader.tsx
import { useEffect } from "react";
import type { MouseEvent, PointerEvent } from "react";

type Press = {
  onPointerUp: (e: PointerEvent<HTMLButtonElement>) => void;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
};

export type SigilHeaderProps = {
  /** Authenticity of the glyph hash vs route hash */
  glyphAuth: "checking" | "authentic" | "forged";
  /** Whether the current transfer link is active or has been archived (burned) */
  linkStatus: "checking" | "active" | "archived";
  /** Convenience boolean for rendering the status chip */
  isArchived: boolean;
  /** Current live (local) glyph hash, used for tooltip on the badge */
  localHash: string;
  /** Pre-wired press handlers for copying the hash */
  copyHashPress: Press;
};

export default function SigilHeader(props: SigilHeaderProps) {
  // Inject once: AUTHENTIC (neon/metal) + ACTIVE/ARCHIVED link badges
  useEffect(() => {
    const id = "sigilheader-authbadgefx-v3";
    if (document.getElementById(id)) return;

    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      /* Shared tokens; Chakra accent flows from page */
      .sp-header .auth-badge,
      .sp-header .link-badge {
        --accent: var(--crystal-accent, #00FFD0);
        -webkit-tap-highlight-color: transparent;
        user-select: none;
        will-change: transform, box-shadow, filter, background;
      }

      /* ───────────────── AUTHENTIC (metal + neon-green) ───────────────── */
      .sp-header .auth-badge {
        --neon: #39FF88; /* neon green text core */
        --ink: #eafcff;
        --halo: color-mix(in oklab, var(--accent) 55%, transparent);
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 44px;
        padding: 10px 16px;
        border-radius: 999px;
        font-weight: 900;
        letter-spacing: .02em;
        line-height: 1;
        cursor: pointer;
        border: 1px solid rgba(255,255,255,.14);
        background:
          linear-gradient(180deg, rgba(255,255,255,.14), rgba(255,255,255,.06)),
          radial-gradient(120% 160% at 50% -30%, color-mix(in oklab, var(--accent) 14%, transparent), transparent);
        box-shadow:
          0 1px 0 rgba(255,255,255,.08) inset,
          0 -1px 0 rgba(0,0,0,.5) inset,
          0 10px 30px rgba(0,0,0,.35);
        color: var(--ink);
        text-shadow: 0 1px 0 rgba(0,0,0,.45);
        overflow: hidden;
        isolation: isolate;
      }

      .sp-header .auth-badge.auth-badge--ok.is-live {
        /* metallic body with accent tint responding to pointer --x/--y */
        background:
          radial-gradient(140% 140% at var(--x, 50%) var(--y, 25%),
            color-mix(in oklab, var(--accent) 12%, #0c1413) 0%,
            rgba(12,20,19,.75) 45%,
            rgba(12,20,19,.45) 70%,
            rgba(12,20,19,.18) 100%),
          linear-gradient(180deg, rgba(255,255,255,.14), rgba(255,255,255,.06));
        border: 1px solid color-mix(in oklab, var(--accent) 48%, rgba(255,255,255,.16));
        box-shadow:
          0 0 0 1px color-mix(in oklab, var(--accent) 36%, transparent) inset,
          0 10px 30px rgba(0,0,0,.4),
          0 0 36px color-mix(in oklab, var(--accent) 30%, transparent);
        color: var(--neon);
        -webkit-text-stroke: .35px color-mix(in oklab, var(--accent) 35%, black);
        text-shadow:
          0 0 10px color-mix(in oklab, var(--neon) 75%, var(--accent) 25%),
          0 0 28px color-mix(in oklab, var(--accent) 40%, transparent);
        animation: badge-breathe 5.236s ease-in-out infinite;
      }

      .sp-header .auth-badge.auth-badge--ok.is-live::before {
        content: "";
        position: absolute;
        inset: 1px;
        border-radius: inherit;
        pointer-events: none;
        background:
          linear-gradient(180deg, rgba(255,255,255,.26), rgba(255,255,255,0)) top/100% 54% no-repeat,
          repeating-linear-gradient(
            115deg,
            rgba(255,255,255,.06) 0 1px,
            rgba(255,255,255,.02) 1px 3px
          );
        mix-blend-mode: screen;
        opacity: .65;
      }

      .sp-header .auth-badge.auth-badge--ok.is-live::after {
        content: "";
        position: absolute;
        inset: -120%;
        pointer-events: none;
        border-radius: 999px;
        background:
          conic-gradient(from var(--angle, 0deg),
            transparent 0deg,
            color-mix(in oklab, var(--halo) 95%, white 0%) 24deg,
            transparent 48deg);
        filter: blur(16px) saturate(1.12) drop-shadow(0 0 10px var(--halo));
        opacity: .6;
        animation: badge-orbit 5.236s linear infinite;
      }

      .sp-header .auth-badge.auth-badge--checking {
        color: #bfe3ff;
        border-color: rgba(126,167,255,.35);
        box-shadow: 0 0 22px rgba(126,167,255,.14);
      }

      .sp-header .auth-badge.auth-badge--bad {
        color: #ffd0d0;
        border-color: rgba(255,86,86,.5);
        box-shadow:
          0 0 0 1px rgba(255,86,86,.35) inset,
          0 0 28px rgba(255,86,86,.18);
        text-shadow: 0 0 10px rgba(255,86,86,.35);
      }

      .sp-header .auth-badge:active { transform: translateY(1px) scale(.992); filter: brightness(.98); }

      @keyframes badge-orbit {
        0%   { --angle: 0deg;   opacity:.45; }
        50%  { --angle: 180deg; opacity:.78; }
        100% { --angle: 360deg; opacity:.45; }
      }
      @keyframes badge-breathe {
        0%   { box-shadow:
                 0 0 0 1px color-mix(in oklab, var(--accent) 22%, transparent) inset,
                 0 10px 30px rgba(0,0,0,.38),
                 0 0 20px color-mix(in oklab, var(--accent) 18%, transparent);
               transform: translateZ(0) scale(1); }
        50%  { box-shadow:
                 0 0 0 1px color-mix(in oklab, var(--accent) 42%, transparent) inset,
                 0 12px 36px rgba(0,0,0,.42),
                 0 0 40px color-mix(in oklab, var(--accent) 32%, transparent);
               transform: translateZ(0) scale(1.012); }
        100% { box-shadow:
                 0 0 0 1px color-mix(in oklab, var(--accent) 22%, transparent) inset,
                 0 10px 30px rgba(0,0,0,.38),
                 0 0 20px color-mix(in oklab, var(--accent) 18%, transparent);
               transform: translateZ(0) scale(1); }
      }

      /* ───────────────── LINK STATUS BADGE (ACTIVE / ARCHIVED) ───────────────── */
      .sp-header .link-badge {
        --accent: var(--crystal-accent, #00FFD0);
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        min-height: 38px;
        border-radius: 999px;
        font-weight: 800;
        font-size: .9rem;
        overflow: hidden;
        isolation: isolate;
        border: 1px solid rgba(255,255,255,.18);
        box-shadow: 0 10px 24px rgba(0,0,0,.35);
      }

      /* ACTIVE — luminous emerald ribbon with scanning sheen */
      .sp-header .link-badge.link-badge--active {
        color: #e9fff4;
        background:
          linear-gradient(180deg, rgba(255,255,255,.14), rgba(255,255,255,.06)),
          radial-gradient(140% 160% at 50% -30%, color-mix(in oklab, var(--accent) 20%, #1a2a22), #0d1713);
        border-color: color-mix(in oklab, var(--accent) 55%, rgba(255,255,255,.18));
        box-shadow:
          0 0 0 1px color-mix(in oklab, var(--accent) 35%, transparent) inset,
          0 0 26px color-mix(in oklab, var(--accent) 32%, transparent),
          0 10px 28px rgba(0,0,0,.40);
      }
      .sp-header .link-badge.link-badge--active::before {
        /* top gloss */
        content:"";
        position:absolute; inset:1px 1px 40% 1px;
        border-radius:inherit;
        background: linear-gradient(180deg, rgba(255,255,255,.28), rgba(255,255,255,0));
        mix-blend-mode: screen;
        pointer-events:none;
      }
      .sp-header .link-badge.link-badge--active::after {
        /* scanning shimmer — synced to Kai breath (5.236s) */
        content:"";
        position:absolute; inset:-20%;
        background:
          linear-gradient(115deg,
            transparent 35%,
            rgba(255,255,255,.22) 45%,
            rgba(255,255,255,.06) 55%,
            transparent 65%);
        transform: translateX(-40%);
        animation: active-sheen 5.236s ease-in-out infinite;
        mix-blend-mode: screen;
        pointer-events:none;
      }
      @keyframes active-sheen {
        0%   { transform: translateX(-45%); opacity:.65; }
        50%  { transform: translateX(0%);   opacity:.85; }
        100% { transform: translateX(45%);  opacity:.65; }
      }

      /* ARCHIVED — tempered amber/iron */
      .sp-header .link-badge.link-badge--archived {
        color: #ffe6c7;
        background:
          linear-gradient(180deg, rgba(255,255,255,.10), rgba(255,255,255,.03)),
          radial-gradient(120% 160% at 50% -20%, rgba(255,170,64,.22), rgba(32,24,12,.6));
        border-color: rgba(255,170,64,.42);
        box-shadow:
          0 0 0 1px rgba(255,170,64,.22) inset,
          0 8px 22px rgba(0,0,0,.35);
      }

      /* Press feedback for link badge */
      .sp-header .link-badge:active { transform: translateY(1px) scale(.992); }

      /* Reduced motion */
      @media (prefers-reduced-motion: reduce) {
        .sp-header .auth-badge.auth-badge--ok.is-live { animation: none; }
        .sp-header .auth-badge.auth-badge--ok.is-live::after { animation: none; opacity: .5; }
        .sp-header .link-badge.link-badge--active::after { animation: none; opacity: .6; }
      }
    `;
    document.head.appendChild(style);
  }, []);

  // Authenticity badge classes + label
  const authClass =
    props.glyphAuth === "authentic"
      ? "auth-badge--ok"
      : props.glyphAuth === "forged"
      ? "auth-badge--bad"
      : "auth-badge--checking";

  const authLabel =
    props.glyphAuth === "authentic"
      ? "SOVEREIGN"
      : props.glyphAuth === "forged"
      ? "HASH MISMATCH"
      : "VERIFYING…";

  // Pointer-reactive highlight (sets CSS vars --x/--y on the badge)
  const onBadgePointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const t = e.currentTarget;
    const r = t.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    t.style.setProperty("--x", `${x}px`);
    t.style.setProperty("--y", `${y}px`);
  };

  const live = props.glyphAuth === "authentic";
  const linkActive = props.linkStatus !== "checking" && !props.isArchived;

  return (
    <header className="sp-header" aria-describedby="sp-sub">
      <div className="sp-kicker">Sovereign Harmonik Kingdom</div>

      <h1 className="sp-title">
        Kairos Sigil-Glyph
        <span className="sp-title-glow" aria-hidden />
      </h1>

      <p id="sp-sub" className="sp-sub">
        Inhale • Remember • Verify • Exhale
      </p>

      {/* Glyph Authenticity & Link Status */}
      <div
        className="sp-auth"
        role="status"
        aria-live="polite"
        style={{ display: "flex", gap: 8, justifyContent: "center" }}
      >
        <button
          className={`auth-badge ${authClass} ${live ? "is-live" : ""}`}
          title={props.localHash || ""}
          aria-label={authLabel}
          onPointerMove={live ? onBadgePointerMove : undefined}
          {...props.copyHashPress}
        >
          {/* Shield mark (inline) */}
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            aria-hidden="true"
            style={{ marginRight: 6 }}
          >
            <path
              fill="currentColor"
              d="M12 2.5 4 6v6.6c0 4.3 3.2 8.5 8 8.9c4.8-.4 8-4.6 8-8.9V6l-8-3.5Zm3.7 7.2l-4.4 5c-.3.3-.7.3-1 0l-1.9-2a.75.75 0 1 1 1.1-1l1.4 1.4 3.9-4.4a.75.75 0 0 1 1 .1c.3.3.3.7 0 1Z"
            />
          </svg>
          {authLabel}
        </button>

        {props.linkStatus !== "checking" && (
          <span
            className={`link-badge ${
              props.isArchived ? "link-badge--archived" : "link-badge--active"
            }`}
            aria-label={`Link status: ${props.isArchived ? "Archived" : "Active"}`}
            title={props.isArchived ? "Transfer burned" : "Transfer link is active"}
          >
            {/* Icon varies by state */}
            {linkActive ? (
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                {/* chain/link icon */}
                <path
                  fill="currentColor"
                  d="M9.6 13.8a4 4 0 0 0 0-5.6l-1.1-1.1a4 4 0 0 0-5.6 5.6l1.1 1.1a1 1 0 0 0 1.4-1.4L4.3 11.3a2 2 0 0 1 2.8-2.8l1.1 1.1a2 2 0 0 1 0 2.8a1 1 0 1 0 1.4 1.4ZM20.1 7.3l-1.1-1.1a4 4 0 0 0-5.6 0L11.6 8a4 4 0 0 0 0 5.6l1.1 1.1a1 1 0 0 0 1.4-1.4L13 12.2a2 2 0 0 1 0-2.8l1.8-1.8a2 2 0 0 1 2.8 0l1.1 1.1a1 1 0 1 0 1.4-1.4Z"
                />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                {/* lock icon */}
                <path
                  fill="currentColor"
                  d="M12 1.75a4.75 4.75 0 0 1 4.75 4.75v2h.75A2.5 2.5 0 0 1 20 11v7.5A2.5 2.5 0 0 1 17.5 21h-11A2.5 2.5 0 0 1 4 18.5V11a2.5 2.5 0 0 1 2.5-2.5h.75v-2A4.75 4.75 0 0 1 12 1.75Zm0 1.5A3.25 3.25 0 0 0 8.75 6.5v2h6.5v-2A3.25 3.25 0 0 0 12 3.25Z"
                />
              </svg>
            )}
            {props.isArchived ? "RETIRED" : "IMMANENT"}
          </span>
        )}
      </div>
    </header>
  );
}
