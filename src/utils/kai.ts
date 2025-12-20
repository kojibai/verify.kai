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
import { kaiNowMs } from "./kaiNow";

////////////////////////////////////////////////////////////////////////////////
// ░░  CONSTANTS  ░░
////////////////////////////////////////////////////////////////////////////////

/** Genesis Breath — the harmonic epoch. */
export const GENESIS_TS = Date.UTC(2024, 4, 10, 6, 45, 41, 888);

/** One Kai-Pulse = 5 .236 s (φ² ÷ 10). */
export const PULSE_MS = (3 + Math.sqrt(5)) * 1000;

/** System Intention — silent mantra baked into every signature. */
export const SYSTEM_INTENTION = "Enter my portal";

////////////////////////////////////////////////////////////////////////////////
// ░░  PULSE LOGIC  ░░
////////////////////////////////////////////////////////////////////////////////

/** Returns the current Kai-Pulse number since Genesis. */
export const getCurrentKaiPulse = (now: number = kaiNowMs()): number =>
  Math.floor((now - GENESIS_TS) / PULSE_MS);

////////////////////////////////////////////////////////////////////////////////
// ░░  INTERNAL HELPERS  ░░
////////////////////////////////////////////////////////////////////////////////

/* — Poseidon loader — */
type PoseidonFn = (inputs: bigint[]) => bigint;
let poseidonFn: PoseidonFn | null = null;

/** Runtime type-guard. */
const isPoseidon = (f: unknown): f is PoseidonFn =>
  typeof f === "function";

/** Resolve *whatever* export shape poseidon-lite uses, exactly once. */
const getPoseidon = async (): Promise<PoseidonFn> => {
  if (poseidonFn) return poseidonFn;

  const mod: unknown = await import("poseidon-lite");

  // Shape 1: named export  poseidon(...)
  if (isPoseidon((mod as { poseidon?: unknown }).poseidon)) {
    poseidonFn = (mod as { poseidon: PoseidonFn }).poseidon;
    return poseidonFn;
  }

  // Shape 2: default export  function poseidon(...)
  if (isPoseidon((mod as { default?: unknown }).default)) {
    poseidonFn = (mod as { default: PoseidonFn }).default;
    return poseidonFn;
  }

  // Shape 3: default export  { poseidon }
  const defObj = (mod as { default?: unknown }).default;
  if (
    typeof defObj === "object" &&
    defObj !== null &&
    isPoseidon((defObj as { poseidon?: unknown }).poseidon)
  ) {
    poseidonFn = (defObj as { poseidon: PoseidonFn }).poseidon;
    return poseidonFn;
  }

  // Shape 4: module itself is callable
  if (isPoseidon(mod)) {
    poseidonFn = mod;
    return poseidonFn;
  }

  throw new Error("poseidon-lite: no callable Poseidon export found");
};

/* — UTF-8 → bigint (field element) — */
const stringToBigInt = (s: string): bigint => {
  const hex = Array.from(new TextEncoder().encode(s), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return BigInt(`0x${hex || "0"}`);
};

/* — Poseidon⟨pulse,intention⟩ → 64-char hex — */
const poseidonHashHex = async (
  pulse: number,
  intention: string,
): Promise<string> => {
  const poseidon = await getPoseidon();
  const out = poseidon([BigInt(pulse), stringToBigInt(intention)]);
  return out.toString(16).padStart(64, "0");
};

/* — BLAKE3( hex ) → 64-char hex (lower-case) — */
const blake3HashHex = (hexInput: string): string => {
  const bytes = Uint8Array.from(
    hexInput.match(/.{1,2}/g)!.map((b) => Number.parseInt(b, 16)),
  );
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
