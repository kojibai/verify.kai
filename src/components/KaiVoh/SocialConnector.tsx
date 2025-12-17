"use client";

/**
 * SocialConnector — Kai-Sigil Proof Share Hub
 * v1.3 — Crash-proof + Atlantean UI + stable Hooks
 *
 * - Accepts a sealed media payload (glyph / video / text) + Kai-Sigil metadata.
 * - Builds a canonical proof caption (Φ-Key, Kai Signature, Pulse, Chakra Day, Verifier URL).
 * - Supports:
 *    • System share (best on mobile; tries file share, then text-only)
 *    • Direct share intents: X, LinkedIn, Facebook
 *    • App-first flows: Instagram, TikTok (download + caption copy + open app)
 *    • Copy caption with proof
 *    • Copy proof JSON
 *    • Download sealed glyph/media
 *
 * - Safe if media is null: shows a “seal first” state instead of throwing.
 * - All Hooks (useState/useMemo) are called unconditionally, before any early return.
 *
 * IMPORTANT:
 * - To satisfy eslint(react-refresh/only-export-components),
 *   this file exports ONLY the React component (default export).
 * - Shared types/helpers live in SocialConnector.shared.ts
 */

import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import "./styles/SocialConnector.css";

import { buildProofCaption, buildProofJson } from "./SocialConnector.shared";
import type {
  SocialConnectorProps,
  SocialPlatform,
} from "./SocialConnector.shared";

/* -------------------------------------------------------------------------- */
/*                            Internal Utility Fns                            */
/* -------------------------------------------------------------------------- */

async function copyToClipboard(text: string): Promise<void> {
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    await navigator.clipboard.writeText(text);
    return;
  }

  // Fallback: old-school textarea trick
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Build share URLs for intent-based platforms.
 * Note: Instagram & TikTok don’t expose stable URL-based share intents for all contexts,
 * so we treat them differently (system-share + copy-caption + download).
 */
