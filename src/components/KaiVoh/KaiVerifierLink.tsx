"use client";

import type { ReactElement } from "react";
import * as ReactQrCodeModule from "react-qr-code";

/* ---------------- QR resolver (ESM/CJS safe) ---------------- */

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
function pickQrComponent(mod: unknown): QRCodeComponent {
  if (isRecord(mod)) {
    const def = mod.default;
    if (isFn(def)) return def as unknown as QRCodeComponent;
    const named = mod.QRCode;
    if (isFn(named)) return named as unknown as QRCodeComponent;
  }
  if (isFn(mod)) return mod as unknown as QRCodeComponent;
  return function QRCodeFallback({ value }: QRCodeProps): ReactElement {
    return <div aria-label="QR unavailable">{value}</div>;
  };
}
const QR = pickQrComponent(ReactQrCodeModule);

/* ---------------- URL helpers ---------------- */

function trimSlashes(s: string): string {
  return s.replace(/^\/+|\/+$/g, "");
}

type ViteImportMeta = { env?: { BASE_URL?: unknown } };

function safeBasePath(): string {
  try {
    const baseUrl = (import.meta as unknown as ViteImportMeta).env?.BASE_URL;
    if (typeof baseUrl === "string" && baseUrl.trim().length > 0) return baseUrl;
  } catch {
    // ignore
  }
  return "/";
}

function defaultVerifierBaseUrl(): string {
  if (typeof window === "undefined") return "/verify";

  const origin = window.location.origin;
  const base = safeBasePath(); // "/" or "/subpath/"
  const baseClean = trimSlashes(base);
  const prefix = baseClean.length > 0 ? `/${baseClean}` : "";

  return `${origin}${prefix}/verify`;
}

/* ---------------- Component ---------------- */

interface KaiVerifierLinkProps {
  pulse: number;
  kaiSignature: string;
  phiKey: string;
  /** Optional: override verifier base, e.g. "https://example.com/verify" */
  verifierBaseUrl?: string;
}

export default function KaiVerifierLink({
  pulse,
  kaiSignature,
  phiKey,
  verifierBaseUrl,
}: KaiVerifierLinkProps): ReactElement {
  const sig = typeof kaiSignature === "string" ? kaiSignature.trim() : "";
  const shortSig = sig.length > 0 ? sig.slice(0, 10) : "unknown-sig";

  const base = (verifierBaseUrl ?? defaultVerifierBaseUrl()).replace(/\/+$/, "");
  const slug = encodeURIComponent(`${pulse}-${shortSig}`);
  const url = `${base}/${slug}`;

  return (
    <div className="flex flex-col items-center gap-4 p-6 text-center">
      <h2 className="text-lg font-semibold">🧿 Public Proof</h2>

      <QR value={url} size={180} bgColor="#00000000" fgColor="#ffffff" />

      <div className="mt-4">
        <p className="text-sm opacity-80">
          Pulse: <strong>{pulse}</strong>
        </p>
        <p className="text-sm opacity-80">
          Φ-Key: <strong>{phiKey}</strong>
        </p>
        <p className="text-sm opacity-80">
          Verifier:{" "}
          <a href={url} className="underline" target="_blank" rel="noopener noreferrer">
            {url}
          </a>
        </p>
      </div>
    </div>
  );
}
