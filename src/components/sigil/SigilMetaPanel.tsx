// src/components/sigil/SigilMetaPanel.tsx
import type * as React from "react";
import { chakraDayToLabel, type SigilPayload } from "../../types/sigil";

type PressHandlers = {
  onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
};

type Props = {
  absUrl: string;
  payload: SigilPayload | null;
  chakraDay: SigilPayload["chakraDay"];
  steps: number;
  stepIndex: number; // kept for compatibility; ignored below
  stepPctDisplay: number; // kept for compatibility; ignored below
  isArchived: boolean;
  isFutureSealed: boolean;
  pulsesLeft: number | null;
  opensInPulses: number | null;
  nextPulseSeconds: string;
  hash: string | undefined;
  shortHash: string;
  copyLinkPress: PressHandlers;
  sharePress: PressHandlers;
  verified: "checking" | "ok" | "mismatch" | "notfound" | "error";
  showSkeleton: boolean;
  showError: boolean;
  stage: React.ReactNode;
};

/* ── Exact step math (μpulse-precise; matches ProvenanceList/EternalKlock) ── */
const HARMONIC_DAY_PULSES_EXACT = 17_491.270421; // exact
const CHAKRA_BEATS_PER_DAY = 36;
const PULSES_PER_STEP = 11; // 11 breaths per step
const UPULSES = 1_000_000; // μpulses per pulse
const MU_PER_DAY = Math.round(HARMONIC_DAY_PULSES_EXACT * UPULSES);

/* ── Kairos Calendar lattice (pure semantic counts) ──
   Week  = 6 Kai-Days
   Month = 7 Kai-Weeks  = 42 Kai-Days
   Year  = 8 Kai-Months = 336 Kai-Days
   All indices are ZERO-BASED for UI consistency (like Beat/Step). */
const DAYS_PER_WEEK = 6;
const WEEKS_PER_MONTH = 7;
const MONTHS_PER_YEAR = 8;
const DAYS_PER_MONTH = DAYS_PER_WEEK * WEEKS_PER_MONTH; // 42
const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR; // 336

/* NEW: φ constant for “Phi Spiral” level (matches SigilModal) */
const PHI = (1 + Math.sqrt(5)) / 2;

/* μpulse helpers */
function muPerBeat() {
  return Math.round(
    (HARMONIC_DAY_PULSES_EXACT / CHAKRA_BEATS_PER_DAY) * UPULSES
  );
}
function muPosInDayFromPulse(pulse: number) {
  const muAbs = Math.floor(pulse * UPULSES); // snap down to current μpulse
  const mu = ((muAbs % MU_PER_DAY) + MU_PER_DAY) % MU_PER_DAY;
  return mu;
}
function exactStepIndexFromPulse(pulse: number, stepsPerBeat: number): number {
  const muBeat = muPerBeat();
  const muStep = PULSES_PER_STEP * UPULSES;
  const muInBeat = muPosInDayFromPulse(pulse) % muBeat;
  const idx = Math.floor(muInBeat / muStep); // 0..(steps-1)
  return Math.min(Math.max(idx, 0), Math.max(stepsPerBeat - 1, 0));
}
function exactPercentIntoStepFromPulse(pulse: number): number {
  const muBeat = muPerBeat();
  const muStep = PULSES_PER_STEP * UPULSES;
  const muInBeat = muPosInDayFromPulse(pulse) % muBeat;
  const muInto = muInBeat % muStep;
  return Math.max(0, Math.min(1, muInto / muStep)); // 0..1
}

/* ── Kairos Calendar indices (no Chronos) ────────────────────────────────
   Compute absolute Kai-Day since Genesis, then reduce into Y/M/W/D.
   Uses BigInt for exact integer division/mod; converts to number for display. */
