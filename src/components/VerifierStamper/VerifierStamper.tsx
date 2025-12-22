/* eslint-disable */

// src/components/verifier/VerifierStamper.tsx
// VerifierStamper.tsx · Divine Sovereign Transfer Gate (mobile-first)
// v25.1 — NO-ZOOM SEND INPUT (iOS Safari-safe wrapper + hooks)
//         value strip positioned under Pulse/Beat/Step/Day (above Presence/Stewardship/Memory tabs),
//         breath-synced trend pills (▲ green / ▼ red / none on flat),
//         + click-to-open LiveChart popover (Φ/$ pills), μΦ-locked exhale parity + ChakraGate surfacing,
//         child-lock + valuation parity

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./VerifierStamper.css";
import SendPhiAmountField from "./SendPhiAmountField";

/* ───────── μΦ parity helpers (shared with ValuationModal) ───────── */
import {
  snap6, // -> number snapped to 6dp
  toScaled6, // -> bigint scaled at 6dp
  toStr6, // -> string with exactly 6dp from a 6dp-scaled bigint
} from "../../utils/phi-precision";

/* Modularized (use local ./ paths from inside /verifier) */
import VerifierErrorBoundary from "../verifier/VerifierErrorBoundary";
import type {
  SigilMetadata,
  SigilMetadataWithOptionals,
  UiState,
  TabKey,
  ChakraDay,
  SigilTransfer,
  HardenedTransferV14,
  SigilPayload,
  ZkBundle,
  ZkRef,
} from "../verifier/types/local";
import { resolveChakraDay } from "../verifier/types/local";
import { logError } from "../verifier/utils/log";
import { base64EncodeUtf8, base64DecodeUtf8 } from "../verifier/utils/base64";
import { buildNotePayload } from "../verifier/utils/notePayload";
import {
  toScaledBig,
  fromScaledBig,
  mulScaled,
  divScaled,
  roundScaledToDecimals,
  fromScaledBigFixed,
  fmtPhiFixed4,
  exhalePhiFromTransferScaled,
} from "../verifier/utils/decimal";
import {
  getChildLockInfo,
  getParentOpenExpiry,
  PULSES_PER_STEP,
  CLAIM_STEPS,
  CLAIM_PULSES,
} from "../verifier/utils/childExpiry";
import { deriveState } from "../verifier/utils/stateMachine";
import { publishRotation } from "../verifier/utils/rotationBus";
import { rewriteUrlPayload } from "../verifier/utils/urlPayload";
import { safeShowDialog, switchModal } from "../verifier/utils/modal";
import { getSigilGlobal } from "../verifier/utils/sigilGlobal";
import { getFirst, fromSvgDataset } from "../verifier/utils/metaDataset";
import JsonTree from "../verifier/ui/JsonTree";
import StatusChips from "../verifier/ui/StatusChips";

/* Existing flows kept */
import SealMomentModal from "../SealMomentModalTransfer";
import ValuationModal from "../ValuationModal";
import {
  buildValueSeal,
  attachValuation,
  type SigilMetadataLite,
  type ValueSeal,
} from "../../utils/valuation";
import NotePrinter from "../ExhaleNote";
import type { VerifierBridge, BanknoteInputs as NoteBanknoteInputs } from "../exhale-note/types";

import { SIGIL_CTX, SIGIL_TYPE, SEGMENT_SIZE } from "./constants";
import { GENESIS_TS, PULSE_MS, kairosEpochNow } from "../../utils/kai_pulse";

import { sha256Hex, phiFromPublicKey } from "./crypto";
import { loadOrCreateKeypair, signB64u, type Keypair } from "./keys";
import { parseSvgFile, centrePixelSignature, embedMetadata, pngBlobFromSvgDataUrl } from "./svg";
import { pulseFilename, safeFilename, download, fileToPayload } from "./files";
import {
  computeKaiSignature,
  derivePhiKeyFromSig,
  expectedPrevHeadRootV14,
  stableStringify,
  hashTransfer,
  hashTransferSenderSide,
  genNonce,
} from "./sigilUtils";
import { buildMerkleRoot, merkleProof, verifyProof } from "./merkle";
import { sealCurrentWindowIntoSegment } from "./segments";
import { verifyHistorical } from "./verifyHistorical";
import { verifyZkOnHead } from "./zk";
import { DEFAULT_ISSUANCE_POLICY, quotePhiForUsd } from "../../utils/phi-issuance";
import { BREATH_MS } from "../valuation/constants";
import { recordSend, getSpentScaledFor, markConfirmedByLeaf } from "../../utils/sendLedger";

/* Live chart popover (stay inside Verifier modal) */
import LiveChart from "../valuation/chart/LiveChart";
import type { ChartPoint } from "../valuation/series";
import InhaleUploadIcon from "../InhaleUploadIcon";

/* ───────── Event typing for Φ movement success ───────── */
type PhiMoveMode = "send" | "receive";

type PhiMoveSuccessDetail = {
  mode: PhiMoveMode;
  /** e.g. "Φ 1.2345" for display */
  amountPhiDisplay?: string;
  /** optional generic formatted amount string */
  amountDisplay?: string;
  /** raw numeric Φ amount (optional) */
  amountPhi?: number;
  /** optional download URL for a receipt/sigil */
  downloadUrl?: string;
  downloadLabel?: string;
  /** optional human-readable message */
  message?: string;
};
/* ─────────── Shared inline styles / tiny components to shrink markup ─────────── */
const S = {
  full: {
    width: "100vw",
    maxWidth: "100vw",
    height: "100dvh",
    maxHeight: "100dvh",
    margin: 0,
    padding: 0,
    overflow: "hidden",
  } as const,
  viewport: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    maxWidth: "100vw",
    overflow: "hidden",
  } as const,
  gridBar: { display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center" } as const,
  stickyTabs: { position: "sticky", top: 48, zIndex: 2 } as const,
  mono: { overflowWrap: "anywhere" } as const,
  iconBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 44,
    height: 44,
    padding: 0,
    flex: "0 0 auto",
  } as const,
  iconBtnSm: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 40,
    height: 40,
    padding: 0,
    flex: "0 0 auto",
  } as const,
  modalBody: { flex: "1 1 auto", minHeight: 0, overflowY: "auto", overflowX: "hidden", paddingBottom: 80 } as const,
  headerImg: { maxWidth: "64px", height: "auto", flex: "0 0 auto" } as const,
  valueStrip: { overflowX: "auto", whiteSpace: "nowrap" } as const,

  /* Minimal inline popover safety (we’ll replace with CSS next) */
  popBg: {
    position: "fixed" as const,
    inset: 0,
    zIndex: 9999,
    background: "rgba(0,0,0,.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
  },
  popCard: {
    width: "min(980px, 100%)",
    maxHeight: "min(680px, calc(100dvh - 28px))",
    borderRadius: 18,
    overflow: "hidden",
    background: "rgba(8,10,16,.92)",
    border: "1px solid rgba(255,255,255,.12)",
    boxShadow: "0 24px 70px rgba(0,0,0,.6)",
    display: "flex",
    flexDirection: "column" as const,
  },
  popHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "12px 12px 10px 14px",
    borderBottom: "1px solid rgba(255,255,255,.08)",
  },
  popBody: {
    flex: "1 1 auto",
    minHeight: 0,
    overflow: "auto",
    padding: 10,
  },
  popTitle: { fontSize: 12, color: "rgba(255,255,255,.82)", letterSpacing: ".02em" },
};

// Auto-shrink text to fit inside its container (down to a floor scale)
function useAutoShrink<T extends HTMLElement>(
  deps: React.DependencyList = [],
  paddingPx = 16, // visual padding inside the pill
  minScale = 0.65 // smallest allowed scale
) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<T | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const box = boxRef.current;
    const txt = textRef.current;
    if (!box || !txt) return;

    const recompute = () => {
      // available width inside the pill minus padding
      const boxW = Math.max(0, box.clientWidth - paddingPx);
      const textW = txt.scrollWidth;
      if (boxW <= 0 || textW <= 0) return setScale(1);

      const next = Math.min(1, Math.max(minScale, boxW / textW));
      setScale(next);
    };

    // First compute + observe future changes
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(box);
    ro.observe(txt);

    // Also adjust on font load / viewport changes
    window.addEventListener("resize", recompute);
    const id = window.setInterval(recompute, 250); // cheap safety net

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recompute);
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { boxRef, textRef, scale };
}

const KV: React.FC<{ k: React.ReactNode; v: React.ReactNode; wide?: boolean; mono?: boolean }> = ({
  k,
  v,
  wide,
  mono,
}) => (
  <div className={`kv${wide ? " wide" : ""}`}>
    <span className="k">{k}</span>
    <span className={`v${mono ? " mono" : ""}`} style={mono ? S.mono : undefined}>
      {v}
    </span>
  </div>
);

const ValueChip: React.FC<{
  kind: "phi" | "usd";
  trend: "up" | "down" | "flat";
  flash: boolean;
  title: string;
  children: React.ReactNode;
  onClick?: () => void;
  ariaLabel?: string;
}> = ({ kind, trend, flash, title, children, onClick, ariaLabel }) => {
  const { boxRef, textRef, scale } = useAutoShrink<HTMLSpanElement>([children, trend, flash], 16, 0.65);

  const clickable = typeof onClick === "function";

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!clickable) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick?.();
    }
  };

  return (
    <div
      ref={boxRef}
      className={`value-chip ${kind} ${trend}${flash ? " is-flashing" : ""}${clickable ? " is-clickable" : ""}`}
      data-trend={trend}
      title={title}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? ariaLabel || title : undefined}
      onClick={onClick}
      onKeyDown={onKeyDown}
      style={clickable ? ({ cursor: "pointer", userSelect: "none" } as any) : undefined}
    >
      <span
        ref={textRef}
        className="amount"
        style={{
          display: "inline-block",
          whiteSpace: "nowrap",
          lineHeight: 1,
          transform: `scale(${scale})`,
          transformOrigin: "left center",
          willChange: "transform",
        }}
      >
        {children}
      </span>
    </div>
  );
};

const IconBtn: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { small?: boolean; aria?: string; titleText?: string; path: string }
> = ({ small, aria, titleText, path, ...rest }) => (
  <button
    {...rest}
    className={rest.className || "secondary"}
    aria-label={aria}
    title={titleText}
    style={small ? S.iconBtnSm : S.iconBtn}
  >
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" className="ico">
      <path d={path} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  </button>
);
const EXPLORER_REGISTRY_LS_KEY = "kai:sigils:v1";
const EXPLORER_FALLBACK_LS_KEY = "sigil:urls";
const EXPLORER_BC_NAME = "kai-sigil-registry";

function registerUrlForExplorer(url: string) {
  if (typeof window === "undefined") return;

  const put = (key: string) => {
    try {
      const raw = window.localStorage.getItem(key);
      const arr = (raw ? JSON.parse(raw) : []) as string[];
      const next = Array.isArray(arr) ? arr.slice() : [];
      if (!next.includes(url)) next.unshift(url);
      // keep it sane; Explorer can still pull remote history
      window.localStorage.setItem(key, JSON.stringify(next.slice(0, 20000)));
    } catch {}
  };

  put(EXPLORER_REGISTRY_LS_KEY);
  put(EXPLORER_FALLBACK_LS_KEY);

  // Live notify Explorer tab(s)
  try {
    const bc = new BroadcastChannel(EXPLORER_BC_NAME);
    bc.postMessage({ type: "add", url });
    bc.close();
  } catch {}

  // Optional: DOM event hook if Explorer listens
  try {
    window.dispatchEvent(new CustomEvent("kai:registry:add", { detail: { url } }));
  } catch {}
}
/* ────────────────────────────────────────────────────────────────
   KKS-1.0 fixed-point μpulse math (MATCHES SigilModal)
────────────────────────────────────────────────────────────────── */
const ONE_PULSE_MICRO = 1_000_000n; // 1 pulse = 1e6 μpulses
const N_DAY_MICRO = 17_491_270_421n; // 17,491.270421 pulses/day (closure) × 1e6
const PULSES_PER_STEP_MICRO = 11_000_000n; // 11 pulses/step => 11e6 μpulses
const STEPS_PER_BEAT = 44;
const BEATS_PER_DAY = 36;
const DAYS_PER_WEEK = 6;

const WEEKDAY = ["Solhara", "Aquaris", "Flamora", "Verdari", "Sonari", "Kaelith"] as const;
type HarmonicDay = (typeof WEEKDAY)[number];

const DAY_TO_CHAKRA: Record<HarmonicDay, ChakraDay> = {
  Solhara: "Root",
  Aquaris: "Sacral",
  Flamora: "Solar Plexus",
  Verdari: "Heart",
  Sonari: "Throat",
  Kaelith: "Crown",
};

/** round(N_DAY_MICRO / 36) using integer math (MATCHES SigilModal) */
const MU_PER_BEAT_EXACT = (N_DAY_MICRO + 18n) / 36n;

