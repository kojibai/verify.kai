// src/glyph/glyphUtils.ts
// 🜁 Glyph Utilities — Recursive Harmonic Tools for Eternal Memory
// Crafted in alignment with Divine Law — no mutation, no incoherence

import { XMLParser } from "fast-xml-parser";
import type { Glyph, SentTransfer } from "./types";

// ─────────────────────────────────────────────────────────────
// 🔒 Deterministic helpers (NO Math.random, NO Date.now, NO bigint leakage)
// ─────────────────────────────────────────────────────────────

/** 32-bit FNV-1a → stable hex (deterministic, fast, pure) */
function fnv1a32Hex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Deterministic signature for send: stable for (source, pulse, recipient, message, amount). */
function deriveKaiSignature(args: {
  sourceHash: string;
  pulse: number;
  amount: number;
  recipientHash?: string;
  message?: string;
}): string {
  const seed = [
    "send",
    `src=${args.sourceHash}`,
    `p=${args.pulse}`,
    `amt=${args.amount}`,
    `to=${args.recipientHash ?? ""}`,
    `msg=${args.message ?? ""}`,
  ].join("|");
  return `glyph::${args.pulse}::${fnv1a32Hex(seed)}`;
}

/**
 * kairosEpochNow() returns bigint elsewhere in your codebase.
 * GlyphMetadata.timestamp expects number.
 *
 * Canon choice here: treat "timestamp" as a Kai-native stamp (pulse).
 * If you later want epoch-ms, pass/convert upstream and set it explicitly.
 */
function stampTimestampNumber(pulse: number): number {
  return pulse;
}

// ─────────────────────────────────────────────────────────────
// 🪞 Deep clone a glyph (safe memory separation)
// Used before mutation or recursive transfer
// ─────────────────────────────────────────────────────────────
export function cloneGlyph(original: Glyph): Glyph {
  return JSON.parse(JSON.stringify(original)) as Glyph;
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
// - Generates new kaiSignature (deterministic)
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

  // ✅ deterministic signature (no Math.random)
  const newKaiSignature = deriveKaiSignature({
    sourceHash: source.hash,
    pulse,
    amount,
    recipientHash,
    message,
  });

  const newHash = newKaiSignature;

  const newGlyph: Glyph = {
    hash: newHash,
    pulseCreated: pulse,
    parentHash: source.hash,
    sentFrom: source.hash,
    value: amount,
    sentTo: recipientHash ? [{ recipientHash, amount, pulseSent: pulse }] : [],
    note: message ?? "",
    inhaled: {},
    metadata: {
      ...(source.metadata ?? {}),
      kaiSignature: newKaiSignature,
      // ✅ number, not bigint
      timestamp: stampTimestampNumber(pulse),
    },
  };

  // NOTE: this function historically mutates `source`. Keeping behavior,
  // but doing it at the end (single, explicit mutation point).
  source.value -= amount;

  if (!source.sentTo) source.sentTo = [];
  if (recipientHash) {
    const transfer: SentTransfer = { recipientHash, amount, pulseSent: pulse };
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
    const json = JSON.parse(fileText) as unknown;
    if (isValidGlyph(json)) return json;
  } catch {
    // Not JSON — continue to SVG fallback
  }

  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
    });

    const parsed = parser.parse(fileText) as unknown;
    const root = parsed as Record<string, unknown>;
    const svg = root.svg as Record<string, unknown> | undefined;

    if (!svg) throw new Error("Missing <svg> root.");

    const hashU = svg["data-hash"] ?? svg["hash"];
    const pulseU = svg["data-pulse"] ?? svg["pulseCreated"];
    const valueU = svg["data-value"] ?? "0";

    const hash = typeof hashU === "string" ? hashU : String(hashU ?? "");
    const pulseCreated = Number.parseInt(typeof pulseU === "string" ? pulseU : String(pulseU ?? ""), 10);
    const value = Number.parseFloat(typeof valueU === "string" ? valueU : String(valueU ?? "0"));

    if (!hash || !Number.isFinite(pulseCreated) || !Number.isFinite(value)) {
      throw new Error("Missing or invalid glyph data in SVG.");
    }

    const metaU = svg.metadata;
    const meta = (typeof metaU === "object" && metaU !== null ? metaU : {}) as Record<string, unknown>;

    // ✅ ensure timestamp is a number, not bigint
    const metadata = {
      ...meta,
      timestamp: stampTimestampNumber(pulseCreated),
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

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isValidGlyph);
  } catch (err) {
    console.error("Failed to load stored glyphs:", err);
    return [];
  }
}