function kaiCalendarFromPulse(pulse: number) {
  const pμ = BigInt(Math.trunc(pulse)) * 1_000_000n; // μpulses since Genesis
  const N_DAY_μ = BigInt(MU_PER_DAY); // μpulses per Kai-Day (exact)
  const absDayIdxBI = pμ / N_DAY_μ; // floor division
  const absDayIdx = Number(absDayIdxBI); // internal 0..∞

  // Reduce into current Kai-Year
  const dYear = Number(
    ((absDayIdxBI % BigInt(DAYS_PER_YEAR)) + BigInt(DAYS_PER_YEAR)) %
      BigInt(DAYS_PER_YEAR)
  ); // 0..335
  const yearIdx = Math.floor(absDayIdx / DAYS_PER_YEAR); // 0..∞

  const monthIdx = Math.floor(dYear / DAYS_PER_MONTH); // 0..7
  const dayInMonth = (dYear % DAYS_PER_MONTH) + 1; // 1..42

  const weekOfYear = Math.floor(dYear / DAYS_PER_WEEK); // 0..55
  const weekOfMonth = Math.floor(dayInMonth / DAYS_PER_WEEK); // 0..6

  const dayOfWeek = (dYear % DAYS_PER_WEEK) + 1; // 1..6

  return {
    absDayIdx: absDayIdx + 1, // 1..∞ (display)
    yearIdx, // 0..∞
    monthIdx, // 0..7  (08 months/year)
    weekOfYear, // 0..55 (56 weeks/year)
    weekOfMonth, // 0..6  (07 weeks/month)
    dayInMonth, // 1..42 (42 days/month)
    dayOfWeek, // 1..6  (06 days/week)
  };
}

/* UI helpers */
const pad2 = (n: number) => String(n).padStart(2, "0");

