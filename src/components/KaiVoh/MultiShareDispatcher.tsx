// /components/KaiVoh/MultiShareDispatcher.tsx
"use client";

/**
 * MultiShareDispatcher — Connected broadcast + manual share hub
 * v1.5 — FIX: Share-step proof capsule is now canonical
 *        - shareMetadata ALWAYS includes a non-empty verifierUrl
 *        - chakraDay is normalized to canonical ChakraDay labels (e.g., "Third Eye", "Solar Plexus")
 *        - SocialConnector (manual share + copy-proof) now receives the corrected proof capsule
 *
 * Guarantees:
 * ✅ metadata.verifierUrl is never null/empty (computed if missing)
 * ✅ metadata.chakraDay is normalized (never "ThirdEye"/"Solar")
 * ✅ Captions always use the same proof URL shown/copied
 */

import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { useSession } from "../session/useSession";
import type { EmbeddedMediaResult } from "./SignatureEmbedder";

import SocialConnector from "./SocialConnector";
import type { SocialMediaPayload, SocialPlatform } from "./SocialConnector.shared";

import { buildVerifierUrl, normalizeChakraDay } from "./verifierProof";
import type { ChakraDay } from "../../utils/kai_pulse";

import "./styles/MultiShareDispatcher.css";

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */

/** Platforms we can broadcast to via backend /api/post/:platform */
type BroadcastPlatform = "x" | "ig" | "tiktok" | "threads";

export type MultiShareDispatcherProps = Readonly<{
  media: EmbeddedMediaResult;
  /**
   * Optional canonical proof capsule from the flow (preferred).
   * If provided, it overrides any stale/partial fields in media.metadata.
   */
  proof?: Readonly<{
    pulse: number;
    kaiSignature: string;
    phiKey: string;
    chakraDay?: ChakraDay;
    verifierUrl?: string;
  }>;
  onComplete: (result: { platform: BroadcastPlatform; link: string }[]) => void;
}>;

type PostResult = Readonly<{
  platform: BroadcastPlatform;
  link: string;
}>;

type PlatformStatus = Readonly<{
  platform: BroadcastPlatform;
  label: string;
  handle?: string;
}>;

type SigMetadata = EmbeddedMediaResult["metadata"];
type ShareMetadata = NonNullable<SocialMediaPayload["metadata"]>;

type SelectionMap = Record<BroadcastPlatform, boolean>;

/* -------------------------------------------------------------------------- */
/*                               Type Guards                                  */
/* -------------------------------------------------------------------------- */

function isBroadcastPlatform(k: string): k is BroadcastPlatform {
  return k === "x" || k === "ig" || k === "tiktok" || k === "threads";
}

function isHttpUrl(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.trim().length > 0 &&
    (v.startsWith("http://") || v.startsWith("https://"))
  );
}

