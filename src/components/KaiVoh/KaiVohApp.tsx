// /components/KaiVoh/KaiVohApp.tsx
"use client";

/**
 * KaiVohApp — Kai-Sigil Posting OS
 * v5.1 — Canonical Proof Capsule (Share-step proof copy is now correct)
 *
 * FIXES (requested):
 * ✅ Share-step JSON proof (manual share / copy) now carries:
 *    - correct canonical chakraDay (e.g., "Third Eye", "Solar Plexus")
 *    - non-null verifierUrl (computed + bound at embed time)
 * ✅ MultiShareDispatcher receives the canonical proof capsule (verifierData)
 * ✅ chakraDay is normalized at login + embed (no raw/non-canonical strings leak through)
 *
 * Flow:
 *   1. Login   — Scan / upload Kai-Sigil, verify Kai Signature → derive Φ-Key.
 *   2. Connect — Configure KaiVoh (accounts, docs, attachments, stream tools).
 *   3. Compose — PostComposer: write post + choose media to be sealed.
 *   4. Seal    — Breath-based sealing (Kai pulse, chakra day, KKS v1).
 *   5. Embed   — Embed Kai Signature + Φ-Key metadata directly into media.
 *   6. Share   — Broadcast hub (MultiShareDispatcher + /api/post/*).
 *   7. Verify  — VerifierFrame (QR + proof) so anyone can confirm human origin.
 */

import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import "./styles/KaiVohApp.css";

/* UI flow */
import SigilLogin from "./SigilLogin";
import { SessionProvider } from "../session/SessionProvider";
import { useSession } from "../session/useSession";

import KaiVoh from "./KaiVoh";
import PostComposer from "./PostComposer";
import type { ComposedPost } from "./PostComposer";
import BreathSealer from "./BreathSealer";
import type { SealedPost } from "./BreathSealer";
import { embedKaiSignature } from "./SignatureEmbedder";
import type { EmbeddedMediaResult } from "./SignatureEmbedder";
import MultiShareDispatcher from "./MultiShareDispatcher";
import { buildNextSigilSvg, downloadSigil } from "./SigilMemoryBuilder";

/* Verifier UI + proof URL helpers (moved out of VerifierFrame for Fast Refresh) */
import VerifierFrame from "./VerifierFrame";
import { buildVerifierUrl, normalizeChakraDay } from "./verifierProof";

/* Canonical crypto parity (match VerifierStamper): derive Φ-Key FROM SIGNATURE */
import { derivePhiKeyFromSig } from "../VerifierStamper/sigilUtils";

/* Kai-Klok φ-engine (KKS v1) */
import { fetchKaiOrLocal, epochMsFromPulse, type ChakraDay } from "../../utils/kai_pulse";

/* Types */
import type { PostEntry, SessionData } from "../session/sessionTypes";

/* -------------------------------------------------------------------------- */
/*                               Helper Types                                 */
/* -------------------------------------------------------------------------- */

type FlowStep = "login" | "connect" | "compose" | "seal" | "embed" | "share" | "verify";

/**
 * Minimal, trusted shape we accept from SigilLogin → never from data-* attrs.
 * Login already did the heavy crypto verification; here we just normalize.
 */
interface SigilMeta {
  kaiSignature: string;
  pulse: number;
  chakraDay?: string;
  userPhiKey?: string;
  connectedAccounts?: Record<string, string>;
  postLedger?: PostEntry[];
}

/** Shape of the embedded KKS metadata coming back from SignatureEmbedder */
type KaiSigKksMetadataShape = EmbeddedMediaResult["metadata"];

/**
 * Extended metadata we keep in-memory for the app.
 * Structurally compatible with KaiSigKksMetadata, but with a few extra
 * convenience fields for the KaiVoh experience.
 */
type ExtendedKksMetadata = KaiSigKksMetadataShape & {
  originPulse?: number;
  sigilPulse?: number;
  exhalePulse?: number;
  verifierUrl?: string;
};

type VerifierData = Readonly<{
  pulse: number;
  kaiSignature: string;
  phiKey: string;
  chakraDay: ChakraDay;
  verifierUrl: string;
}>;

