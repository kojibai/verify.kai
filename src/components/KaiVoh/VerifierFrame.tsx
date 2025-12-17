// /components/KaiVoh/VerifierFrame.tsx
"use client";

/**
 * VerifierFrame — Kai-Sigil Verification Panel
 * v2.3 — Canonical Proof Capsule + Copy Proof JSON (verifierUrl never null)
 *
 * Guarantees:
 * ✅ Default verifier base is ALWAYS current app origin (+ Vite BASE_URL subpath) + "/verify"
 * ✅ verifierUrl is always a non-empty string (even on localhost)
 * ✅ "Copy Proof" copies a JSON capsule including verifierUrl + canonical chakraDay
 */

import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import * as ReactQrCodeModule from "react-qr-code";
import "./styles/VerifierFrame.css";

import type { ChakraDay } from "../../utils/kai_pulse";
import {
  buildVerifierSlug,
  buildVerifierUrl,
  defaultHostedVerifierBaseUrl,
  normalizeChakraDay,
  shortKaiSig10,
} from "./verifierProof";

export interface VerifierFrameProps {
  pulse: number;
  kaiSignature: string; // full signature (we will shorten for display + slug)
  phiKey: string;
  caption?: string;

  /** Accept either raw string or canonical ChakraDay; we normalize → ChakraDay | undefined */
  chakraDay?: ChakraDay | string;

  compact?: boolean;

  /** Optional override for the base verify URL (rare). Example: "https://example.com/verify" */
  verifierBaseUrl?: string;
}

type QRCodeProps = {
  value: string;
  size?: number;
  bgColor?: string;
  fgColor?: string;
  level?: "L" | "M" | "Q" | "H";
};
type QRCodeComponent = (props: QRCodeProps) => ReactElement;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function isFn(v: unknown): v is (...args: never[]) => unknown {
  return typeof v === "function";
}

/** ESM/CJS interop-safe resolver */
function pickQrComponent(mod: unknown): QRCodeComponent {
  if (isRecord(mod)) {
    const def = mod.default;
    if (isFn(def)) return def as unknown as QRCodeComponent;

    const named = mod.QRCode;
    if (isFn(named)) return named as unknown as QRCodeComponent;
  }
  if (isFn(mod)) return mod as unknown as QRCodeComponent;

  return function QRCodeFallback({ value }: QRCodeProps): ReactElement {
    return (
      <div className="kv-verifier__qr-fallback" aria-label="QR unavailable">
        {value}
      </div>
    );
  };
}

const QR = pickQrComponent(ReactQrCodeModule);

