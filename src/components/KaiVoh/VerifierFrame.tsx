// /components/KaiVoh/VerifierFrame.tsx
"use client";

/**
 * VerifierFrame — Kai-Sigil Verification Panel
 * v2.4 — KPV-1 Proof Hash (payload-bound proof capsule)
 *
 * Guarantees:
 * ✅ Default verifier base is ALWAYS current app origin (+ Vite BASE_URL subpath) + "/verify"
 * ✅ verifierUrl is always a non-empty string (even on localhost)
 * ✅ "Copy Proof" copies a JSON capsule including:
 *    - canonical chakraDay
 *    - verifierSlug (domain-stable)
 *    - proofCapsule (KPV-1)
 *    - proofHash (SHA-256 over the capsule)
 *
 * Note:
 * - verifierUrl is convenience/QR and may change across hosts.
 * - proofHash binds the capsule fields (pulse/chakra/signature/phiKey/slug), not the host URL.
 */

import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import * as ReactQrCodeModule from "react-qr-code";
import "./styles/VerifierFrame.css";

import type { ChakraDay } from "../../utils/kai_pulse";
import {
  buildVerifierSlug,
  buildVerifierUrl,
  defaultHostedVerifierBaseUrl,
  hashProofCapsuleV1,
  normalizeChakraDay,
  shortKaiSig10,
  type ProofCapsuleV1,
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

function truncateHash(h: string, head = 10, tail = 10): string {
  if (!h) return "";
  if (h.length <= head + tail + 3) return h;
  return `${h.slice(0, head)}…${h.slice(-tail)}`;
}

export type ProofCopy = Readonly<{
  verifierUrl: string;
  verifierBaseUrl: string;
  verifierSlug: string;

  pulse: number;
  chakraDay?: ChakraDay;

  kaiSignature: string;
  kaiSignatureShort: string;
  phiKey: string;

  /** KPV-1: canonical capsule that gets hashed */
  proofCapsule: ProofCapsuleV1 | null;

  /** KPV-1: SHA-256 over proofCapsule (hex) */
  proofHash?: string;
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
  const [proofHash, setProofHash] = useState<string | null>(null);

  const proof = useMemo<ProofCopy>(() => {
    const baseRaw = verifierBaseUrl ?? defaultHostedVerifierBaseUrl();
    const base = String(baseRaw).replace(/\/+$/, "") || "/verify";

    const sigFull = typeof kaiSignature === "string" ? kaiSignature.trim() : "";
    const sigShort = shortKaiSig10(sigFull);

    const slug = buildVerifierSlug(pulse, sigFull);
    const url = buildVerifierUrl(pulse, sigFull, base);

    const chakraNorm =
      typeof chakraDay === "string" ? normalizeChakraDay(chakraDay) : normalizeChakraDay(String(chakraDay ?? ""));

    const phiKeyClean = typeof phiKey === "string" ? phiKey.trim() : "";

    const capsule: ProofCapsuleV1 | null =
      pulse > 0 && sigFull.length > 0 && phiKeyClean.length > 0 && chakraNorm
        ? {
            v: "KPV-1",
            pulse,
            chakraDay: chakraNorm,
            kaiSignature: sigFull,
            phiKey: phiKeyClean,
            verifierSlug: slug,
          }
        : null;

    return {
      verifierUrl: url,
      verifierBaseUrl: base,
      verifierSlug: slug,
      pulse,
      chakraDay: chakraNorm,
      kaiSignature: sigFull,
      kaiSignatureShort: sigShort,
      phiKey: phiKeyClean,
      proofCapsule: capsule,
      proofHash: undefined,
    };
  }, [chakraDay, kaiSignature, phiKey, pulse, verifierBaseUrl]);

  useEffect(() => {
    let cancelled = false;

    (async (): Promise<void> => {
      if (!proof.proofCapsule) {
        setProofHash(null);
        return;
      }
      try {
        const h = await hashProofCapsuleV1(proof.proofCapsule);
        if (!cancelled) setProofHash(h);
      } catch {
        if (!cancelled) setProofHash(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [proof.proofCapsule]);

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
      let h: string | undefined = proofHash ?? undefined;
      if (!h && proof.proofCapsule) {
        h = await hashProofCapsuleV1(proof.proofCapsule);
        setProofHash(h);
      }

      const payload: ProofCopy = {
        ...proof,
        proofHash: h,
      };

      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
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
  const hashDisplay = proofHash ? truncateHash(proofHash) : "—";

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
            Scan or open the verifier link to confirm this post was sealed by this Φ-Key (KPV-1 payload-bound proof).
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

          <div className="kv-verifier__meta-row">
            <dt className="kv-verifier__meta-label">🔒 Proof Hash</dt>
            <dd className="kv-verifier__meta-value kv-verifier__mono" title={proofHash ?? ""}>
              {hashDisplay}
            </dd>
          </div>
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
            {copyStatus === "ok" ? "Remembered!" : copyStatus === "error" ? "Remember failed" : "Remember Link"}
          </button>

          <button
            type="button"
            onClick={() => void handleCopyProof()}
            className="kv-verifier__btn kv-verifier__btn--ghost"
            data-role="verifier-copy-proof"
          >
            {copyProofStatus === "ok"
              ? "Proof Remembered!"
              : copyProofStatus === "error"
                ? "Remember failed"
                : "Remember Proof"}
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
