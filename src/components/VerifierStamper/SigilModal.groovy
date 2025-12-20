SigilModal.tsx · Atlantean Lumitech “Kairos Sigil Viewer”
   v19.0 — Canonical child-hash share link (SigilPage-compatible)
   • Live polling only on mount & when “Now” is clicked
   • Past/Future/Pulse lock to selected pulse until “Now”
   • Server enrichment is labels-only; numerics are canonical
   • stepIndex uses floor(); glyph ⇄ metadata 1:1
   • Sealing uses KaiSigil.onReady().hash for route + canonicalHash
   • Payload matches SigilPage decodeSigilPayload expectations
────────────────────────────────────────────────────────────────── */

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ChangeEvent,
  type FC,
  Component,
} from "react";
import { createPortal } from "react-dom";
import html2canvas from "html2canvas";
import JSZip from "jszip";
import "./SigilModal.css";
import { kaiNowMs } from "../../utils/kaiNow";

import KaiSigil, {
  type KaiSigilProps,
  type KaiSigilHandle,
} from "./KaiSigil";
import { StargateViewer } from "./StargateViewer";
import VerifierStamper from "./VerifierStamper";
import SealMomentModal from "./SealMomentModal";
import { makeSigilUrl, type SigilSharePayload } from "../utils/sigilUrl";

/* 🔁 Single source of truth: Kai-Klok (φ-exact) */
import {
  PULSE_MS,
  STEPS_BEAT,
  API_URL,
  utcFromBreathSlot,
  momentFromUTC,
  momentFromPulse,
  epochMsFromPulse,
  buildKaiKlockResponse,
  DAY_TO_CHAKRA,
  type Weekday,
} from "../utils/kai_pulse";

/* 🧱 Typed SSOT + adapter */
import type { KlockData } from "../types/klockTypes";
import { toKlockData } from "../utils/klock_adapters";

/* ═════════════ external props ═════════════ */
interface Props {
  initialPulse?: number;
  onClose: () => void;
}

/* ═════════════ server payload used for enrichment (labels only) ═════════════ */
interface KaiApiResponse {
  kaiPulseEternal?: number; // ignored for indices
  eternalSeal?: string;     // text; numerics sanitized
  kairos_seal_day_month?: string; // info-only; hidden by default
  kairos_seal?: string;           // info-only; hidden by default
  eternalMonth?: string;
  eternalChakraArc?: string;
  eternalYearName?: string;
  kaiTurahPhrase?: string;
}

/* ═════════════ constants & helpers ═════════ */
const SIGIL_SIZE = 240;
const LIVE_INTERVAL_MS = PULSE_MS;

/** Strict mode: never show server-provided numbers directly */
const STRICT_CANONICAL = true;

type H2COpts = NonNullable<Parameters<typeof html2canvas>[1]> & {
  backgroundColor?: string | null;
};

const isIOS = () => {
  const nav = navigator as Navigator & { vendor?: string };
  const ua = (nav.userAgent || nav.vendor || "").toLowerCase();
  return /iphone|ipad|ipod/i.test(ua);
};

const clamp = (x: number, lo: number, hi: number) =>
  x < lo ? lo : x > hi ? hi : x;

const clamp01 = (x: number) => clamp(x, 0, 1);
/** avoid exactly 1.0 so floor(stepPct*44) never reaches 44 */
const clamp01OpenTop = (x: number) => Math.min(0.999999, Math.max(0, x));

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));
const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString() : String(n));


const fmtSealKairos = (beat: number, stepIdx: number) => `${beat}:${pad2(stepIdx)}`;

/** Rewrites any numeric fields inside a server seal string so they match glyph */
function canonicalizeSealText(
  seal: string | undefined | null,
  canonicalPulse: number,
  beat: number,
  stepIdx: number
): string {
  if (!seal) return "";
  let s = seal;

  s = s.replace(
    /Kairos:\s*\d{1,2}:\d{1,2}/i,
    `Kairos:${fmtSealKairos(beat, stepIdx)}`
  );

  s = s.replace(
    /Eternal\s*Pulse:\s*[\d,]+/i,
    `Eternal Pulse:${fmt(canonicalPulse)}`
  );

  s = s.replace(/Step:\s*\d{1,2}\s*\/\s*44/i, `Step:${stepIdx}/44`);
  s = s.replace(/Beat:\s*\d{1,2}\s*\/\s*36(?:\([^)]+\))?/i, `Beat:${beat}/36`);

  return s;
}

