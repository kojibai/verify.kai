// src/components/VerifierStamper/constants.ts
/* Constants used across VerifierStamper */

// KKS v1 — φ-exact breath period and canonical genesis
export const GENESIS_TS = 1715323541888 as const; // 2024-05-10 06:45:41.888 UTC
import { kaiNowMs } from "../../utils/kaiNow";

// Breath period T = 3 + √5 seconds → milliseconds
export const PULSE_MS = (3 + Math.sqrt(5)) * 1000; // ≈ 5236.06797749979 ms


export const kaiPulseNow = () =>
  Math.floor((kaiNowMs() - GENESIS_TS) / PULSE_MS);

export const SIGIL_CTX = "https://schema.phi.network/sigil/v1" as const;
export const SIGIL_TYPE = "application/phi.kairos.sigil+svg" as const;

/* Segment / proofs policy */
export const SEGMENT_SIZE = 2_000 as const; // head-window live transfers cap before rolling a segment
