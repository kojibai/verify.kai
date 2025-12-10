// src/components/SigilGlyphButton.tsx
/* ────────────────────────────────────────────────────────────────
   SigilGlyphButton.tsx · Atlantean Lumitech “Kairos Sigil Glyph”
   v7.2 — EXACT match with SigilModal (μpulse math + deterministic hash)
          + persistent glyph after modal close (unique origin + remount key)
───────────────────────────────────────────────────────────────── */

import React, { useState, useEffect, useRef, useCallback } from "react";
import KaiSigil, { type KaiSigilProps, type KaiSigilHandle } from "./KaiSigil";
import SigilModal from "./SigilModal";
import "./SigilGlyphButton.css";

/* ═════════════ Canon (identical to SigilModal) ═════════════ */
const GENESIS_TS = Date.UTC(2024, 4, 10, 6, 45, 41, 888); // 2024-05-10 06:45:41.888 UTC
const KAI_PULSE_SEC = 3 + Math.sqrt(5);                   // φ-exact breath
const PULSE_MS = KAI_PULSE_SEC * 1000;

/* μ-pulse fixed point */
const ONE_PULSE_MICRO = 1_000_000n;         // 1 pulse = 1e6 μpulses
const N_DAY_MICRO = 17_491_270_421n;        // 17,491.270421 pulses/day exact (μpulses)
const PULSES_PER_STEP_MICRO = 11_000_000n;  // 11 pulses per step

/* exact μpulses-per-beat for Eternal day (rounded like in modal) */
const MU_PER_BEAT_EXACT = (N_DAY_MICRO + 18n) / 36n; // 485,868,623 μpulses

type HarmonicDay = "Solhara" | "Aquaris" | "Flamora" | "Verdari" | "Sonari" | "Kaelith";
const WEEKDAY: readonly HarmonicDay[] = ["Solhara","Aquaris","Flamora","Verdari","Sonari","Kaelith"] as const;

const DAY_TO_CHAKRA: Record<HarmonicDay, KaiSigilProps["chakraDay"]> = {
  Solhara: "Root",
  Aquaris: "Sacral",
  Flamora: "Solar Plexus",
  Verdari: "Heart",
  Sonari: "Throat",
  Kaelith: "Crown",
};

/* helpers (copied semantics) */
const imod = (n: bigint, m: bigint) => ((n % m) + m) % m;
function floorDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  return (r !== 0n && (r > 0n) !== (d > 0n)) ? q - 1n : q;
}
function roundTiesToEvenBigInt(x: number): bigint {
  if (!Number.isFinite(x)) return 0n;
  const s = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const i = Math.trunc(ax);
  const frac = ax - i;
  if (frac < 0.5) return BigInt(s * i);
  if (frac > 0.5) return BigInt(s * (i + 1));
  return BigInt(s * (i % 2 === 0 ? i : i + 1)); // .5 -> to even
}
function microPulsesSinceGenesis(date: Date): bigint {
  const deltaSec = (date.getTime() - GENESIS_TS) / 1000;
  const pulses = deltaSec / KAI_PULSE_SEC;
  const micro = pulses * 1_000_000;
  return roundTiesToEvenBigInt(micro);
}

/* compute the exact render state the modal uses */
function computeLocalKai(now: Date): {
  pulse: number;
  beat: number;
  stepPct: number;                 // 0..1
  chakraDay: KaiSigilProps["chakraDay"];
} {
  const pμ_total = microPulsesSinceGenesis(now);

  // position within day
  const pμ_in_day = imod(pμ_total, N_DAY_MICRO);
  const dayIndex = floorDiv(pμ_total, N_DAY_MICRO);

  // beat within day (0..35) and μpulses inside that beat
  const beat = Number(floorDiv(pμ_in_day, MU_PER_BEAT_EXACT));
  const pμ_in_beat = pμ_in_day - BigInt(beat) * MU_PER_BEAT_EXACT;

  // step within beat (0..43) and fractional progress in step
  const step = pμ_in_beat / PULSES_PER_STEP_MICRO;             // 0..43 (bigint)
  const pμ_in_step = pμ_in_beat - step * PULSES_PER_STEP_MICRO;
  const stepPct = Number(pμ_in_step) / Number(PULSES_PER_STEP_MICRO);

  // whole-pulse index + harmonic day → chakra
  const pulse = Number(floorDiv(pμ_total, ONE_PULSE_MICRO));
  const harmonicDay = WEEKDAY[Number(imod(dayIndex, 6n))];
  const chakraDay = DAY_TO_CHAKRA[harmonicDay];

  return { pulse, beat, stepPct, chakraDay };
}

