// /components/KaiVoh/SignatureEmbedder.ts
import type { SealedPost } from "./BreathSealer";
import { momentFromPulse, STEPS_BEAT, type ChakraDay } from "../../utils/kai_pulse";
import { derivePhiKeyFromSig } from "../VerifierStamper/sigilUtils";

export interface KaiSigKksMediaDescriptor {
  kind: "image" | "video";
  mimeType: string;
  filename: string;
  sizeBytes: number;
}

export interface KaiSigKksPostDescriptor {
  caption: string | null;
  originUrl: string | null;
  authorHandle: string | null;
  authorDisplayName: string | null;
}

export interface KaiSigKksMetadata {
  /** Kai Signature Spec v1.0 */
  spec: "KKS-1.0";
  specVersion: "1.0";
  kksType: "kai-sigil-signature";

  /** App context (KaiVoh client) */
  app: "KaiVoh";
  appVersion: string;

  /** Kairos moment */
  pulse: number;
  kaiPulse: number;
  beat: number;
  stepIndex: number;
  stepsPerBeat: number;
  chakraDay: ChakraDay | null;
  kaiMomentId: string; // `${pulse}|${beat}|${stepIndex}|${chakraDay}`

  /** Identity */
  kaiSignature: string;
  userPhiKey: string | null;
  /** Legacy + human-readable short label (first 8 hex chars) */
  phiKey: string;
  phiKeyShort: string;

  /** Human layer */
  caption: string | null;
  timestamp: string; // ISO-8601

  /** KKS envelope details */
  kksNonce: string | null;
  hashes: {
    /** SHA-256 over the canonical statement payload (UTF-8 JSON) */
    statement: string;
  };

  /** Canonical statement that was signed (for audit) */
  statement: {
    caption: string | null;
    media: KaiSigKksMediaDescriptor;
  };

  /** Extra app-level description (for clients) */
  post: KaiSigKksPostDescriptor;
}

export interface EmbeddedMediaResult {
  type: "image" | "video";
  content: Blob;
  filename: string;
  metadata: KaiSigKksMetadata;
}

/**
 * Extra optional fields we *may* get from BreathSealer without forcing them
 * on the core SealedPost type.
 */
