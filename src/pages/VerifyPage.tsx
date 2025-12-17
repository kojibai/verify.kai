"use client";

import React, { useCallback, useMemo, useState, type ReactElement } from "react";
import "./VerifyPage.css";

import VerifierFrame from "../components/KaiVoh/VerifierFrame";
import { derivePhiKeyFromSig } from "../components/VerifierStamper/sigilUtils";

type SlugInfo = {
  raw: string;
  pulse: number | null;
  shortSig: string | null;
};

type EmbeddedMeta = {
  pulse?: number;
  chakraDay?: string;
  kaiSignature?: string;
  phiKey?: string;
  timestamp?: string;
  verifierUrl?: string;
  raw?: unknown;
};


type VerifyChecks = {
  hasSignature: boolean;
  slugPulseMatches: boolean | null;
  slugShortSigMatches: boolean | null;
  derivedPhiKeyMatchesEmbedded: boolean | null;
};

type VerifyResult =
  | {
      status: "idle";
    }
  | {
      status: "error";
      message: string;
      slug: SlugInfo;
      embedded?: EmbeddedMeta;
      derivedPhiKey?: string;
      checks?: VerifyChecks;
    }
  | {
      status: "ok";
      slug: SlugInfo;
      embedded: EmbeddedMeta;
      derivedPhiKey: string;
      checks: VerifyChecks;
    };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function parseSlug(rawSlug: string): SlugInfo {
  const raw = decodeURIComponent(rawSlug || "").trim();
  const m = raw.match(/^(\d+)-([A-Za-z0-9]+)$/);
  if (!m) return { raw, pulse: null, shortSig: null };

  const pulseNum = Number(m[1]);
  const pulse = Number.isFinite(pulseNum) && pulseNum > 0 ? pulseNum : null;
  const shortSig = m[2] ? String(m[2]) : null;

  return { raw, pulse, shortSig };
}