/* -------------------------------------------------------------------------- */
/*                           Narrowing / Validation                            */
/* -------------------------------------------------------------------------- */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isPostEntry(v: unknown): v is PostEntry {
  return (
    isRecord(v) &&
    typeof v.pulse === "number" &&
    typeof v.platform === "string" &&
    typeof v.link === "string"
  );
}

function toPostLedger(v: unknown): PostEntry[] {
  if (!Array.isArray(v)) return [];
  const out: PostEntry[] = [];
  for (const item of v) {
    if (isPostEntry(item)) out.push(item);
  }
  return out;
}

function toStringRecord(v: unknown): Record<string, string> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === "string") out[k] = val;
  }
  return out;
}

function parseSigilMeta(v: unknown): SigilMeta | null {
  if (!isRecord(v)) return null;

  const kaiSignature = v.kaiSignature;
  const pulse = v.pulse;
  if (typeof kaiSignature !== "string" || typeof pulse !== "number") return null;

  const chakraDay = typeof v.chakraDay === "string" ? v.chakraDay : undefined;
  const userPhiKey = typeof v.userPhiKey === "string" ? v.userPhiKey : undefined;
  const connectedAccounts = toStringRecord(v.connectedAccounts);
  const postLedger = toPostLedger(v.postLedger);

  return { kaiSignature, pulse, chakraDay, userPhiKey, connectedAccounts, postLedger };
}

/** Light, sane Base58 (no case-folding, no hard 34-char lock) */
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;
function isValidPhiKeyShape(k: string): boolean {
  return BASE58_RE.test(k) && k.length >= 26 && k.length <= 64;
}

/* -------------------------------------------------------------------------- */
/*                          Presentation Helpers                              */
/* -------------------------------------------------------------------------- */

const FLOW_ORDER: FlowStep[] = ["connect", "compose", "seal", "embed", "share", "verify"];

const FLOW_LABEL: Record<FlowStep, string> = {
  login: "Login",
  connect: "KaiVoh",
  compose: "Compose",
  seal: "Seal Breath",
  embed: "Embed Signature",
  share: "Share",
  verify: "Verify",
};

function shortKey(k: string | undefined): string {
  if (!k) return "—";
  if (k.length <= 10) return k;
  return `${k.slice(0, 5)}…${k.slice(-4)}`;
}

function chakraClass(chakraDay?: string): string {
  const base = (chakraDay || "Crown")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  return `kv-chakra-${base}`;
}

