"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import KaiPriceChart, { type KPricePoint } from "./KaiPriceChart";
import { DEFAULT_ISSUANCE_POLICY, quotePhiForUsd } from "../utils/phi-issuance";
import type { SigilMetadataLite } from "../utils/valuation";
import "./HomePriceChartCard.compact.css";

/* =============================================================
   HomePriceChartCard — Slim Ticker ↔ Expandable Chart
   • No /api/sigil/meta — meta is deterministic in-app.
   • Single source of truth: ticker reads from chart's onTick
   • priceFn is PURE (no setState); chart drives updates
   • Chart remains mounted while collapsed (hidden off-screen)
   ============================================================= */

type Props = {
  ctaAmountUsd?: number;
  apiBase?: string;
  title?: string;
  chartHeight?: number;
  onError?: (err: unknown) => void;
  stripePk?: string;
  onExpandChange?: (expanded: boolean) => void;
};

const API_DEFAULT = "https://pay.kaiklok.com";
const STRIPE_PUBLISHABLE_KEY =
  "pk_live_51SNLMpRzKZKauLy5RLZFDy8FzHTt50YH1BRbXof1Db79yr1xchPQLzLF43pixjKLUbwKr2nc3WT6eq7TZZInfnhT00IMTw0M8N";

/** Daily pulse span used for 24h delta (rounded from 17,491.270421) */
const PULSES_PER_DAY = 17491;

// Deterministic embedded meta (matches the investor form fallback).
const FALLBACK_META = { ip: { expectedCashflowPhi: [] } } as unknown as SigilMetadataLite;

/* ---------- typed constants ---------- */
const EMPTY_POINTS: KPricePoint[] = [];
const QUICK_AMOUNTS = [144, 233, 987] as const;

/* Hidden but mounted — chart engine keeps ticking */
const HIDDEN_CHART_STYLE: React.CSSProperties = {
  position: "fixed",
  left: -10000,
  top: -10000,
  width: 1,
  height: 1,
  opacity: 0,
  visibility: "hidden",
  pointerEvents: "none",
  overflow: "hidden",
  clipPath: "inset(50%)",
  contain: "layout paint size style",
};

/* ---------- helpers ---------- */
function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms = 15000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  return fn(ctl.signal).finally(() => clearTimeout(t));
}

