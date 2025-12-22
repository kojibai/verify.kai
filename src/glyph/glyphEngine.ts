// src/glyph/glyphEngine.ts
// 🧠 Core Recursive Glyph Engine — Deterministic + Pure
// Harmonizes Kairos glyph valuation, evolution, and lineage logic.

import type { Glyph, GlyphMetadata } from "./types";
import { computeIntrinsicUnsigned } from "../utils/valuation";
import type { SigilTransfer, SigilMetadataLite } from "../utils/valuation";

// ─────────────────────────────────────────────────────────────
// 🔒 Deterministic helpers (NO Math.random, NO Date.now)
// ─────────────────────────────────────────────────────────────

/** 32-bit FNV-1a → stable hex (deterministic, fast, pure) */
function fnv1a32Hex(input: string): string {
  let hash = 0x811c9dc5; // offset basis
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // hash *= 16777619 (with 32-bit overflow)
    hash = Math.imul(hash, 0x01000193);
  }
  // >>>0 to unsigned, pad to 8 hex chars
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Deterministic “kaiSignature” for an evolution: stable for (parent, pulse, patch). */
function deriveKaiSignature(
  parent: Glyph,
  pulse: number,
  updates?: Partial<GlyphMetadata>
): string {
  const parentSig = parent.metadata?.kaiSignature ?? "";
  const patchSig = typeof updates?.kaiSignature === "string" ? updates.kaiSignature : "";
  const patchTs = typeof updates?.timestamp === "number" ? String(updates.timestamp) : "";

  // NOTE: we intentionally avoid JSON.stringify(updates) to prevent key-order ambiguity.
  const seed = `evolve|p=${pulse}|parentHash=${parent.hash}|parentSig=${parentSig}|patchSig=${patchSig}|patchTs=${patchTs}`;
  return `glyph::${pulse}::${fnv1a32Hex(seed)}`;
}

// ─────────────────────────────────────────────────────────────
// 🔁 Generate a new glyph based on an existing one (evolution step)
// Adds lineage and recalculates value using intrinsic valuation
// ─────────────────────────────────────────────────────────────
export function evolveGlyph(
  parent: Glyph,
  pulse: number,
  updates?: Partial<GlyphMetadata>
): Glyph {
  // ✅ deterministic kaiSignature (no randomness)
  const kaiSignature = deriveKaiSignature(parent, pulse, updates);

  // ✅ timestamp must be a number; keep it deterministic by default:
  // - if caller provides updates.timestamp, respect it
  // - else stamp with Kai pulse (stable + sortable + purely Kai-native)
  const timestamp: number =
    typeof updates?.timestamp === "number" ? updates.timestamp : pulse;

  // Merge metadata (parent ⊕ updates) and stamp with new signature + timestamp
  const metadata: GlyphMetadata = {
    ...(parent.metadata ?? {}),
    ...(updates ?? {}),
    kaiSignature,
    timestamp,
  };

  // For now, use kaiSignature as the glyph hash
  const hash = kaiSignature;

  // Construct the derivative glyph shell (value to be computed below)
  const newGlyph: Glyph = {
    hash,
    pulseCreated: pulse,
    pulseGenesis: parent.pulseGenesis ?? parent.pulseCreated,
    parentHash: parent.hash,
    sentFrom: parent.hash,
    value: 1, // replaced after valuation
    inhaled: {},
    metadata,
  };

  // 🧩 Convert our minimal SentTransfer[] into valuation-layer SigilTransfer[]
  const transfers: SigilTransfer[] = (parent.sentTo ?? []).map((t) => ({
    senderSignature: parent.metadata?.kaiSignature ?? parent.hash,
    senderStamp: parent.hash,
    senderKaiPulse: t.pulseSent,
    receiverSignature: t.recipientHash,
    // receiverStamp, receiverKaiPulse, payload are optional and not known here
  }));

  // Build a *typed* SigilMetadataLite for valuation
  const metaForValuation: SigilMetadataLite = {
    pulse, // claim/creation pulse for this glyph
    kaiSignature, // signature of the glyph being valued
    seriesSize: 1,
    quality: "med",
    creatorVerified: false,
    creatorRep: 0,
    transfers,
    cumulativeTransfers: transfers.length,
  };

  // Run deterministic intrinsic valuation at `pulse`
  const { unsigned } = computeIntrinsicUnsigned(metaForValuation, pulse);
  newGlyph.value = unsigned.valuePhi;

  return newGlyph;
}

// ─────────────────────────────────────────────────────────────
// 🔬 Trace a glyph's ancestral lineage (requires resolver)
// ─────────────────────────────────────────────────────────────
export async function traceLineage(
  glyph: Glyph,
  getGlyphByHash: (hash: string) => Promise<Glyph | null>
): Promise<Glyph[]> {
  const lineage: Glyph[] = [];
  let currentHash = glyph.parentHash;

  while (currentHash) {
    const parent = await getGlyphByHash(currentHash);
    if (!parent) break;
    lineage.unshift(parent);
    currentHash = parent.parentHash;
  }

  return lineage;
}

// ─────────────────────────────────────────────────────────────
// 🧪 Check whether two glyphs share the same genesis pulse
// ─────────────────────────────────────────────────────────────
export function haveCommonGenesis(a: Glyph, b: Glyph): boolean {
  return (
    a.pulseGenesis !== undefined &&
    b.pulseGenesis !== undefined &&
    a.pulseGenesis === b.pulseGenesis
  );
}

// ─────────────────────────────────────────────────────────────
// 📬 Sum of Φ sent out from a glyph
// ─────────────────────────────────────────────────────────────
export function totalSentPhi(glyph: Glyph): number {
  return (glyph.sentTo ?? []).reduce((sum, t) => sum + t.amount, 0);
}

// ─────────────────────────────────────────────────────────────
// 📊 Glyph age in pulses
// ─────────────────────────────────────────────────────────────
export function ageInPulses(glyph: Glyph, nowPulse: number): number {
  return Math.max(0, nowPulse - glyph.pulseCreated);
}
