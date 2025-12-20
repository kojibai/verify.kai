// src/glyph/glyphEngine.ts
// 🧠 Core Recursive Glyph Engine — Deterministic + Pure
// Harmonizes Kairos glyph valuation, evolution, and lineage logic.

import type { Glyph, GlyphMetadata } from "./types";
import { computeIntrinsicUnsigned } from "../utils/valuation";
import type { SigilTransfer, SigilMetadataLite } from "../utils/valuation";
import { kaiNowMs } from "../utils/kaiNow";

// ─────────────────────────────────────────────────────────────
// 🔁 Generate a new glyph based on an existing one (evolution step)
// Adds lineage and recalculates value using intrinsic valuation
// ─────────────────────────────────────────────────────────────
export function evolveGlyph(
  parent: Glyph,
  pulse: number,
  updates?: Partial<GlyphMetadata>
): Glyph {
  // Mint a new kaiSignature for this derivative glyph (deterministic placeholder)
  const kaiSignature = `glyph::${pulse}::${Math.random().toString(36).slice(2, 10)}`;

  // Merge metadata (parent ⊕ updates) and stamp with new signature + timestamp
  const metadata: GlyphMetadata = {
    ...(parent.metadata ?? {}),
    ...(updates ?? {}),
    kaiSignature,
    timestamp: kaiNowMs(),
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
    value: 1,             // temporary placeholder; replaced after valuation
    inhaled: {},
    metadata,
  };

  // 🧩 Convert our minimal SentTransfer[] into valuation-layer SigilTransfer[]
  // We only have: recipientHash, amount, pulseSent
  // Map to: senderSignature (parent's signature or hash), senderStamp (use hash),
  // senderKaiPulse (pulseSent), receiverSignature (recipientHash)
  const transfers: SigilTransfer[] = (parent.sentTo ?? []).map((t) => ({
    senderSignature: parent.metadata?.kaiSignature ?? parent.hash,
    senderStamp: parent.hash,
    senderKaiPulse: t.pulseSent,
    receiverSignature: t.recipientHash,
    // receiverStamp, receiverKaiPulse, payload are optional and not known here
  }));

  // Build a *typed* SigilMetadataLite for valuation
  const metaForValuation: SigilMetadataLite = {
    pulse,                         // claim/creation pulse for this glyph
    kaiSignature,                  // signature of the glyph being valued
    // choose defaults to keep types tight and deterministic:
    seriesSize: 1,
    quality: "med",
    creatorVerified: false,
    creatorRep: 0,
    transfers,
    cumulativeTransfers: transfers.length,
    // Optional rhythmic fields if you want to feed them later:
    // beat, stepIndex, stepsPerBeat, frequencyHz, chakraGate, etc.
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