function readString(meta: Record<string, unknown>, key: string): string | undefined {
  const v = meta[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function readNumber(meta: Record<string, unknown>, key: string): number | undefined {
  const v = meta[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/*                         Caption / Verify URL helpers                       */
/* -------------------------------------------------------------------------- */

function ensureMaxLen(s: string, limit: number): string {
  if (s.length <= limit) return s;
  return `${s.slice(0, Math.max(0, limit - 1))}…`;
}

/**
 * Sanitize KaiSig / KKS metadata into a primitive-only, share-safe bag.
 * - Only primitive fields (string | number | boolean | null | undefined)
 * - Ensures canonical keys exist:
 *   pulse, kaiSignature, phiKey, chakraDay, verifierUrl, etc.
 *
 * IMPORTANT:
 * - We ALWAYS guarantee verifierUrl is a non-empty http(s) URL by computing it if missing.
 * - We normalize chakraDay using the canonical ChakraDay literals.
 */
function sanitizeMetadataForSocial(
  meta: SigMetadata | undefined,
  proof?: MultiShareDispatcherProps["proof"],
): ShareMetadata {
  const result: ShareMetadata = {};
  const source = (meta ?? {}) as Record<string, unknown>;

  // ----- Pulse (prefer proof) -----
  const pulseNumber =
    typeof proof?.pulse === "number" && Number.isFinite(proof.pulse)
      ? proof.pulse
      : readNumber(source, "pulse");

  if (typeof pulseNumber === "number") result.pulse = pulseNumber;

  // ----- Kai Signature (prefer proof) -----
  const kaiSignature =
    typeof proof?.kaiSignature === "string" && proof.kaiSignature.trim().length > 0
      ? proof.kaiSignature.trim()
      : readString(source, "kaiSignature");

  if (typeof kaiSignature === "string") result.kaiSignature = kaiSignature;

  // ----- PhiKey (prefer proof) -----
  const phiKey =
    typeof proof?.phiKey === "string" && proof.phiKey.trim().length > 0
      ? proof.phiKey.trim()
      : readString(source, "phiKey");

  if (typeof phiKey === "string") result.phiKey = phiKey;

  // ----- Chakra day (prefer proof, normalize) -----
  const chakraRaw =
    typeof proof?.chakraDay === "string" && proof.chakraDay.trim().length > 0
      ? proof.chakraDay
      : readString(source, "chakraDay");

  const chakraNormalized = normalizeChakraDay(chakraRaw);
  if (typeof chakraNormalized === "string") result.chakraDay = chakraNormalized;

  // ----- Verifier URL (prefer proof/meta, otherwise compute) -----
  const metaVerifier = source["verifierUrl"];
  const proofVerifier = proof?.verifierUrl;

  let verifierUrl: string | undefined;
  if (isHttpUrl(proofVerifier)) verifierUrl = proofVerifier.trim();
  else if (isHttpUrl(metaVerifier)) verifierUrl = metaVerifier.trim();

  // If still missing, compute deterministically (never null/empty)
  const safePulse = typeof pulseNumber === "number" ? pulseNumber : 0;
  const safeSig = typeof kaiSignature === "string" && kaiSignature.length > 0 ? kaiSignature : "unknown-signature";
  if (!verifierUrl) verifierUrl = buildVerifierUrl(safePulse, safeSig);

  result.verifierUrl = verifierUrl;

  // Copy a few extra well-known KKS fields (primitives only) for future-proofing.
  const extraKeys = ["beat", "stepIndex", "step", "kaiTime", "kksVersion", "userPhiKey", "timestamp"] as const;

  for (const key of extraKeys) {
    const value = source[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Build a platform-specific caption.
 * Uses sanitized ShareMetadata so everything is deterministic and safe.
 */
function buildCaption(meta: ShareMetadata, platform: BroadcastPlatform, handle?: string): string {
  const pulseRaw = meta.pulse;
  const pulseDisplay = typeof pulseRaw === "number" ? pulseRaw : "∞";

  const fullSig = typeof meta.kaiSignature === "string" ? meta.kaiSignature : "";
  const shortSig = fullSig.slice(0, 10);

  const phiKey = typeof meta.phiKey === "string" && meta.phiKey.length > 0 ? meta.phiKey : "φK";

  const link = typeof meta.verifierUrl === "string" && meta.verifierUrl.length > 0 ? meta.verifierUrl : buildVerifierUrl(0, "unknown-signature");

  const baseHashtags = ["#KaiKlok", "#SigilProof", "#PostedByBreath"];
  const platformHashtags: Record<BroadcastPlatform, string[]> = {
    x: baseHashtags,
    ig: [...baseHashtags, "#HarmonicTime"],
    tiktok: [...baseHashtags, "#KaiTime", "#ForYou"],
    threads: [...baseHashtags, "#Threads"],
  };

  const byline = handle ? ` by @${handle}` : "";

  if (platform === "x") {
    const oneLine = [
      `🌀 Pulse ${pulseDisplay}${byline}`,
      `Sig:${shortSig}`,
      `ID:${phiKey}`,
      `Verify:${link}`,
      ...platformHashtags.x,
    ].join(" • ");
    return ensureMaxLen(oneLine, 270);
  }

  if (platform === "ig") {
    return [
      `🌀 Pulse ${pulseDisplay}${byline}`,
      `Sig: ${shortSig}`,
      `ID: ${phiKey}`,
      `Verify: ${link}`,
      "",
      platformHashtags.ig.join(" "),
    ].join("\n");
  }

  if (platform === "tiktok") {
    return [
      `Verify: ${link}`,
      `🌀 Pulse ${pulseDisplay}${byline}`,
      `Sig: ${shortSig} • ID: ${phiKey}`,
      platformHashtags.tiktok.join(" "),
    ].join("\n");
  }

  return [
    `🌀 Pulse ${pulseDisplay}${byline}`,
    `Sig: ${shortSig} • ID: ${phiKey}`,
    `Verify: ${link}`,
    platformHashtags.threads.join(" "),
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/*                          MultiShareDispatcher UI                           */
/* -------------------------------------------------------------------------- */

export default function MultiShareDispatcher({ media, proof, onComplete }: MultiShareDispatcherProps): ReactElement {
  const { session } = useSession();

  // Connected accounts → broadcast targets
  const targets = useMemo<PlatformStatus[]>(() => {
    const list: PlatformStatus[] = [];
    const accounts = session?.connectedAccounts;
    if (!accounts) return list;

    for (const [k, v] of Object.entries(accounts)) {
      if (!v) continue;
      if (!isBroadcastPlatform(k)) continue;

      const label =
        k === "x"
          ? "X / Twitter"
          : k === "ig"
            ? "Instagram"
            : k === "tiktok"
              ? "TikTok"
              : "Threads";

      list.push({ platform: k, label, handle: v });
    }
    return list;
  }, [session?.connectedAccounts]);

  // Connected set (stable, derived)
  const connected = useMemo(() => new Set<BroadcastPlatform>(targets.map((t) => t.platform)), [targets]);

  /**
   * User overrides only.
   * - undefined => default selection logic applies
   * - true/false => user explicitly chose it
   */
  const [overrides, setOverrides] = useState<Partial<SelectionMap>>({});

  // Derived effective selection (NO effect, no cascading renders)
  const selection = useMemo<SelectionMap>(() => {
    const get = (p: BroadcastPlatform): boolean => {
      if (!connected.has(p)) return false; // cannot select what isn't connected
      const ov = overrides[p];
      return typeof ov === "boolean" ? ov : true; // default: selected when connected
    };

    return {
      x: get("x"),
      ig: get("ig"),
      tiktok: get("tiktok"),
      threads: get("threads"),
    };
  }, [connected, overrides]);

  const toggle = (p: BroadcastPlatform): void => {
    setOverrides((prev) => {
      const currently = connected.has(p)
        ? typeof prev[p] === "boolean"
          ? (prev[p] as boolean)
          : true
        : false;

      const nextVal = !currently;
      return { ...prev, [p]: nextVal };
    });
  };

  const [broadcastStatus, setBroadcastStatus] = useState<"idle" | "posting" | "done">("idle");
  const [broadcastResults, setBroadcastResults] = useState<ReadonlyArray<PostResult>>([]);

  // Manual share tracking (from SocialConnector)
  const [manualShared, setManualShared] = useState(false);
  const [lastManualPlatform, setLastManualPlatform] = useState<SocialPlatform | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);

  /* ------------------------------------------------------------------------ */
  /*                   Canonical share metadata & payload                     */
  /* ------------------------------------------------------------------------ */

  const shareMetadata = useMemo<ShareMetadata>(() => sanitizeMetadataForSocial(media.metadata, proof), [media.metadata, proof]);

  const socialMedia = useMemo<SocialMediaPayload>(() => {
    const payloadType: SocialMediaPayload["type"] =
      media.type === "video" ? "video" : "image";

    return {
      content: media.content,
      filename: media.filename,
      type: payloadType,
      metadata: shareMetadata,
    };
  }, [media.content, media.filename, media.type, shareMetadata]);

  /* ------------------------------------------------------------------------ */
  /*                             Backend posting                              */
  /* ------------------------------------------------------------------------ */

  async function postToPlatform(platform: BroadcastPlatform, handle?: string): Promise<{ link: string }> {
    const form = new FormData();
    form.append("file", media.content, media.filename);

    const caption = buildCaption(shareMetadata, platform, handle);
    form.append("caption", caption);

    if (handle) form.append("handle", handle);

    const res = await fetch(`/api/post/${platform}`, {
      method: "POST",
      body: form,
    });

    if (!res.ok) throw new Error(`POST /api/post/${platform} failed: ${res.status}`);

    const json = (await res.json()) as { url?: string };
    return { link: json.url ?? "#" };
  }

  const handlePostSelected = async (): Promise<void> => {
    if (!session) return;

    const selectedTargets = targets.filter((t) => selection[t.platform]);
    if (selectedTargets.length === 0) return;

    setBroadcastStatus("posting");
    setBroadcastResults([]);

    const posted = await Promise.all(
      selectedTargets.map(async (t) => {
        try {
          const result = await postToPlatform(t.platform, t.handle);
          return { platform: t.platform, link: result.link } as const;
        } catch (e) {
          console.warn(`Post to ${t.platform} failed:`, e);
          return { platform: t.platform, link: "❌ Failed" } as const;
        }
      }),
    );

    setBroadcastResults(posted);
    setBroadcastStatus("done");
  };

  const allDisabled = targets.length === 0 || !targets.some((t) => selection[t.platform]);
  const canContinue = broadcastStatus === "done" || manualShared;

  /* ------------------------------------------------------------------------ */
  /*                                   Render                                 */
  /* ------------------------------------------------------------------------ */

  return (
    <div className="kv-share-shell flex flex-col gap-6 w-full max-w-2xl">
      <header className="kv-share-header">
        <h2 className="kv-share-title">Broadcast to connected socials</h2>
        <p className="kv-share-subtitle">
          Post directly to linked accounts, then (or instead) use the manual share hub below to reach any platform — every share carries your Kai-Sigil proof.
        </p>
      </header>

      <section className="kv-share-broadcast">
        {targets.length === 0 ? (
          <p className="kv-share-empty">No platforms connected yet. You can still share manually below.</p>
        ) : (
          <>
            <div className="kv-share-connected-label">Connected accounts</div>

            <div className="grid grid-cols-2 gap-3 w-full">
              {targets.map((t) => (
                <label
                  key={t.platform}
                  className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition ${
                    selection[t.platform] ? "border-emerald-400 bg-emerald-400/10" : "border-white/20 bg-white/5"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="accent-emerald-400"
                    checked={selection[t.platform]}
                    onChange={() => toggle(t.platform)}
                  />

                  <div className="flex flex-col">
                    <span className="text-sm font-medium">
                      {t.label} {t.handle ? `· @${t.handle}` : ""}
                    </span>
                    <span className="text-xs opacity-60">Auto-post via KaiVoh</span>
                  </div>
                </label>
              ))}
            </div>

            <div className="mt-3">
              <button
                type="button"
                disabled={allDisabled || broadcastStatus === "posting"}
                onClick={() => void handlePostSelected()}
                className={`kv-btn kv-btn-primary ${allDisabled || broadcastStatus === "posting" ? "kv-btn-disabled" : ""}`}
              >
                {broadcastStatus === "posting"
                  ? "Posting with breath…"
                  : allDisabled
                    ? "No platforms selected"
                    : "Post to Selected"}
              </button>
            </div>

            {broadcastStatus === "done" ? (
              <div className="kv-share-results mt-3">
                <h3 className="text-xs uppercase tracking-wide opacity-60 mb-2">Post results</h3>
                <ul className="text-sm space-y-1">
                  {broadcastResults.map((r) => (
                    <li key={r.platform} className="flex items-center gap-2 break-all">
                      <span className="font-semibold min-w-[80px] capitalize">{r.platform}</span>
                      <span>:</span>
                      {r.link === "❌ Failed" ? (
                        <span className="text-red-400">{r.link}</span>
                      ) : (
                        <a href={r.link} target="_blank" rel="noopener noreferrer" className="underline">
                          {r.link}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="kv-share-manual">
        <SocialConnector
          media={socialMedia}
          onShared={(platform) => {
            setManualShared(true);
            setLastManualPlatform(platform);
            setManualError(null);
          }}
          onError={(_platform, err) => {
            setManualError(err.message);
          }}
        />

        {lastManualPlatform ? (
          <p className="kv-share-status text-xs opacity-70 mt-2">
            Last shared via <span className="font-semibold">{lastManualPlatform}</span>.
          </p>
        ) : null}

        {manualError ? (
          <p className="kv-share-error text-xs text-red-400 mt-1">{manualError}</p>
        ) : null}
      </section>

      <footer className="kv-share-footer mt-4 flex flex-col items-center gap-2">
        <button
          type="button"
          className={`kv-btn kv-btn-primary ${!canContinue ? "kv-btn-disabled" : ""}`}
          disabled={!canContinue}
          onClick={() => {
            onComplete(broadcastResults.map((r) => ({ platform: r.platform, link: r.link })));
          }}
        >
          {canContinue ? "Continue to Verify" : "Share at least once to continue"}
        </button>
      </footer>
    </div>
  );
}
