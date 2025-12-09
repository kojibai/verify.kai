import type { SessionData } from "../session/sessionTypes";


/**
 * KaiVoh Session Memory Builder — KKS v1.0 aligned
 *
 * Produces a REAL KaiSigil-style SVG using the same math + constants
 * as the live KaiSigil component, but as a pure string for download.
 *
 * This is a "logout sigil": a frozen memory of the session state
 * (Φ-Key, pulse, ledger, accounts, chakra day, etc.) at the moment
 * you mint the next sigil.
 *
 * The embedded <metadata> payload is shaped to match what the Verifier
 * expects for a sealed Sigil, so the memory glyph can be opened and
 * inspected just like a send/receive SVG.
 */

import {
  CHAKRAS,
  CHAKRA_GATES,
  CENTER,
  PHI,
  SPACE,
  hsl,
  lissajousPath,
  polygonPath,
  normalizeChakraDayKey,
} from "../KaiSigil/constants";
import { deriveFrequencyHzSafe } from "../KaiSigil/freq";
import { makeSummary } from "../KaiSigil/helpers";

// Kai-Klok canonical engine (KKS v1.0)
import {
  momentFromPulse,
  STEPS_BEAT,
  type ChakraDay,
} from "../../utils/kai_pulse";
import { PULSE_MS } from "../../utils/kai_pulse";

// Share the same metadata contract as Verifier / Valuation / Explorer
import { SIGIL_CTX, SIGIL_TYPE } from "../VerifierStamper/constants";

/* ────────────────────────────────────────────────────────────────────
   Φ-Key resolver
   - Ensures we ALWAYS feed the Verifier a pure string Φ-Key.
   - Handles both string and structured phiKey objects gracefully.
   - Never uses `any`.
   ──────────────────────────────────────────────────────────────────── */

function resolvePhiKey(session: SessionData): string {
  const raw = (session as { phiKey?: unknown }).phiKey;

  // Simple case: already a clean string Φ-Key
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length > 0) return trimmed;
  }

  // Structured case: pull a stable identity field out of an object
  if (raw && typeof raw === "object") {
    // id
    if ("id" in raw && typeof (raw as { id: unknown }).id === "string") {
      const id = (raw as { id: string }).id.trim();
      if (id.length > 0) return id;
    }

    // key
    if ("key" in raw && typeof (raw as { key: unknown }).key === "string") {
      const key = (raw as { key: string }).key.trim();
      if (key.length > 0) return key;
    }

    // address
    if (
      "address" in raw &&
      typeof (raw as { address: unknown }).address === "string"
    ) {
      const address = (raw as { address: string }).address.trim();
      if (address.length > 0) return address;
    }

    // nested userPhiKey
    if (
      "userPhiKey" in raw &&
      typeof (raw as { userPhiKey: unknown }).userPhiKey === "string"
    ) {
      const userPhiKey = (raw as { userPhiKey: string }).userPhiKey.trim();
      if (userPhiKey.length > 0) return userPhiKey;
    }
  }

  // Anonymous fallback: Verifier will treat this as anonymous / to-be-bound.
  if (typeof session.kaiSignature === "string" && session.kaiSignature.length) {
    return `φK-${session.kaiSignature.slice(0, 8)}`;
  }

  return "φK-unknown";
}

/**
 * Build the SVG string for the next KaiVoh session memory sigil.
 *
 * NOTE:
 * - We intentionally DO NOT set `kaiSignature` so the glyph is treated
 *   as "unsigned" content-wise (Verifier can always seal it later with Σ).
 * - We DO embed the user's Φ-Key and the session Kai-Signature separately
 *   so the memory remains fully inspectable.
 * - `pulse` / geometry is anchored at the FINAL EXHALE pulse of this session,
 *   not just the original upload pulse. This matches how live sigils mint.
 */