function buildShareUrl(
  platform: SocialPlatform,
  caption: string,
  verifierUrl?: string,
): string | null {
  const encodedCaption = encodeURIComponent(caption);
  const encodedUrl = verifierUrl ? encodeURIComponent(verifierUrl) : "";

  switch (platform) {
    case "x":
      return `https://twitter.com/intent/tweet?text=${encodedCaption}`;
    case "linkedin": {
      if (encodedUrl) {
        return `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`;
      }
      return `https://www.linkedin.com/feed/?shareActive=true&text=${encodedCaption}`;
    }
    case "facebook": {
      if (encodedUrl) {
        return `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
      }
      return `https://www.facebook.com/dialog/share?display=popup&quote=${encodedCaption}`;
    }
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/*                            SocialConnector UI                              */
/* -------------------------------------------------------------------------- */

export default function SocialConnector({
  media,
  suggestedCaption,
  verifierUrl,
  onShared,
  onError,
}: SocialConnectorProps): ReactElement {
  const [status, setStatus] = useState<string | null>(null);

  // Safely unwrap metadata even when media is null (Hooks must always run)
  const {
    kaiSignature,
    phiKey,
    pulse,
    chakraDay,
    verifierUrl: metaVerifierUrl,
  } = media?.metadata ?? {};

  const effectiveVerifierUrl = verifierUrl ?? metaVerifierUrl ?? undefined;

  const proofCaption = useMemo(
    () =>
      buildProofCaption({
        baseCaption: suggestedCaption,
        kaiSignature,
        phiKey,
        pulse,
        chakraDay,
        verifierUrl: effectiveVerifierUrl,
      }),
    [
      suggestedCaption,
      kaiSignature,
      phiKey,
      pulse,
      chakraDay,
      effectiveVerifierUrl,
    ],
  );

  const proofBlobJson = useMemo(
    () =>
      buildProofJson({
        phiKey,
        kaiSignature,
        pulse,
        chakraDay,
        verifierUrl: effectiveVerifierUrl,
      }),
    [phiKey, kaiSignature, pulse, chakraDay, effectiveVerifierUrl],
  );

  const canUseWebShare =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function";

  const handleError = (platform: SocialPlatform, error: unknown): void => {
    const err =
      error instanceof Error
        ? error
        : new Error(String(error ?? "Unknown error"));
    if (onError) onError(platform, err);
    setStatus(err.message);
  };

  const handleShared = (platform: SocialPlatform): void => {
    if (onShared) onShared(platform);
  };

  const handleShare = async (platform: SocialPlatform): Promise<void> => {
    // Extra guard: if something somehow calls this without media, don’t crash.
    if (!media) {
      setStatus(
        "No sealed media detected for this pulse yet. Complete Seal & Embed first.",
      );
      return;
    }

    try {
      setStatus(null);

      if (platform === "copy-caption") {
        await copyToClipboard(proofCaption);
        setStatus("Caption copied to clipboard. Paste into your post.");
        handleShared(platform);
        return;
      }

      if (platform === "copy-proof") {
        await copyToClipboard(proofBlobJson);
        setStatus("Proof JSON copied. Save it with your post or dev tools.");
        handleShared(platform);
        return;
      }

      if (platform === "download") {
        triggerDownload(media.content, media.filename);
        setStatus("Sealed glyph downloaded.");
        handleShared(platform);
        return;
      }

      if (platform === "system-share") {
        if (!canUseWebShare) {
          await copyToClipboard(proofCaption);
          setStatus(
            "System share unavailable; caption copied. Open your app and paste.",
          );
          handleShared(platform);
          return;
        }

        const navWithMaybeCanShare = navigator as Navigator & {
          canShare?: (data?: ShareData) => boolean;
        };

        const baseShareData: ShareData = {
          text: proofCaption,
        };

        // Try file-sharing if supported (Web Share Level 2)
        if (typeof navWithMaybeCanShare.canShare === "function") {
          try {
            const fileType =
              media.type === "image"
                ? "image/svg+xml"
                : media.type === "video"
                ? "video/mp4"
                : "text/plain";

            const file = new File([media.content], media.filename, {
              type: fileType,
            });

            const shareWithFiles: ShareData = {
              ...baseShareData,
              files: [file],
            };

            if (navWithMaybeCanShare.canShare(shareWithFiles)) {
              await navigator.share(shareWithFiles);
              setStatus("Shared via system sheet with media.");
              handleShared(platform);
              return;
            }
          } catch {
            // If File construction or canShare fails, fall back to text-only share.
          }
        }

        await navigator.share(baseShareData);
        setStatus("Shared via system sheet.");
        handleShared(platform);
        return;
      }

      // Intent-based platforms
      if (platform === "x" || platform === "linkedin" || platform === "facebook") {
        const url = buildShareUrl(platform, proofCaption, effectiveVerifierUrl);
        if (!url) {
          await copyToClipboard(proofCaption);
          setStatus(
            "Unable to open share URL; caption copied instead. Paste into your post.",
          );
          handleShared(platform);
          return;
        }

        window.open(url, "_blank", "noopener,noreferrer");
        await copyToClipboard(proofCaption);
        setStatus(
          "Opened share composer and copied caption. Paste if not auto-filled.",
        );
        handleShared(platform);
        return;
      }

      if (platform === "instagram" || platform === "tiktok") {
        // App-first flows:
        // 1. Download media (camera roll / files).
        // 2. Copy caption.
        // 3. Open app homepage; user taps + and selects saved media.
        triggerDownload(media.content, media.filename);
        await copyToClipboard(proofCaption);

        const url =
          platform === "instagram"
            ? "https://www.instagram.com/"
            : "https://www.tiktok.com/upload";

        window.open(url, "_blank", "noopener,noreferrer");
        setStatus(
          `Downloaded glyph and copied caption. Opened ${platform} — create a new memory, pick the image, and paste the caption.`,
        );
        handleShared(platform);
        return;
      }

      // Fallback: copy caption only
      await copyToClipboard(proofCaption);
      setStatus("Caption copied. Paste into your social app.");
      handleShared(platform);
    } catch (error) {
      handleError(platform, error);
    }
  };

  /* ------------------------------------------------------------------------ */
  /*                                 RENDER                                   */
  /* ------------------------------------------------------------------------ */

  // If Connect Accounts was clicked before a glyph is sealed+embedded,
  // render a gentle “seal first” message instead of crashing.
  if (!media) {
    return (
      <section className="kv-social-connector">
        <header className="kv-social-header">
          <h2 className="kv-social-title">Connect & Share</h2>
          <p className="kv-social-subtitle">
            Seal a post or glyph first. Once Kai-Sigil has embedded your proof
            into the media, this panel will unlock full social sharing with
            verifiable origin.
          </p>
        </header>
        <p className="kv-social-status">
          No sealed media detected for this pulse yet. Complete the{" "}
          <strong>Seal & Embed</strong> step, then tap{" "}
          <strong>Connect Accounts</strong> again.
        </p>
        {status && <p className="kv-social-status">{status}</p>}
      </section>
    );
  }

  // Normal “media present” UI
  return (
    <section className="kv-social-connector">
      <header className="kv-social-header">
        <h2 className="kv-social-title">Share Your Kai-Sigil Post</h2>
        <p className="kv-social-subtitle">
          Every share includes a verifiable Kai-Sigil proof so anyone can confirm
          this post was sealed by your Φ-Key.
        </p>
      </header>

      <div className="kv-social-proof">
        <div className="kv-social-proof-block">
          <div className="kv-proof-label">Preview caption</div>
          <pre className="kv-proof-caption" aria-label="Proof caption preview">
            {proofCaption}
          </pre>
        </div>

        <div className="kv-social-proof-meta">
          <div className="kv-proof-meta-row">
            <span className="kv-proof-meta-label">Φ-Key</span>
            <span className="kv-proof-meta-value">
              {phiKey ?? "— (not provided)"}
            </span>
          </div>
          <div className="kv-proof-meta-row">
            <span className="kv-proof-meta-label">Kai Signature</span>
            <span className="kv-proof-meta-value">
              {kaiSignature ?? "— (not provided)"}
            </span>
          </div>
          <div className="kv-proof-meta-row">
            <span className="kv-proof-meta-label">Pulse</span>
            <span className="kv-proof-meta-value">
              {typeof pulse === "number" ? pulse : "—"}
            </span>
          </div>
          <div className="kv-proof-meta-row">
            <span className="kv-proof-meta-label">Verifier URL</span>
            <span className="kv-proof-meta-value">
              {effectiveVerifierUrl ?? "—"}
            </span>
          </div>
        </div>
      </div>

      <div className="kv-social-actions">
        <div className="kv-social-row kv-social-row--primary">
          <button
            type="button"
            className="kv-btn kv-btn-primary"
            onClick={() => void handleShare("system-share")}
          >
            System Share (Best on Mobile)
          </button>
          <button
            type="button"
            className="kv-btn kv-btn-ghost"
            onClick={() => void handleShare("download")}
          >
            Download Glyph
          </button>
        </div>

        <div className="kv-social-row kv-social-row--grid">
          <button
            type="button"
            className="kv-btn kv-btn-chip"
            onClick={() => void handleShare("x")}
          >
            Post to X (Twitter)
          </button>
          <button
            type="button"
            className="kv-btn kv-btn-chip"
            onClick={() => void handleShare("instagram")}
          >
            Post to Instagram
          </button>
          <button
            type="button"
            className="kv-btn kv-btn-chip"
            onClick={() => void handleShare("tiktok")}
          >
            Post to TikTok
          </button>
          <button
            type="button"
            className="kv-btn kv-btn-chip"
            onClick={() => void handleShare("linkedin")}
          >
            Post to LinkedIn
          </button>
          <button
            type="button"
            className="kv-btn kv-btn-chip"
            onClick={() => void handleShare("facebook")}
          >
            Post to Facebook
          </button>
        </div>

        <div className="kv-social-row kv-social-row--secondary">
          <button
            type="button"
            className="kv-btn kv-btn-outline"
            onClick={() => void handleShare("copy-caption")}
          >
            Remember Caption with Proof
          </button>
          <button
            type="button"
            className="kv-btn kv-btn-outline"
            onClick={() => void handleShare("copy-proof")}
          >
            Remember Proof JSON
          </button>
        </div>
      </div>

      {status && <p className="kv-social-status">{status}</p>}
    </section>
  );
}