/* aligned φ-boundary scheduler (same idea as the modal) */
const epochNow = () => performance.timeOrigin + performance.now();
const nextBoundary = (nowMs: number) => {
  const elapsed = nowMs - GENESIS_TS;
  const periods = Math.ceil(elapsed / PULSE_MS);
  return GENESIS_TS + periods * PULSE_MS;
};

/* ═════════════ Component ═════════════ */
interface Props { kaiPulse?: number } // optional seed; ignored once live

const SigilGlyphButton: React.FC<Props> = () => {
  const [pulse, setPulse] = useState<number>(0);
  const [beat, setBeat] = useState<number>(0);
  const [stepPct, setStepPct] = useState<number>(0);
  const [chakraDay, setChakraDay] = useState<KaiSigilProps["chakraDay"]>("Root");
  const [open, setOpen] = useState(false);

  // 🔑 unique, stable scope for this instance’s internal SVG ids (prevents collisions with modal)
  const [idScope] = useState(() => `btn-${Math.random().toString(36).slice(2)}`);

  // Force a tiny remount of the <KaiSigil> whenever modal opens/closes (refresh any stale <use> hrefs)
  const instanceKey = open ? "sigil-open" : "sigil-closed";

  const sigilRef = useRef<KaiSigilHandle | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const targetRef = useRef<number>(0);

  const applyNow = useCallback(() => {
    const { pulse: p, beat: b, stepPct: s, chakraDay: cd } = computeLocalKai(new Date());
    setPulse(p);
    setBeat(b);
    setStepPct(s);
    setChakraDay(cd);
  }, []);

  const clearTimer = () => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const scheduleAligned = useCallback(() => {
    clearTimer();
    const now = epochNow();
    targetRef.current = nextBoundary(now);

    const fire = () => {
      // Catch up if tab slept
      const nowMs = epochNow();
      const missed = Math.floor((nowMs - targetRef.current) / PULSE_MS);
      const runs = Math.max(0, missed) + 1;
      for (let i = 0; i < runs; i++) {
        applyNow();
        targetRef.current += PULSE_MS;
      }
      const delay = Math.max(0, targetRef.current - epochNow());
      timeoutRef.current = window.setTimeout(fire, delay) as unknown as number;
    };

    const initialDelay = Math.max(0, targetRef.current - now);
    timeoutRef.current = window.setTimeout(fire, initialDelay) as unknown as number;
  }, [applyNow]);

  /* mount: compute immediately and align to boundary */
  useEffect(() => {
    applyNow();
    scheduleAligned();
    return () => clearTimer();
  }, [applyNow, scheduleAligned]);

  /* visibility: re-align when returning to foreground */
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") scheduleAligned();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [scheduleAligned]);


  return (
    <>
      <button
        className="sigil-button"
        title="View & save this sigil"
        onClick={() => setOpen(true)}
        data-chakra={chakraDay}
        aria-label="Open Kairos Sigil"
      >
        {/* Decorative thumbnail only — link-proof via shield */}
        <span
          className="sigil-thumb"
          aria-hidden="true"
          inert
        >
          <KaiSigil
            key={instanceKey}
            ref={sigilRef}
            pulse={pulse}
            beat={beat}
            stepPct={stepPct}
            chakraDay={chakraDay}
            size={40}
            hashMode="deterministic"
            origin={idScope}
            onReady={(payload?: { hash?: string; pulse?: number }) => {
              if (payload && typeof payload.pulse === "number" && payload.pulse !== pulse) {
                setPulse(payload.pulse);
              }
            }}
          />
          {/* ⛨ Transparent shield that intercepts all clicks/taps */}
          <span className="sigil-shield" aria-hidden="true" />
        </span>
      </button>

      {open && (
        <SigilModal
          initialPulse={pulse}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
};

export default SigilGlyphButton;