export function buildNextSigilSvg(session: SessionData): string {
  // ---- Core session identity / pulses -------------------------------------
  const originPulse = session.pulse;

  const lastPostPulse =
    session.postLedger && session.postLedger.length > 0
      ? session.postLedger.reduce(
          (max, p) => (p.pulse > max ? p.pulse : max),
          session.postLedger[0].pulse
        )
      : originPulse;

  // Snapshot pulse = actual logout/exhale moment that this memory is minted at.
  const snapshotPulse = lastPostPulse;
  const exhalePulse = lastPostPulse;

  // Canonical Kai-Klok moment at snapshot (KKS v1.0)
  const snapshotMoment = momentFromPulse(snapshotPulse) as {
    stepIndex: number;
    beat: number;
    chakraDay: ChakraDay;
  };

  const stepIndex = snapshotMoment.stepIndex;
  const beat = snapshotMoment.beat;
  const stepsPerBeat = STEPS_BEAT; // 44 steps/beat in Kai-Klok spec

  // Chakra day normalization (prefer explicit session, else moment’s own)
  const chakraDayKey = normalizeChakraDayKey(
    (session.chakraDay ?? snapshotMoment.chakraDay) as ChakraDay
  );

  // ---- KaiSigil geometry (same formulas as KaiSigil.tsx, but frozen) ------
  // Phase within the current beat (0..1) — deterministic, KKS-aligned
  const stepWithinBeat = stepIndex % stepsPerBeat;
  const visualPhase = stepWithinBeat / stepsPerBeat;
  const visualClamped = Math.max(0, Math.min(1, visualPhase));

  const chakraConfig = CHAKRAS[chakraDayKey];
  const chakraGate = CHAKRA_GATES[chakraDayKey];
  const { sides, hue } = chakraConfig;

  // Lissajous + polygon parameters (same seeds as live KaiSigil)
  const a = (snapshotPulse % 7) + 1;
  const b = (beat % 5) + 2;
  const delta = visualClamped * 2 * Math.PI;
  const rotation = (PHI ** 2 * Math.PI * (snapshotPulse % 97)) % (2 * Math.PI);

  const light = 50 + 15 * Math.sin(visualClamped * 2 * Math.PI);
  const baseColor = hsl(
    (hue + 360 * 0.03 * visualClamped) % 360,
    100,
    light
  );

  const corePath = polygonPath(sides, rotation);
  const auraPath = lissajousPath(a, b, delta);

  const strokeCore = SPACE * 0.009;
  const dotR = SPACE * 0.016;

  // Frequency derived from chakra + stepIndex (same as Verifier / Valuation)
  const frequencyHz = deriveFrequencyHzSafe(chakraDayKey, stepIndex);

  // ---- Identity snapshot ---------------------------------------------------
  const phiKey = resolvePhiKey(session);

  // Human summary string (no eternal seal text; pure snapshot)
  const summary = makeSummary(
    undefined,
    beat,
    stepIndex,
    snapshotPulse
  );

  // ---- Φ “DNA ring” derived from the Φ-Key (visual identity) --------------
  // This is a deterministic phi-band encoded from the Φ-Key string, so
  // identity is visible in the geometry without text.
  const phiSeed = Array.from(phiKey).reduce(
    (acc, ch) => (acc * 131 + ch.charCodeAt(0)) % 104729,
    0
  );

  const markerCount = 12; // 12-fold ring, φ-modulated
  const phiRadius = SPACE * 0.31;

  const phiMarkersSvg = Array.from({ length: markerCount })
    .map((_, idx) => {
      const t = (idx + (phiSeed % 100) / 100) / markerCount;
      const angle = t * 2 * Math.PI;
      const rJitter = (phiSeed % 7) / 100;
      const r =
        phiRadius *
        (1 + rJitter * Math.sin(2 * Math.PI * t * PHI));

      const x = CENTER + r * Math.cos(angle);
      const y = CENTER + r * Math.sin(angle);
      const localR =
        dotR * (0.5 + 0.5 * Math.sin(2 * Math.PI * t * PHI));

      return `    <circle cx="${x.toFixed(3)}" cy="${y.toFixed(
        3
      )}" r="${localR.toFixed(3)}" fill="${baseColor}" opacity="0.7" />`;
    })
    .join("\n");

  // ---- Memory metadata (SigilMetadata-compatible, KKS v1.0) ----------------
  const createdAt = new Date().toISOString();

  const meta = {
    // Shared Sigil contract so Verifier / Explorer treat this as a real Sigil
    "@context": SIGIL_CTX,
    type: SIGIL_TYPE,

    // Spec marker
    kksVersion: "KKS-1.0",

    // Distinguish this glyph as a KaiVoh session memory
    kind: "KaiVohSessionMemory",
    logoutSigil: true,

    // Core Kai-Sigil coordinates (what Verifier expects)
    pulse: snapshotPulse, // geometry anchor = snapshot (final exhale)
    beat,
    stepIndex,
    stepsPerBeat,
    chakraDay: chakraDayKey,
    chakraGate,
    frequencyHz,
    pulseMs: PULSE_MS,

    // Identity: Φ-Key and session signature snapshot
    userPhiKey: phiKey,
    // We keep the session's Kai-Signature, but do NOT treat it as Σ(content)
    sessionKaiSignature: session.kaiSignature,

    // Extra helpful aliases for explorers / tooling
    phiKey,
    originPulse,
    exhalePulse,
    sigilPulse: snapshotPulse, // where geometry is anchored
    kaiPulse: exhalePulse, // last exhale in this session

    // Session memory payload (all actions during this session)
    connectedAccounts: session.connectedAccounts ?? {},
    postLedger: session.postLedger ?? [],

    summary,
    createdAt,
  };

  const title = `KaiVoh Memory • Φ-Key ${phiKey} • p${originPulse}→p${exhalePulse}`;

  // ---- SVG assembly --------------------------------------------------------
  return `
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 ${SPACE} ${SPACE}"
     width="${SPACE}"
     height="${SPACE}">
  <title>${title}</title>
  <desc>${summary}</desc>

  <defs>
    <!-- Background radial gradient -->
    <radialGradient id="kv-mem-bg" cx="50%" cy="45%" r="75%">
      <stop offset="0%" stop-color="${baseColor}" stop-opacity="0.18" />
      <stop offset="45%" stop-color="${baseColor}" stop-opacity="0.04" />
      <stop offset="100%" stop-color="#02040a" stop-opacity="1" />
    </radialGradient>

    <!-- Soft glow around the core -->
    <filter id="kv-mem-glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="${SPACE * 0.025}" result="blur" />
      <feColorMatrix
        in="blur"
        type="matrix"
        values="0 0 0 0 0.7
                0 0 0 0 1
                0 0 0 0 0.9
                0 0 0 0.7 0" />
    </filter>

    <!-- Inner orb gradient -->
    <radialGradient id="kv-mem-orb" cx="50%" cy="50%" r="60%">
      <stop offset="0%" stop-color="${baseColor}" stop-opacity="0.9" />
      <stop offset="45%" stop-color="${baseColor}" stop-opacity="0.25" />
      <stop offset="100%" stop-color="#02040a" stop-opacity="0" />
    </radialGradient>
  </defs>

  <!-- Background -->
  <rect x="0" y="0" width="${SPACE}" height="${SPACE}" fill="url(#kv-mem-bg)" />

  <!-- Aura + core (glow group) -->
  <g filter="url(#kv-mem-glow)" stroke-linecap="round" stroke-linejoin="round">
    <!-- Outer Kai-lissajous orbit -->
    <path
      d="${auraPath}"
      fill="none"
      stroke="${baseColor}"
      stroke-width="${SPACE * 0.0025}"
      opacity="0.55"
    />
    <!-- Core polygon (diamond / star) -->
    <path
      d="${corePath}"
      fill="none"
      stroke="${baseColor}"
      stroke-width="${strokeCore}"
      opacity="0.9"
    />
    <!-- Inner orb -->
    <circle
      cx="${CENTER}"
      cy="${CENTER}"
      r="${SPACE * 0.12}"
      fill="url(#kv-mem-orb)"
    />
    <!-- Central Kai pulse point -->
    <circle
      cx="${CENTER}"
      cy="${CENTER}"
      r="${dotR}"
      fill="${baseColor}"
    />
    <!-- Φ “DNA ring” derived from Φ-Key (visual identity, no text) -->
${phiMarkersSvg}
  </g>

  <!-- Embedded memory/meta payload (Verifier-compatible JSON) -->
  <metadata><![CDATA[
${JSON.stringify(meta, null, 2)}
  ]]></metadata>
</svg>`.trim();
}