function formatCountdown(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "0.0s";
  const seconds = ms / 1000;
  if (seconds < 1) return `${seconds.toFixed(2)}s`;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${seconds.toFixed(0)}s`;
}

function safeFileExt(name: string): string {
  const i = name.lastIndexOf(".");
  if (i <= 0 || i >= name.length - 1) return "";
  const ext = name.slice(i);
  if (ext.length > 12) return "";
  return ext;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Ensure the final SVG Blob actually contains the final merged metadata JSON. */
async function embedMetadataIntoSvgBlob(svgBlob: Blob, metadata: unknown): Promise<Blob> {
  try {
    const rawText = await svgBlob.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawText, "image/svg+xml");

    if (doc.querySelector("parsererror")) return svgBlob;

    const root = doc.documentElement;
    if (!root || root.namespaceURI !== SVG_NS || root.tagName.toLowerCase() !== "svg") return svgBlob;

    const metas = doc.getElementsByTagName("metadata");
    const metaEl: SVGMetadataElement =
      metas.length > 0
        ? (metas.item(0) as SVGMetadataElement)
        : (doc.createElementNS(SVG_NS, "metadata") as SVGMetadataElement);

    if (metas.length === 0) root.appendChild(metaEl);

    metaEl.textContent = JSON.stringify(metadata, null, 2);

    const serializer = new XMLSerializer();
    const updatedSvg = serializer.serializeToString(doc);
    return new Blob([updatedSvg], { type: "image/svg+xml" });
  } catch {
    return svgBlob;
  }
}

/* --------------------------- UI Subcomponents ----------------------------- */

interface StepIndicatorProps {
  current: FlowStep;
}

function StepIndicator({ current }: StepIndicatorProps): ReactElement {
  const currentIndex = FLOW_ORDER.indexOf(current);

  return (
    <div className="kv-steps">
      {FLOW_ORDER.map((step, index) => {
        const isCurrent = step === current;
        const isDone = currentIndex >= 0 && index < currentIndex;

        const chipClass = ["kv-step-chip", isDone ? "kv-step-chip--done" : "", isCurrent ? "kv-step-chip--active" : ""]
          .filter(Boolean)
          .join(" ");

        return (
          <div key={step} className="kv-step">
            <div className={chipClass}>
              <span className="kv-step-index">{index + 1}</span>
              <span className="kv-step-label">{FLOW_LABEL[step]}</span>
            </div>
            {index < FLOW_ORDER.length - 1 ? <div className="kv-step-rail" aria-hidden="true" /> : null}
          </div>
        );
      })}
    </div>
  );
}

interface SessionHudProps {
  session: SessionData;
  step: FlowStep;
  hasConnectedAccounts: boolean;
  onLogout: () => void;
  onNewPost: () => void;
  livePulse?: number | null;
  msToNextPulse?: number | null;
}

function SessionHud({
  session,
  step,
  hasConnectedAccounts,
  onLogout,
  onNewPost,
  livePulse,
  msToNextPulse,
}: SessionHudProps): ReactElement {
  const ledgerCount = session.postLedger?.length ?? 0;
  const pulseDisplay = livePulse ?? session.pulse;
  const countdownLabel = formatCountdown(msToNextPulse);

  return (
    <header className={["kv-session-hud", chakraClass(session.chakraDay)].join(" ")}>
      <div className="kv-session-main">
        <div className="kv-session-header-row">
          <div className="kv-session-title-block">
            <div className="kv-session-kicker">KaiVoh · Glyph Session</div>

            <div className="kv-session-keyline">
              <span className="kv-meta-item kv-meta-phikey">
                <span className="kv-meta-label">Φ-Key</span>
                <span className="kv-meta-value">{shortKey(session.phiKey)}</span>
              </span>

              <span className="kv-meta-divider" />

              <span className="kv-meta-item">
                <span className="kv-meta-label">Sigil Pulse</span>
                <span className="kv-meta-value">{session.pulse}</span>
              </span>

              <span className="kv-meta-divider" />

              <span className="kv-meta-item">
                <span className="kv-meta-label">Chakra</span>
                <span className="kv-meta-value">{session.chakraDay ?? "Crown"}</span>
              </span>

              {ledgerCount > 0 ? (
                <>
                  <span className="kv-meta-divider" />
                  <span className="kv-meta-item kv-meta-activity">
                    <span className="kv-meta-label">Sealed</span>
                    <span className="kv-meta-value">
                      {ledgerCount} {ledgerCount === 1 ? "post" : "posts"}
                    </span>
                  </span>
                </>
              ) : null}
            </div>

            <div className="kv-session-live">
              <span className="kv-live-label">Live Kai Pulse</span>
              <span className="kv-live-value">
                {pulseDisplay}
                <span className="kv-live-countdown">· next breath in {countdownLabel}</span>
              </span>
            </div>
          </div>

          <div className="kv-session-status-block">
            <span
              className={[
                "kv-accounts-pill",
                hasConnectedAccounts ? "kv-accounts-pill--ok" : "kv-accounts-pill--warn",
              ].join(" ")}
            >
              {hasConnectedAccounts ? "Accounts linked" : "Connect accounts"}
            </span>
            <span className="kv-step-current-label">{FLOW_LABEL[step] ?? "Flow"}</span>
          </div>
        </div>

        <div className="kv-session-steps-row">
          <StepIndicator current={step} />
        </div>
      </div>

      <div className="kv-session-actions">
        <button type="button" onClick={onNewPost} className="kv-btn kv-btn-primary">
          + Exhale Memory
        </button>
        <button type="button" onClick={onLogout} className="kv-btn kv-btn-ghost">
          ⏻ Inhale Memories
        </button>
      </div>
    </header>
  );
}

interface ActivityStripProps {
  ledger: PostEntry[];
}

function ActivityStrip({ ledger }: ActivityStripProps): ReactElement | null {
  if (!ledger || ledger.length === 0) return null;

  const lastFew = [...ledger].sort((a, b) => b.pulse - a.pulse).slice(0, 4);

  return (
    <section className="kv-activity">
      <div className="kv-activity-header">
        <span className="kv-activity-title">Session Activity</span>
        <span className="kv-activity-count">{ledger.length} total</span>
      </div>

      <div className="kv-activity-list">
        {lastFew.map((entry) => (
          <div key={`${entry.platform}-${entry.pulse}-${entry.link}`} className="kv-activity-item">
            <div className="kv-activity-item-main">
              <span className="kv-activity-platform">{entry.platform}</span>
              <span className="kv-activity-pulse">
                Pulse <span>{entry.pulse}</span>
              </span>
            </div>

            {entry.link ? (
              <a href={entry.link} target="_blank" rel="noreferrer" className="kv-activity-link">
                {entry.link}
              </a>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Flow                                     */
/* -------------------------------------------------------------------------- */

function KaiVohFlow(): ReactElement {
  const { session, setSession, clearSession } = useSession();

  const [step, setStep] = useState<FlowStep>("login");
  const [post, setPost] = useState<ComposedPost | null>(null);
  const [sealed, setSealed] = useState<SealedPost | null>(null);
  const [finalMedia, setFinalMedia] = useState<EmbeddedMediaResult | null>(null);
  const [verifierData, setVerifierData] = useState<VerifierData | null>(null);

  const [flowError, setFlowError] = useState<string | null>(null);

  /* Live Kai pulse + countdown (KKS v1) */
  const [livePulse, setLivePulse] = useState<number | null>(null);
  const [msToNextPulse, setMsToNextPulse] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const tick = async (): Promise<void> => {
      const now = new Date();
      const kai = await fetchKaiOrLocal(undefined, now);
      if (cancelled) return;

      const pulseNow = kai.pulse;
      const nextPulseMsBI = epochMsFromPulse(pulseNow + 1);

      let remaining = Number(nextPulseMsBI - BigInt(now.getTime()));
      if (!Number.isFinite(remaining) || remaining < 0) remaining = 0;

      setLivePulse(pulseNow);
      setMsToNextPulse(remaining);
    };

    void tick();
    const timer = window.setInterval(() => void tick(), 250);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const hasConnectedAccounts = useMemo(() => {
    if (!session || !session.connectedAccounts) return false;
    return Object.keys(session.connectedAccounts).length > 0;
  }, [session]);

  /* ---------------------------------------------------------------------- */
  /*                          Session + Sigil Handling                      */
  /* ---------------------------------------------------------------------- */

  const handleSigilVerified = async (_svgText: string, rawMeta: unknown): Promise<void> => {
    try {
      setFlowError(null);

      const meta = parseSigilMeta(rawMeta);
      if (!meta) throw new Error("Malformed sigil metadata from login.");

      const expectedPhiKey = await derivePhiKeyFromSig(meta.kaiSignature);

      if (meta.userPhiKey && meta.userPhiKey !== expectedPhiKey) {
        console.warn("[KaiVoh] Embedded userPhiKey differs from derived; preferring derived from signature.", {
          embedded: meta.userPhiKey,
          derived: expectedPhiKey,
        });
      }

      if (!isValidPhiKeyShape(expectedPhiKey)) {
        throw new Error("Invalid Φ-Key shape after derivation.");
      }

      const sessionChakra: ChakraDay = normalizeChakraDay(meta.chakraDay) ?? "Crown";

      const nextSession: SessionData = {
        phiKey: expectedPhiKey,
        kaiSignature: meta.kaiSignature,
        pulse: meta.pulse,
        chakraDay: sessionChakra,
        connectedAccounts: meta.connectedAccounts ?? {},
        postLedger: meta.postLedger ?? [],
      };

      setSession(nextSession);

      if (Object.keys(nextSession.connectedAccounts ?? {}).length > 0) setStep("compose");
      else setStep("connect");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid Φ-Key signature or metadata.";
      setFlowError(msg);
      setStep("login");
    }
  };

  const handleLogout = (): void => {
    if (!session) return;

    const nextSvg = buildNextSigilSvg(session);
    downloadSigil(`sigil-${session.pulse + 1}.svg`, nextSvg);

    clearSession();
    setPost(null);
    setSealed(null);
    setFinalMedia(null);
    setVerifierData(null);
    setFlowError(null);
    setStep("login");
  };

  const handleNewPost = (): void => {
    setPost(null);
    setSealed(null);
    setFinalMedia(null);
    setVerifierData(null);
    setFlowError(null);
    setStep("compose");
  };

  /* ---------------------------------------------------------------------- */
  /*                          Embedding Kai Signature                       */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;

    (async (): Promise<void> => {
      if (step !== "embed" || !sealed || !session) return;

      try {
        const mediaRaw = await embedKaiSignature(sealed);
        if (cancelled) return;

        const originPulse = session.pulse;
        const exhalePulse = sealed.pulse;

        const baseMeta: KaiSigKksMetadataShape = mediaRaw.metadata;

        // 🔒 Canonical proof signature = what the file will claim
        const proofSig = (baseMeta.kaiSignature ?? sealed.kaiSignature ?? session.kaiSignature ?? "").trim();
        if (!proofSig) throw new Error("Missing kaiSignature for embedded proof.");

        // ✅ Canonical Φ-Key derived from the exact embedded signature
        const proofPhiKey = await derivePhiKeyFromSig(proofSig);

        // Optional hard invariant — prevents minting broken artifacts
        if (session.phiKey && session.phiKey !== proofPhiKey) {
          throw new Error("Proof mismatch: embedded kaiSignature derives a different Φ-Key than session.");
        }

        // ✅ Canonical chakraDay precedence:
        //    sealed (moment) → baseMeta (if string) → session → Crown
        const baseChakraRaw = typeof baseMeta.chakraDay === "string" ? baseMeta.chakraDay : undefined;

        const proofChakraDay: ChakraDay =
          normalizeChakraDay(sealed.chakraDay ?? undefined) ??
          normalizeChakraDay(baseChakraRaw) ??
          normalizeChakraDay(session.chakraDay ?? undefined) ??
          "Crown";

        // ✅ canonical verifier URL (never null)
        const verifierUrl = buildVerifierUrl(exhalePulse, proofSig);

        const mergedMetadata: ExtendedKksMetadata = {
          ...baseMeta,

          pulse: exhalePulse,
          kaiPulse: exhalePulse,

          chakraDay: proofChakraDay,

          kaiSignature: proofSig,
          phiKey: proofPhiKey,
          userPhiKey: proofPhiKey,
          phiKeyShort: `φK-${proofPhiKey.slice(0, 8)}`,

          // ✅ bind URL to the proof object (never null)
          verifierUrl,

          originPulse,
          sigilPulse: originPulse,
          exhalePulse,
        };

        // If this is SVG, rewrite the SVG <metadata> so the *file itself* carries mergedMetadata.
        let content = mediaRaw.content;
        if (mediaRaw.type === "image" && content.type.includes("svg")) {
          content = await embedMetadataIntoSvgBlob(content, mergedMetadata);
        }

        const ext =
          safeFileExt(mediaRaw.filename) ||
          safeFileExt(sealed.post.file.name) ||
          (mediaRaw.type === "video" ? ".mp4" : ".svg");

        const filename = `memory_p${originPulse}_p${exhalePulse}${ext}`;

        const media: EmbeddedMediaResult = {
          ...mediaRaw,
          content,
          filename,
          metadata: mergedMetadata,
        };

        setFinalMedia(media);

        // ✅ canonical proof capsule for Share step + Verify step
        setVerifierData({
          pulse: exhalePulse,
          kaiSignature: proofSig,
          phiKey: proofPhiKey,
          chakraDay: proofChakraDay,
          verifierUrl,
        });

        setStep("share");
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Failed to embed Kai Signature into media.";
        setFlowError(msg);
        setStep("compose");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step, sealed, session]);

  /* ---------------------------------------------------------------------- */
  /*                             Ledger Helpers                             */
  /* ---------------------------------------------------------------------- */

  const appendBroadcastToLedger = (results: { platform: string; link: string }[], pulse: number): void => {
    if (!session || results.length === 0) return;

    const existing = session.postLedger ?? [];
    const appended: PostEntry[] = [
      ...existing,
      ...results.map((r) => ({
        pulse,
        platform: r.platform,
        link: r.link,
      })),
    ];

    setSession({ ...session, postLedger: appended });
  };

  /* ---------------------------------------------------------------------- */
  /*                                Rendering                               */
  /* ---------------------------------------------------------------------- */

  if (!session || step === "login") {
    return (
      <div className="kai-voh-login-shell">
        <main className="kv-main-card">
          <SigilLogin onVerified={handleSigilVerified} />
          {flowError ? <p className="kv-error">{flowError}</p> : null}
        </main>
      </div>
    );
  }

  const renderStep = (): ReactElement => {
    if (step === "connect") {
      return (
        <div className="kv-connect-step">
          <KaiVoh />
          <button
            type="button"
            onClick={() => setStep("compose")}
            className="kv-btn kv-btn-primary kv-btn-wide"
          >
            Continue to Compose
          </button>
        </div>
      );
    }

    if (step === "compose" && !post) {
      return (
        <PostComposer
          onReady={(p: ComposedPost) => {
            setPost(p);
            setSealed(null);
            setFinalMedia(null);
            setVerifierData(null);
            setFlowError(null);
            setStep("seal");
          }}
        />
      );
    }

    if (step === "seal" && post) {
      return (
        <BreathSealer
          post={post}
          identityKaiSignature={session.kaiSignature} // ✅ required (stable identity sig)
          userPhiKey={session.phiKey} // ✅ optional but recommended
          onSealComplete={(sealedPost: SealedPost) => {
            setSealed(sealedPost);
            setStep("embed");
          }}
        />
      );
    }

    if (step === "embed") {
      return <p className="kv-embed-status">Embedding Kai Signature into your media…</p>;
    }

    if (step === "share" && finalMedia && sealed && verifierData) {
      return (
        <MultiShareDispatcher
          media={finalMedia}
          proof={verifierData} // ✅ KEY FIX: share-step proof copy uses canonical capsule
          onComplete={(results) => {
            appendBroadcastToLedger(results, sealed.pulse);
            setStep("verify");
          }}
        />
      );
    }

    if (step === "verify" && verifierData) {
      return (
        <div className="kv-verify-step">
          <VerifierFrame
            pulse={verifierData.pulse}
            kaiSignature={verifierData.kaiSignature}
            phiKey={verifierData.phiKey}
            chakraDay={verifierData.chakraDay}
            compact={false}
          />

          <p className="kv-verify-copy">
            Your memory is now verifiable as human-authored under this Φ-Key. Anyone can scan the QR or open the verifier link to confirm it
            was sealed at this pulse under your sigil.
          </p>

          <div className="kv-verify-actions">
            <button type="button" onClick={handleNewPost} className="kv-btn kv-btn-primary">
              + Exhale Memory
            </button>
            <button type="button" onClick={handleLogout} className="kv-btn kv-btn-ghost">
              ⏻ Inhale Memories
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="kv-error-state">
        Something went sideways in the breath stream…
        <button type="button" onClick={handleNewPost} className="kv-error-reset">
          Reset step
        </button>
      </div>
    );
  };

  return (
    <div className="kai-voh-app-shell">
      <SessionHud
        session={session}
        step={step}
        hasConnectedAccounts={hasConnectedAccounts}
        onLogout={handleLogout}
        onNewPost={handleNewPost}
        livePulse={livePulse}
        msToNextPulse={msToNextPulse}
      />

      <main className="kv-main-card">
        {renderStep()}
        {flowError ? <p className="kv-error">{flowError}</p> : null}
      </main>

      {session.postLedger && session.postLedger.length > 0 ? <ActivityStrip ledger={session.postLedger} /> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   App                                      */
/* -------------------------------------------------------------------------- */

export default function KaiVohApp(): ReactElement {
  return (
    <SessionProvider>
      <KaiVohFlow />
    </SessionProvider>
  );
}