async function createPaymentIntent(
  apiBase: string,
  amountUsd: number
): Promise<{ clientSecret: string; intentId: string }> {
  return withTimeout(async (signal) => {
    const res = await fetch(`${apiBase}/api/payments/intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      mode: "cors",
      signal,
      body: JSON.stringify({
        amount: Math.max(1, Math.round(amountUsd)),
        currency: "usd",
        description: "Kairos Sovereign Inhale",
      }),
    });
    if (!res.ok) {
      const msg = (await res.text().catch(() => "")) || `Failed to create payment intent (${res.status})`;
      throw new Error(msg);
    }
    return (await res.json()) as { clientSecret: string; intentId: string };
  });
}

/* ---------- Inline Φ icon (for price text) ---------- */
function PhiIconInline(): React.JSX.Element {
  return <img className="hp-phi-icon" src="/phi.svg" alt="Φ" />;
}

/* ---------- deterministic meta hook (no unused params) ---------- */
const useSigilMeta = (): SigilMetadataLite => {
  const [meta] = useState<SigilMetadataLite>(FALLBACK_META);
  return meta;
};

/* ---------- inline Stripe ---------- */
const InlineCardCheckout: React.FC<{
  amountUsd: number;
  intentId: string;
  onClose: () => void;
  onSuccess?: () => void;
}> = ({ amountUsd, intentId, onClose, onSuccess }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  const confirm = useCallback(async () => {
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setError("");
    try {
      const { error: err, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
        confirmParams: { return_url: typeof window !== "undefined" ? window.location.href : undefined },
      });
      if (err) {
        setError(err.message || "Payment confirmation failed.");
        return;
      }
      if (paymentIntent?.status === "succeeded") {
        onSuccess?.();
        return;
      }
      setError("Payment is not complete yet. Please try again.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unable to confirm payment.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [stripe, elements, busy, onSuccess]);

  return (
    <div className="hp-popover" role="dialog" aria-label="Inline sovereign checkout" data-intent-id={intentId}>
      <div className="hp-pop-head">
        <div className="hp-pop-title">
          Inhale{" "}
          {amountUsd.toLocaleString(undefined, {
            style: "currency",
            currency: "USD",
          })}
        </div>
        <button type="button" className="hp-x" onClick={onClose} aria-label="Close checkout">
          ×
        </button>
      </div>
      <div className="hp-pop-body">
        <div className="hp-payment" aria-busy={!elements}>
          <PaymentElement />
        </div>
        <div className="hp-actions">
          <button type="button" className="hp-primary" onClick={confirm} disabled={busy || !stripe || !elements}>
            {busy ? "Confirming…" : "Inhale Sigil-Glyph"}
          </button>
          <button type="button" className="hp-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
        {error && <div className="hp-error">{error}</div>}
        <p className="hp-fine">3-D Secure via Stripe (PCI). No securities. No fiat ROI.</p>
      </div>
    </div>
  );
};

/* ---------- main ---------- */
export default function HomePriceChartCard({
  ctaAmountUsd = 250,
  apiBase = API_DEFAULT,
  title = "Value Index",
  chartHeight = 120,
  onError,
  stripePk = STRIPE_PUBLISHABLE_KEY,
  onExpandChange,
}: Props) {
  // meta is deterministic & local; no network dependency
  const meta = useSigilMeta();
  const [sample, setSample] = useState<number>(ctaAmountUsd);
  const [expanded, setExpanded] = useState<boolean>(false);

  // Notify parent once on mount (no dependency churn)
  const onExpandChangeRef = useRef<Props["onExpandChange"]>(onExpandChange);
  useEffect(() => {
    onExpandChangeRef.current = onExpandChange;
  }, [onExpandChange]);
  useEffect(() => {
    onExpandChangeRef.current?.(false);
  }, []);

  // Stripe
  const stripePromise = useMemo(() => loadStripe(stripePk), [stripePk]);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [intentId, setIntentId] = useState<string | null>(null);
  const [elementsKey, setElementsKey] = useState(0);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  /* ---------- PURE price fn (used by chart engine only) ---------- */
  const computePrice = useCallback(
    (pulse: number): number => {
      if (!meta) return 0;
      const usdSample = Math.max(1, Math.round(Number.isFinite(sample) ? sample : 1));
      const q = quotePhiForUsd(
        {
          meta,
          nowPulse: Math.floor(pulse),
          usd: usdSample,
          currentStreakDays: 0,
          lifetimeUsdSoFar: 0,
          plannedHoldBeats: 0,
        },
        DEFAULT_ISSUANCE_POLICY
      );
      return q.phiPerUsd > 0 ? 1 / q.phiPerUsd : 0; // USD per Φ
    },
    [meta, sample]
  );

  const chartPriceFn = useCallback((pulse: number) => computePrice(pulse), [computePrice]);

  /* ---------- Single source of truth for the bar: chart onTick ---------- */
  const [chartTick, setChartTick] = useState<{ pulse: number; price: number } | null>(null);
  const handleTick = useCallback(({ p, price }: { p: number; price: number }) => {
    setChartTick({ pulse: p, price });
  }, []);

  /* ---------- 24h % based on the same pulse index from onTick ---------- */
  const pct24h = useMemo(() => {
    if (!chartTick) return null;
    const prev = computePrice(chartTick.pulse - PULSES_PER_DAY);
    if (!(prev > 0)) return 0;
    return ((chartTick.price - prev) / prev) * 100;
  }, [chartTick, computePrice]);

  const hasPrice = !!(chartTick && Number.isFinite(chartTick.price) && chartTick.price > 0);

  // Keep an accessible text version (screen readers), but render Φ as svg visibly.
  const priceAria = hasPrice ? `$${chartTick!.price.toFixed(2)} / Φ` : "—";

  const priceNode: React.ReactNode = hasPrice ? (
    <span className="hp-price-row" aria-label={priceAria}>
      <span className="hp-price-usd">{`$${chartTick!.price.toFixed(2)}`}</span>
      <span className="hp-price-slash" aria-hidden>
        {" "}
        /{" "}
      </span>
      <PhiIconInline />
    </span>
  ) : (
    "—"
  );

  const pctLabel = (() => {
    if (pct24h == null || !Number.isFinite(pct24h)) return "0.00%";
    const abs = Math.abs(pct24h);
    return `${pct24h >= 0 ? "+" : "−"}${abs.toFixed(2)}%`;
  })();

  const pctClass = pct24h != null && pct24h >= 0 ? "hp-up" : "hp-down";

  /* ---------- Checkout ---------- */
  const openInlineCheckout = useCallback(async () => {
    setErrorMsg("");
    try {
      const amt = Number.isFinite(sample) ? Math.max(1, Math.round(sample)) : ctaAmountUsd;
      const { clientSecret: secret, intentId: id } = await createPaymentIntent(apiBase, amt);
      setClientSecret(secret);
      setIntentId(id);
      setElementsKey((k) => k + 1);
      setSuccess(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to start checkout.";
      setErrorMsg(msg);
      onError?.(err);
    }
  }, [sample, ctaAmountUsd, apiBase, onError]);

  const closeInlineCheckout = useCallback(() => {
    setClientSecret(null);
    setIntentId(null);
    setElementsKey((k) => k + 1);
  }, []);

  const onSuccess = useCallback(() => {
    setSuccess(true);
    try {
      const detail = {
        amount: Number.isFinite(sample) ? Math.max(1, Math.round(sample)) : ctaAmountUsd,
        method: "card" as const,
      };
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("investor:contribution", { detail }));
      }
    } catch (e) {
      onError?.(e);
    }
    closeInlineCheckout();
  }, [sample, ctaAmountUsd, onError, closeInlineCheckout]);

  const regionId = useId();

  const toggleExpanded = useCallback(() => {
    setExpanded((v) => {
      const nv = !v;
      onExpandChangeRef.current?.(nv);
      return nv;
    });
  }, []);

  return (
    <div className={`hp-card ${expanded ? "is-expanded" : "is-collapsed"}`} role="group" aria-label="Sovereign asset">
      {/* Slim ticker — driven ONLY by chart onTick */}
      <div
        className="hp-ticker"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-controls={regionId}
        onClick={toggleExpanded}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleExpanded();
          }
        }}
      >
        <div className="hp-left">
          {/* ✅ Removed the left-side PhiLogo next to "Value Index" */}
          <span className="hp-title">{title}</span>
        </div>

        <div className="hp-right">
          <span className="hp-price" aria-live="polite" aria-label={priceAria}>
            {priceNode}
          </span>
          <span className={`hp-pct ${pctClass}`} aria-live="polite">
            {pct24h != null && pct24h >= 0 ? "▲" : "▼"} {pctLabel}
          </span>
        </div>
      </div>

      {/* Always-mounted chart engine (hidden when collapsed) */}
      <div className="hp-chart-wrap" aria-hidden={!expanded} style={expanded ? { marginTop: 8 } : HIDDEN_CHART_STYLE}>
        <div className="hp-chart">
          <KaiPriceChart
            points={EMPTY_POINTS} // KPricePoint[]
            autoWidth
            height={chartHeight}
            title={undefined}
            priceFn={chartPriceFn} // PURE; same fn that pct24h uses
            onTick={handleTick} // SINGLE SOURCE for bar data
            live
          />
        </div>
      </div>

      {/* Expandable region */}
      <div
        id={regionId}
        className={`hp-expand ${expanded ? "is-open" : "is-closed"}`}
        role="region"
        aria-label="Live chart and inhale controls"
        style={expanded ? {} : { height: 0, overflow: "hidden", visibility: "hidden", pointerEvents: "none" }}
      >
        <div className="hp-controls">
          <div className="hp-chips">
            <span className="dim">Exhale:</span>
            {QUICK_AMOUNTS.map((v) => (
              <button
                key={v}
                type="button"
                className={`chip ${v === sample ? "active" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setSample(v);
                }}
                aria-label={`Set sample to $${v}`}
              >
                ${v.toLocaleString()}
              </button>
            ))}
            <button
              type="button"
              className="chip ghost"
              aria-label="Increase sample by 5%"
              onClick={(e) => {
                e.stopPropagation();
                setSample((s) => Math.max(1, Math.round(s * 1.05)));
              }}
            >
              +5%
            </button>
          </div>

          <div className="hp-actions-row">
            <button
              type="button"
              className="hp-primary"
              onClick={(e) => {
                e.stopPropagation();
                openInlineCheckout();
              }}
              aria-haspopup="dialog"
            >
              Inhale
            </button>
          </div>

          {errorMsg && <div className="hp-error">{errorMsg}</div>}
        </div>

        {clientSecret && intentId && (
          <Elements
            key={elementsKey}
            stripe={stripePromise}
            options={{
              clientSecret,
              appearance: {
                theme: "night",
                variables: {
                  colorPrimary: "#37FFE4",
                  colorBackground: "rgba(8,14,16,.7)",
                  colorText: "#E8FBF8",
                  colorTextSecondary: "#AEE8DF",
                  colorIcon: "#E8FBF8",
                  borderRadius: "10px",
                },
                rules: {
                  ".Tab": { borderRadius: "10px" },
                  ".Input": { borderRadius: "10px", backgroundColor: "rgba(255,255,255,0.06)" },
                },
              },
            }}
          >
            <InlineCardCheckout
              amountUsd={Number.isFinite(sample) ? Math.max(1, Math.round(sample)) : ctaAmountUsd}
              intentId={intentId}
              onClose={closeInlineCheckout}
              onSuccess={onSuccess}
            />
          </Elements>
        )}

        {success && (
          <div className="hp-toast" role="status" aria-live="polite">
            <span className="hp-dot" aria-hidden />
            Inhale sealed. Thank you, sovereign.
          </div>
        )}
      </div>
    </div>
  );
}