/**
 * Convenience helper:
 * Build + download a KaiVoh session memory sigil with a canonical,
 * UNIQUE filename pattern, mirroring Verifier's `sigil_receive` naming:
 *
 *   sigil_memory_<originPulse>_<exhalePulse>_<ISO>.svg
 *
 * where:
 *   originPulse = session.pulse    (start of session)
 *   exhalePulse = last post pulse  (or originPulse if none)
 *   ISO         = logout moment in ISO8601, safe for filenames
 */
export function downloadSessionMemorySigil(session: SessionData): void {
  const svgContent = buildNextSigilSvg(session);

  const originPulse = session.pulse;
  const exhalePulse =
    session.postLedger && session.postLedger.length > 0
      ? session.postLedger.reduce(
          (max, p) => (p.pulse > max ? p.pulse : max),
          session.postLedger[0].pulse
        )
      : originPulse;

  const isoSafe = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");

  const filename = `sigil_memory_${originPulse}_${exhalePulse}_${isoSafe}.svg`;
  downloadSigil(filename, svgContent);
}

/**
 * Low-level download helper (kept generic).
 * If you want custom filenames elsewhere, you can still call this directly.
 */
export function downloadSigil(filename: string, svgContent: string): void {
  const blob = new Blob([svgContent], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);
}
