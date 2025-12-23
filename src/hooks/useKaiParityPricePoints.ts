import React from "react";
import { ONE_PULSE_MICRO, kairosEpochNow } from "../utils/kai_pulse";

/* ────────────────────────────────────────────────────────────
   Kai Parity Price Feed — derives USD/Φ from your real quote
   - Uses the SAME policy as purchase: quotePhiForUSD(usd, pulseIndex)
   - Appends a new point ONLY when circulation steps by ≥ $13
     or when a contribution event lands.
   - Keeps a compact sliding window (default 240 points).
   - No global type redeclarations; safe accessor to window.KaiKlok.
   RAH • VEH • YAH • DAH
   ──────────────────────────────────────────────────────────── */

export type QuotePhiForUSDFn = (amountUSD: number, pulseIndex: number) => number;
export type KPricePoint = { p: number; price: number; vol: number };

/** Local clamp (strict, integer-safe) */
const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

/** Current Kai pulse (index + float) */
function kaiPulseNow() {
  const micro = kairosEpochNow();
  const pulsesFloat = Number(micro) / Number(ONE_PULSE_MICRO);
  const index = Math.floor(pulsesFloat);
  return { index, pulsesFloat };
}

/** Safe, no-redeclare accessor for an optional quote function on window.KaiKlok */
function getQuoteFn(): QuotePhiForUSDFn | null {
  if (typeof window === "undefined") return null;
  const maybe = (window as unknown as {
    KaiKlok?: { quotePhiForUSD?: QuotePhiForUSDFn };
  }).KaiKlok?.quotePhiForUSD;
  return typeof maybe === "function" ? maybe : null;
}

/** Resolve USD/Φ at a pulse using your real quote (preferred). */
function usdPerPhiAtPulse(pulseIndex: number, probeUSD = 100): number | null {
  const fn = getQuoteFn();
  if (!fn) return null;
  const phi = Number(fn(probeUSD, pulseIndex)) || 0;
  if (phi <= 0) return null;
  return probeUSD / phi;
}

/**
 * Live parity price series:
 * - Append on each $13 step of liveTotal OR on "investor:contribution"
 * - Points are (pulseFloat, USD/Φ, vol∈[0..1])
 */
export function useKaiParityPricePoints(opts: {
  liveTotal: number;           // DISPLAY total you already compute (minted + Kai accrual)
  windowSize?: number;         // sliding window length (default 240)
  minStepUSD?: number;         // threshold step (default 13)
  probeUSD?: number;           // sample size for quote → USD/Φ (default 100)
}): KPricePoint[] {
  const { liveTotal, windowSize = 240, minStepUSD = 13, probeUSD = 100 } = opts;

  const [points, setPoints] = React.useState<KPricePoint[]>([]);
  // Track the last integer "step" so we only add when step changes
  const lastStepRef = React.useRef<number>(Math.floor(liveTotal / minStepUSD));

  const pushPoint = React.useCallback((vol: number) => {
    const { index, pulsesFloat } = kaiPulseNow();
    const px = usdPerPhiAtPulse(index, probeUSD);
    if (!Number.isFinite(px) || px === null || px <= 0) return; // wait until real quote is exposed
    setPoints((prev) => {
      const next: KPricePoint = { p: pulsesFloat, price: px, vol: clamp(vol, 0, 1) };
      const arr = [...prev, next];
      return arr.slice(-windowSize);
    });
  }, [probeUSD, windowSize]);

  // Append when circulation crosses a $minStepUSD boundary
  React.useEffect(() => {
    const step = Math.floor(liveTotal / minStepUSD);
    if (step !== lastStepRef.current) {
      const deltaSteps = step - lastStepRef.current;
      lastStepRef.current = step;
      const vol = clamp(0.25 + 0.05 * Math.abs(deltaSteps), 0.25, 1);
      pushPoint(vol);
    }
  }, [liveTotal, minStepUSD, pushPoint]);

  // Also append instantly when a mint posts (contribution event)
  React.useEffect(() => {
    const onContribution = (e: Event) => {
      const detail = (e as CustomEvent<{ amount: number; method: "card" | "btc" }>).detail;
      const usd = Math.max(0, detail?.amount ?? 0);
      if (usd <= 0) return;
      // Heuristic: larger mint → heavier vol
      const vol = clamp(Math.log10(usd + 10) / 3, 0.35, 1);
      pushPoint(vol);
    };
    window.addEventListener("investor:contribution", onContribution as EventListener);
    return () => window.removeEventListener("investor:contribution", onContribution as EventListener);
  }, [pushPoint]);

  // Seed one point once we have a usable quote
  React.useEffect(() => {
    if (points.length === 0) {
      // try to seed; if quote isn’t ready yet, it’ll no-op until first step/mint
      pushPoint(0.35);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return points;
}