const fmtServerKairosShort = (raw: string) =>
  raw
    .trim()
    .replace(/^(\d+):(\d+)/, (_m, b, s) => `${+b}:${pad2(+s)}`)
    .replace(/D\s*(\d+)/, (_m, d) => `D${+d}`);

/* ═════════════ icons ═════════════ */
const CloseIcon: FC = () => (
  <svg viewBox="0 0 24 24" aria-hidden className="close-icon">
    <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="2" />
    <line x1="20" y1="4" x2="4" y2="20" stroke="currentColor" strokeWidth="2" />
    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.2" opacity=".25" />
  </svg>
);

/* ═════════════ simple error boundary around KaiSigil ═════════════ */
class KaiSigilBoundary extends Component<
  { children: React.ReactNode; onError?: (e: unknown) => void },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; onError?: (e: unknown) => void }) {

    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: unknown) {
    this.props.onError?.(err);
  }
  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          aria-live="polite"
          style={{
            width: "100%",
            maxWidth: SIGIL_SIZE,
            margin: "16px auto",
            aspectRatio: "1 / 1",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,.15)",
            display: "grid",
            placeItems: "center",
            fontSize: 12,
            opacity: 0.8,
          }}
        >
          Sigil safe mode (reloading…)
        </div>
      );
    }
    return this.props.children;
  }
}

/* ═════════════ Stargate viewer (fullscreen) ═════════════ */
const StargateModal: FC<{
  sigilUrl: string;
  pulse: number;
  onClose: () => void;
}> = ({ sigilUrl, pulse, onClose }) => {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (el && !isIOS() && !document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {});
    }
    return () => {
      if (!isIOS() && document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    };
  }, []);

  const swallow = (e: React.SyntheticEvent) => e.stopPropagation();

  return createPortal(
    <div
      ref={wrapRef}
      className="stargate-overlay"
      role="dialog"
      aria-modal="true"
      onMouseDown={swallow}
      onClick={swallow}
      onTouchStart={swallow}
      onKeyDown={swallow}
    >
      <button className="stargate-close" aria-label="Close" onClick={onClose}>
        <CloseIcon />
      </button>
      <div onClick={swallow}>
        <StargateViewer sigilUrl={sigilUrl} pulse={pulse} showPulse />
      </div>
    </div>,
    document.body
  );
};

