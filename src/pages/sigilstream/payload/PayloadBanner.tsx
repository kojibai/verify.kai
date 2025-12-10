// src/pages/sigilstream/payload/PayloadBanner.tsx
"use client";

import type React from "react";
import { useState } from "react";
import type { FeedPostPayload } from "../../../utils/feedPayload";
import type { KaiMomentStrict } from "../core/types";
import { pad2 } from "../core/utils";
import { expandShortAliasToCanonical } from "../core/alias";
import { useToasts } from "../data/toast/toast";

import { AttachmentGallery } from "../attachments/gallery";
import type { AttachmentManifest } from "../attachments/types";

type Props = {
  payload: FeedPostPayload | null;
  payloadKai: KaiMomentStrict | null;
  payloadAttachments: AttachmentManifest | null;
  payloadError: string | null;
};

/** Type guard for optional `sigilId` without using `any`. */
function hasSigilId(
  p: FeedPostPayload,
): p is FeedPostPayload & { sigilId: string } {
  const r = p as unknown as Record<string, unknown>;
  return typeof r.sigilId === "string";
}

/** Build human label for Kai moment */
function kaiLabel(k: KaiMomentStrict): string {
  return `Kairos ${k.beat}:${pad2(k.stepIndex)} — ${k.weekday} • ${k.chakraDay}`;
}

/** Map/pretty-print a source tag */
function prettySource(src: string | undefined): string {
  if (!src) return "Manual";
  const s = String(src).toLowerCase();
  if (s === "x") return "From X";
  if (s === "manual") return "Manual";
  return s.slice(0, 1).toUpperCase() + s.slice(1);
}

/**
 * PayloadBanner
 * - Shows source/author/ids
 * - Displays pulse + Kai label
 * - "Kopy current" button (canonicalizes short alias → /stream/p/<token>)
 * - Renders attachments when present
 * - Shows error when payloadError is set (and payload is null)
 */
export function PayloadBanner({
  payload,
  payloadKai,
  payloadAttachments,
  payloadError,
}: Props): React.JSX.Element | null {
  const toasts = useToasts();
  const [copied, setCopied] = useState(false);

  if (payloadError && !payload) {
    return (
      <div className="sf-error" role="alert">
        {payloadError}
      </div>
    );
  }
  if (!payload) return null;

  // Plain (non-hook) computations to avoid conditional hook warnings.
  const srcLabel = prettySource(payload.source);
  const kaiText = payloadKai ? kaiLabel(payloadKai) : null;

  return (
    <div className="sf-payload" role="region" aria-label="Current payload">
      {/* Pills row */}
      <div
        className="sf-payload-line"
        style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
      >
        <span className="sf-pill sf-pill--source">{srcLabel}</span>
        {payload.author && (
          <span className="sf-pill sf-pill--author">{payload.author}</span>
        )}
        {hasSigilId(payload) && (
          <span className="sf-pill sf-pill--sigil">Sigil-Glyph {payload.sigilId}</span>
        )}
        {payload.phiKey && (
          <span className="sf-pill sf-pill--phikey">ΦKey {payload.phiKey}</span>
        )}
      </div>

      {/* Core row: pulse + Kai label + optional caption */}
      <div
        className="sf-payload-core"
        style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
      >
        <strong>Pulse</strong>&nbsp;{payload.pulse}
        {kaiText && <span className="sf-kai-label"> • {kaiText}</span>}
        {payload.caption && (
          <span className="sf-caption"> — “{payload.caption}”</span>
        )}
      </div>

      {/* Kopy current canonical link */}
      <div style={{ marginTop: ".5rem", display: "flex", gap: ".5rem" }}>
        <button
          className="sf-btn"
          onClick={async () => {
            try {
              const url =
                typeof window !== "undefined" ? window.location.href : "";
              const canonical = expandShortAliasToCanonical(url);
              await navigator.clipboard.writeText(canonical);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
              toasts.push("success", "Link remembered.");
            } catch {
              toasts.push("warn", "Copy failed. Select the address bar.");
            }
          }}
        >
          {copied ? "Remembered" : "Remember"}
        </button>
      </div>

      {/* Attachments (existing, from payload) */}
      {payloadAttachments && <AttachmentGallery manifest={payloadAttachments} />}
    </div>
  );
}

export default PayloadBanner;