function readSlugFromLocation(): string {
  if (typeof window === "undefined") return "";

  // support both:
  // - /verify/<slug>
  // - /#/verify/<slug> (hash routers)
  const path = window.location.pathname || "";
  const hash = window.location.hash || "";

  const m1 = path.match(/\/verify\/([^/?#]+)/);
  if (m1 && m1[1]) return m1[1];

  const m2 = hash.match(/\/verify\/([^/?#]+)/);
  if (m2 && m2[1]) return m2[1];

  return "";
}

function extractMetadataBlock(svgText: string): string | null {
  // grabs inner text of first <metadata>…</metadata>
  const m = svgText.match(/<metadata[^>]*>([\s\S]*?)<\/metadata>/i);
  if (!m) return null;
  return (m[1] ?? "").trim();
}

function safeJsonParse(s: string): unknown | null {
  const t = s.trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function toEmbeddedMetaFromUnknown(raw: unknown): EmbeddedMeta {
  if (!isRecord(raw)) return { raw };

  const kaiSignature =
    typeof raw.kaiSignature === "string" ? raw.kaiSignature : undefined;

  const pulse =
    typeof raw.pulse === "number" && Number.isFinite(raw.pulse) ? raw.pulse : undefined;

  const chakraDay =
    typeof raw.chakraDay === "string" ? raw.chakraDay : undefined;

  const timestamp =
    typeof raw.timestamp === "string" ? raw.timestamp : undefined;

    const phiKeyRaw = typeof raw.phiKey === "string" ? raw.phiKey : undefined;
const userPhiKey = typeof raw.userPhiKey === "string" ? raw.userPhiKey : undefined;

// If phiKey looks like a short label, prefer userPhiKey
const phiKey =
  phiKeyRaw && !phiKeyRaw.startsWith("φK-") ? phiKeyRaw : userPhiKey;

const verifierUrl =
  typeof raw.verifierUrl === "string" ? raw.verifierUrl : undefined;

return {
  pulse,
  chakraDay,
  kaiSignature,
  phiKey,
  timestamp,
  verifierUrl,
  raw,
};

}

function extractEmbeddedMeta(svgText: string): EmbeddedMeta {
  // 1) preferred: <metadata>{JSON}</metadata>
  const metaBlock = extractMetadataBlock(svgText);
  if (metaBlock) {
    const parsed = safeJsonParse(metaBlock);
    if (parsed) return toEmbeddedMetaFromUnknown(parsed);
  }

  // 2) fallback: try to find a JSON object containing "kaiSignature"
  // (handles cases where metadata was embedded differently)
  const idx = svgText.indexOf('"kaiSignature"');
  if (idx >= 0) {
    // attempt to capture a nearby {...} blob
    const slice = svgText.slice(Math.max(0, idx - 800), Math.min(svgText.length, idx + 2000));
    const m = slice.match(/\{[\s\S]*\}/);
    if (m && m[0]) {
      const parsed = safeJsonParse(m[0]);
      if (parsed) return toEmbeddedMetaFromUnknown(parsed);
    }
  }

  return {};
}

function firstN(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n);
}

async function readFileText(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsText(file);
  });
}

export default function VerifyPage(): ReactElement {
  const slugRaw = useMemo(() => readSlugFromLocation(), []);
  const slug = useMemo(() => parseSlug(slugRaw), [slugRaw]);

  const [svgText, setSvgText] = useState<string>("");
  const [result, setResult] = useState<VerifyResult>({ status: "idle" });
  const [busy, setBusy] = useState<boolean>(false);

  const verifierFrameProps = useMemo(() => {
    // If we only have the slug, we can still render the capsule.
    // The actual verification happens after user provides the sealed SVG text.
    const pulse = slug.pulse ?? 0;
    const kaiSignature = slug.shortSig ?? "unknown-signature";
    return { pulse, kaiSignature, phiKey: "—" };
  }, [slug.pulse, slug.shortSig]);

  const runVerify = useCallback(async (): Promise<void> => {
    const raw = svgText.trim();
    if (!raw) {
      setResult({
        status: "error",
        message: "Paste the sealed SVG text or upload the sealed SVG file first.",
        slug,
      });
      return;
    }

    setBusy(true);
    try {
      const embedded = extractEmbeddedMeta(raw);

      const sig = (embedded.kaiSignature ?? "").trim();
      if (!sig) {
        setResult({
          status: "error",
          message: "No kaiSignature found in the SVG metadata.",
          slug,
          embedded,
        });
        return;
      }

      const derivedPhiKey = await derivePhiKeyFromSig(sig);

      const embeddedPhiKey = (embedded.phiKey ?? "").trim();
      const embeddedPulse = embedded.pulse;

      const slugPulseMatches =
        slug.pulse == null || embeddedPulse == null ? null : slug.pulse === embeddedPulse;

      const slugShortSigMatches =
        slug.shortSig == null ? null : slug.shortSig === firstN(sig, slug.shortSig.length);

      const derivedPhiKeyMatchesEmbedded =
        embeddedPhiKey.length === 0 ? null : derivedPhiKey === embeddedPhiKey;

      const checks: VerifyChecks = {
        hasSignature: true,
        slugPulseMatches,
        slugShortSigMatches,
        derivedPhiKeyMatchesEmbedded,
      };

      // Decide pass/fail:
      // - Must have signature
      // - If slug contains pulse/shortSig, they must match if embedded provides pulse
      // - If embedded includes phiKey, derived must match it
      const hardFail =
        (checks.slugPulseMatches === false) ||
        (checks.slugShortSigMatches === false) ||
        (checks.derivedPhiKeyMatchesEmbedded === false);

      if (hardFail) {
        setResult({
          status: "error",
          message: "Verification failed: one or more checks did not match.",
          slug,
          embedded,
          derivedPhiKey,
          checks,
        });
        return;
      }

      setResult({
        status: "ok",
        slug,
        embedded: {
          ...embedded,
          // normalize to show the sealing Φ-Key even if embed omitted it
          phiKey: embeddedPhiKey.length > 0 ? embeddedPhiKey : derivedPhiKey,
        },
        derivedPhiKey,
        checks,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Verification failed.";
      setResult({ status: "error", message: msg, slug });
    } finally {
      setBusy(false);
    }
  }, [slug, svgText]);

  const onPickFile = useCallback(async (file: File): Promise<void> => {
    // We verify SVG text (offline). If user drops non-SVG, show error.
    if (!file.name.toLowerCase().endsWith(".svg")) {
      setResult({
        status: "error",
        message: "Upload a sealed .svg (this verifier reads embedded <metadata> JSON).",
        slug,
      });
      return;
    }
    const text = await readFileText(file);
    setSvgText(text);
    setResult({ status: "idle" });
  }, [slug]);

  return (
    <div className="verify-page">
      <header className="verify-hero">
        <h1 className="verify-title">Kai-Sigil Verifier</h1>
        <p className="verify-subtitle">
          Open a sealed memory and verify its human origin by Kai Signature → Φ-Key.
        </p>

        <div className="verify-slug">
          <span className="verify-slug-label">Link:</span>
          <code className="verify-slug-value">/verify/{slug.raw || "—"}</code>
        </div>
      </header>

      <main className="verify-main">
        <section className="verify-card">
          <h2 className="verify-card-title">1) Provide the sealed post</h2>

          <div className="verify-upload-row">
            <label className="verify-upload">
              <input
                type="file"
                accept=".svg,image/svg+xml"
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  if (f) void onPickFile(f);
                  e.currentTarget.value = "";
                }}
              />
              Upload sealed SVG
            </label>

            <button
              type="button"
              className="verify-btn"
              onClick={() => void runVerify()}
              disabled={busy}
            >
              {busy ? "Verifying…" : "Verify"}
            </button>
          </div>

          <textarea
            className="verify-textarea"
            value={svgText}
            onChange={(e) => setSvgText(e.currentTarget.value)}
            placeholder="Or paste the sealed SVG text here (must include <metadata>{...}</metadata> with kaiSignature + pulse + userPhiKey/phiKey)."
            spellCheck={false}
          />
        </section>

        <section className="verify-card">
          <h2 className="verify-card-title">2) Proof capsule</h2>

          {result.status === "ok" ? (
        <VerifierFrame
  pulse={result.embedded.pulse ?? (slug.pulse ?? 0)}
  kaiSignature={result.embedded.kaiSignature ?? (slug.shortSig ?? "unknown")}
  phiKey={result.derivedPhiKey}
  chakraDay={result.embedded.chakraDay}
  compact={false}
/>

          ) : (
 <VerifierFrame
  pulse={verifierFrameProps.pulse}
  kaiSignature={verifierFrameProps.kaiSignature}
  phiKey={verifierFrameProps.phiKey}
  compact={false}
/>

          )}

          <div className="verify-status">
            {result.status === "idle" ? (
              <p className="verify-muted">Upload/paste a sealed SVG, then click Verify.</p>
            ) : result.status === "ok" ? (
              <div className="verify-ok">
                <div className="verify-badge verify-badge--ok">Verified</div>
                <p className="verify-line">
                  Sealed by Φ-Key: <code>{result.derivedPhiKey}</code>
                </p>
                <ul className="verify-checks">
                  <li>
                    slug pulse match:{" "}
                    <strong>{result.checks.slugPulseMatches === null ? "n/a" : String(result.checks.slugPulseMatches)}</strong>
                  </li>
                  <li>
                    slug shortSig match:{" "}
                    <strong>{result.checks.slugShortSigMatches === null ? "n/a" : String(result.checks.slugShortSigMatches)}</strong>
                  </li>
                  <li>
                    derived Φ-Key matches embedded:{" "}
                    <strong>
                      {result.checks.derivedPhiKeyMatchesEmbedded === null
                        ? "n/a (embed omitted phiKey)"
                        : String(result.checks.derivedPhiKeyMatchesEmbedded)}
                    </strong>
                  </li>
                </ul>
              </div>
            ) : (
              <div className="verify-fail">
                <div className="verify-badge verify-badge--fail">Not verified</div>
                <p className="verify-line">{result.message}</p>

                {result.checks ? (
                  <ul className="verify-checks">
                    <li>
                      slug pulse match:{" "}
                      <strong>{result.checks.slugPulseMatches === null ? "n/a" : String(result.checks.slugPulseMatches)}</strong>
                    </li>
                    <li>
                      slug shortSig match:{" "}
                      <strong>{result.checks.slugShortSigMatches === null ? "n/a" : String(result.checks.slugShortSigMatches)}</strong>
                    </li>
                    <li>
                      derived Φ-Key matches embedded:{" "}
                      <strong>
                        {result.checks.derivedPhiKeyMatchesEmbedded === null
                          ? "n/a (embed omitted phiKey)"
                          : String(result.checks.derivedPhiKeyMatchesEmbedded)}
                      </strong>
                    </li>
                  </ul>
                ) : null}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
