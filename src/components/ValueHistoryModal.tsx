// src/components/ValueHistoryModal.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { kairosEpochNow } from "../utils/kai_pulse";
import "./ValueHistoryModal.css";

/** Kairos series point: t = absolute *fractional* beat since genesis, v = value (Φ) */
export type Point = { t: number; v: number };

/** Beat ranges — ZERO chronos. */
type RangeKey = "1B" | "1D" | "6D" | "42D" | "ALL";
const RANGE_BEATS: Record<RangeKey, number> = {
  "1B": 1, // 1 Beat
  "1D": 36, // 1 Day = 36 Beats
  "6D": 36 * 6, // 6 Days
  "42D": 36 * 42, // 42 Days
  ALL: Number.POSITIVE_INFINITY,
};

/* ─────────────────────────────────────────────────────────────
   Eternal Kai constants (aligns with SovereignSolar canon)
   Pulses/day × breath seconds (3 + √5) → day length; /36 → ms/beat
   ───────────────────────────────────────────────────────────── */
const HARMONIC_DAY_PULSES = 17491.270421; // pulses per day
const BREATH_SEC = 3 + Math.sqrt(5); // 5.2360679…
const BEATS_PER_DAY = 36;
const MS_PER_BEAT =
  (HARMONIC_DAY_PULSES * BREATH_SEC * 1000) / BEATS_PER_DAY; // ≈ 2_544_041.137 ms
const GENESIS_TS = 1715323541888; // 2024-05-10T06:45:41.888Z

/** Convert epoch-ms → absolute fractional beats since genesis. */
function msToAbsBeat(ms: number): number {
  return (ms - GENESIS_TS) / MS_PER_BEAT;
}

/** Snapshot of “now” in Kai beats at module-load time (keeps hooks pure). */
const NOW_BEAT_AT_LOAD = msToAbsBeat(kairosEpochNow());

/** Normalize any epoch-ms series to Kai beats. */
function normalizeToKaiBeats(src: Point[]): Point[] {
  if (!src?.length) return [];
  const looksLikeEpoch = src[src.length - 1].t > 1e11; // heuristic
  if (!looksLikeEpoch) return src;
  return src.map((p) => ({ t: msToAbsBeat(p.t), v: p.v }));
}

