/* ────────────────────────────────────────────────────────────────
   kai.ts · Atlantean Lumitech “Harmonic Core”
   v25.3 — Pure-JS Poseidon, ESLint-clean, runtime-robust
──────────────────────────────────────────────────────────────────
   ✦ Breath-synchronous Kai-Pulse maths (Genesis: 10 May 2024 06:45:41.888 UTC)
   ✦ poseidon-lite ⊕ BLAKE3 → deterministic kai_signature
   ✦ Zero Node shims · Zero `any` · Works in every evergreen browser
────────────────────────────────────────────────────────────────── */

////////////////////////////////////////////////////////////////////////////////
// ░░  DEPENDENCIES  ░░  (Poseidon is loaded lazily to shrink bundle size)
////////////////////////////////////////////////////////////////////////////////

import { blake3 } from "@noble/hashes/blake3";
import { bytesToHex } from "@noble/hashes/utils";
import { kairosEpochNow, microPulsesSinceGenesis } from "./kai_pulse";

////////////////////////////////////////////////////////////////////////////////
// ░░  CONSTANTS  ░░
////////////////////////////////////////////////////////////////////////////////

/** Genesis Breath — the harmonic epoch (ms). MUST match kai_pulse.ts exactly. */
export const GENESIS_TS = 1715323541888 as const; // 2024-05-10T06:45:41.888Z

/** System Intention — silent mantra baked into every signature. */
export const SYSTEM_INTENTION = "Enter my portal";

////////////////////////////////////////////////////////////////////////////////
// ░░  PULSE LOGIC  ░░
////////////////////////////////////////////////////////////////////////////////

const MICRO_PER_PULSE = 1_000_000n;

function bigintToSafeNumber(v: bigint): number {
  if (v <= 0n) return 0;
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (v > max) return Number.MAX_SAFE_INTEGER;
  return Number(v);
}

/**
 * Returns the current Kai-Pulse number since Genesis.
 * Uses kai_pulse.ts fixed-point bridge (μpulses) → no float drift, no bigint↔number type traps.
 */
export const getCurrentKaiPulse = (now: bigint = kairosEpochNow()): number => {
  const micro = microPulsesSinceGenesis(now); // bigint μpulses since Genesis
  const pulse = micro / MICRO_PER_PULSE;      // floor to integer pulse index
  return bigintToSafeNumber(pulse);
};

////////////////////////////////////////////////////////////////////////////////
// ░░  INTERNAL HELPERS  ░░
////////////////////////////////////////////////////////////////////////////////

/* — Poseidon loader — */
type PoseidonFn = (inputs: bigint[]) => bigint;
let poseidonFn: PoseidonFn | null = null;

/** Runtime type-guard. */
const isPoseidon = (f: unknown): f is PoseidonFn => typeof f === "function";

/** Resolve *whatever* export shape poseidon-lite uses, exactly once. */
const getPoseidon = async (): Promise<PoseidonFn> => {
  if (poseidonFn) return poseidonFn;

  const mod: unknown = await import("poseidon-lite");

  // Shape 1: named export  poseidon(...)
  const named = (mod as { poseidon?: unknown }).poseidon;
  if (isPoseidon(named)) {
    poseidonFn = named;
    return poseidonFn;
  }

  // Shape 2: default export  function poseidon(...)
  const def = (mod as { default?: unknown }).default;
  if (isPoseidon(def)) {
    poseidonFn = def;
    return poseidonFn;
  }

  // Shape 3: default export  { poseidon }
  if (typeof def === "object" && def !== null) {
    const inner = (def as { poseidon?: unknown }).poseidon;
    if (isPoseidon(inner)) {
      poseidonFn = inner;
      return poseidonFn;
    }
  }

  // Shape 4: module itself is callable
  if (isPoseidon(mod)) {
    poseidonFn = mod;
    return poseidonFn;
  }

  throw new Error("poseidon-lite: no callable Poseidon export found");
};

/* — UTF-8 → bigint (field-ish element) — */
const stringToBigInt = (s: string): bigint => {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length === 0) return 0n;

  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return BigInt(`0x${hex}`);
};

function hexToBytes(hex: string): Uint8Array {
  const h = (hex ?? "").trim().toLowerCase();
  if (!h) return new Uint8Array(0);
  if (h.length % 2 !== 0) throw new Error("hexToBytes: invalid hex length");

  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
    out[i] = Number.isFinite(byte) ? byte : 0;
  }
  return out;
}

/* — Poseidon⟨pulse,intention⟩ → 64-char hex — */
const poseidonHashHex = async (pulse: number, intention: string): Promise<string> => {
  const poseidon = await getPoseidon();
  const out = poseidon([BigInt(pulse), stringToBigInt(intention)]);
  return out.toString(16).padStart(64, "0");
};

/* — BLAKE3( hex ) → 64-char hex (lower-case) — */
const blake3HashHex = (hexInput: string): string => {
  const bytes = hexToBytes(hexInput);
  return bytesToHex(blake3(bytes));
};

////////////////////////////////////////////////////////////////////////////////
// ░░  PUBLIC API  ░░
////////////////////////////////////////////////////////////////////////////////

/**
 * Computes the immutable **kai_signature** for a given pulse.
 *
 * @param pulse      Kai-Pulse number (`getCurrentKaiPulse()`).
 * @param intention  Optional override (defaults to SYSTEM_INTENTION).
 * @returns          64-char lower-case hex signature.
 */
export const computeKaiSignature = async (
  pulse: number,
  intention: string = SYSTEM_INTENTION,
): Promise<string> => {
  const poseidonHex = await poseidonHashHex(pulse, intention);
  return blake3HashHex(poseidonHex);
};