interface KaiVohSealedPostExtras {
  beat?: number;
  stepIndex?: number;
  userPhiKey?: string | null;
  kksNonce?: string | null;
}
function normalizeKaiSignature(sig: string): string {
  let s = sig.trim();
  if (s.startsWith("0x") || s.startsWith("0X")) s = s.slice(2);
  if (/^[0-9a-fA-F]+$/.test(s)) s = s.toLowerCase();
  return s;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Deterministic SHA-256 hex helper over a JSON-serializable payload or string. */
async function sha256HexFromJson(payload: unknown): Promise<string> {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hashBuf);
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Resolve a coherent Kai moment from pulse (plus any upstream hints on the sealed post).
 */
function resolveMoment(
  sealed: SealedPost & KaiVohSealedPostExtras
): {
  beat: number;
  stepIndex: number;
  chakraDay: ChakraDay | null;
  stepsPerBeat: number;
} {
  const { pulse } = sealed;
  const core = momentFromPulse(pulse) as {
    beat?: number;
    stepIndex?: number;
    chakraDay?: ChakraDay;
    stepsPerBeat?: number;
  };

  const beat =
    typeof sealed.beat === "number"
      ? sealed.beat
      : typeof core.beat === "number"
        ? core.beat
        : 0;

  const stepIndex =
    typeof sealed.stepIndex === "number"
      ? sealed.stepIndex
      : typeof core.stepIndex === "number"
        ? core.stepIndex
        : 0;

  const chakraDay: ChakraDay | null =
    (sealed.chakraDay as ChakraDay | undefined) ??
    (core.chakraDay as ChakraDay | undefined) ??
    null;

  const stepsPerBeat =
    typeof core.stepsPerBeat === "number" ? core.stepsPerBeat : STEPS_BEAT;

  return { beat, stepIndex, chakraDay, stepsPerBeat };
}

/**
 * Build the KKS-1.0 Kai Signature envelope for this sealed post.
 */
async function buildKksMetadata(
  sealed: SealedPost & KaiVohSealedPostExtras,
  mediaKind: "image" | "video"
): Promise<KaiSigKksMetadata> {
  const { post, pulse, kaiSignature } = sealed;

  if (!kaiSignature || kaiSignature.length === 0) {
    throw new Error("embedKaiSignature: kaiSignature is required.");
  }

  const { beat, stepIndex, chakraDay, stepsPerBeat } = resolveMoment(sealed);

  const file = post.file;
  const caption = (post.caption ?? null) as string | null;

  const originUrl =
    (post as { originUrl?: string }).originUrl ??
    (post as { url?: string }).url ??
    null;

  const authorHandle =
    (post as { authorHandle?: string }).authorHandle ?? null;
  const authorDisplayName =
    (post as { authorDisplayName?: string }).authorDisplayName ?? null;

  const timestamp = new Date().toISOString();
  const proofSig = normalizeKaiSignature(kaiSignature);

  // ✅ Derive canonical Φ-Key from the exact embedded signature
  const derivedPhiKey = await derivePhiKeyFromSig(proofSig);

  // Optional invariant: if upstream supplied userPhiKey, it MUST match
  const upstreamPhiKey = sealed.userPhiKey ?? null;
  if (upstreamPhiKey && upstreamPhiKey !== derivedPhiKey) {
    throw new Error("embedKaiSignature: userPhiKey does not match derived Φ-Key from kaiSignature.");
  }

  const userPhiKey = derivedPhiKey;

  // Display-only short label (keep if you want)
  const phiKeyShort = `φK-${derivedPhiKey.slice(0, 8)}`;

  const statementMedia: KaiSigKksMediaDescriptor = {
    kind: mediaKind,
    mimeType: file.type,
    filename: file.name,
    sizeBytes: file.size,
  };

  const statementPayload = {
    caption,
    media: statementMedia,
    pulse,
    beat,
    stepIndex,
    chakraDay,
  };

  const statementHash = await sha256HexFromJson(statementPayload);

  const momentId = `${pulse}|${beat}|${stepIndex}|${chakraDay ?? "Unknown"}`;

  const kksNonce = sealed.kksNonce ?? null;

  const postDescriptor: KaiSigKksPostDescriptor = {
    caption,
    originUrl,
    authorHandle,
    authorDisplayName,
  };

  const meta: KaiSigKksMetadata = {
    spec: "KKS-1.0",
    specVersion: "1.0",
    kksType: "kai-sigil-signature",

    app: "KaiVoh",
    appVersion: "1.0.0",

    pulse,
    kaiPulse: pulse,
    beat,
    stepIndex,
    stepsPerBeat,
    chakraDay,
    kaiMomentId: momentId,

    kaiSignature: proofSig,

    // ✅ these must be the *real* Φ-Key (base58), not a label
    userPhiKey,
    phiKey: derivedPhiKey,

    // keep short for UI if desired
    phiKeyShort,


    caption,
    timestamp,

    kksNonce,
    hashes: {
      statement: statementHash,
    },

    statement: {
      caption,
      media: statementMedia,
    },

    post: postDescriptor,
  };

  return meta;
}

export async function embedKaiSignature(
  sealed: SealedPost
): Promise<EmbeddedMediaResult> {
  const extended = sealed as SealedPost & KaiVohSealedPostExtras;
  const { post, pulse } = extended;

  const mediaKind: "image" | "video" = post.mediaType === "video" ? "video" : "image";
  const metadata = await buildKksMetadata(extended, mediaKind);

  // SVG path → embed KKS JSON into <metadata>.
  if (post.mediaType === "image" && post.file.type.includes("svg")) {
    const rawText = await post.file.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawText, "image/svg+xml");

    if (doc.querySelector("parsererror")) {
      throw new Error("Invalid SVG content (parsererror present).");
    }

    const root = doc.documentElement;
    if (
      !root ||
      root.namespaceURI !== SVG_NS ||
      root.tagName.toLowerCase() !== "svg"
    ) {
      throw new Error("Not an SVG root document.");
    }

    const metas = doc.getElementsByTagName("metadata");
    let metaEl: SVGMetadataElement;

    if (metas.length > 0) {
      metaEl = metas.item(0)!;
    } else {
      const created = doc.createElementNS(SVG_NS, "metadata");
      metaEl = created as SVGMetadataElement;
      root.appendChild(metaEl);
    }

    // Single, canonical JSON block per KKS-1.0
    metaEl.textContent = JSON.stringify(metadata, null, 2);

    const serializer = new XMLSerializer();
    const updatedSvg = serializer.serializeToString(doc);

    return {
      type: "image",
      content: new Blob([updatedSvg], { type: "image/svg+xml" }),
      filename: `sigil-${pulse}.svg`,
      metadata,
    };
  }

  // Non-SVG images → we still return the full KKS envelope,
  // but cannot physically embed it into a binary image here.
  if (post.mediaType === "image") {
    return {
      type: "image",
      content: post.file,
      filename: post.file.name,
      metadata,
    };
  }

  // Video → same: envelope travels alongside the Blob.
  return {
    type: "video",
    content: post.file,
    filename: post.file.name,
    metadata,
  };
}