/* ═════════════ main component ═════════════ */
const SigilModal: FC<Props> = ({ initialPulse = 0, onClose }) => {
  /* ── SSOT (typed, app-wide) ─────────────────────────────── */
  const [klock, setKlock] = useState<KlockData | null>(null);

  /* ── primitive props for KaiSigil (derived from SSOT) ───── */
  const [pulse, setPulse] = useState(initialPulse);
  const [beat, setBeat] = useState(0);
  const [stepPct, setStepPct] = useState(0);
  const [chakraDay, setChakraDay] = useState<KaiSigilProps["chakraDay"]>("Root");

  /* ── mode + controls ────────────────────────────────────── */
  const [staticMode, _setStaticMode] =
    useState<"live" | "calendar" | "iso" | "pulse">("live");
  const modeRef = useRef<"live" | "calendar" | "iso" | "pulse">("live");
  const setMode = (m: "live" | "calendar" | "iso" | "pulse") => {
    modeRef.current = m;
    _setStaticMode(m);
  };

  const [dateISO, setDateISO] = useState("");
  const [breathIdx, setBreathIdx] = useState(1);
  const [isoText, setIsoText] = useState("");
  const [pulseText, setPulseText] = useState(String(initialPulse));

  const [errMsg, setErrMsg] = useState("");

  // Server strings may be displayed, but NEVER override canonical indices.
  const [serverSealDayMonth, setServerSealDayMonth] = useState<string | null>(null);

  /* ── UI toggles/state ───────────────────────────────────── */
  const [stargateOpen, setStargateOpen] = useState(false);
  const [stargateURL, setStargateURL] = useState("");

  const [showVerifier, setShowVerifier] = useState(false);

  const [sealOpen, setSealOpen] = useState(false);
  const [sealUrl, setSealUrl] = useState("");
  const [sealHash, setSealHash] = useState("");

  const [lastHash, setLastHash] = useState<string>(""); // <- canonical child hash
  const [sigilCrashed, setSigilCrashed] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const sigilRef = useRef<KaiSigilHandle | null>(null);
  const anchorRef = useRef(kaiNowMs());

  /* responsive canvas size */
  const [canvasSize, setCanvasSize] = useState(SIGIL_SIZE);
  useEffect(() => {
    const compute = () => {
      const vw = typeof window !== "undefined" ? window.innerWidth : SIGIL_SIZE;
      const target = Math.max(160, Math.min(SIGIL_SIZE, Math.floor(vw * 0.9)));
      setCanvasSize(target);
    };
    compute();
    window.addEventListener("resize", compute, { passive: true });
    return () => window.removeEventListener("resize", compute);
  }, []);

  /* pulse sync for the ✕ button */
  const syncCloseBtn = () => {
    const btn = closeBtnRef.current;
    if (!btn) return;
    const lag = LIVE_INTERVAL_MS - (kaiNowMs() % LIVE_INTERVAL_MS);
    btn.style.setProperty("--pulse-dur", `${LIVE_INTERVAL_MS}ms`);
    btn.style.setProperty("--pulse-offset", `-${lag}ms`);
  };

  /* helpers to control live interval explicitly */
  const stopLive = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  /* ── LOCAL SSOT: φ-exact build (no server needed) ─ */
  const hydratePrimitivesFromKlock = (kd: KlockData) => {
    const canonicalPulse = kd.kaiPulseEternal | 0;
    setPulse(canonicalPulse);
    setPulseText(String(canonicalPulse));

    const beatIdx = kd.SpiralBeat.beatIndex | 0;
    const stepIdx = kd.SpiralStep.stepIndex | 0;
    const pctIntoStep = clamp01(kd.SpiralStep.percentIntoStep ?? 0);
    const stepPctAcrossBeat = clamp01((stepIdx + pctIntoStep) / STEPS_BEAT);

    const day = (kd.harmonicDay ?? "Solhara") as Weekday;
    const chakra: KaiSigilProps["chakraDay"] = DAY_TO_CHAKRA[day] ?? "Root";

    setKlock(kd);
    setBeat(clamp(beatIdx, 0, 35));
    setStepPct(stepPctAcrossBeat);
    setChakraDay(chakra);
    setSigilCrashed(false);
    anchorRef.current = kaiNowMs();
  };

  const buildLocalKlock = useCallback(
    async (when?: string | Date | bigint) => {
      const res = await buildKaiKlockResponse(when);
      const kd = toKlockData(res, when);
      const msAtPulse = epochMsFromPulse(kd.kaiPulseEternal | 0);
      kd.timestamp =
        typeof when === "string"
          ? when
          : typeof when === "bigint"
          ? new Date(Number(msAtPulse)).toISOString()
          : when
          ? new Date(Number(msAtPulse)).toISOString()
          : new Date(Number(msAtPulse)).toISOString();

      hydratePrimitivesFromKlock(kd);
    },
    []
  );

  /* ── fetch Kai (server enrichment → local SSOT) ─ */
  const queryKai = useCallback(
    async (iso?: string) => {
      setErrMsg("");

      // If we're in a locked mode and no ISO was requested, ignore any stray calls.
      if (!iso && modeRef.current !== "live") return;

      const when: string | Date = iso ?? new Date();

      // Local SSOT first (authoritative numbers)
      const res = await buildKaiKlockResponse(when);
      let kd = toKlockData(res, when);

      const msAtPulse = epochMsFromPulse(kd.kaiPulseEternal | 0);
      kd.timestamp = new Date(Number(msAtPulse)).toISOString();

      // Labels-only enrichment
      const url = iso
        ? `${API_URL}?override_time=${encodeURIComponent(iso)}`
        : API_URL;

      try {
        const resp = await fetch(url, { cache: "no-store" });
        if (!resp.ok) throw new Error();
        const json: KaiApiResponse = await resp.json();

        if (json.eternalSeal)       kd = { ...kd, eternalSeal: json.eternalSeal };
        if (json.kaiTurahPhrase)    kd = { ...kd, kaiTurahPhrase: json.kaiTurahPhrase };
        if (json.eternalMonth)      kd = { ...kd, eternalMonth: json.eternalMonth };
        if (json.eternalChakraArc)  kd = { ...kd, SpiralArc: json.eternalChakraArc };
        if (json.eternalYearName)   kd = { ...kd, eternalYearName: json.eternalYearName };

        setServerSealDayMonth(json.kairos_seal_day_month ?? json.kairos_seal ?? null);
      } catch {
        setErrMsg("Offline — computed locally.");
        setServerSealDayMonth(null);
      }

      hydratePrimitivesFromKlock(kd);
      syncCloseBtn();
    },
    []
  );

  /* live start — only on mount; only returns to live via “Now” */
  const startLive = useCallback(() => {
    stopLive();
    setMode("live");
    setDateISO("");
    setIsoText("");

    // Present moment **now**, then poll — but guard inside queryKai
    void queryKai();
    intervalRef.current = setInterval(() => {
      // Still live? If not, ignore tick.
      if (modeRef.current !== "live") return;
      void queryKai();
    }, LIVE_INTERVAL_MS);
  }, [queryKai, stopLive]);

  /* mount → start live once */
  useEffect(() => {
    startLive();
    return () => stopLive();
  }, [startLive, stopLive]);

  // Only block events for typing controls so the rest (✕, Now, Save, etc.) still work.
  useEffect(() => {
    const shield = (ev: Event) => {
      const t = ev.target as Element | null;
      if (!t) return;
      if (!t.closest(".sigil-modal")) return;

      const isTypingControl =
        t.matches("input, textarea, select") ||
        !!t.closest("label") ||
        t.getAttribute("contenteditable") === "true";

      if (isTypingControl) ev.stopPropagation();
    };

    document.addEventListener("pointerdown", shield, true);
    document.addEventListener("touchstart", shield, true);
    document.addEventListener("click", shield, true);
    document.addEventListener("focusin", shield, true);
    return () => {
      document.removeEventListener("pointerdown", shield, true);
      document.removeEventListener("touchstart", shield, true);
      document.removeEventListener("click", shield, true);
      document.removeEventListener("focusin", shield, true);
    };
  }, []);

  /* ── datetime-local picker (local minute + breath) — HARD-LOCK ─ */
  const onDateChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    stopLive();
    setMode("calendar");
    setDateISO(val);
    setIsoText("");

    if (!val) return;

    const iso = utcFromBreathSlot(val, breathIdx);
    if (iso) void queryKai(iso);
  };

  const onBreathChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const idx = Number(e.target.value);
    setBreathIdx(idx);
    if (!dateISO) return;
    stopLive();
    setMode("calendar");
    const iso = utcFromBreathSlot(dateISO, idx);
    if (iso) void queryKai(iso);
  };

  /* ── raw ISO (UTC/BCE) input — HARD-LOCK ───────────────── */
  const onIsoTextChange = (e: ChangeEvent<HTMLInputElement>) => {
    stopLive();
    setMode("iso");
    setIsoText(e.target.value);
    setDateISO("");
  };

  const goIso = async () => {
    const s = isoText.trim();
    if (!s) return;
    try {
      momentFromUTC(s);            // validate
      await buildLocalKlock(s);    // immediate local lock
      void queryKai(s);            // enrich labels (no numerics)
    } catch {
      setErrMsg("Invalid ISO datetime.");
    }
  };

  /* ── pulse (±∞) selector — HARD-LOCK until “Now” ───────── */
  const onPulseTextChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setPulseText(val);

    stopLive();
    setMode("pulse");
    setDateISO("");
    setIsoText("");

    const trimmed = val.trim();
    if (trimmed === "" || trimmed === "-") return;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return;

    try {
      const ms = epochMsFromPulse(n);
      await buildLocalKlock(ms);                                // lock immediately
      void queryKai(new Date(Number(ms)).toISOString());        // enrich labels
    } catch {
      // If parse failed, remain in pulse mode but don’t crash live state.
      try {
        momentFromPulse(n);
      } catch {
        // ignore invalid pulse; stay in pulse mode
      }
    }
    };
    
    
    /* ── “Now” reset — the ONLY way back to live ───────────── */
    const resetToNow = () => {
    
    const card =
      overlayRef.current?.querySelector(".sigil-modal") as HTMLElement | null;
    if (card) {
      card.classList.remove("flash-now");
      void card.offsetWidth;
      card.classList.add("flash-now");
    }
    setDateISO("");
    setIsoText("");
    setBreathIdx(1);
    startLive();
  };

  /* ── next-pulse countdown (cosmetic, live only) ────────── */
  const [secsLeft, setSecsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (modeRef.current !== "live") return setSecsLeft(null);
    const id = setInterval(() => {
      const rem = PULSE_MS - ((kaiNowMs() - anchorRef.current) % PULSE_MS);
      setSecsLeft(rem / 1000);
    }, 200);
    return () => clearInterval(id);
  }, [staticMode]); // re-evaluate when UI mode flips

  /* ── clipboard ─────────────────────────────────────────── */
  const copy = (txt: string) => void navigator.clipboard.writeText(txt);

  /* -- asset builders ------------------------------------------------------- */
  const buildSVGBlob = (): Blob | null => {
    const svg = document.querySelector<SVGSVGElement>("#sigil-export svg");
    if (!svg) return null;

    const serializer = new XMLSerializer();
    let xml = serializer.serializeToString(svg);
    if (!xml.startsWith("<?xml")) {
      xml = `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
    }
    return new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  };

  const buildPNGBlob = async (): Promise<Blob | null> => {
    const el = document.getElementById("sigil-export");
    if (!el) return null;

    const canvas = await html2canvas(el, {
      backgroundColor: null,
    } as H2COpts);

    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png")
    );
  };

  /* -- zip exporter --------------------------------------------------------- */
  const saveZipBundle = async () => {
    const [svgBlob, pngBlob] = await Promise.all([buildSVGBlob(), buildPNGBlob()]);
    if (!svgBlob || !pngBlob) return;

    const zip = new JSZip();
    zip.file(`sigil_${pulse}.svg`, svgBlob);
    zip.file(`sigil_${pulse}.png`, pngBlob);

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(zipBlob);

    Object.assign(document.createElement("a"), {
      href: url,
      download: `sigil_${pulse}.zip`,
    }).click();

    requestAnimationFrame(() => URL.revokeObjectURL(url));
  };

  const openStargate = () => {
    if (!sigilRef.current) return;
    setStargateURL(sigilRef.current.toDataURL());
    setStargateOpen(true);
  };

  const handleClose = () => {
    setShowVerifier(false);
    onClose();
  };

  /* ── derived strings for display & seal ────────────────── */
  const stepIdxLocal =
    Math.floor(clamp01OpenTop(stepPct) * STEPS_BEAT) % STEPS_BEAT;
  const localBeatStep = fmtSealKairos(beat, stepIdxLocal);

  const showServerKairosInfo = !STRICT_CANONICAL && !!serverSealDayMonth;
  const serverKairosDisp =
    showServerKairosInfo && serverSealDayMonth
      ? fmtServerKairosShort(serverSealDayMonth)
      : "";

  const canonicalSealText =
    klock?.eternalSeal
      ? canonicalizeSealText(klock.eternalSeal, pulse, beat, stepIdxLocal)
      : "";

  /* ═════════════ RENDER ═════════════ */
  const sigilKey = `${pulse}-${clamp(beat, 0, 35)}-${stepIdxLocal}-${chakraDay}`;

  return createPortal(
    <>
      {/* ========= overlay ========= */}
      <div
        ref={overlayRef}
        role="dialog"
        aria-modal="true"
        className={`sigil-modal-overlay ${sealOpen ? "seal-open" : ""}`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && e.stopPropagation()}
      >
        <div
          className="sigil-modal"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          style={{ maxWidth: "min(94vw, 560px)" }}
        >
          {/* ✕ */}
          <button
            ref={closeBtnRef}
            aria-label="Close"
            className="close-btn"
            onClick={handleClose}
          >
            <CloseIcon />
          </button>

          <h2>Kairos Sigil Generator</h2>

          {/* moment pickers */}
          <div className="input-row" style={{ flexWrap: "wrap", gap: 8 }}>
            {/* A) Chronos-free minute+breath selector */}
            <label>
              Select moment:&nbsp;
              <input
                type="datetime-local"
                value={dateISO}
                onChange={onDateChange}
              />
            </label>

            {staticMode === "calendar" && dateISO && (
              <>
                <label style={{ marginLeft: 12 }}>
                  Breath within minute:&nbsp;
                  <select value={breathIdx} onChange={onBreathChange}>
                    {Array.from({ length: 11 }, (_, i) => (
                      <option key={i} value={i + 1}>
                        Breath {i + 1}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}

            {/* B) Raw ISO */}
            <div className="iso-input-group">
              <label style={{ marginLeft: 12 }}>
                ISO:&nbsp;
                <input
                  type="text"
                  className="iso-input"
                  placeholder="YYYY-MM-DDTHH:mm:ssZ"
                  value={isoText}
                  onChange={onIsoTextChange}
                  onKeyDown={(e) => e.key === "Enter" && void goIso()}
                />
              </label>
              <button
                onClick={() => void goIso()}
                className={`go-btn ${!isoText.trim() ? "hidden" : ""}`}
              >
                Go
              </button>
            </div>

            {/* C) Pulse (±∞) — hard lock + live typing */}
            <label
              style={{ marginLeft: 12 }}
              onPointerDownCapture={(e) => e.stopPropagation()}
              onTouchStartCapture={(e) => e.stopPropagation()}
              onClickCapture={(e) => e.stopPropagation()}
            >
              Pulse (±∞):&nbsp;
              <input
                className="pulse-input"
                type="text"
                inputMode="numeric"
                pattern="-?[0-9]*"
                value={pulseText}
                onChange={onPulseTextChange}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                  e.stopPropagation();
                }}
                style={{ width: 140 }}
                aria-label="Pulse (type to update instantly)"
              />
            </label>

            {/* The ONLY way back to live */}
            {staticMode !== "live" && (
              <button
                type="button"
                className="now-btn"
                title="Return to Live Kairos"
                onClick={resetToNow}
                style={{ marginLeft: 12 }}
              >
                Now
              </button>
            )}
          </div>

          {/* countdown + status */}
          {secsLeft !== null && (
            <p className="countdown">
              next pulse in <strong>{secsLeft.toFixed(3)}</strong>s
            </p>
          )}
          {errMsg && <p className="error-msg">{errMsg}</p>}
          {sigilCrashed && (
            <p className="warn-msg" role="status">
              Renderer recovered in safe mode.
            </p>
          )}

          {/* sigil canvas */}
          <div
            id="sigil-export"
            style={{
              position: "relative",
              width: canvasSize,
              margin: "16px auto",
            }}
          >
            <KaiSigilBoundary onError={() => setSigilCrashed(true)}>
              <KaiSigil
                key={sigilKey}
                ref={sigilRef}
                pulse={pulse}
                beat={clamp(beat, 0, 35)}
                stepPct={clamp01OpenTop(stepPct)}
                chakraDay={chakraDay}
                size={canvasSize}
                hashMode="deterministic"
                origin=""
                onReady={(payload: { hash?: string; pulse?: number }) => {

                  const hash = payload?.hash ? String(payload.hash).toLowerCase() : "";
                  const childPulse =
                    typeof payload?.pulse === "number" ? payload.pulse : undefined;
                  if (hash) setLastHash(hash);
                  // Stay locked: mirror the child pulse only if it differs (shouldn't normally)
                  if (typeof childPulse === "number" && childPulse !== pulse) {
                    setPulse(childPulse);
                    setPulseText(String(childPulse));
                  }
                }}
              />
            </KaiSigilBoundary>
            <span className="pulse-tag">{fmt(pulse)}</span>
          </div>

          {/* metadata — strictly canonical */}
          <div className="sigil-meta-block">
            <p>
              <strong>Pulse:</strong>&nbsp;{fmt(pulse)}
              <button className="copy-btn" onClick={() => copy(String(pulse))}>
                Copy
              </button>
            </p>

            <p>
              <strong>Kairos:</strong>&nbsp;{localBeatStep}
              <button className="copy-btn" onClick={() => copy(localBeatStep)}>
                Copy
              </button>
            </p>

            {/* Server short Kairos hidden in STRICT_CANONICAL mode */}
            {showServerKairosInfo && (
              <p className="muted">
                <strong>Server Kairos (info):</strong>&nbsp;{serverKairosDisp}
              </p>
            )}

            {klock && (
              <>
                <p>
                  <strong>Seal:</strong>&nbsp;
                  {canonicalSealText}
                  <button
                    className="copy-btn"
                    onClick={() => copy(canonicalSealText)}
                  >
                    Copy
                  </button>
                </p>
                <p>
                  <strong>Day:</strong> {klock.harmonicDay}
                </p>
                <p>
                  <strong>Month:</strong> {klock.eternalMonth}
                </p>
                <p>
                  <strong>Arc:</strong> {klock.SpiralArc}
                </p>
                <p>
                  <strong>Year:</strong> {klock.eternalYearName}
                </p>
                <p>
                  <strong>Kai-Turah:</strong>&nbsp;{klock.kaiTurahPhrase}
                  <button
                    className="copy-btn"
                    onClick={() => copy(klock.kaiTurahPhrase)}
                  >
                    Copy
                  </button>
                </p>
              </>
            )}
          </div>

          {/* verifier */}
          {!showVerifier ? (
            <button
              onClick={() => setShowVerifier(true)}
              className="verifier-toggle"
            >
              ☤ Verifier
            </button>
          ) : (
            <div
              className="verifier-container"
              role="dialog"
              aria-modal="true"
              aria-label="Kai-Sigil Verifier"
            >
              <div
                className="verifier-bg"
                aria-hidden="true"
                onClick={() => setShowVerifier(false)}
              />
              <button
                className="verifier-exit"
                aria-label="Close verifier"
                onClick={() => setShowVerifier(false)}
              >
                ✕
              </button>
              <div className="container-shell" onClick={(e) => e.stopPropagation()}>
                <VerifierStamper />
              </div>
            </div>
          )}

          {/* actions */}
          <div className="btn-row">
            <button
              className="save-btn"
              onClick={() => {
                const hash =
                  (lastHash || sigilRef.current?.payloadHashHex || "").toLowerCase();
                if (!hash) {
                  alert("Preparing the sigil. Try again in a moment.");
                  return;
                }

                // Build share payload EXACTLY as SigilPage expects
                const payload: SigilSharePayload & {
                  canonicalHash?: string;
                  exportedAt?: string;
                  expiresAtPulse?: number;
                } = {
                  pulse,
                  beat,
                  stepIndex:
                    Math.floor(clamp01OpenTop(stepPct) * STEPS_BEAT) % STEPS_BEAT,
                  chakraDay,
                  stepsPerBeat: STEPS_BEAT,
                  // sovereign fields can be added later in the verifier flow
                  // userPhiKey, kaiSignature,
                  canonicalHash: hash,                        // tie file to live glyph
                  exportedAt: new Date().toISOString(),       // for provenance
                  expiresAtPulse: pulse + 11,                 // default 11-breath window
                };

                const url = makeSigilUrl(hash, payload);
                setSealHash(hash);
                setSealUrl(url);
                setSealOpen(true);
              }}
              disabled={!lastHash}
              title={!lastHash ? "Preparing sigil…" : "Seal this moment"}
            >
              Seal This Moment
            </button>
            <button className="stargate-btn" onClick={openStargate}>
              View in Stargate
            </button>
          </div>
        </div>
      </div>

      {/* ========= Seal popover ========= */}
      <SealMomentModal
        open={sealOpen}
        url={sealUrl}
        hash={sealHash}
        onClose={() => setSealOpen(false)}
        onDownloadZip={saveZipBundle}
      />

      {/* ========= Stargate viewer ========= */}
      {stargateOpen && (
        <StargateModal
          sigilUrl={stargateURL}
          pulse={pulse}
          onClose={() => setStargateOpen(false)}
        />
      )}
    </>,
    document.body
  );
};

export default SigilModal;
