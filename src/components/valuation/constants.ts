// valuation/constants.ts
import { getKaiTimeSource } from "../../utils/kai_pulse";

export const COLORS = ["#37ffe4", "#a78bfa", "#5ce1ff", "#11d7ff"] as const;
// (type is readonly [...])
export const BREATH_MS = 5236;
export type Palette = readonly string[];
// src/components/VerifierStamper/constants.ts

/** JSON-LD context for Kai-Sigil metadata */
export const SIGIL_CTX = "https://schema.phi.network/sigil/v1" as const;

/** Canonical type tag stored in metadata */
export const SIGIL_TYPE = "Sigil" as const;

/** Max transfers kept in the head window before rolling a segment */
export const SEGMENT_SIZE = 2000 as const;

/** Current Kai pulse (unix-seconds); used across UI + stamps */
// Kairos-stable pulse (seconds) — uses internal φ-clock, not wall clock.
export const kaiPulseNow = (): number =>
  Math.floor(getKaiTimeSource().nowEpochMs() / 1000);