export default function SigilMetaPanel({
  absUrl,
  payload,
  chakraDay,
  steps,
  /* stepIndex, stepPctDisplay, */ // ← intentionally ignored; we derive exactly
  isArchived,
  isFutureSealed,
  pulsesLeft,
  opensInPulses,
  nextPulseSeconds,
  hash,
  shortHash,
  copyLinkPress,
  sharePress,
  stage,
}: Props) {
  // ✅ derive step index + percent from pulse to guarantee exactness
  const derivedStepIndex =
    payload ? exactStepIndexFromPulse(payload.pulse, steps) : 0;
  const derivedStepPct =
    payload ? exactPercentIntoStepFromPulse(payload.pulse) : 0;

  // ✅ Kairos calendar (pure lattice + closure)
  const k = payload ? kaiCalendarFromPulse(payload.pulse) : null;

  // ✅ φ-spiral level (matches SigilModal semantics)
  const phiSpiralLevel = payload
    ? Math.floor(Math.log(Math.max(payload.pulse, 1)) / Math.log(PHI))
    : 0;

  // ✅ UI label (Crown -> Krown) while keeping internal ChakraDay unchanged
  const label = payload
    ? chakraDayToLabel(payload.chakraDay)
    : chakraDayToLabel(chakraDay);

  return (
    <div className="sp-card" role="region" aria-label="Sigil details">
      <div className="sp-status">
        <div className="sp-hash mono" title={hash || ""}>
          <span className="sp-hash-label">Route Hash:</span>
          <span className="sp-hash-short">{shortHash}</span>
        </div>

        <div className="sp-actions">
          <button className="btn-ghost" {...copyLinkPress} aria-label="Copy link">
            Remember
          </button>
          <button className="btn-ghost" {...sharePress} aria-label="Share">
            Share
          </button>
          <a className="btn-ghost" href="/keystream">
            Keystream
          </a>
        </div>
      </div>

      {/* Stage */}
      {stage}

      {/* Eternal Pulse */}
      {payload && (
        <div className="sp-epulse">
          <div className="epulse-card">
            <div className="epulse-head">
              <div className="epulse-label">Kai ☤</div>
              <div className="epulse-value">{payload.pulse.toLocaleString()}</div>
            </div>
          </div>
        </div>
      )}

      {/* Meta rows */}
      <div className="sp-meta">
        <div className="sp-meta-row">
          <span className="lbl">URL</span>
          <code className="mono mono-wrap">{absUrl}</code>
        </div>

        {payload && (
          <>
            {/* ── Kai-Klok structural data ───────────────────────────── */}
            <div className="sp-meta-row">
              <span className="lbl">Day:</span>
              <span>{label}</span>
            </div>
            <div className="sp-meta-row">
              <span className="lbl">Beat:</span>
              {/* Beat display remains zero-based as before */}
              <span>{pad2(payload.beat)} / 36</span>
            </div>
            <div className="sp-meta-row">
              <span className="lbl">Step:</span>
              {/* ZERO-BASED step display, derived exactly from pulse */}
              <span>
                {pad2(derivedStepIndex)} / {steps}
              </span>
            </div>
            <div className="sp-meta-row">
              <span className="lbl">% to Next Step:</span>
              <span>{(derivedStepPct * 100).toFixed(1)}%</span>
            </div>

            {/* NEW: φ-Spiral (same definition as in SigilModal) */}
            <div className="sp-meta-row">
              <span className="lbl">Φ Spiral:</span>
              <span>PS{phiSpiralLevel}</span>
            </div>

            {/* ── Kairos Calendar (NO Chronos) ───────────────────────── */}
            {k && (
              <>
                <div className="sp-meta-row">
                  <span className="lbl">Year:</span>
                  <span>Y{String(k.yearIdx)}</span>
                </div>

                <div className="sp-meta-row">
                  <span className="lbl">Month:</span>
                  <span>
                    {pad2(k.monthIdx + 1)} / {pad2(MONTHS_PER_YEAR)}
                  </span>
                </div>

                <div className="sp-meta-row">
                  <span className="lbl">Week (Year):</span>
                  <span>
                    {pad2(k.weekOfYear + 1)} /{" "}
                    {pad2(DAYS_PER_YEAR / DAYS_PER_WEEK)}
                  </span>
                </div>

                <div className="sp-meta-row">
                  <span className="lbl">Week (Month):</span>
                  <span>
                    {pad2(k.weekOfMonth + 1)} / {pad2(WEEKS_PER_MONTH)}
                  </span>
                </div>

                <div className="sp-meta-row">
                  <span className="lbl">Day (Week):</span>
                  <span>
                    {pad2(k.dayOfWeek)} / {pad2(DAYS_PER_WEEK)}
                  </span>
                </div>

                <div className="sp-meta-row">
                  <span className="lbl">Day (Month):</span>
                  <span>
                    {pad2(k.dayInMonth)} / {pad2(DAYS_PER_MONTH)}
                  </span>
                </div>

                <div className="sp-meta-row">
                  <span className="lbl">Day (Abs):</span>
                  <span>{k.absDayIdx.toLocaleString()}</span>
                </div>
              </>
            )}

            {/* ── Live window ─────────────────────────────────────────── */}
            <div className="sp-meta-row">
              <span className="lbl">Inhale Step:</span>
              <span>
                {isArchived
                  ? "Arkived (transfer burned)"
                  : isFutureSealed
                  ? "Sealed (pre-moment)"
                  : pulsesLeft == null
                  ? "—"
                  : pulsesLeft === 0
                  ? "Sealed"
                  : `${pulsesLeft} Breath${pulsesLeft === 1 ? "" : "s"} left`}
              </span>
            </div>

            {isFutureSealed && opensInPulses !== null && opensInPulses > 0 && (
              <div className="sp-meta-row">
                <span className="lbl">Opens In:</span>
                <span>
                  {opensInPulses} Breath{opensInPulses === 1 ? "" : "s"}
                </span>
              </div>
            )}

            {!isFutureSealed &&
              !isArchived &&
              pulsesLeft !== null &&
              pulsesLeft > 0 && (
                <div className="sp-meta-row">
                  <span className="lbl">Next Breath:</span>
                  <span>{nextPulseSeconds}s</span>
                </div>
              )}

            <div className="sp-meta-row">
              <span className="lbl">Seal:</span>
              <span>Kai-Klok</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