/* ── safe modulo + floorDiv for BigInt ─────────────────────────── */
const imod = (n: bigint, m: bigint) => ((n % m) + m) % m;
function floorDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  return r !== 0n && (r > 0n) !== (d > 0n) ? q - 1n : q;
}

/* ────────────────────────────────────────────────────────────────
   kairosEpochNow() → normalized “μpulses since Genesis”
   (robust against common unit mixups: pulses vs μpulses vs epoch μs)
────────────────────────────────────────────────────────────────── */
function microPulsesSinceGenesisMs(epochMs: number): bigint {
  const deltaMs = epochMs - GENESIS_TS;

  // μpulses = round( deltaMs / PULSE_MS * 1e6 ) with ties-to-even.
  const x = (deltaMs / PULSE_MS) * 1_000_000;
  const s = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const i = Math.trunc(ax);
  const frac = ax - i;

  let rounded = i;
  if (frac > 0.5) rounded = i + 1;
  else if (frac === 0.5) rounded = i % 2 === 0 ? i : i + 1;

  return BigInt(s) * BigInt(rounded);
}

function normalizeKaiEpochRawToMicroPulses(raw: bigint): bigint {
  // 1) raw looks like *pulse count* (small) → promote to μpulses.
  if (raw >= 0n && raw < 500_000_000n) return raw * ONE_PULSE_MICRO;

  // 2) raw already looks like μpulses since Genesis.
  const pulseGuess = floorDiv(raw, ONE_PULSE_MICRO);
  if (pulseGuess >= 0n && pulseGuess < 500_000_000n) return raw;

  // 3) fallback: treat as epoch microseconds → epoch ms → μpulses since Genesis
  const epochMsBI = raw / 1000n;
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  const minSafe = BigInt(Number.MIN_SAFE_INTEGER);
  if (epochMsBI > maxSafe || epochMsBI < minSafe) return raw;

  const epochMs = Number(epochMsBI);
  if (!Number.isFinite(epochMs)) return raw;

  return microPulsesSinceGenesisMs(epochMs);
}

function readKaiNowMicro(): { pμ: bigint; pulse: number; μInPulse: bigint; msToNext: number } {
  const raw = kairosEpochNow();
  const pμ = normalizeKaiEpochRawToMicroPulses(raw);

  const pulseBI = floorDiv(pμ, ONE_PULSE_MICRO);
  const pulse =
    pulseBI <= 0n ? 0 : pulseBI > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(pulseBI);

  const μInPulse = imod(pμ, ONE_PULSE_MICRO); // 0..999,999
  const μToNext = ONE_PULSE_MICRO - μInPulse; // 1..1,000,000
  const msToNext = Math.max(0, Math.ceil((Number(μToNext) * PULSE_MS) / 1_000_000));

  return { pμ, pulse, μInPulse, msToNext };
}

function computeLiveKaiFromMicro(pμ: bigint): {
  pulse: number;
  beat: number;
  stepIndex: number;
  harmonicDay: HarmonicDay;
  chakraDay: ChakraDay;
} {
  const pulseBI = floorDiv(pμ, ONE_PULSE_MICRO);
  const pulse =
    pulseBI <= 0n ? 0 : pulseBI > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(pulseBI);

  const pμ_in_day = imod(pμ, N_DAY_MICRO);
  const dayIndex = floorDiv(pμ, N_DAY_MICRO);

  const beatRaw = Number(floorDiv(pμ_in_day, MU_PER_BEAT_EXACT));
  const beat = Math.min(Math.max(beatRaw, 0), BEATS_PER_DAY - 1);

  const pμ_in_beat = pμ_in_day - BigInt(beat) * MU_PER_BEAT_EXACT;

  const rawStep = Number(pμ_in_beat / PULSES_PER_STEP_MICRO);
  const stepIndex = Math.min(Math.max(rawStep, 0), STEPS_PER_BEAT - 1);

  const harmonicDayIndex = Number(imod(dayIndex, BigInt(DAYS_PER_WEEK)));
  const harmonicDay = WEEKDAY[harmonicDayIndex];
  const chakraDay = DAY_TO_CHAKRA[harmonicDay];

  return { pulse, beat, stepIndex, harmonicDay, chakraDay };
}

/* ────────────────────────────────────────────────────────────────
   Deterministic boundary ticker: updates ONLY when pulse boundary passes
────────────────────────────────────────────────────────────────── */
function useKaiBoundaryTicker(active: boolean) {
  const [snap, setSnap] = useState(() => readKaiNowMicro());
  const tRef = useRef<number | null>(null);

  useEffect(() => {
    if (tRef.current !== null) {
      window.clearTimeout(tRef.current);
      tRef.current = null;
    }
    if (!active) return;

    const tick = () => {
      const s = readKaiNowMicro();
      setSnap((prev) => (prev.pulse === s.pulse ? prev : s));
      tRef.current = window.setTimeout(tick, s.msToNext);
    };

    tick();
    return () => {
      if (tRef.current !== null) window.clearTimeout(tRef.current);
      tRef.current = null;
    };
  }, [active]);

  return snap;
}

/* 6-decimal countdown (derived ONLY from μpulse remainder) */
function useKaiPulseCountdown(active: boolean) {
  const [secsLeft, setSecsLeft] = useState<number>(PULSE_MS / 1000);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (!active) return;

    const loop = () => {
      const s = readKaiNowMicro();
      const μToNext = ONE_PULSE_MICRO - s.μInPulse;
      const msLeft = (Number(μToNext) * PULSE_MS) / 1_000_000;
      setSecsLeft(Math.max(0, msLeft / 1000));
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [active]);

  return active ? secsLeft : null;
}
// Deterministic pulse "now" accessor (used by legacy call-sites)
function kaiPulseNow(): number {
  return readKaiNowMicro().pulse;
}

