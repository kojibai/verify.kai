// src/glyph/useGlyphLogic.ts
// 🜄 Harmonic Glyph Operations — Recursive Sovereign Execution Layer

import type { Glyph } from "./types";
import { kaiNowMs } from "../utils/kaiNow";

// Constants
const DEFAULT_GROWTH_RATE = 0.000777; // Optional growth per pulse
const DEFAULT_PULSE_NOW = () => Math.floor(kaiNowMs() / 5236); // fallback Kai pulse if Kai-Klok not injected

// ─────────────────────────────────────────────────────────────
// 🫁 Get the currently available balance from a source glyph
//    after accounting for value already inhaled into a destination
// ─────────────────────────────────────────────────────────────
export function getAvailableFromInhaled(source: Glyph, target: Glyph): number {
  const inhaled = target.inhaled?.[source.hash];
  const alreadyUsed = inhaled?.amountUsed ?? 0;
  const remaining = source.value - alreadyUsed;
  return Math.max(0, remaining);
}

// ─────────────────────────────────────────────────────────────
// 🧠 Check if a glyph can inhale another glyph (with optional amount)
// ─────────────────────────────────────────────────────────────
export function canInhale(
  source: Glyph,
  target: Glyph,
  amount: number
): {
  allowed: boolean;
  available: number;
  reason?: string;
} {
  const available = getAvailableFromInhaled(source, target);
  if (amount > available) {
    return {
      allowed: false,
      available,
      reason: `Insufficient Φ. Only ${available.toFixed(3)} available.`,
    };
  }
  return { allowed: true, available };
}

// ─────────────────────────────────────────────────────────────
// 🔁 Inhale a glyph into another glyph (recursive energy transfer)
// ─────────────────────────────────────────────────────────────
export function inhaleGlyphIntoTarget(
  source: Glyph,
  target: Glyph,
  amount: number,
  pulseNow: number = DEFAULT_PULSE_NOW()
): Glyph {
  if (!target.inhaled) target.inhaled = {};

  const existing = target.inhaled[source.hash];
  const priorAmount = existing?.amountUsed ?? 0;

  target.inhaled[source.hash] = {
    glyph: source,
    amountUsed: priorAmount + amount,
    pulseInhaled: pulseNow,
  };

  target.value += amount;
  return target;
}

// ─────────────────────────────────────────────────────────────
// 📤 Send Φ from one glyph to mint a new glyph
// Returns the new derivative glyph (immutable)
// ─────────────────────────────────────────────────────────────
export function sendGlyphFromSource(
  source: Glyph,
  amount: number,
  pulseNow: number = DEFAULT_PULSE_NOW(),
  recipientHash?: string,
  message?: string
): Glyph {
  if (amount > source.value) {
    throw new Error("Attempted to send more Φ than available.");
  }

  const newGlyph: Glyph = {
    hash: generateHash(source.hash, pulseNow),
    value: amount,
    pulseCreated: pulseNow,
    pulseGenesis: source.pulseGenesis ?? source.pulseCreated,
    inhaled: {},
    sentTo: [],
    metadata: {
      name: "Derivative Glyph",
      message,
      creator: recipientHash,
      timestamp: kaiNowMs(),
    },
  };

  // Log the transfer on the source
  if (!source.sentTo) source.sentTo = [];
  source.sentTo.push({
    recipientHash: newGlyph.hash,
    amount,
    pulseSent: pulseNow,
  });

  source.value -= amount;
  return newGlyph;
}

// ─────────────────────────────────────────────────────────────
// 🧮 Optional growth handler — increase value over Kai pulses
// ─────────────────────────────────────────────────────────────
export function applyGrowth(
  glyph: Glyph,
  pulseNow: number = DEFAULT_PULSE_NOW()
): Glyph {
  const age = pulseNow - glyph.pulseCreated;
  const growth = age * (glyph.growthRate ?? DEFAULT_GROWTH_RATE);
  glyph.value += growth;
  return glyph;
}

// ─────────────────────────────────────────────────────────────
// 🧬 Hash generator — placeholder deterministic function
// To be replaced with zk-bound sigil hash
// ─────────────────────────────────────────────────────────────
function generateHash(base: string, pulse: number): string {
  return `${base.slice(0, 8)}::${pulse.toString(36)}`;
}
