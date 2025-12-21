// 🜁 Glyph Utilities — Recursive Harmonic Tools for Eternal Memory
// Crafted in alignment with Divine Law — no mutation, no incoherence

import { XMLParser } from "fast-xml-parser";
import { kairosEpochNow } from "../utils/kai_pulse";
import type { Glyph, SentTransfer } from "./types";

// ─────────────────────────────────────────────────────────────
// 🪞 Deep clone a glyph (safe memory separation)
// Used before mutation or recursive transfer
// ─────────────────────────────────────────────────────────────
export function cloneGlyph(original: Glyph): Glyph {
  return JSON.parse(JSON.stringify(original));
}

// ─────────────────────────────────────────────────────────────
// 💎 Format a Φ value to 3 decimals (default UI precision)
// ─────────────────────────────────────────────────────────────
export function formatPhi(value: number, decimals = 3): string {
  return `${value.toFixed(decimals)} Φ`;
}

// ─────────────────────────────────────────────────────────────
// ⚖️ Calculate harmonic ratio (φ = 1.618...) from a base
// Useful for value scaling, healing, yield, etc.
// ─────────────────────────────────────────────────────────────
export function phiRatio(base: number): number {
  const PHI = (1 + Math.sqrt(5)) / 2;
  return base * PHI;
}

// ─────────────────────────────────────────────────────────────
// 🧬 Safe recursive merge: combine two glyphs’ memories
// Does not overwrite but appends inhaled + sentTo records
// ─────────────────────────────────────────────────────────────
export function mergeGlyphs(target: Glyph, source: Glyph): Glyph {
  const result = cloneGlyph(target);

  if (!result.inhaled) result.inhaled = {};
  if (source.inhaled) {
    for (const [hash, data] of Object.entries(source.inhaled)) {
      result.inhaled[hash] = data;
    }
  }

  if (!result.sentTo) result.sentTo = [];
  if (source.sentTo) {
    result.sentTo.push(...source.sentTo);
  }

  result.value += source.value;
  return result;
}

// ─────────────────────────────────────────────────────────────
// 📦 Send a new glyph from a source glyph
// - Deducts Φ from source
// - Records transfer trail
// - Generates new kaiSignature
// - Resets inhaled memory
// ─────────────────────────────────────────────────────────────
export function sendGlyphFromSource(
  source: Glyph,
  amount: number,
  pulse: number,
  recipientHash?: string,
  message?: string
): Glyph {
  if (amount <= 0) throw new Error("Amount must be positive.");
  if (source.value < amount) throw new Error("Insufficient glyph balance.");

  const newKaiSignature = `glyph::${pulse}::${Math.random().toString(36).slice(2, 10)}`;
  const newHash = newKaiSignature;

  const newGlyph: Glyph = {
    hash: newHash,
    pulseCreated: pulse,
    parentHash: source.hash,
    sentFrom: source.hash,
    value: amount,
    sentTo: recipientHash
      ? [{ recipientHash, amount, pulseSent: pulse }]
      : [],
    note: message ?? "",
    inhaled: {},
    metadata: {
      ...(source.metadata ?? {}),
      kaiSignature: newKaiSignature,
      timestamp: kairosEpochNow(),
    },
  };

  source.value -= amount;

  if (!source.sentTo) source.sentTo = [];
  if (recipientHash) {
    const transfer: SentTransfer = {
      recipientHash,
      amount,
      pulseSent: pulse,
    };
    source.sentTo.push(transfer);
  }

  return newGlyph;
}

// ─────────────────────────────────────────────────────────────
// 💠 Guard: Ensure object is a valid Glyph
// ─────────────────────────────────────────────────────────────
export function isValidGlyph(obj: unknown): obj is Glyph {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "hash" in obj &&
    "pulseCreated" in obj &&
    "value" in obj &&
    typeof (obj as Glyph).hash === "string" &&
    typeof (obj as Glyph).pulseCreated === "number" &&
    typeof (obj as Glyph).value === "number"
  );
}

// ─────────────────────────────────────────────────────────────
// 🧾 Parse an imported glyph from .svg or .json content
// Validates format and converts to Glyph
// ─────────────────────────────────────────────────────────────
export function parseImportedGlyph(fileText: string): Glyph {
  try {
    const json = JSON.parse(fileText);
    if (isValidGlyph(json)) return json;
  } catch {
    // Not JSON — continue to SVG fallback
  }

  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
    });

    const parsed = parser.parse(fileText);
    const svg = parsed.svg;

    const hash = svg["data-hash"] ?? svg["hash"];
    const pulseCreated = parseInt(svg["data-pulse"] ?? svg["pulseCreated"], 10);
    const value = parseFloat(svg["data-value"] ?? "0");

    if (!hash || isNaN(pulseCreated) || isNaN(value)) {
      throw new Error("Missing or invalid glyph data in SVG.");
    }

    const metadata = {
      ...svg.metadata,
      timestamp: kairosEpochNow(),
    };

    const glyph: Glyph = {
      hash,
      pulseCreated,
      value,
      metadata,
    };

    return glyph;
  } catch {
    throw new Error("Invalid glyph format. Not a valid JSON or SVG.");
  }
}

// ─────────────────────────────────────────────────────────────
// 🗃️ Load stored glyphs from localStorage (or empty array fallback)
// Used by Vault, Transfer UI, and Session Memory
// ─────────────────────────────────────────────────────────────
export function loadStoredGlyphs(): Glyph[] {
  try {
    const raw = localStorage.getItem("kai_glyph_vault");
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isValidGlyph);
  } catch (err) {
    console.error("Failed to load stored glyphs:", err);
    return [];
  }
}