/* ═════════════ Component ═════════════ */
const VerifierStamperInner: React.FC = () => {
  const svgInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dlgRef = useRef<HTMLDialogElement>(null);
  const noteDlgRef = useRef<HTMLDialogElement>(null);

 // ✅ Deterministic Kai “NOW” — updates only on pulse boundaries (NO Date / NO 1s polling)
const snap = useKaiBoundaryTicker(true);
const live = useMemo(() => computeLiveKaiFromMicro(snap.pμ), [snap.pμ]);
const secsLeft = useKaiPulseCountdown(true);

const pulseNow = live.pulse;

const headerBeatStep = useMemo(
  () => `${live.beat}:${String(live.stepIndex).padStart(2, "0")}`,
  [live.beat, live.stepIndex]
);


  const [svgURL, setSvgURL] = useState<string | null>(null);
  const [sourceFilename, setSourceFilename] = useState<string | null>(null);
  const [rawMeta, setRawMeta] = useState<string | null>(null);
  const [meta, setMeta] = useState<SigilMetadata | null>(null);

  const [contentSigExpected, setContentSigExpected] = useState<string | null>(null);
  const [contentSigMatches, setContentSigMatches] = useState<boolean | null>(null);
  const [phiKeyExpected, setPhiKeyExpected] = useState<string | null>(null);
  const [phiKeyMatches, setPhiKeyMatches] = useState<boolean | null>(null);

  const [liveSig, setLiveSig] = useState<string | null>(null);
  const [rgbSeed, setRgbSeed] = useState<[number, number, number] | null>(null);

  const [payload, setPayload] = useState<SigilPayload | null>(null);

  const [amountMode, setAmountMode] = useState<"USD" | "PHI">("PHI");
  const [phiInput, setPhiInput] = useState<string>("");
  const [usdInput, setUsdInput] = useState<string>("");

  const [uiState, setUiState] = useState<UiState>("idle");
  const [tab, setTab] = useState<TabKey>("summary");
  const [error, setError] = useState<string | null>(null);
  const [viewRaw, setViewRaw] = useState<boolean>(false);

  const [headProof, setHeadProof] = useState<{ ok: boolean; index: number; root: string } | null>(null);

  const [sealOpen, setSealOpen] = useState<boolean>(false);
  const [sealUrl, setSealUrl] = useState<string>("");
  const [sealHash, setSealHash] = useState<string>("");
  const [valuationOpen, setValuationOpen] = useState<boolean>(false);
  const [noteOpen, setNoteOpen] = useState<boolean>(false);
  const [sigilSvgRaw, setSigilSvgRaw] = useState<string | null>(null);

  const [rotateOut, setRotateOut] = useState<boolean>(false);
  useEffect(() => {
    const d = dlgRef.current;
    if (!d) return;
    if (rotateOut) d.setAttribute("data-rotate", "true");
    else d.removeAttribute("data-rotate");
  }, [rotateOut]);

  const [me, setMe] = useState<Keypair | null>(null);
  useEffect(() => {
    (async () => {
      try {
        setMe(await loadOrCreateKeypair());
      } catch (err) {
        logError("loadOrCreateKeypair", err);
      }
    })();
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/verification_key.json", { cache: "no-store" });
        if (!res.ok) return;
        const vkey: unknown = await res.json();
        if (!alive) return;
        (window as any).SIGIL_ZK_VKEY = vkey;
      } catch (err) {
        logError("fetch(/verification_key.json)", err);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const [canonical, setCanonical] = useState<string | null>(null);
  const [canonicalContext, setCanonicalContext] = useState<"parent" | "derivative" | null>(null);

  const openVerifier = () => safeShowDialog(dlgRef.current);

  const closeVerifier = () => {
    // Reset interactive state so next sigil is clean
    setError(null);
    setUiState("idle");
    setTab("summary");
    setViewRaw(false);
    setPhiInput("");
    setUsdInput("");
    setPayload(null);

    // 🔑 CRITICAL: allow re-uploading the same file again
    if (svgInput.current) svgInput.current.value = "";
    if (fileInput.current) fileInput.current.value = "";

    dlgRef.current?.close();
    dlgRef.current?.setAttribute("data-open", "false");
  };

  const noteInitial = useMemo<NoteBanknoteInputs>(
    () =>
      buildNotePayload({
        meta,
        sigilSvgRaw,
        verifyUrl: sealUrl || (typeof window !== "undefined" ? window.location.href : ""),
        pulseNow,
      }),
    [meta, sigilSvgRaw, sealUrl, pulseNow]
  );

  const openNote = () =>
    switchModal(dlgRef.current, () => {
      const d = noteDlgRef.current;
      if (!d) return;
      const p = buildNotePayload({
        meta,
        sigilSvgRaw,
        verifyUrl: sealUrl || (typeof window !== "undefined" ? window.location.href : ""),
        pulseNow,
      });
      const bridge: VerifierBridge = { getNoteData: async () => p };
      (window as any).KKVerifier = bridge;
      try {
        window.dispatchEvent(new CustomEvent<NoteBanknoteInputs>("kk:note-data", { detail: p }));
      } catch (err) {
        logError("dispatch(kk:note-data)", err);
      }
      safeShowDialog(d);
      setNoteOpen(true);
    });

  const closeNote = () => {
    const d = noteDlgRef.current;
    d?.close();
    d?.setAttribute("data-open", "false");
    setNoteOpen(false);
  };

  const openValuation = () => switchModal(dlgRef.current, () => setValuationOpen(true));
  const closeValuation = () => setValuationOpen(false);

  const onAttachValuation = async (seal: ValueSeal) => {
    if (!meta) return;
    const updated = attachValuation(meta, seal) as SigilMetadata;
    setMeta(updated);
    setRawMeta(JSON.stringify(updated, null, 2));
    if (svgURL) {
      const durl = await embedMetadata(svgURL, updated);
      download(durl, `${pulseFilename("sigil_with_valuation", updated.pulse ?? 0, pulseNow)}.svg`);
    }
    setValuationOpen(false);
  };

  const refreshHeadWindow = useCallback(async (m: SigilMetadata) => {
    const transfers = m.transfers ?? [];
    const root = await (await import("./sigilUtils")).computeHeadWindowRoot(transfers);
    (m as SigilMetadataWithOptionals).transfersWindowRoot = root;

    if (transfers.length > 0) {
      const leaves = await Promise.all(transfers.map(hashTransfer));
      const index = leaves.length - 1;
      const proof = await merkleProof(leaves, index);
      const okDirect = await verifyProof(root, proof);
      const okBundle = await verifyHistorical(m, { kind: "head", windowMerkleRoot: root, transferProof: proof });
      setHeadProof({ ok: okDirect && okBundle, index, root });
    } else setHeadProof(null);

    try {
      const v14Leaves = await Promise.all(
        (m.hardenedTransfers ?? []).map(async (t) =>
          sha256Hex(
            stableStringify({
              previousHeadRoot: t.previousHeadRoot,
              senderPubKey: t.senderPubKey,
              senderSig: t.senderSig,
              senderKaiPulse: t.senderKaiPulse,
              nonce: t.nonce,
              transferLeafHashSend: t.transferLeafHashSend,
              receiverPubKey: t.receiverPubKey,
              receiverSig: t.receiverSig,
              receiverKaiPulse: t.receiverKaiPulse,
              transferLeafHashReceive: t.transferLeafHashReceive,
              zkSend: t.zkSend ?? null,
              zkReceive: t.zkReceive ?? null,
            })
          )
        )
      );
      (m as SigilMetadataWithOptionals).transfersWindowRootV14 = await buildMerkleRoot(v14Leaves);
    } catch (err) {
      logError("refreshHeadWindow.buildMerkleRoot(v14)", err);
    }

    try {
      await verifyZkOnHead(m);
      setMeta({ ...m });
    } catch (err) {
      logError("refreshHeadWindow.verifyZkOnHead", err);
    }

    return m;
  }, []);

  const isPersistedChild = useCallback(async (m: SigilMetadata) => {
    const parentCanonical =
      (m.canonicalHash as string | undefined)?.toLowerCase() ||
      (await sha256Hex(`${m.pulse}|${m.beat}|${m.stepIndex}|${m.chakraDay}`)).toLowerCase();
    const explicitChildOf = (m as SigilMetadataWithOptionals).childOfHash?.toLowerCase();
    if (explicitChildOf && (m.canonicalHash?.toLowerCase() ?? "") !== parentCanonical) return true;
    return (m.canonicalHash?.toLowerCase() ?? "") !== parentCanonical;
  }, []);

  const computeEffectiveCanonical = useCallback(
    async (m: SigilMetadata): Promise<{ canonical: string; context: "parent" | "derivative" }> => {
      const parentCanonical =
        (m.canonicalHash as string | undefined)?.toLowerCase() ||
        (await sha256Hex(`${m.pulse}|${m.beat}|${m.stepIndex}|${m.chakraDay}`)).toLowerCase();

      if (await isPersistedChild(m)) {
        const childCanon = (m.canonicalHash as string).toLowerCase();
        const used = !!(m as SigilMetadataWithOptionals).sendLock?.used;
        const lastClosed = !!(m.transfers ?? []).slice(-1)[0]?.receiverSignature;
        return { canonical: childCanon, context: used || lastClosed ? "parent" : "derivative" };
      }

      const last = (m.transfers ?? []).slice(-1)[0];
      const hardenedLast = (m.hardenedTransfers ?? []).slice(-1)[0];
      const isChildOpen = !!last && !last.receiverSignature;
      if (!isChildOpen) return { canonical: parentCanonical, context: "parent" };

      const sendLeaf = last ? await hashTransferSenderSide(last) : "";
      const prevHead =
        hardenedLast?.previousHeadRoot ||
        (m as SigilMetadataWithOptionals).transfersWindowRootV14 ||
        (m as SigilMetadataWithOptionals).transfersWindowRoot ||
        "";
      const seed = stableStringify({
        parent: parentCanonical,
        nonce: m.transferNonce || "",
        senderStamp: last?.senderStamp || "",
        senderKaiPulse: last?.senderKaiPulse || 0,
        prevHead,
        leafSend: sendLeaf,
      });
      const childCanonical = (await sha256Hex(seed)).toLowerCase();
      return { canonical: childCanonical, context: "derivative" };
    },
    [isPersistedChild]
  );

  const handleSvg = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    try {
      setSigilSvgRaw(await f.text());
    } catch (err) {
      logError("handleSvg.readFile", err);
      setSigilSvgRaw(null);
    }

    setSourceFilename(f.name || null);
    setError(null);
    setPayload(null);
    setTab("summary");
    setViewRaw(false);

    const url = URL.createObjectURL(f);
    setSvgURL(url);

    const { meta: m, contextOk, typeOk } = await parseSvgFile(f);

    m.segmentSize ??= SEGMENT_SIZE;
    const segCount = (m.segments ?? []).reduce((a, s) => a + (s.count || 0), 0);
    if (typeof m.cumulativeTransfers !== "number") m.cumulativeTransfers = segCount + (m.transfers?.length ?? 0);
    if ((m.segments?.length ?? 0) > 0 && !m.segmentsMerkleRoot)
      m.segmentsMerkleRoot = await buildMerkleRoot((m.segments ?? []).map((s) => s.root));

    const pulseForSeal = typeof m.pulse === "number" ? m.pulse : kaiPulseNow();
    const { sig, rgb } = await centrePixelSignature(url, pulseForSeal);
    setLiveSig(sig);
    setRgbSeed(rgb);

    const expected = await computeKaiSignature(m);
    setContentSigExpected(expected);
    const cMatch = expected && m.kaiSignature ? expected.toLowerCase() === m.kaiSignature.toLowerCase() : null;
    setContentSigMatches(cMatch);

    if (m.kaiSignature) {
      const expectedPhi = await derivePhiKeyFromSig(m.kaiSignature);
      setPhiKeyExpected(expectedPhi);
      setPhiKeyMatches(m.userPhiKey ? expectedPhi === m.userPhiKey : null);
    } else {
      setPhiKeyExpected(null);
      setPhiKeyMatches(null);
    }

    try {
      if ((m as SigilMetadataWithOptionals).creatorPublicKey) {
        const phi = await phiFromPublicKey((m as SigilMetadataWithOptionals).creatorPublicKey!);
        if (!m.userPhiKey) m.userPhiKey = phi;
      }
    } catch (err) {
      logError("handleSvg.phiFromPublicKey", err);
    }

    const hasCore =
      typeof m.pulse === "number" &&
      typeof m.beat === "number" &&
      typeof m.stepIndex === "number" &&
      typeof m.chakraDay === "string";

    const last = m.transfers?.slice(-1)[0];
    const lastParty = last?.receiverSignature || last?.senderSignature || null;
    const isOwner = lastParty && sig ? lastParty === sig : null;
    const hasTransfers = !!(m.transfers && m.transfers.length > 0);
    const lastOpen = !!(last && !last.receiverSignature);
    const lastClosed = !!(last && !!last.receiverSignature);
    const isUnsigned = !m.kaiSignature;

    const m2 = await refreshHeadWindow(m);

    let effCtx: "parent" | "derivative" | null = null;
    try {
      const eff = await computeEffectiveCanonical(m2);
      setCanonical(eff.canonical);
      setCanonicalContext(eff.context);
      effCtx = eff.context;
    } catch (err) {
      logError("computeEffectiveCanonical", err);
      setCanonical(null);
      setCanonicalContext(null);
    }

    const { used: childUsed, expired: childExpired } = getChildLockInfo(m2, kaiPulseNow());
    const { expired: parentOpenExpired } = getParentOpenExpiry(m2, kaiPulseNow());

    setMeta(m2);
    setRawMeta(JSON.stringify(m2, null, 2));

    const nextUi: UiState = deriveState({
      contextOk,
      typeOk,
      hasCore,
      contentSigMatches: cMatch,
      isOwner,
      hasTransfers,
      lastOpen,
      lastClosed,
      isUnsigned,
      childUsed,
      childExpired,
      parentOpenExpired,
      isChildContext: effCtx === "derivative",
    });
    setUiState(nextUi);

    setAmountMode("PHI");
    setPhiInput("");
    setUsdInput("");

    openVerifier();

    // 🔑 Important: clear the input so choosing the same file again fires onChange
    if (e.target) e.target.value = "";
  };

  const handleAttach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPayload(await fileToPayload(f));
  };

  const sealUnsigned = async () => {
    if (!meta || !svgURL) return;
    const m = { ...meta };
    const nowPulse = kaiPulseNow();
    if (!m.kaiSignature) {
      const sig = await computeKaiSignature(m);
      if (!sig) {
        setError("Cannot compute kaiSignature — missing core fields.");
        return;
      }
      m.kaiSignature = sig;
    }
    if (!m.userPhiKey && m.kaiSignature) m.userPhiKey = await derivePhiKeyFromSig(m.kaiSignature);
    if (typeof m.kaiPulse !== "number") m.kaiPulse = nowPulse;
    try {
      if (!(m as SigilMetadataWithOptionals).creatorPublicKey && me) (m as SigilMetadataWithOptionals).creatorPublicKey = me.spkiB64u;
    } catch (err) {
      logError("sealUnsigned.creatorPublicKey", err);
    }
    const durl = await embedMetadata(svgURL, m);
    download(durl, `${safeFilename("sigil_sealed", nowPulse)}.svg`);
    const m2 = await refreshHeadWindow(m);
    setMeta(m2);
    setRawMeta(JSON.stringify(m2, null, 2));
    setUiState((p) => (p === "unsigned" ? "readySend" : p));
    setError(null);
  };

  async function buildChildMetaForDownload(
    updated: SigilMetadata,
    args: { parentCanonical: string; childCanonical: string; allocationPhiStr: string; issuedPulse: number }
  ) {
    const m = JSON.parse(JSON.stringify(updated)) as SigilMetadataWithOptionals;
    m.canonicalHash = args.childCanonical;
    m.childOfHash = args.parentCanonical;
    m.childAllocationPhi = args.allocationPhiStr; // exact 6dp string
    m.childIssuedPulse = args.issuedPulse;
    m.childClaim = { steps: CLAIM_STEPS, expireAtPulse: args.issuedPulse + CLAIM_PULSES };
    m.sendLock = { nonce: updated.transferNonce!, used: false };
    m.branchBasePhi = args.allocationPhiStr; // keep parity for branch head
    m.branchSpentPhi = "0";
    return m;
  }

  const shareTransferLink = useCallback(async (m: SigilMetadata) => {
    const parentCanonical =
      (m.canonicalHash as string | undefined)?.toLowerCase() ||
      (await sha256Hex(`${m.pulse}|${m.beat}|${m.stepIndex}|${m.chakraDay}`)).toLowerCase();

    const last = (m.transfers ?? []).slice(-1)[0];
    const hardenedLast = (m.hardenedTransfers ?? []).slice(-1)[0];
    const sendLeaf = last ? await hashTransferSenderSide(last) : "";
    const childSeed = stableStringify({
      parent: parentCanonical,
      nonce: m.transferNonce || "",
      senderStamp: last?.senderStamp || "",
      senderKaiPulse: last?.senderKaiPulse || 0,
      prevHead:
        hardenedLast?.previousHeadRoot ||
        (m as SigilMetadataWithOptionals).transfersWindowRootV14 ||
        (m as SigilMetadataWithOptionals).transfersWindowRoot ||
        "",
      leafSend: sendLeaf,
    });
    const childHash = (await sha256Hex(childSeed)).toLowerCase();

    const token = m.transferNonce || genNonce();
    const chakraDay: ChakraDay = (m.chakraDay as ChakraDay) || "Root";
    const sharePayload = {
      pulse: m.pulse as number,
      beat: m.beat as number,
      stepIndex: m.stepIndex as number,
      chakraDay,
      kaiSignature: m.kaiSignature,
      userPhiKey: m.userPhiKey,
    };

    const startPulse = last?.senderKaiPulse ?? kaiPulseNow();
    const claim = {
      steps: CLAIM_STEPS,
      expireAtPulse: startPulse + CLAIM_PULSES,
      stepsPerBeat: (m as SigilMetadataWithOptionals).stepsPerBeat ?? 44,
    };

    let preview: { unit?: "USD" | "PHI"; amountPhi?: string; amountUsd?: string; usdPerPhi?: number } | undefined;
    try {
      if (last?.payload?.mime?.startsWith("application/vnd.kairos-exhale")) {
        const obj = JSON.parse(base64DecodeUtf8(last.payload.encoded)) as
          | { kind?: string; unit?: "USD" | "PHI"; amountPhi?: string; amountUsd?: string; usdPerPhi?: number }
          | null;
        if (obj?.kind === "exhale") preview = { unit: obj.unit, amountPhi: obj.amountPhi, amountUsd: obj.amountUsd, usdPerPhi: obj.usdPerPhi };
      }
    } catch (err) {
      logError("shareTransferLink.previewDecode", err);
    }

    const enriched = { ...sharePayload, canonicalHash: childHash, parentHash: parentCanonical, transferNonce: token, claim, preview };

    let base = "";
    try {
      const { makeSigilUrl } = await import("../../utils/sigilUrl");
      base = makeSigilUrl(childHash, sharePayload);
    } catch (err) {
      logError("shareTransferLink.makeSigilUrl", err);
      const u = new URL(typeof window !== "undefined" ? window.location.href : "http://localhost");
      u.pathname = `/s/${childHash}`;
      base = u.toString();
    }

    let historyParam: string | undefined;
    try {
      const { encodeSigilHistory } = await import("../../utils/sigilUrl");
      const lite: Array<{ s: string; p: number; r?: string }> = [];
      for (const t of m.transfers ?? []) {
        if (!t?.senderSignature || typeof t.senderKaiPulse !== "number") continue;
        lite.push(
          typeof t.receiverSignature === "string" && typeof t.receiverKaiPulse === "number"
            ? { s: t.senderSignature, p: t.senderKaiPulse, r: t.receiverSignature }
            : { s: t.senderSignature, p: t.senderKaiPulse }
        );
      }
      const enc = encodeSigilHistory(lite);
      historyParam = enc.startsWith("h:") ? enc.slice(2) : enc;
    } catch (err) {
      logError("shareTransferLink.encodeSigilHistory", err);
    }

    const url = rewriteUrlPayload(base, enriched, token, historyParam);
    setSealUrl(url);
    setSealHash(childHash);
    setRotateOut(true);
    registerUrlForExplorer(url);
    switchModal(dlgRef.current, () => setSealOpen(true));
    try {
      publishRotation([parentCanonical], token);
    } catch (err) {
      logError("shareTransferLink.publishRotation", err);
    }
  }, []);

  const syncMetaAndUi = useCallback(
    async (mNew: SigilMetadata) => {
      setMeta(mNew);
      setRawMeta(JSON.stringify(mNew, null, 2));

      const hasCore =
        typeof mNew.pulse === "number" &&
        typeof mNew.beat === "number" &&
        typeof mNew.stepIndex === "number" &&
        typeof mNew.chakraDay === "string";

      const lastTx = mNew.transfers?.slice(-1)[0];
      const lastParty = lastTx?.receiverSignature || lastTx?.senderSignature || null;
      const isOwner = lastParty && liveSig ? lastParty === liveSig : null;
      const hasTransfers = !!(mNew.transfers && mNew.transfers.length > 0);
      const lastOpen = !!(lastTx && !lastTx.receiverSignature);
      const lastClosed = !!(lastTx && !!lastTx.receiverSignature);
      const isUnsigned = !mNew.kaiSignature;

      let effCtx: "parent" | "derivative" | null = null;
      try {
        const eff = await computeEffectiveCanonical(mNew);
        setCanonical(eff.canonical);
        setCanonicalContext(eff.context);
        effCtx = eff.context;
      } catch (err) {
        logError("syncMetaAndUi.computeEffectiveCanonical", err);
        setCanonical(null);
        setCanonicalContext(null);
      }

      const { used: childUsed, expired: childExpired } = getChildLockInfo(mNew, kaiPulseNow());
      const { expired: parentOpenExpired } = getParentOpenExpiry(mNew, kaiPulseNow());
      const cMatch =
        contentSigExpected && mNew.kaiSignature ? contentSigExpected.toLowerCase() === mNew.kaiSignature.toLowerCase() : null;

      const next: UiState = deriveState({
        contextOk: true,
        typeOk: true,
        hasCore,
        contentSigMatches: cMatch,
        isOwner,
        hasTransfers,
        lastOpen,
        lastClosed,
        isUnsigned,
        childUsed,
        childExpired,
        parentOpenExpired,
        isChildContext: effCtx === "derivative",
      });
      setUiState(next);
    },
    [liveSig, computeEffectiveCanonical, contentSigExpected]
  );

  const fmtPhiCompact = useCallback((s: string) => {
    let t = (s || "").trim();
    if (!t) return "0";
    if (t.startsWith(".")) t = "0" + t;
    t = t.replace(/\.?$/, (m) => (/\.\d/.test(t) ? m : ""));
    return t;
  }, []);

  const fmtUsdNoSym = useCallback(
    (v: number) =>
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        useGrouping: true,
      }).format(Math.max(0, v || 0)),
    []
  );

  const canShare = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      typeof (navigator as Navigator & { share?: (data?: unknown) => Promise<void> }).share === "function",
    []
  );

  useEffect(
    () => () => {
      if (svgURL?.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(svgURL);
        } catch (err) {
          logError("revokeObjectURL", err);
        }
      }
    },
    [svgURL]
  );

  // ⬇️ add deps: canonicalContext, sourceFilename
  const metaLiteForNote = useMemo<SigilMetadataLite | null>(() => {
    if (!meta) return null;
    const mOpt = meta as SigilMetadataWithOptionals;
    const steps: number = typeof mOpt.stepsPerBeat === "number" ? mOpt.stepsPerBeat : 12;
    const twr = mOpt.transfersWindowRoot ?? mOpt.transfersWindowRootV14 ?? "";

    // ⬇️ include derivative hints + exact child value fields (strings or numbers both OK)
    const out = {
      pulse: meta.pulse as number,
      beat: meta.beat as number,
      stepIndex: meta.stepIndex as number,
      stepsPerBeat: steps,
      chakraDay: (meta.chakraDay as ChakraDay) || "Root",
      kaiSignature: meta.kaiSignature ?? "",
      userPhiKey: meta.userPhiKey ?? "",
      transfersWindowRoot: twr,

      // NEW: minimal hints so ValuationModal can detect & resolve child value
      canonicalContext: canonicalContext ?? undefined,
      childOfHash: (mOpt.childOfHash ?? undefined) as any,
      sendLock: (mOpt.sendLock ?? undefined) as any,
      childClaim: (mOpt.childClaim ?? undefined) as any,
      childAllocationPhi: (mOpt.childAllocationPhi ?? undefined) as any,
      branchBasePhi: (mOpt.branchBasePhi ?? undefined) as any,

      // if you carry these in meta, pass through (typed as-any to keep SigilMetadataLite)
      valuationSource: (mOpt as any).valuationSource,
      stats: (mOpt as any).stats,

      // filename helps the “sigil_send” heuristic
      fileName: sourceFilename ?? undefined,
    } as SigilMetadataLite as any;

    return out;
  }, [meta, canonicalContext, sourceFilename]);

  // Chakra Gate (display without the word "gate")
  const chakraGate = useMemo<string | null>(() => {
    if (!meta) return null;
    const raw =
      getFirst(meta, ["chakraGate", "valuationSource.chakraGate"]) ||
      fromSvgDataset(meta as SigilMetadataWithOptionals, "data-chakra-gate") ||
      null;
    if (!raw) return null;

    const cleaned = raw.replace(/\bgate\b/gi, "").replace(/\s{2,}/g, " ").trim();
    return cleaned || raw;
  }, [meta]);

  type InitialGlyph = { hash: string; value: number; pulseCreated: number; meta: SigilMetadataLite };
  const [initialGlyph, setInitialGlyph] = useState<InitialGlyph | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!metaLiteForNote) {
        setInitialGlyph(null);
        return;
      }
      const canonicalHash =
        (meta?.canonicalHash as string | undefined)?.toLowerCase() ||
        (await sha256Hex(`${metaLiteForNote.pulse}|${metaLiteForNote.beat}|${metaLiteForNote.stepIndex}|${metaLiteForNote.chakraDay}`)).toLowerCase();
      try {
        const headHash =
          (meta as SigilMetadataWithOptionals)?.transfersWindowRoot ||
          (meta as SigilMetadataWithOptionals)?.transfersWindowRootV14 ||
          "";
        const { seal } = await buildValueSeal(metaLiteForNote, pulseNow, sha256Hex, headHash);
        if (!cancelled)
          setInitialGlyph({
            hash: canonicalHash,
            value: seal.valuePhi ?? 0,
            pulseCreated: metaLiteForNote.pulse ?? pulseNow,
            meta: metaLiteForNote,
          });
      } catch (err) {
        logError("buildValueSeal", err);
        if (!cancelled)
          setInitialGlyph({
            hash: canonicalHash,
            value: 0,
            pulseCreated: metaLiteForNote.pulse ?? pulseNow,
            meta: metaLiteForNote,
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [metaLiteForNote, meta, pulseNow]);

  useEffect(() => {
    if (!noteOpen || sigilSvgRaw || !svgURL) return;
    (async () => {
      try {
        const txt = await fetch(svgURL).then((r) => r.text());
        setSigilSvgRaw(txt);
      } catch (err) {
        logError("ensureRawSvgForNote", err);
      }
    })();
  }, [noteOpen, sigilSvgRaw, svgURL]);

  const issuancePolicy = DEFAULT_ISSUANCE_POLICY;
  const { usdPerPhi } = useMemo(() => {
    try {
      const nowKai = pulseNow;
      const metaLiteSafe: SigilMetadataLite =
        metaLiteForNote ?? {
          pulse: 0,
          beat: 0,
          stepIndex: 0,
          stepsPerBeat: 12,
          chakraDay: "Root",
          kaiSignature: "",
          userPhiKey: "",
          transfersWindowRoot: "",
        };
      const q = quotePhiForUsd(
        { meta: metaLiteSafe, nowPulse: nowKai, usd: 100, currentStreakDays: 0, lifetimeUsdSoFar: 0 },
        issuancePolicy
      );
      return { usdPerPhi: q.usdPerPhi ?? 0 };
    } catch (err) {
      logError("quotePhiForUsd", err);
      return { usdPerPhi: 0 };
    }
  }, [metaLiteForNote, pulseNow, issuancePolicy]);

  const persistedBaseScaled = useMemo(
    () => toScaledBig(((meta as SigilMetadataWithOptionals | null)?.branchBasePhi ?? "")),
    [meta]
  );
  const persistedSpentScaled = useMemo(
    () => toScaledBig(((meta as SigilMetadataWithOptionals | null)?.branchSpentPhi ?? "0")),
    [meta]
  );

  const pivotIndex = useMemo(() => {
    const trs = meta?.transfers ?? [];
    for (let i = trs.length - 1; i >= 0; i -= 1) if (trs[i]?.receiverSignature) return i;
    return trs.length > 0 ? trs.length - 1 : -1;
  }, [meta?.transfers]);

  const prevPivotIndex = useMemo(() => {
    const trs = meta?.transfers ?? [];
    let seen = 0;
    for (let i = trs.length - 1; i >= 0; i -= 1) if (trs[i]?.receiverSignature && ++seen === 2) return i;
    return -1;
  }, [meta?.transfers]);

  const lastTransfer = useMemo(() => (meta?.transfers ?? []).slice(-1)[0], [meta?.transfers]);
  const isChildContext = useMemo(() => canonicalContext === "derivative", [canonicalContext]);

  const basePhiScaled = useMemo(() => {
    if (isChildContext) {
      const childAllocStr = (meta as SigilMetadataWithOptionals | null)?.childAllocationPhi;
      if (childAllocStr) {
        const ex = toScaledBig(childAllocStr);
        if (ex > 0n) return ex;
      }
      const exOpen = toScaledBig(fromScaledBig(exhalePhiFromTransferScaled(lastTransfer)));
      return exOpen > 0n ? exOpen : 0n;
    }
    if (persistedBaseScaled > 0n) return persistedBaseScaled;
    if (pivotIndex >= 0 && meta?.transfers) {
      const v = exhalePhiFromTransferScaled(meta.transfers[pivotIndex]);
      return v > 0n ? v : 0n;
    }
    return toScaledBig(String(initialGlyph?.value ?? 0) || "0");
  }, [isChildContext, meta, lastTransfer, persistedBaseScaled, pivotIndex, initialGlyph]);

  const currentWindowSpentScaled = useMemo(() => {
    try {
      const trs = meta?.transfers ?? [];
      let sum = 0n;
      for (let i = Math.max(0, pivotIndex + 1); i < trs.length; i += 1) sum += exhalePhiFromTransferScaled(trs[i]);
      return sum;
    } catch (err) {
      logError("remainingPhiScaled.sumAfterPivot", err);
      return 0n;
    }
  }, [meta?.transfers, pivotIndex]);

  const priorWindowSpentScaled = useMemo(() => {
    try {
      const trs = meta?.transfers ?? [];
      if (pivotIndex <= 0) return 0n;
      const start = Math.max(0, prevPivotIndex + 1);
      const end = Math.max(start, pivotIndex);
      let sum = 0n;
      for (let i = start; i < end; i += 1) sum += exhalePhiFromTransferScaled(trs[i]);
      return sum;
    } catch (err) {
      logError("priorWindowSpentScaled", err);
      return 0n;
    }
  }, [meta?.transfers, pivotIndex, prevPivotIndex]);

  const ledgerSpentScaled = useMemo(() => {
    if (!canonical) return 0n;
    try {
      return getSpentScaledFor(canonical);
    } catch (err) {
      logError("ledgerSpentScaled", err);
      return 0n;
    }
  }, [canonical]);

  const effectivePersistedSpentScaled = useMemo(
    () => (persistedSpentScaled > priorWindowSpentScaled ? persistedSpentScaled : priorWindowSpentScaled),
    [persistedSpentScaled, priorWindowSpentScaled]
  );

  const metaSpentScaled = useMemo(
    () => (isChildContext ? 0n : effectivePersistedSpentScaled + currentWindowSpentScaled),
    [isChildContext, effectivePersistedSpentScaled, currentWindowSpentScaled]
  );

  const totalSpentScaled = useMemo(
    () => (ledgerSpentScaled > metaSpentScaled ? ledgerSpentScaled : metaSpentScaled),
    [ledgerSpentScaled, metaSpentScaled]
  );

  const remainingPhiScaled = useMemo(
    () => (basePhiScaled > totalSpentScaled ? basePhiScaled - totalSpentScaled : 0n),
    [basePhiScaled, totalSpentScaled]
  );

  const remainingPhiDisplay4 = useMemo(
    () => fromScaledBigFixed(roundScaledToDecimals(remainingPhiScaled, 4), 4),
    [remainingPhiScaled]
  );

  // Snap headline Φ to 6dp for UI (math stays BigInt elsewhere)
  const headerPhi = useMemo(() => snap6(Number(fromScaledBig(remainingPhiScaled))), [remainingPhiScaled]);

  const usdPerPhiRateScaled = useMemo(() => toScaledBig((usdPerPhi || 0).toFixed(18)), [usdPerPhi]);
  const headerUsd = useMemo(
    () => Number(fromScaledBig(mulScaled(remainingPhiScaled, usdPerPhiRateScaled))) || 0,
    [remainingPhiScaled, usdPerPhiRateScaled]
  );

  /* ────────────────────────────────────────────────────────────────
     Breath-synced trend computation (BREATH_MS):
     - Φ chip trend is driven by headerPhi deltas
     - $ chip trend is driven by headerUsd deltas (rounded to cents)
     - flash triggers only on change, clears after 420ms
     CSS is responsible for ▲ green / ▼ red / none on flat.
  ───────────────────────────────────────────────────────────────── */
  const [phiTrend, setPhiTrend] = useState<"up" | "down" | "flat">("flat");
  const [usdTrend, setUsdTrend] = useState<"up" | "down" | "flat">("flat");
  const [phiFlash, setPhiFlash] = useState<boolean>(false);
  const [usdFlash, setUsdFlash] = useState<boolean>(false);

  const latestPhiRef = useRef<number>(headerPhi);
  const latestUsdRef = useRef<number>(headerUsd);
  const shownPhiRef = useRef<number>(headerPhi);
  const shownUsdRef = useRef<number>(Math.round(headerUsd * 100) / 100);

  const phiFlashTimeoutRef = useRef<number | null>(null);
  const usdFlashTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    latestPhiRef.current = headerPhi;
  }, [headerPhi]);

  useEffect(() => {
    latestUsdRef.current = headerUsd;
  }, [headerUsd]);

  useEffect(() => {
    const eps = 1e-9;

    const tick = () => {
      // Φ
      const nextPhi = latestPhiRef.current;
      const prevPhi = shownPhiRef.current;
      const phiDelta = nextPhi - prevPhi;
      const nextPhiTrend: "up" | "down" | "flat" =
        phiDelta > eps ? "up" : phiDelta < -eps ? "down" : "flat";

      if (nextPhiTrend !== "flat" && Math.abs(phiDelta) > eps) {
        setPhiTrend(nextPhiTrend);
        setPhiFlash(true);
        if (phiFlashTimeoutRef.current) window.clearTimeout(phiFlashTimeoutRef.current);
        phiFlashTimeoutRef.current = window.setTimeout(() => setPhiFlash(false), 420);
      } else {
        setPhiTrend("flat");
      }
      shownPhiRef.current = nextPhi;

      // USD (round to cents so we don't flicker on microscopic float changes)
      const nextUsd = Math.round(latestUsdRef.current * 100) / 100;
      const prevUsd = shownUsdRef.current;
      const usdDelta = nextUsd - prevUsd;
      const nextUsdTrend: "up" | "down" | "flat" =
        usdDelta > eps ? "up" : usdDelta < -eps ? "down" : "flat";

      if (nextUsdTrend !== "flat" && Math.abs(usdDelta) > eps) {
        setUsdTrend(nextUsdTrend);
        setUsdFlash(true);
        if (usdFlashTimeoutRef.current) window.clearTimeout(usdFlashTimeoutRef.current);
        usdFlashTimeoutRef.current = window.setTimeout(() => setUsdFlash(false), 420);
      } else {
        setUsdTrend("flat");
      }
      shownUsdRef.current = nextUsd;
    };

    // Initialize refs so first tick doesn't "flash" from 0 → value
    shownPhiRef.current = latestPhiRef.current;
    shownUsdRef.current = Math.round(latestUsdRef.current * 100) / 100;

    const id = window.setInterval(tick, BREATH_MS);
    return () => {
      window.clearInterval(id);
      if (phiFlashTimeoutRef.current) window.clearTimeout(phiFlashTimeoutRef.current);
      if (usdFlashTimeoutRef.current) window.clearTimeout(usdFlashTimeoutRef.current);
    };
  }, []);

  /* ────────────────────────────────────────────────────────────────
     LiveChart popover (stays inside the verifier modal)
  ───────────────────────────────────────────────────────────────── */
  const [chartOpen, setChartOpen] = useState(false);
  const [chartFocus, setChartFocus] = useState<"phi" | "usd">("phi");
  // force a remount when opening/switching focus so ResponsiveContainer never measures at 0
  const [chartReflowKey, setChartReflowKey] = useState(0);
  const openChartPopover = useCallback((focus: "phi" | "usd") => {
    setChartFocus(focus);
    setChartOpen(true);
    setChartReflowKey((k) => k + 1);
  }, []);
  useEffect(() => {
    if (chartOpen) setChartReflowKey((k) => k + 1);
  }, [chartOpen, chartFocus]);

  const closeChartPopover = useCallback(() => {
    setChartOpen(false);
  }, []);

  useEffect(() => {
    if (!chartOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeChartPopover();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chartOpen, closeChartPopover]);

  /* ────────────────────────────────────────────────────────────────
     μΦ-exact conversion & send-input normalization
     - For PHI mode: normalize user input to exactly 6dp via toScaled6 → toStr6
     - For USD mode: compute Φ from USD, then round to 6dp string
     Every downstream use (canExhale, send, payload, ledger) consumes this 6dp string.
  ───────────────────────────────────────────────────────────────── */
  const conv = useMemo(() => {
    if (amountMode === "PHI") {
      const phiNormalized = fmtPhiCompact(phiInput);
      const phi6Scaled = toScaled6(phiNormalized); // 6dp BigInt
      const phi6String = toStr6(phi6Scaled); // "X.XXXXXX"
      const usdScaled = mulScaled(toScaledBig(phi6String), usdPerPhiRateScaled);
      const usdNumber = Number(fromScaledBig(usdScaled));
      return {
        displayLeftLabel: "Φ",
        displayRight: Number.isFinite(usdNumber) ? `$ ${fmtUsdNoSym(usdNumber)}` : "$ 0.00",
        phiStringToSend: phi6String, // exact 6dp string
        usdNumberAtSend: Number.isFinite(usdNumber) ? usdNumber : 0,
      };
    }

    // USD mode
    const usdScaled = toScaledBig(usdInput);
    const phiScaled = divScaled(usdScaled, usdPerPhiRateScaled);
    const phi6String = fromScaledBigFixed(roundScaledToDecimals(phiScaled, 6), 6); // exact 6dp
    return {
      displayLeftLabel: "$",
      displayRight: `≈ Φ ${fromScaledBigFixed(roundScaledToDecimals(phiScaled, 4), 4)}`, // friendly preview (4dp)
      phiStringToSend: phi6String, // exact 6dp string
      usdNumberAtSend: Number(fromScaledBig(usdScaled)) || 0,
    };
  }, [amountMode, phiInput, usdInput, usdPerPhiRateScaled, fmtUsdNoSym, fmtPhiCompact]);

  const canExhale = useMemo(
    () => toScaledBig(conv.phiStringToSend || "0") > 0n && toScaledBig(conv.phiStringToSend || "0") <= remainingPhiScaled,
    [conv.phiStringToSend, remainingPhiScaled]
  );

  const downloadZip = useCallback(async () => {
    if (!meta || !svgURL) return;
    const svgDataUrl = await embedMetadata(svgURL, meta);
    const svgBlob = await fetch(svgDataUrl).then((r) => r.blob());
    let pngBlob: Blob | null = null;
    try {
      pngBlob = await pngBlobFromSvgDataUrl(svgDataUrl, 1024);
    } catch (err) {
      logError("pngBlobFromSvgDataUrl", err);
    }
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    const sigilPulse = meta.pulse ?? 0;
    const last = meta.transfers?.slice(-1)[0];
    const sendPulse = last?.senderKaiPulse ?? meta.kaiPulse ?? kaiPulseNow();
    const base = pulseFilename("sigil_bundle", sigilPulse, sendPulse);
    zip.file(`${base}.svg`, svgBlob);
    if (pngBlob) zip.file(`${base}.png`, pngBlob);
    const zipBlob = await zip.generateAsync({ type: "blob" });
    download(zipBlob, `${base}.zip`);
  }, [meta, svgURL]);

  const isSendFilename = useMemo(() => (sourceFilename || "").toLowerCase().includes("sigil_send"), [sourceFilename]);

  const send = async () => {
    if (!meta || !svgURL || !liveSig) return;

    if (meta.kaiSignature && contentSigExpected && meta.kaiSignature.toLowerCase() !== contentSigExpected.toLowerCase()) {
      setError("Content signature mismatch — cannot send.");
      setUiState("sigMismatch");
      return;
    }

    const m: SigilMetadata = { ...meta };
    if (!m.kaiSignature) {
      const sig = await computeKaiSignature(m);
      if (!sig) {
        setError("Cannot compute kaiSignature — missing core fields.");
        return;
      }
      m.kaiSignature = sig;
      if (!m.userPhiKey) m.userPhiKey = await derivePhiKeyFromSig(sig);
    }
    if (typeof m.kaiPulse !== "number") m.kaiPulse = kaiPulseNow();

    const nowPulse = kaiPulseNow();
    const stamp = await sha256Hex(`${liveSig}-${m.pulse ?? 0}-${nowPulse}`);

    // μΦ-normalized amount from conv (already 6dp string)
    const validPhi6 = (conv.phiStringToSend || "").trim(); // "X.XXXXXX"
    const reqScaled = toScaledBig(validPhi6);

    if (reqScaled <= 0n) {
      setError("Enter a Φ amount greater than zero.");
      return;
    }
    if (reqScaled > remainingPhiScaled) {
      setError(
        `Exhale exceeds resonance Φ — requested Φ ${fromScaledBigFixed(reqScaled, 4)} but only Φ ${remainingPhiDisplay4} remains on this glyph.`
      );
      return;
    }

    const cleanUsd = Number.isFinite(conv.usdNumberAtSend) ? Math.max(0, conv.usdNumberAtSend) : 0;

    // Prefer exhale payload (μΦ-exact)
    let chosenPayload: SigilPayload | undefined;
    {
      const body = {
        kind: "exhale" as const,
        unit: amountMode,
        amountPhi: validPhi6, // ← exact 6dp string
        amountUsd: cleanUsd.toFixed(2),
        usdPerPhi: usdPerPhi || 0,
        atPulse: nowPulse,
        kaiSignature: m.kaiSignature || "",
        userPhiKey: m.userPhiKey || "",
      };
      chosenPayload = {
        name: `exhale_${validPhi6.replace(/\./g, "_")}phi.json`,
        mime: "application/vnd.kairos-exhale+json",
        size: base64EncodeUtf8(JSON.stringify(body)).length,
        encoded: base64EncodeUtf8(JSON.stringify(body)),
      };
    }
    if (!chosenPayload && payload) chosenPayload = payload;

    const transfer: SigilTransfer = {
      senderSignature: liveSig,
      senderStamp: stamp,
      senderKaiPulse: nowPulse,
      payload: chosenPayload ?? undefined,
    };
    const updated: SigilMetadata = {
      ...m,
      ["@context"]: m["@context"] ?? SIGIL_CTX,
      type: m.type ?? SIGIL_TYPE,
      canonicalHash: m.canonicalHash || undefined,
      transferNonce: m.transferNonce || genNonce(),
      transfers: [...(m.transfers ?? []), transfer],
      segmentSize: m.segmentSize ?? SEGMENT_SIZE,
    };

    try {
      const prevSpent = toScaledBig((meta as SigilMetadataWithOptionals)?.branchSpentPhi ?? "0");
      const newSpentScaled = prevSpent + reqScaled; // μΦ-normalized increment
      (updated as SigilMetadataWithOptionals).branchBasePhi =
        (meta as SigilMetadataWithOptionals)?.branchBasePhi ?? fromScaledBig(basePhiScaled);
      (updated as SigilMetadataWithOptionals).branchSpentPhi = fromScaledBig(newSpentScaled);
    } catch (err) {
      logError("send.persistBranchProgress", err);
    }

    // Hardened + ZK + ledger (unchanged; amounts already μΦ normalized)
    let parentCanonical = "",
      childCanonical = "",
      transferLeafHashSend = "",
      prevHeadV14 = "";
    try {
      parentCanonical =
        (updated.canonicalHash as string | undefined)?.toLowerCase() ||
        (await sha256Hex(`${updated.pulse}|${updated.beat}|${updated.stepIndex}|${updated.chakraDay}`)).toLowerCase();

      if (me) {
        (updated as SigilMetadataWithOptionals).creatorPublicKey ??= me.spkiB64u;

        const indexV14 = updated.hardenedTransfers?.length ?? 0;
        prevHeadV14 = await expectedPrevHeadRootV14(updated, indexV14);
        transferLeafHashSend = await hashTransferSenderSide(transfer);
        const nonce = updated.transferNonce!;

        const mod = (await import("./sigilUtils")) as typeof import("./sigilUtils");
        const msg = mod.buildSendMessageV14(updated, {
          previousHeadRoot: prevHeadV14,
          senderKaiPulse: nowPulse,
          senderPubKey: (updated as SigilMetadataWithOptionals).creatorPublicKey!,
          nonce,
          transferLeafHashSend,
        });
        const senderSig = await signB64u(me.priv, msg);

        const hardened: HardenedTransferV14 = {
          previousHeadRoot: prevHeadV14,
          senderPubKey: (updated as SigilMetadataWithOptionals).creatorPublicKey!,
          senderSig,
          senderKaiPulse: nowPulse,
          nonce,
          transferLeafHashSend,
        };

        if ((window as any).SIGIL_ZK?.provideSendProof) {
          try {
            const proofObj = await (window as any).SIGIL_ZK.provideSendProof({
              meta: updated,
              leafHash: transferLeafHashSend,
              previousHeadRoot: prevHeadV14,
              nonce,
            });
            if (proofObj) {
              const bundle: ZkBundle = {
                scheme: "groth16",
                curve: "BLS12-381",
                proof: proofObj.proof,
                publicSignals: proofObj.publicSignals,
                vkey: proofObj.vkey,
              };
              (hardened as SigilMetadataWithOptionals).zkSendBundle = bundle;
              const publicHash = await mod.hashAny(proofObj.publicSignals);
              const proofHash = await mod.hashAny(proofObj.proof);
              const vkey = proofObj.vkey ?? (updated as SigilMetadataWithOptionals).zkVerifyingKey ?? (window as any).SIGIL_ZK_VKEY;
              const vkeyHash = vkey ? await mod.hashAny(vkey) : undefined;
              const ref: ZkRef = { scheme: "groth16", curve: "BLS12-381", publicHash, proofHash, vkeyHash };
              (hardened as SigilMetadataWithOptionals).zkSend = ref;
            }
          } catch (err) {
            logError("provideSendProof", err);
          }
        }

        updated.hardenedTransfers = [...(updated.hardenedTransfers ?? []), hardened];
      }

      const childSeed = stableStringify({
        parent: parentCanonical,
        nonce: updated.transferNonce || "",
        senderStamp: transfer.senderStamp || "",
        senderKaiPulse: transfer.senderKaiPulse || 0,
        prevHead:
          prevHeadV14 ||
          (updated as SigilMetadataWithOptionals).transfersWindowRootV14 ||
          (updated as SigilMetadataWithOptionals).transfersWindowRoot ||
          "",
        leafSend: transferLeafHashSend,
      });
      childCanonical = (await sha256Hex(childSeed)).toLowerCase();

      const rec = {
        parentCanonical,
        childCanonical,
        amountPhiScaled: toScaledBig(validPhi6).toString(), // μΦ-exact
        senderKaiPulse: nowPulse,
        transferNonce: updated.transferNonce!,
        senderStamp: stamp,
        previousHeadRoot: prevHeadV14,
        transferLeafHashSend,
      };
      try {
        await recordSend(rec);
      } catch (err) {
        logError("recordSend", err);
      }
      try {
        getSigilGlobal().registerSend?.(rec);
      } catch (err) {
        logError("__SIGIL__.registerSend", err);
      }
      try {
        window.dispatchEvent(new CustomEvent("sigil:sent", { detail: rec }));
      } catch (err) {
        logError("dispatchEvent(sigil:sent)", err);
      }
    } catch (err) {
      logError("send.hardenedBuild/ledger", err);
    }

    // Child metadata with μΦ allocation
    const childMeta = await buildChildMetaForDownload(updated, {
      parentCanonical,
      childCanonical,
      allocationPhiStr: validPhi6,
      issuedPulse: nowPulse,
    });
    const childDataUrl = await embedMetadata(svgURL, childMeta);
    const sigilPulse = updated.pulse ?? 0;
    download(childDataUrl, `${pulseFilename("sigil_send", sigilPulse, nowPulse)}.svg`);

    // Optional: seal segment after cap
    const windowSize = (updated.transfers ?? []).length;
    const cap = updated.segmentSize ?? SEGMENT_SIZE;
    if (windowSize >= cap) {
      const { meta: rolled, segmentFileBlob } = await sealCurrentWindowIntoSegment(updated);
      if (segmentFileBlob)
        download(
          segmentFileBlob,
          `sigil_segment_${rolled.pulse ?? 0}_${String((rolled.segments?.length ?? 1) - 1).padStart(6, "0")}.json`
        );
      const durl2 = await embedMetadata(svgURL, rolled);
      download(durl2, `${pulseFilename("sigil_head_after_seal", rolled.pulse ?? 0, nowPulse)}.svg`);
      const rolled2 = await refreshHeadWindow(rolled);
      await syncMetaAndUi(rolled2);
      setError(null);
      setPhiInput("");
      setUsdInput("");
      await shareTransferLink(rolled2);
      return;
    }

    const updated2 = await refreshHeadWindow(updated);
    await syncMetaAndUi(updated2);
    setError(null);
    setPhiInput("");
    setUsdInput("");
    await shareTransferLink(updated2);
  };

  const receive = async () => {
    if (!meta || !svgURL || !liveSig) return;

    if (canonicalContext === "parent") {
      const { expired: parentExpired } = getParentOpenExpiry(meta, kaiPulseNow());
      if (parentExpired) {
        setError("This open send has expired.");
        return;
      }
    }

    const { used, expired } = getChildLockInfo(meta, kaiPulseNow());
    if (used) {
      setError("This transfer link has already been used.");
      return;
    }
    if (expired) {
      setError("This transfer link has expired.");
      setUiState("complete");
      return;
    }

    const last = meta.transfers?.slice(-1)[0];
    if (!last || last.receiverSignature) return;

    const nowPulse = kaiPulseNow();
    const updatedLast: SigilTransfer = {
      ...last,
      receiverSignature: liveSig,
      receiverStamp: await sha256Hex(`${liveSig}-${last.senderStamp}-${nowPulse}`),
      receiverKaiPulse: nowPulse,
    };
    const updated: SigilMetadataWithOptionals = {
      ...(meta as SigilMetadataWithOptionals),
      transfers: [...(meta.transfers ?? []).slice(0, -1), updatedLast],
    };

    try {
      if (me && (updated.hardenedTransfers?.length ?? 0) > 0) {
        const hLast = updated.hardenedTransfers![updated.hardenedTransfers!.length - 1];
        if (!hLast.receiverSig) {
          (updated as SigilMetadataWithOptionals).creatorPublicKey ??= me.spkiB64u;
          const transferLeafHashReceive = await hashTransfer(updatedLast);
          const mod = (await import("./sigilUtils")) as typeof import("./sigilUtils");
          const msgR = mod.buildReceiveMessageV14({
            previousHeadRoot: hLast.previousHeadRoot,
            senderSig: hLast.senderSig,
            receiverKaiPulse: nowPulse,
            receiverPubKey: (updated as SigilMetadataWithOptionals).creatorPublicKey!,
            transferLeafHashReceive,
          });
          const receiverSig = await signB64u(me.priv, msgR);
          const newHLast: HardenedTransferV14 = {
            ...hLast,
            receiverPubKey: (updated as SigilMetadataWithOptionals).creatorPublicKey!,
            receiverSig,
            receiverKaiPulse: nowPulse,
            transferLeafHashReceive,
          };

          if ((window as any).SIGIL_ZK?.provideReceiveProof) {
            try {
              const proofObj = await (window as any).SIGIL_ZK.provideReceiveProof({
                meta: updated,
                leafHash: transferLeafHashReceive,
                previousHeadRoot: hLast.previousHeadRoot,
                linkSig: hLast.senderSig,
              });
              if (proofObj) {
                const bundle: ZkBundle = {
                  scheme: "groth16",
                  curve: "BLS12-381",
                  proof: proofObj.proof,
                  publicSignals: proofObj.publicSignals,
                  vkey: proofObj.vkey,
                };
                (newHLast as SigilMetadataWithOptionals).zkReceiveBundle = bundle;
                const publicHash = await mod.hashAny(proofObj.publicSignals);
                const proofHash = await mod.hashAny(proofObj.proof);
                const vkey = proofObj.vkey ?? (updated as SigilMetadataWithOptionals).zkVerifyingKey ?? (window as any).SIGIL_ZK_VKEY;
                const vkeyHash = vkey ? await mod.hashAny(vkey) : undefined;
                const ref: ZkRef = { scheme: "groth16", curve: "BLS12-381", publicHash, proofHash, vkeyHash };
                (newHLast as SigilMetadataWithOptionals).zkReceive = ref;
              }
            } catch (err) {
              logError("provideReceiveProof", err);
            }
          }

          updated.hardenedTransfers = [...updated.hardenedTransfers!.slice(0, -1), newHLast];

          try {
            const parentCanon =
              (updated.childOfHash as string | undefined)?.toLowerCase() ||
              (await sha256Hex(`${updated.pulse}|${updated.beat}|${updated.stepIndex}|${updated.chakraDay}`)).toLowerCase();
            if (hLast.transferLeafHashSend) markConfirmedByLeaf(parentCanon, hLast.transferLeafHashSend);
          } catch (err) {
            logError("ledger.markConfirmedByLeaf", err);
          }
        }
      }
    } catch (err) {
      logError("receive.hardenedSeal", err);
    }

    try {
      if (await isPersistedChild(updated))
        updated.sendLock = { ...(updated.sendLock ?? { nonce: updated.transferNonce! }), used: true, usedPulse: nowPulse };
    } catch (err) {
      logError("receive.setUsedLock", err);
    }

    const durl = await embedMetadata(svgURL, updated);
    const sigilPulse = updated.pulse ?? 0;
    download(durl, `${pulseFilename("sigil_receive", sigilPulse, nowPulse)}.svg`);
    const updated2 = await refreshHeadWindow(updated);
    await syncMetaAndUi(updated2);
    setError(null);
  };

  const sealSegmentNow = useCallback(async () => {
    if (!meta || !(meta.transfers?.length)) return;
    if (isSendFilename) {
      setError("Segmentation is disabled on SEND sigils.");
      return;
    }
    const { meta: rolled, segmentFileBlob } = await sealCurrentWindowIntoSegment(meta);
    if (segmentFileBlob)
      download(
        segmentFileBlob,
        `sigil_segment_${rolled.pulse ?? 0}_${String((rolled.segments?.length ?? 1) - 1).padStart(6, "0")}.json`
      );
    if (svgURL) {
      const durl = await embedMetadata(svgURL, rolled);
      download(durl, `${pulseFilename("sigil_head_after_seal", rolled.pulse ?? 0, kaiPulseNow())}.svg`);
    }
    const rolled2 = await refreshHeadWindow(rolled);
    await syncMetaAndUi(rolled2);
    setError(null);
  }, [meta, svgURL, isSendFilename, refreshHeadWindow, syncMetaAndUi]);

  const frequencyHz = useMemo(
    () =>
      getFirst(meta, ["frequencyHz", "valuationSource.frequencyHz"]) ||
      fromSvgDataset(meta as SigilMetadataWithOptionals, "data-frequency-hz"),
    [meta]
  );

  // Chakra: resolve from chakraDay or chakraGate (strips "gate" implicitly)
  const chakraDayDisplay = useMemo<ChakraDay | null>(() => resolveChakraDay(meta ?? {}), [meta]);

  const childDeadline = useMemo(() => {
    if (canonicalContext !== "derivative") return null;
    const info = getChildLockInfo(meta, pulseNow);
    if (!info.expireAt) return null;
    const leftPulses = Math.max(0, info.expireAt - pulseNow);
    const leftSteps = Math.ceil(leftPulses / PULSES_PER_STEP);
    return { leftPulses, leftSteps, expireAt: info.expireAt };
  }, [meta, pulseNow, canonicalContext]);

  const { used: childUsed, expired: childExpired } = useMemo(() => getChildLockInfo(meta, pulseNow), [meta, pulseNow]);
  const parentOpenExp = useMemo(() => getParentOpenExpiry(meta, pulseNow).expired, [meta, pulseNow]);

  function useRollingChartSeries({
    seriesKey,
    sampleMs,
    valuePhi,
    usdPerPhi,
    maxPoints = 2048,
    snapKey,
  }: {
    seriesKey: string;
    sampleMs: number;
    valuePhi: number;
    usdPerPhi: number;
    maxPoints?: number;
    snapKey?: number;
  }) {
    const [data, setData] = React.useState<ChartPoint[]>([]);
    const dataRef = React.useRef<ChartPoint[]>([]);
    const vRef = React.useRef(valuePhi);
    const fxRef = React.useRef(usdPerPhi);

    // keep latest values in refs
    React.useEffect(() => {
      if (Number.isFinite(valuePhi)) vRef.current = valuePhi;
    }, [valuePhi]);

    React.useEffect(() => {
      if (Number.isFinite(usdPerPhi) && usdPerPhi > 0) fxRef.current = usdPerPhi;
    }, [usdPerPhi]);

    const snapNow = React.useCallback(() => {
      const p = kaiPulseNow();
      const val = Number.isFinite(vRef.current) ? vRef.current : 0;
      const fx = Number.isFinite(fxRef.current) && fxRef.current > 0 ? fxRef.current : 0;

      const prev = dataRef.current;
      if (!prev.length) {
        const seed: ChartPoint[] = [
          { i: p - 1, value: val, fx } as any,
          { i: p, value: val, fx } as any,
        ];
        dataRef.current = seed;
        setData(seed);
        return;
      }

      const last = prev[prev.length - 1] as any;
      let next: ChartPoint[];

      if (last?.i === p) {
        // update current pulse point immediately
        next = [...prev.slice(0, -1), { ...last, value: val, fx } as any];
      } else if (typeof last?.i === "number" && last.i < p) {
        // pulse advanced: append
        next = [...prev, { i: p, value: val, fx } as any];
      } else {
        // weird ordering: just replace last
        next = [...prev.slice(0, -1), { ...last, value: val, fx } as any];
      }

      if (next.length > maxPoints) next.splice(0, next.length - maxPoints);

      dataRef.current = next;
      setData(next);
    }, [maxPoints]);

    // Reset when a new glyph/canonical is loaded (seed with *current* value immediately)
    React.useEffect(() => {
      dataRef.current = [];
      setData([]);
      snapNow();
    }, [seriesKey, snapNow]);

    // SNAP IMMEDIATELY on value changes (so you don’t wait for next BREATH tick)
    React.useEffect(() => {
      snapNow();
    }, [valuePhi, usdPerPhi, snapNow]);

    // SNAP when opening / switching focus (use snapKey from your chartReflowKey)
    React.useEffect(() => {
      if (typeof snapKey === "number") snapNow();
    }, [snapKey, snapNow]);

    // Continue appending at breath cadence
    React.useEffect(() => {
      const id = window.setInterval(() => {
        const p = kaiPulseNow();
        const prev = dataRef.current;
        const last = prev[prev.length - 1] as any;
        if (last?.i === p) return;

        const nextPoint = { i: p, value: vRef.current, fx: fxRef.current } as any;
        const next = prev.length ? [...prev, nextPoint] : [nextPoint];
        if (next.length > maxPoints) next.splice(0, next.length - maxPoints);

        dataRef.current = next;
        setData(next);
      }, sampleMs);

      return () => window.clearInterval(id);
    }, [sampleMs, maxPoints]);

    return data;
  }

  const seriesKey = useMemo(() => {
    // canonical is best; fallback to core tuple so it still resets correctly
    if (canonical) return canonical;
    if (!meta) return "none";
    return `${meta.pulse ?? "x"}|${meta.beat ?? "x"}|${meta.stepIndex ?? "x"}|${meta.chakraDay ?? "x"}`;
  }, [canonical, meta]);

  const chartData = useRollingChartSeries({
    seriesKey,
    sampleMs: BREATH_MS,
    valuePhi: headerPhi,
    usdPerPhi,
    maxPoints: 4096,
    snapKey: chartReflowKey, // 👈 ensures “exact price on open”
  });

  // sensible PV: use your initialGlyph seal if present, else current live Φ
  const pvForChart = useMemo(() => {
    const v = Number(initialGlyph?.value);
    return Number.isFinite(v) && v > 0 ? v : headerPhi;
  }, [initialGlyph, headerPhi]);

  return (
    <div
      className="verifier-stamper"
      role="application"
      style={{ maxWidth: "100vw", overflowX: "hidden" }}
    >
      {/* Top toolbar — Stream + ΦKey on the same row, with live Kai pulse */}
      <div className="toolbar">
        <div className="toolbar-main">
          <div className="brand-lockup" aria-label="Kairos live status">
            <div className="brand-text">
              <div className="live-pulse">
                <span className="now">LIVE</span>
                <span className="pulse-number"> ☤KAI {pulseNow}</span>
              </div>
            </div>
          </div>

          <div className="toolbar-actions" aria-label="Verifier actions">
            <button
              className="primary"
              onClick={() => svgInput.current?.click()}
              type="button"
            >
              <InhaleUploadIcon color="#37FFE4" />

              <span className="phikey-label" aria-label="PhiKey">
                <img className="phikey-mark" src="/phi.svg" alt="Φ" />
                <span className="phikey-text">Key</span>
              </span>
            </button>
          </div>
        </div>
      </div>

      <input ref={svgInput} type="file" accept=".svg" hidden onChange={handleSvg} />

      {/* Verifier Modal */}
      <dialog
        ref={dlgRef}
        className="glass-modal fullscreen"
        id="verifier-dialog"
        data-open="false"
        aria-label="Kai-Sigil Verifier Modal"
        style={S.full}
      >
        <div className="modal-viewport" style={S.viewport}>
          <div className="modal-topbar" style={S.gridBar}>
            <div className="status-strip" aria-live="polite" style={S.valueStrip}>
              <StatusChips
                uiState={uiState}
                contentSigMatches={contentSigMatches}
                phiKeyMatches={phiKeyMatches}
                meta={meta}
                headProof={headProof}
                canonicalContext={canonicalContext}
                childUsed={childUsed}
                childExpired={childExpired}
                parentOpenExpired={parentOpenExp}
                isSendFilename={isSendFilename}
              />
            </div>
            <button
              className="close-btn holo"
              data-aurora="true"
              aria-label="Close"
              title="Close"
              onClick={closeVerifier}
              style={{ justifySelf: "end", marginRight: 8 }}
            >
              ×
            </button>
          </div>

          {svgURL && meta && (
            <>
              {/* Header */}
              <header className="modal-header" style={{ paddingInline: 16 }}>
                <img src={svgURL} alt="Sigil thumbnail" width={64} height={64} style={S.headerImg} />
                <div className="header-fields" style={{ minWidth: 0 }}>
                  <h2 style={{ overflowWrap: "anywhere" }}>
                    Pulse <span>{meta.pulse ?? "—"}</span>
                  </h2>
                  <p>
                    Beat <span>{meta.beat ?? "—"}</span> · Step <span>{meta.stepIndex ?? "—"}</span> · Day:{" "}
                    <span>{(chakraDayDisplay as ChakraDay) ?? (meta.chakraDay as ChakraDay) ?? "—"}</span>
                  </p>

                  {/* Value strip MUST remain under Beat/Step/Day; CSS handles final spacing */}
                  <div className="value-strip" aria-live="polite">
                    <ValueChip
                      kind="phi"
                      trend={phiTrend}
                      flash={phiFlash}
                      title={canonicalContext === "derivative" ? "Resonance Φ for this derivative glyph" : "Resonance Φ on this glyph"}
                      ariaLabel="Open live chart for Φ value"
                      onClick={() => openChartPopover("phi")}
                    >
                      <span className="sym">Φ</span>
                      {headerPhi.toFixed(6)}
                    </ValueChip>

                    <ValueChip
                      kind="usd"
                      trend={usdTrend}
                      flash={usdFlash}
                      title="Indicative USD (issuance model)"
                      ariaLabel="Open live chart for USD value"
                      onClick={() => openChartPopover("usd")}
                    >
                      <span className="sym">$</span>
                      {fmtUsdNoSym(headerUsd)}
                    </ValueChip>
                  </div>

                  {isSendFilename && (
                    <div className="child-banner tooltip-container" style={{ fontSize: 10, opacity: 0.9, marginTop: 6 }}>
                      <strong>7 Steps from Exhale</strong> <span className="tooltip-trigger">INHALE:</span>
                      <div className="tooltip">
                        You have 7 steps (77 pulses) to inhale &amp; seal this Sigil. After this period, INHALE is permanently
                        finalized &amp; the Sigil is eternally sealed.
                      </div>
                    </div>
                  )}
                </div>
              </header>

              {/* Live chart popover (overlays inside verifier modal, easy exit, no navigation) */}
              {chartOpen && (
                <div
                  className="chart-popover-backdrop"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Live chart"
                  onMouseDown={closeChartPopover}
                  onClick={closeChartPopover}
                  style={S.popBg}
                >
                  <div
                    className="chart-popover"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    style={S.popCard}
                  >
                    <div className="chart-popover-head" style={S.popHead}>
                      <div style={S.popTitle} className="chart-popover-title">
                        {chartFocus === "phi" ? "Φ Resonance · Live" : "$ Price · Live"}
                      </div>
                      <button
                        className="close-btn holo"
                        data-aurora="true"
                        aria-label="Close chart"
                        title="Close"
                        onClick={closeChartPopover}
                        style={{ width: 40, height: 40, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                      >
                        ×
                      </button>
                    </div>

                    <div className="chart-popover-body" style={S.popBody}>
                      <React.Suspense fallback={<div style={{ padding: 16, color: "var(--dim)" }}>Loading chart…</div>}>
                        <LiveChart
                          data={chartData}
                          live={headerPhi}
                          pv={pvForChart}
                          premiumX={1}
                          momentX={1}
                          colors={["rgba(167,255,244,1)"]}
                          usdPerPhi={usdPerPhi}
                          mode={chartFocus === "usd" ? "usd" : "phi"}
                          isChildGlyph={canonicalContext === "derivative"}
                          reflowKey={chartReflowKey}
                        />
                      </React.Suspense>
                    </div>
                  </div>
                </div>
              )}

              {/* Tabs */}
              <nav className="tabs" role="tablist" aria-label="Views" style={S.stickyTabs}>
                <button role="tab" aria-selected={tab === "summary"} className={tab === "summary" ? "active" : ""} onClick={() => setTab("summary")}>
                  Presence
                </button>
                <button role="tab" aria-selected={tab === "lineage"} className={tab === "lineage" ? "active" : ""} onClick={() => setTab("lineage")}>
                  Stewardship
                </button>
                <button role="tab" aria-selected={tab === "data"} className={tab === "data" ? "active" : ""} onClick={() => setTab("data")}>
                  Memory
                </button>

                <button className="secondary" onClick={openValuation} disabled={!meta}>
                  Resonance
                </button>
                <button className="secondary" onClick={openNote} disabled={!svgURL}>
                  Note
                </button>
              </nav>

              {/* Body */}
              <section className="modal-body" role="tabpanel" style={S.modalBody}>
                {tab === "summary" && (
                  <div className="summary-grid">
                    <KV k="Now" v={pulseNow} />
                    {childDeadline && <KV k="Inhale Seal:" v={`${childDeadline.leftSteps} steps (${childDeadline.leftPulses} pulses) left`} />}
                    {canonicalContext === "derivative" &&
                      (() => {
                        const { expireAt } = getChildLockInfo(meta, pulseNow);
                        return typeof expireAt === "number" && Number.isFinite(expireAt) ? <KV k="Inhale by:" v={expireAt} /> : null;
                      })()}

                    {meta.userPhiKey && (
                      <KV
                        k="Φ-Key:"
                        v={
                          <>
                            {meta.userPhiKey}
                            {phiKeyExpected && (phiKeyMatches ? <span className="chip ok">match</span> : <span className="chip err">mismatch</span>)}
                          </>
                        }
                        wide
                        mono
                      />
                    )}

                    {meta.kaiSignature && (
                      <KV
                        k="Kai-Signature (Σ):"
                        v={
                          <>
                            {meta.kaiSignature}
                            {contentSigMatches === true && <span className="chip ok">match</span>}
                            {contentSigMatches === false && <span className="chip err">mismatch</span>}
                          </>
                        }
                        wide
                        mono
                      />
                    )}

                    {frequencyHz && <KV k="Frequency (Hz):" v={frequencyHz} />}
                    {chakraGate && <KV k="Spiral Gate:" v={chakraGate} />}
                    {liveSig && <KV k="PROOF OF BREATH™:" v={liveSig} wide mono />}
                    <KV k="Stewardship Hash:" v={canonical ?? "—"} wide mono />
                    <KV k={canonicalContext === "derivative" ? "Derivative Resonance" : "Resonance "} v={` Φ${remainingPhiDisplay4}`} />
                    <KV k="Exhale key:" v={(meta as SigilMetadataWithOptionals)?.creatorPublicKey ?? "—"} wide mono />
                    <KV k="Exhale nonce:" v={meta.transferNonce ?? "—"} wide mono />
                    <KV k="Issued @ (derivative):" v={(meta as SigilMetadataWithOptionals)?.childIssuedPulse ?? "—"} />
                    <KV k="Derivative of (source):" v={(meta as SigilMetadataWithOptionals)?.childOfHash ?? "—"} wide mono />
                    {headProof && <KV k="Latest proof:" v={headProof.ok ? `#${headProof.index + 1} ✓` : `#${headProof.index} ×`} />}
                    {headProof !== null && <KV k="Head proof root:" v={headProof.root} wide mono />}
                    <KV k="Head proof root (v14):" v={(meta as SigilMetadataWithOptionals)?.transfersWindowRootV14 ?? "—"} wide mono />

                    {canonicalContext === "parent" &&
                      (() => {
                        const pe = getParentOpenExpiry(meta, pulseNow);
                        return pe.expireAt ? <KV k="Inhale expires @:" v={pe.expireAt} /> : null;
                      })()}

                    {canonicalContext === "derivative" && (meta as SigilMetadataWithOptionals)?.sendLock?.used && <KV k="One-time lock:" v="Used" />}
                    <KV k="Hardened transfers:" v={meta.hardenedTransfers?.length ?? 0} />
                    <KV k="Segments:" v={meta.segments?.length ?? 0} />
                    <KV k="Segment size:" v={meta.segmentSize ?? SEGMENT_SIZE} />
                    <KV k="Segment Depth:" v={meta.cumulativeTransfers ?? 0} />
                    <KV k="Segment Tree Root:" v={meta.segmentsMerkleRoot ?? "—"} wide mono />
                    {rgbSeed && <KV k="RGB seed:" v={rgbSeed.join(", ")} />}
                  </div>
                )}

                {tab === "lineage" && (
                  <div className="lineage">
                    {meta.transfers?.length ? (
                      <ol className="transfers">
                        {meta.transfers.map((t, i) => {
                          const open = !t.receiverSignature;
                          const hardened = meta.hardenedTransfers?.[i];
                          let exhaleInfo:
                            | { unit?: "USD" | "PHI"; amountPhi?: string; amountUsd?: string; usdPerPhi?: number }
                            | null = null;

                          try {
                            if (t.payload?.mime?.startsWith("application/vnd.kairos-exhale")) {
                              const obj = JSON.parse(base64DecodeUtf8(t.payload.encoded)) as
                                | { kind?: string; unit?: "USD" | "PHI"; amountPhi?: string; amountUsd?: string; usdPerPhi?: number }
                                | null;
                              if (obj?.kind === "exhale")
                                exhaleInfo = { unit: obj.unit, amountPhi: obj.amountPhi, amountUsd: obj.amountUsd, usdPerPhi: obj.usdPerPhi };
                            }
                          } catch (err) {
                            logError("lineage.decodeExhalePayload", err);
                          }

                          let lineagePhi = "",
                            lineageUsd = "";
                          try {
                            if (exhaleInfo?.amountPhi) {
                              lineagePhi = fmtPhiFixed4(exhaleInfo.amountPhi);
                              lineageUsd =
                                typeof exhaleInfo.amountUsd === "string" && exhaleInfo.amountUsd
                                  ? exhaleInfo.amountUsd
                                  : typeof exhaleInfo.usdPerPhi === "number" && Number.isFinite(exhaleInfo.usdPerPhi)
                                    ? fmtUsdNoSym((Number(exhaleInfo.amountPhi) || 0) * exhaleInfo.usdPerPhi)
                                    : "0.00";
                            }
                          } catch (err) {
                            logError("lineage.computeDisplay", err);
                          }

                          return (
                            <li key={i} className={open ? "transfer open" : "transfer closed"}>
                              <header>
                                <span className="index">#{i + 1}</span>
                                <span className={`state ${open ? "open" : "closed"}`}>{open ? "Pending receive" : "Sealed"}</span>
                              </header>

                              <div className="row">
                                <span className="k">Exhaler Σ</span>
                                <span className="v mono" style={S.mono}>
                                  {t.senderSignature}
                                </span>
                              </div>

                              <div className="row">
                                <span className="k">Exhaler Seal:</span>
                                <span className="v mono" style={S.mono}>
                                  {t.senderStamp}
                                </span>
                              </div>

                              <div className="row">
                                <span className="k">Exhaler Pulse</span>
                                <span className="v">{t.senderKaiPulse}</span>
                              </div>

                              {exhaleInfo?.amountPhi && (
                                <div className="row">
                                  <span className="k">Exhaled</span>
                                  <span className="v">
                                    Φ {lineagePhi} · ${lineageUsd}
                                  </span>
                                </div>
                              )}

                              {hardened && (
                                <>
                                  <div className="row">
                                    <span className="k">Prev-Head</span>
                                    <span className="v mono" style={S.mono}>
                                      {hardened.previousHeadRoot}
                                    </span>
                                  </div>

                                  <div className="row">
                                    <span className="k">Exhale leaf</span>
                                    <span className="v mono" style={S.mono}>
                                      {hardened.transferLeafHashSend}
                                    </span>
                                  </div>

                                  {hardened.transferLeafHashReceive && (
                                    <div className="row">
                                      <span className="k">Inhale leaf</span>
                                      <span className="v mono" style={S.mono}>
                                        {hardened.transferLeafHashReceive}
                                      </span>
                                    </div>
                                  )}

                                  {hardened.zkSend && (
                                    <div className="row">
                                      <span className="k">ZK Exhale:</span>
                                      <span className="v">
                                        {hardened.zkSend.verified ? "✓" : "•"} {hardened.zkSend.scheme}
                                      </span>
                                    </div>
                                  )}

                                  {hardened.zkSend?.proofHash && (
                                    <div className="row">
                                      <span className="k">ZK Exhale hash:</span>
                                      <span className="v mono" style={S.mono}>
                                        {hardened.zkSend.proofHash}
                                      </span>
                                    </div>
                                  )}

                                  {hardened.zkReceive && (
                                    <div className="row">
                                      <span className="k">ZK Inhale</span>
                                      <span className="v">
                                        {hardened.zkReceive.verified ? "✓" : "•"} {hardened.zkReceive.scheme}
                                      </span>
                                    </div>
                                  )}

                                  {hardened.zkReceive?.proofHash && (
                                    <div className="row">
                                      <span className="k">ZK Inhale hash</span>
                                      <span className="v mono" style={S.mono}>
                                        {hardened.zkReceive.proofHash}
                                      </span>
                                    </div>
                                  )}
                                </>
                              )}

                              {t.receiverSignature && (
                                <>
                                  <div className="row">
                                    <span className="k">Inhaler Σ</span>
                                    <span className="v mono" style={S.mono}>
                                      {t.receiverSignature}
                                    </span>
                                  </div>
                                  <div className="row">
                                    <span className="k">Inhaler Seal</span>
                                    <span className="v mono" style={S.mono}>
                                      {t.receiverStamp}
                                    </span>
                                  </div>
                                  <div className="row">
                                    <span className="k">Inhaler Pulse</span>
                                    <span className="v">{t.receiverKaiPulse}</span>
                                  </div>
                                </>
                              )}

                              {t.payload && (
                                <details className="payload" open>
                                  <summary>Payload</summary>
                                  <div className="row">
                                    <span className="k">Name</span>
                                    <span className="v">{t.payload.name}</span>
                                  </div>
                                  <div className="row">
                                    <span className="k">MIME</span>
                                    <span className="v">{t.payload.mime}</span>
                                  </div>
                                  <div className="row">
                                    <span className="k">Size</span>
                                    <span className="v">{t.payload.size} bytes</span>
                                  </div>
                                </details>
                              )}
                            </li>
                          );
                        })}
                      </ol>
                    ) : (
                      <p className="empty">No stewardship yet — ready to exhale from Sigil-Glyph.</p>
                    )}
                  </div>
                )}

                {tab === "data" && (
                  <>
                    <div className="json-toggle">
                      <label>
                        <input type="checkbox" checked={viewRaw} onChange={() => setViewRaw((v) => !v)} /> View raw JSON
                      </label>
                    </div>
                    {viewRaw ? (
                      <pre className="raw-json" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                        {rawMeta}
                      </pre>
                    ) : (
                      <div className="json-tree-wrap" style={{ overflowX: "hidden" }}>
                        <JsonTree data={meta} />
                      </div>
                    )}
                  </>
                )}
              </section>

              {/* Footer */}
              <footer className="modal-footer" style={{ position: "sticky", bottom: 0 }}>
                {error && (
                  <p className="status error" style={{ overflowWrap: "anywhere" }}>
                    {error}
                  </p>
                )}

                <div
                  className="footer-actions"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                    width: "100%",
                    boxSizing: "border-box",
                  }}
                >
                  {uiState === "unsigned" && (
                    <button className="secondary" onClick={sealUnsigned}>
                      Seal content (Σ + Φ)
                    </button>
                  )}

                  {(uiState === "readySend" || uiState === "verified") && (
                    <div
                      className="send-row no-zoom-input"
                      data-nozoom="true"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flex: "1 1 auto",
                        minWidth: 0,
                        fontSize: 16, // iOS Safari: ≥16px prevents zoom-on-focus
                        WebkitTextSizeAdjust: "100%",
                      }}
                    >
                      <SendPhiAmountField
                        amountMode={amountMode}
                        setAmountMode={setAmountMode}
                        usdInput={usdInput}
                        phiInput={phiInput}
                        setUsdInput={setUsdInput}
                        setPhiInput={setPhiInput}
                        convDisplayRight={conv.displayRight}
                        remainingPhiDisplay4={remainingPhiDisplay4}
                        canonicalContext={canonicalContext}
                        phiFormatter={(s) => toStr6(toScaled6(fmtPhiCompact(s)))} // enforce 6dp in the input field
                      />
                      <IconBtn
                        className="primary"
                        onClick={send}
                        aria="Exhale (send)"
                        titleText={canShare ? "Exhale (seal & share)" : "Exhale (seal & copy link)"}
                        disabled={!canExhale}
                        path="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
                      />
                    </div>
                  )}

                  <IconBtn
                    onClick={() => fileInput.current?.click()}
                    aria="Attach a file"
                    titleText="Attach a file"
                    small
                    path="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.2a2 2 0 01-2.83-2.83l8.49-8.49"
                  />
                  <input ref={fileInput} type="file" hidden onChange={handleAttach} />

                  {uiState === "readyReceive" && (
                    <IconBtn
                      className="primary"
                      onClick={receive}
                      aria="Inhale (receive)"
                      titleText={
                        canonicalContext === "derivative"
                          ? childExpired
                            ? "Link expired"
                            : childUsed
                              ? "Link already used"
                              : "Inhale"
                          : parentOpenExp
                            ? "Send expired"
                            : "Inhale"
                      }
                      disabled={(canonicalContext === "derivative" && (childExpired || childUsed)) || (canonicalContext === "parent" && parentOpenExp)}
                      path="M2 22l11-11M2 22l20-7-9-4-4-9-7 20z"
                    />
                  )}

                  {(meta?.transfers?.length ?? 0) > 0 && (
                    <IconBtn
                      className="secondary"
                      onClick={sealSegmentNow}
                      aria="Segment head window"
                      titleText="Roll current head-window into a segment (continuous)"
                      disabled={isSendFilename}
                      small
                      path="M12 3l9 4-9 4-9-4 9-4zm-9 8l9 4 9-4M3 19l9 4 9-4"
                    />
                  )}
                </div>
              </footer>
            </>
          )}
        </div>
      </dialog>

      {/* Seal moment dialog (share link after SEND) */}
      <SealMomentModal
        open={sealOpen}
        url={sealUrl}
        hash={sealHash}
        onClose={() => {
          setSealOpen(false);
          setRotateOut(false);
          openVerifier();
        }}
        onDownloadZip={downloadZip}
      />

      {/* Valuation */}
      {meta && metaLiteForNote && (
        <ValuationModal
          open={valuationOpen}
          onClose={closeValuation}
          meta={metaLiteForNote}
          nowPulse={pulseNow}
          initialGlyph={initialGlyph ?? undefined}
          onAttach={uiState === "verified" ? onAttachValuation : undefined}
        />
      )}

      {/* Note printer */}
      <dialog
        ref={noteDlgRef}
        className="glass-modal fullscreen"
        id="note-dialog"
        data-open={noteOpen ? "true" : "false"}
        aria-label="Note Exhaler"
        style={S.full}
      >
        <div className="modal-viewport" style={S.viewport}>
          <div className="modal-topbar" style={S.gridBar}>
            <div style={{ paddingInline: 12, fontSize: 12, color: "var(--dim)" }}>Kairos — Note Exhaler</div>
            <button
              className="close-btn holo"
              data-aurora="true"
              aria-label="Close"
              title="Close"
              onClick={closeNote}
              style={{ justifySelf: "end", marginRight: 8 }}
            >
              ×
            </button>
          </div>

          <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
            {sigilSvgRaw && metaLiteForNote ? (
              <NotePrinter meta={metaLiteForNote} initial={noteInitial} />
            ) : sigilSvgRaw ? (
              <div style={{ padding: 16, color: "var(--dim)" }}>Missing valuation metadata for Note — upload/parse a sigil first.</div>
            ) : (
              <div style={{ padding: 16, color: "var(--dim)" }}>Load a sigil to print a note.</div>
            )}
          </div>
        </div>
      </dialog>
    </div>
  );
};

export default function VerifierStamper() {
  return (
    <VerifierErrorBoundary onReset={() => {}}>
      <React.Suspense fallback={<div style={{ padding: 16 }}>Loading…</div>}>
        <VerifierStamperInner />
      </React.Suspense>
    </VerifierErrorBoundary>
  );
}