function truncateMiddle(value: string, head = 6, tail = 6): string {
  if (!value) return "";
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export type ProofCapsule = Readonly<{
  verifierUrl: string;
  verifierBaseUrl: string;
  verifierSlug: string;
  pulse: number;
  chakraDay?: ChakraDay;
  kaiSignature: string;
  kaiSignatureShort: string;
  phiKey: string;
}>;

export default function VerifierFrame({
  pulse,
  kaiSignature,
  phiKey,
  caption,
  chakraDay,
  compact = false,
  verifierBaseUrl,
}: VerifierFrameProps): ReactElement {
  const [copyStatus, setCopyStatus] = useState<"idle" | "ok" | "error">("idle");
  const [copyProofStatus, setCopyProofStatus] = useState<"idle" | "ok" | "error">("idle");

  const proof = useMemo<ProofCapsule>(() => {
    const baseRaw = verifierBaseUrl ?? defaultHostedVerifierBaseUrl();
    const base = String(baseRaw).replace(/\/+$/, "") || "/verify";

    const sigFull = typeof kaiSignature === "string" ? kaiSignature.trim() : "";
    const sigShort = shortKaiSig10(sigFull);

    const slug = buildVerifierSlug(pulse, sigFull);
    const url = buildVerifierUrl(pulse, sigFull, base);

    const chakraRaw = typeof chakraDay === "string" ? chakraDay : undefined;
    const chakra = normalizeChakraDay(chakraRaw);

    return {
      verifierUrl: url,
      verifierBaseUrl: base,
      verifierSlug: slug,
      pulse,
      chakraDay: chakra,
      kaiSignature: sigFull,
      kaiSignatureShort: sigShort,
      phiKey: typeof phiKey === "string" ? phiKey.trim() : "",
    };
  }, [chakraDay, kaiSignature, phiKey, pulse, verifierBaseUrl]);

  const qrSize = compact ? 96 : 160;

  const handleCopyLink = async (): Promise<void> => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setCopyStatus("error");
      return;
    }
    try {
      await navigator.clipboard.writeText(proof.verifierUrl);
      setCopyStatus("ok");
      window.setTimeout(() => setCopyStatus("idle"), 2000);
    } catch {
      setCopyStatus("error");
    }
  };

  const handleCopyProof = async (): Promise<void> => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setCopyProofStatus("error");
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(proof, null, 2));
      setCopyProofStatus("ok");
      window.setTimeout(() => setCopyProofStatus("idle"), 2000);
    } catch {
      setCopyProofStatus("error");
    }
  };

  const rootClass = compact ? "kv-verifier kv-verifier--compact" : "kv-verifier";
  const pulseLabel = Number.isFinite(pulse) && pulse > 0 ? String(pulse) : "—";
  const captionClean = typeof caption === "string" ? caption.trim() : "";
  const truncatedPhiKey = truncateMiddle(proof.phiKey);

  return (
    <section className={rootClass} aria-label="Kai-Sigil verification frame" data-role="verifier-frame">
      <div
        className="kv-verifier__qr-shell"
        role="img"
        aria-label={`QR code linking to Kai-Sigil verifier for pulse ${pulseLabel} and signature ${proof.kaiSignatureShort}`}
      >
        <div className="kv-verifier__qr-inner">
          <QR value={proof.verifierUrl} size={qrSize} bgColor="#00000000" fgColor="#ffffff" />
        </div>
      </div>

      <div className="kv-verifier__content">
        <header className="kv-verifier__header">
          <h3 className="kv-verifier__title">Kai-Sigil Verifier</h3>
          <p className="kv-verifier__subtitle">
            Scan or open the verifier link to confirm this post was sealed by this Φ-Key.
          </p>
        </header>

        <dl className="kv-verifier__meta">
          <div className="kv-verifier__meta-row">
            <dt className="kv-verifier__meta-label">🌀 Pulse</dt>
            <dd className="kv-verifier__meta-value">{pulseLabel}</dd>
          </div>

          <div className="kv-verifier__meta-row">
            <dt className="kv-verifier__meta-label">Kai Signature</dt>
            <dd className="kv-verifier__meta-value kv-verifier__mono">{proof.kaiSignatureShort}</dd>
          </div>

          <div className="kv-verifier__meta-row">
            <dt className="kv-verifier__meta-label">Φ-Key</dt>
            <dd className="kv-verifier__meta-value kv-verifier__mono" title={proof.phiKey}>
              {truncatedPhiKey || "—"}
            </dd>
          </div>

          {proof.chakraDay ? (
            <div className="kv-verifier__meta-row">
              <dt className="kv-verifier__meta-label">🧬 Chakra Day</dt>
              <dd className="kv-verifier__meta-value">{proof.chakraDay}</dd>
            </div>
          ) : null}
        </dl>

        {captionClean.length > 0 ? (
          <p className="kv-verifier__caption" aria-label="Post caption">
            “{captionClean}”
          </p>
        ) : null}

        <div className="kv-verifier__actions">
          <a
            href={proof.verifierUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="kv-verifier__btn kv-verifier__btn--primary"
            data-role="verifier-open-link"
          >
            Open Verifier
          </a>

          <button
            type="button"
            onClick={() => void handleCopyLink()}
            className="kv-verifier__btn kv-verifier__btn--ghost"
            data-role="verifier-copy-link"
          >
            {copyStatus === "ok" ? "Copied!" : copyStatus === "error" ? "Copy failed" : "Copy Link"}
          </button>

          <button
            type="button"
            onClick={() => void handleCopyProof()}
            className="kv-verifier__btn kv-verifier__btn--ghost"
            data-role="verifier-copy-proof"
          >
            {copyProofStatus === "ok"
              ? "Proof copied!"
              : copyProofStatus === "error"
                ? "Copy failed"
                : "Copy Proof"}
          </button>
        </div>

        <p className="kv-verifier__url" aria-label="Verifier URL">
          <span className="kv-verifier__url-label">Verifier URL:</span>
          <span className="kv-verifier__url-value">{proof.verifierUrl}</span>
        </p>
      </div>
    </section>
  );
}
