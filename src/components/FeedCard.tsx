// src/components/FeedCard.tsx
"use client";

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

/* ─────────────────────────────────────────────────────────────
   KKS-1.0: D/M/Y from μpulses (exact, deterministic)
   dayOfMonth: 1..42
   month:      1..8
   year:       1.. (yearIndex + 1)
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
  return r === 0n ? q : (a >= 0n ? q : q - 1n);
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
  // Bridge pulse -> epoch ms (φ-exact) -> μpulses (φ-exact) to match engine behavior.
  const ms = epochMsFromPulse(pulse); // bigint
  const pμ = microPulsesSinceGenesis(ms); // bigint μpulses

  const dayIdx = floorDivE(pμ, N_DAY_MICRO); // bigint days since genesis (can be negative)

  const monthIdx = floorDivE(dayIdx, BigInt(DAYS_PER_MONTH)); // bigint
  const yearIdx = floorDivE(dayIdx, BigInt(DAYS_PER_YEAR)); // bigint

  const dayOfMonth = toSafeNumber(modE(dayIdx, BigInt(DAYS_PER_MONTH))) + 1; // 1..42
  const month = toSafeNumber(modE(monthIdx, BigInt(MONTHS_PER_YEAR))) + 1; // 1..8
  const year = toSafeNumber(yearIdx); // display year

  return { day: dayOfMonth, month, year };
}

/**
 * Chakra coercion:
 * - KaiSigil’s CHAKRAS map expects "Crown" (not "Krown")
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
  const label = `${pad2(beatZ)}:${pad2(stepZ)}`; // zero-based, two-digit BB:SS
  const d = Math.max(1, Math.floor(day));
  const m = Math.max(1, Math.floor(month));
  const y = Math.floor(year); // year may be <=0 for pre-genesis; keep exact
  const line = `☤Kai:${pulse} • D${d}/M${m}/Y${y}-${label}`;
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

export const FeedCard: React.FC<Props> = ({ url }) => {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1100);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.warn("Remember failed:", e);
    }
  }, [url]);

  const decoded = useMemo(() => decodeSigilUrl(url), [url]);

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
            {decoded.error}
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

  // Single source of truth: derive moment from pulse
  const m = momentFromPulse(pulse);

  const beatRaw = typeof data.beat === "number" && Number.isFinite(data.beat) ? data.beat : m.beat;
  const stepRaw =
    typeof data.stepIndex === "number" && Number.isFinite(data.stepIndex)
      ? data.stepIndex
      : m.stepIndex;

  // INTERNAL chakra value (what KaiSigil expects)
  const chakraDay: ChakraDay = toChakra(data.chakraDay, m.chakraDay);
  // DISPLAY chakra value (what user sees)
  const chakraDayDisplay = chakraDay === "Crown" ? "Krown" : String(chakraDay);

  const beatZ = Math.max(0, Math.floor(beatRaw));
  const stepZ = Math.max(0, Math.floor(stepRaw));

  // ✅ Exact KKS v1.0 D/M/Y (1-based day & month)
  const { day, month, year } = kaiDMYFromPulseKKS(pulse);

  const kind =
    data.kind ??
    (post ? "post" : message ? "message" : share ? "share" : reaction ? "reaction" : "sigil");

  const appBadge = data.appId ? `app ${short(data.appId, 10, 4)}` : undefined;
  const userBadge = data.userId ? `user ${short(String(data.userId), 10, 4)}` : undefined;

  const sigilId = isNonEmpty(capsule.sigilId) ? capsule.sigilId : undefined;
  const phiKey = isNonEmpty(capsule.phiKey) ? capsule.phiKey : undefined;
  const signaturePresent = isNonEmpty(capsule.kaiSignature);
  const verifiedTitle = signaturePresent ? "Signature present (Kai Signature)" : "Unsigned capsule";

  const authorBadge = isNonEmpty(capsule.author) ? capsule.author : undefined;

  const sourceBadge =
    (isNonEmpty(capsule.source) ? capsule.source : undefined) ?? legacySourceFromData(data);

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

  return (
    <article
      className={`fc fc--crystal ${signaturePresent ? "fc--signed" : "fc--unsigned"}`}
      role="article"
      aria-label={`${kind} glyph`}
      data-kind={kind}
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
              <span className="fc-chip fc-chip--kind" title={`Kind: ${kind}-glyph`}>
                {kind.toUpperCase()}
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

              {sourceBadge && (
                <span className="fc-chip fc-chip--source" title="Source">
                  {String(sourceBadge).toUpperCase()}
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
              {isNonEmpty(post.title) && <h3 className="fc-title">{post.title}</h3>}
              {isNonEmpty(post.text) && <p className="fc-body">{post.text}</p>}

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
              {isNonEmpty(message.text) && <p className="fc-body">{message.text}</p>}
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
              {isNonEmpty(share.note) && <p className="fc-body">{share.note}</p>}
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
              <h3 className="fc-title">Proof Of Breath™</h3>
              <a className="fc-link" href={url} target="_blank" rel="noreferrer" title={url}>
                {hostOf(url) ?? url}
              </a>
            </section>
          )}

          <footer className="fc-actions" role="group" aria-label="Actions">
            <a className="fc-btn" href={url} target="_blank" rel="noreferrer" title="Open original sigil">
              ↗ Sigil-Glyph
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