export default function ValueHistoryModal({
  open,
  onClose,
  series,
  latestValue,
  label = "Live Φ",
}: {
  open: boolean;
  onClose: () => void;
  series: Point[];
  latestValue: number;
  label?: string;
}) {
  const [range, setRange] = useState<RangeKey>("1D");
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [hoverY, setHoverY] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // canvas + container
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Force redraw on container size change (independent of data)
  const [sizeTick, setSizeTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => setSizeTick((t) => t + 1));
    ro.observe(wrap);
    const onWin = () => setSizeTick((t) => t + 1);
    window.addEventListener("resize", onWin, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onWin);
    };
  }, [open]);

  // Normalize & sort
  // NOTE: This assumes `series` is treated as immutable by the caller
  // (new array when you push/append). That keeps React + Compiler semantics correct.
  const kaiSorted = useMemo(() => {
    const normalized = normalizeToKaiBeats(series || []);
    return normalized.length
      ? [...normalized].sort((a, b) => a.t - b.t)
      : normalized;
  }, [series]);

  // If the stream is still warming up, seed a single point from latestValue
  // so the chart shows instantly. We use a module-level snapshot for “now”
  // to keep hooks/components pure.
  const seeded = useMemo<Point[]>(() => {
    if (kaiSorted.length > 0) return kaiSorted;
    if (!Number.isFinite(latestValue)) return [];
    return [{ t: NOW_BEAT_AT_LOAD, v: latestValue }];
  }, [kaiSorted, latestValue]);

  // Range filter (beats)
  const filtered = useMemo(() => {
    if (!seeded.length) return seeded;
    if (range === "ALL") return seeded;
    const span = RANGE_BEATS[range];
    const lastBeat = seeded[seeded.length - 1].t;
    const cutoff = lastBeat - span;
    // find first index >= cutoff
    let ix = 0;
    for (let i = 0; i < seeded.length; i++) {
      if (seeded[i].t >= cutoff) {
        ix = i;
        break;
      }
    }
    return seeded.slice(ix);
  }, [seeded, range]);

  // Extents (with gentle pad)
  const { minT, maxT, minV, maxV } = useMemo(() => {
    if (!filtered.length)
      return { minT: 0, maxT: 1, minV: 0, maxV: 1 };
    const ts = filtered.map((p) => p.t);
    const vs = filtered.map((p) => p.v);
    const vMin = Math.min(...vs);
    const vMax = Math.max(...vs);
    const pad =
      (vMax - vMin) * 0.08 ||
      Math.max(0.000001, Math.abs(vMax) * 0.02);
    return {
      minT: Math.min(...ts),
      maxT: Math.max(...ts),
      minV: vMin - pad,
      maxV: vMax + pad,
    };
  }, [filtered]);

  // Direction for the "Latest" badge (flash green on up, red on down)
  const latestDir: "up" | "down" | null = useMemo(() => {
    const n = filtered.length;
    if (n >= 2) {
      const a = filtered[n - 2].v;
      const b = filtered[n - 1].v;
      if (b > a) return "up";
      if (b < a) return "down";
      return null;
    }
    // fall back to previous known value vs latestValue
    if (n === 1 && Number.isFinite(latestValue)) {
      const b = filtered[0].v;
      if (b > latestValue) return "down";
      if (b < latestValue) return "up";
    }
    return null;
  }, [filtered, latestValue]);

  // Draw the chart
  useEffect(() => {
    if (!open) return;
    const el = canvasRef.current;
    const wrap = wrapRef.current;
    if (!el || !wrap) return;

    const DPR = Math.max(
      1,
      Math.floor(window.devicePixelRatio || 1)
    );
    const W = Math.max(
      280,
      Math.min(1200, wrap.clientWidth || 320)
    );
    const H = Math.max(
      220,
      Math.min(420, Math.round(W * 0.42))
    );

    el.width = W * DPR;
    el.height = H * DPR;
    el.style.width = `${W}px`;
    el.style.height = `${H}px`;

    type CtxMaybeReset = CanvasRenderingContext2D & {
      resetTransform?: () => void;
    };
    const ctx = el.getContext("2d") as CtxMaybeReset | null;
    if (!ctx) return;

    if (typeof ctx.resetTransform === "function") ctx.resetTransform();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // glass background
    const gglass = ctx.createLinearGradient(0, 0, 0, H);
    gglass.addColorStop(0, "rgba(255,255,255,0.06)");
    gglass.addColorStop(1, "rgba(255,255,255,0.03)");
    ctx.fillStyle = gglass;
    ctx.fillRect(0, 0, W, H);

    if (!filtered.length) return;

    const padX = 36;
    const padY = 24;
    const x = (t: number) => {
      const span = Math.max(1e-9, maxT - minT);
      return (
        padX +
        ((t - minT) / span) * (W - padX * 2)
      );
    };
    const y = (v: number) => {
      const rng = Math.max(1e-12, maxV - minV);
      return (
        H -
        padY -
        ((v - minV) / rng) * (H - padY * 2)
      );
    };

    // Grid (subtle)
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const gy =
        padY + (i * (H - padY * 2)) / 4;
      ctx.moveTo(padX, gy);
      ctx.lineTo(W - padX, gy);
    }
    ctx.stroke();

    // Tiny SMA to smooth breath jitter
    const smooth = 3;
    const pts = filtered.map((p, i) => {
      const start = Math.max(0, i - smooth);
      const seg = filtered.slice(start, i + 1);
      const avg =
        seg.reduce((s, q) => s + q.v, 0) /
        seg.length;
      return { t: p.t, v: avg };
    });

    // Single-point glow
    if (pts.length === 1) {
      const p = pts[0];
      const xx = x(p.t);
      const yy = y(p.v);
      ctx.shadowBlur = 16;
      ctx.shadowColor = "rgba(55,230,212,.45)";
      ctx.fillStyle = "rgba(167,255,244,1)";
      ctx.beginPath();
      ctx.arc(xx, yy, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      return;
    }

    // Area fill
    const grad = ctx.createLinearGradient(
      0,
      padY,
      0,
      H - padY
    );
    grad.addColorStop(0, "rgba(55,230,212,.35)");
    grad.addColorStop(1, "rgba(55,230,212,0)");
    ctx.beginPath();
    ctx.moveTo(x(pts[0].t), y(pts[0].v));
    pts.forEach((p) =>
      ctx.lineTo(x(p.t), y(p.v))
    );
    ctx.lineTo(
      x(pts[pts.length - 1].t),
      H - padY
    );
    ctx.lineTo(x(pts[0].t), H - padY);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Neon stroke
    ctx.shadowBlur = 16;
    ctx.shadowColor = "rgba(55,230,212,.45)";
    ctx.strokeStyle = "rgba(167,255,244,1)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const xx = x(p.t);
      const yy = y(p.v);
      if (i === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Crosshair & tooltip
    if (
      hoverX != null &&
      hoverY != null &&
      hoverIdx != null &&
      filtered[hoverIdx]
    ) {
      const p = filtered[hoverIdx];
      const xx = x(p.t);
      const yy = y(p.v);

      ctx.strokeStyle = "rgba(255,255,255,.25)";
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(xx, padY);
      ctx.lineTo(xx, H - padY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(xx, yy, 3, 0, Math.PI * 2);
      ctx.fill();

      const tip = `Beat ${p.t.toFixed(
        6
      )}  •  ${p.v.toLocaleString(undefined, {
        maximumFractionDigits: 6,
      })} Φ`;
      const pad = 8;
      ctx.font =
        "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Inter";
      const tw = ctx.measureText(tip).width;
      const bx = Math.min(
        Math.max(xx - tw / 2 - pad, 8),
        W - tw - pad * 2 - 8
      );
      const by = Math.max(yy - 34, 8);

      const r = 8;
      const w = tw + pad * 2;
      const h = 24;
      const x0 = bx;
      const y0 = by;
      const r2 = Math.min(r, w / 2, h / 2);
      ctx.fillStyle = "rgba(0,0,0,.6)";
      ctx.strokeStyle = "rgba(255,255,255,.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0 + r2, y0);
      ctx.lineTo(x0 + w - r2, y0);
      ctx.quadraticCurveTo(
        x0 + w,
        y0,
        x0 + w,
        y0 + r2
      );
      ctx.lineTo(x0 + w, y0 + h - r2);
      ctx.quadraticCurveTo(
        x0 + w,
        y0 + h,
        x0 + w - r2,
        y0 + h
      );
      ctx.lineTo(x0 + r2, y0 + h);
      ctx.quadraticCurveTo(
        x0,
        y0 + h,
        x0,
        y0 + h - r2
      );
      ctx.lineTo(x0, y0 + r2);
      ctx.quadraticCurveTo(
        x0,
        y0,
        x0 + r2,
        y0
      );
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#e7fbf7";
      ctx.fillText(tip, bx + pad, by + 16);
    }
  }, [
    open,
    filtered,
    minT,
    maxT,
    minV,
    maxV,
    hoverX,
    hoverY,
    hoverIdx,
    sizeTick,
  ]);

  // pointer interactivity
  useEffect(() => {
    if (!open) return;
    const el = canvasRef.current;
    if (!el) return;

    const onMove = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const DPR = Math.max(
        1,
        Math.floor(window.devicePixelRatio || 1)
      );
      const cx =
        (ev.clientX - rect.left) * DPR;
      const cy =
        (ev.clientY - rect.top) * DPR;
      setHoverX(cx / DPR);
      setHoverY(cy / DPR);

      if (filtered.length) {
        const padX = 36;
        const W = rect.width;
        const minX = padX;
        const maxX = W - padX;
        const x01 = Math.min(
          1,
          Math.max(
            0,
            (cx / DPR - minX) /
              Math.max(1, maxX - minX)
          )
        );
        const tGuess =
          minT + x01 * (maxT - minT);
        let lo = 0;
        let hi = filtered.length - 1;
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (filtered[mid].t < tGuess) lo = mid;
          else hi = mid;
        }
        const pick =
          Math.abs(
            filtered[lo].t - tGuess
          ) <
          Math.abs(
            filtered[hi].t - tGuess
          )
            ? lo
            : hi;
        setHoverIdx(pick);
      }
    };

    const onLeave = () => {
      setHoverX(null);
      setHoverY(null);
      setHoverIdx(null);
    };

    el.addEventListener("pointermove", onMove, {
      passive: true,
    });
    el.addEventListener("pointerleave", onLeave, {
      passive: true,
    });
    return () => {
      el.removeEventListener(
        "pointermove",
        onMove
      );
      el.removeEventListener(
        "pointerleave",
        onLeave
      );
    };
  }, [open, filtered, minT, maxT]);

  if (!open) return null;

  const latestText = Number.isFinite(latestValue)
    ? latestValue.toLocaleString(undefined, {
        maximumFractionDigits: 6,
      })
    : "—";

  return (
    <div
      className="valuehist-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Value History"
    >
      <button
        className="valuehist-exit"
        onClick={onClose}
        title="Close"
      >
        ✕
      </button>

      <div
        className="valuehist-stage"
        style={{ alignItems: "stretch" }}
      >
        <div className="valuehist-panel">
          <div className="valuehist-head">
            <h3 className="valuehist-title">
              {label} — history
            </h3>

            <span
              className={`badge badge--ok ${
                latestDir === "up"
                  ? "flash-up"
                  : latestDir === "down"
                  ? "flash-down"
                  : ""
              }`}
              aria-label="latest value"
            >
              Latest:&nbsp;
              <strong>{latestText} Φ</strong>
            </span>

            <div className="valuehist-ranges">
              {(
                ["1B", "1D", "6D", "42D", "ALL"] as RangeKey[]
              ).map((k) => (
                <button
                  key={k}
                  className={`btn-ghost${
                    k === range ? " btn-primary" : ""
                  }`}
                  onClick={() => setRange(k)}
                  aria-pressed={k === range}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>

          <div
            ref={wrapRef}
            className="valuehist-frame"
          >
            {filtered.length === 0 && (
              <div className="valuehist-empty">
                Waiting for live samples…
              </div>
            )}
            <canvas ref={canvasRef} />
          </div>

          <div className="valuehist-actions">
            <button
              className="btn-ghost"
              onClick={() => {
                const rows = filtered.map(
                  (p) => `${p.t},${p.v}`
                );
                const blob = new Blob(
                  [
                    `beat,value\n${rows.join(
                      "\n"
                    )}`,
                  ],
                  { type: "text/csv" }
                );
                const url =
                  URL.createObjectURL(blob);
                const a =
                  document.createElement("a");
                a.href = url;
                a.download =
                  "phi-history-kai.csv";
                a.click();
                setTimeout(
                  () =>
                    URL.revokeObjectURL(url),
                  300
                );
              }}
            >
              Download CSV
            </button>
            <button
              className="btn-ghost"
              onClick={() => {
                const el2 = canvasRef.current;
                if (!el2) return;
                el2.toBlob((b) => {
                  if (!b) return;
                  const url =
                    URL.createObjectURL(b);
                  const a =
                    document.createElement("a");
                  a.href = url;
                  a.download =
                    "phi-history.png";
                  a.click();
                  setTimeout(
                    () =>
                      URL.revokeObjectURL(url),
                    300
                  );
                });
              }}
            >
              Save PNG
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
