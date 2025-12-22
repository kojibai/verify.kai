// /components/KaiVoh/VerifierFrame.tsx
"use client";

/**
 * VerifierFrame — Kai-Sigil Verification Panel
 * v2.5 — SPEC-NOW Pulse (Kai-Klok source-of-truth) + KPV-1 Proof Hash
 *
 * Update:
 * ✅ If `pulse` is missing/invalid (<=0), this component derives a LIVE pulse from kai_pulse.ts (spec NOW)
 * ✅ If `pulse` is provided (>0), it is treated as the sealed/authoritative pulse (no live override)
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
import * as KaiPulseSpec from "../../utils/kai_pulse";

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
  /** If omitted/invalid (<=0), this component will use SPEC-NOW pulse */
  pulse?: number;

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

function asSafeNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") {
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    const min = BigInt(Number.MIN_SAFE_INTEGER);
    if (v > max || v < min) return null;
    return Number(v);
  }
  return null;
}

function toValidPulse(p: unknown): number | null {
  const n = typeof p === "number" ? p : NaN;
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
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

/**
 * SPEC-NOW pulse resolver (best-effort, no Chronos sampling here).
 * Prefers a direct pulse-now function if present; otherwise derives from kairosEpochNow + constants.
 */
function readPulseNowFromSpec(): number | null {
  const rec = KaiPulseSpec as unknown as Record<string, unknown>;

  // 1) Direct pulse-now fn (preferred)
  const directKeys = ["kaiPulseNow", "getKaiPulseNow", "pulseNow"];
  for (const k of directKeys) {
    const fn = rec[k];
    if (isFn(fn)) {
      const out = (fn as () => unknown)();
      const n = asSafeNumber(out);
      const p = toValidPulse(n);
      if (p) return p;
    }
  }

  // 2) Derive from kairosEpochNow (epoch-ms, deterministic) + GENESIS_TS + PULSE_MS if available
  const epochFn = rec["kairosEpochNow"];
  const genesis = asSafeNumber(rec["GENESIS_TS"]);
  const pulseMs = asSafeNumber(rec["PULSE_MS"]);

  if (isFn(epochFn) && genesis !== null && pulseMs !== null && Number.isFinite(pulseMs) && pulseMs > 0) {
    const epochOut = (epochFn as () => unknown)();
    const epochMs = asSafeNumber(epochOut);
    if (epochMs !== null) {
      const delta = epochMs - genesis;
      if (Number.isFinite(delta)) {
        // canonical UI pulse index: 1-based
        const p = Math.floor(delta / pulseMs) + 1;
        return p > 0 ? p : null;
      }
    }
  }

  return null;
}

function readNextPulseDelayMsFromSpec(): number | null {
  const rec = KaiPulseSpec as unknown as Record<string, unknown>;

  const epochFn = rec["kairosEpochNow"];
  const genesis = asSafeNumber(rec["GENESIS_TS"]);
  const pulseMs = asSafeNumber(rec["PULSE_MS"]);

  if (!isFn(epochFn) || genesis === null || pulseMs === null || !(pulseMs > 0)) return null;

  const epochOut = (epochFn as () => unknown)();
  const epochMs = asSafeNumber(epochOut);
  if (epochMs === null) return null;

  const delta = epochMs - genesis;
  if (!Number.isFinite(delta)) return null;

  const idx0 = Math.max(0, Math.floor(delta / pulseMs)); // 0-based
  const nextBoundary = genesis + (idx0 + 1) * pulseMs;
  const raw = nextBoundary - epochMs;

  // Keep it sane (no busy-loop, no giant stalls)
  const delay = Math.ceil(Math.max(25, Math.min(60_000, raw)));
  return Number.isFinite(delay) ? delay : null;
}

/**
 * Live SPEC-NOW pulse (ticks on the next pulse boundary).
 * Only used when the caller didn't provide an authoritative pulse.
 */
function useSpecNowPulse(enabled: boolean): number {
  const [p, setP] = useState<number>(() => readPulseNowFromSpec() ?? 0);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let t: number | null = null;

    const tick = (): void => {
      if (cancelled) return;

      const next = readPulseNowFromSpec();
      if (next && next > 0) setP(next);

      const delay = readNextPulseDelayMsFromSpec() ?? 1000;
      t = window.setTimeout(tick, delay);
    };

    tick();

    return () => {
      cancelled = true;
      if (t !== null) window.clearTimeout(t);
    };
  }, [enabled]);

  return p;
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

  const pulseProvided = toValidPulse(pulse);
  const specPulse = useSpecNowPulse(pulseProvided === null);
  const pulseEff = pulseProvided ?? specPulse;

  const proof = useMemo<ProofCopy>(() => {
    const baseRaw = verifierBaseUrl ?? defaultHostedVerifierBaseUrl();
    const base = String(baseRaw).replace(/\/+$/, "") || "/verify";

    const sigFull = typeof kaiSignature === "string" ? kaiSignature.trim() : "";
    const sigShort = shortKaiSig10(sigFull);

    const p = Number.isFinite(pulseEff) && pulseEff > 0 ? Math.floor(pulseEff) : 0;

    const slug = buildVerifierSlug(p, sigFull);
    const url = buildVerifierUrl(p, sigFull, base);

    const chakraNorm =
      typeof chakraDay === "string"
        ? normalizeChakraDay(chakraDay)
        : normalizeChakraDay(String(chakraDay ?? ""));

    const phiKeyClean = typeof phiKey === "string" ? phiKey.trim() : "";

    const capsule: ProofCapsuleV1 | null =
      p > 0 && sigFull.length > 0 && phiKeyClean.length > 0 && chakraNorm
        ? {
            v: "KPV-1",
            pulse: p,
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
      pulse: p,
      chakraDay: chakraNorm,
      kaiSignature: sigFull,
      kaiSignatureShort: sigShort,
      phiKey: phiKeyClean,
      proofCapsule: capsule,
      proofHash: undefined,
    };
  }, [chakraDay, kaiSignature, phiKey, pulseEff, verifierBaseUrl]);

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
  const pulseLabel = Number.isFinite(proof.pulse) && proof.pulse > 0 ? String(proof.pulse) : "—";
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
