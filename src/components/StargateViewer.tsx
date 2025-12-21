/* ────────────────────────────────────────────────────────────────
   StargateViewer.tsx · Atlantean Lumitech “Ω-Gate Viewer”
   v6.0 — Eternal-Sigil Edition (mobile-perfect, a11y-polished)
────────────────────────────────────────────────────────────────── */

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  type DragEventHandler,
  type ChangeEventHandler,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type TouchEvent,
  type FC,
} from "react";
import KaiSigil, { type KaiSigilProps } from "./KaiSigil";
import "./StargateViewer.css";
import { getLiveKaiPulse, kairosEpochNow } from "../utils/kai_pulse";

/* ════════════ Public Props ═════════════════════════════════════ */
export interface StargateViewerProps {
  sigilUrl?: string;   // fallback static sigil
  pulse?: number;      // override livePulse seed
  showPulse?: boolean;
  size?: number;       // px
  baseHue?: number;    // base hue for gate chrome
  controls?: boolean;
}

/* ════════════ Time maths (same as Kai-API) ═════════════════════ */
const GENESIS_TS        = Date.UTC(2024, 4, 10, 6, 45, 40);
const PULSE_MS          = 5_236;                 // Eternal Pulse
const PULSES_PER_STEP   = 11;
const STEPS_PER_BEAT    = 44;
const PULSES_PER_BEAT   = PULSES_PER_STEP * STEPS_PER_BEAT; // 484
const DIVISIONS         = 11;                    // micro-breaths
const TICK_MS           = PULSE_MS / DIVISIONS / 4;          // ≈119 ms
const PHI               = (1 + Math.sqrt(5)) / 2;

/* ════════════ Chakra helpers ═══════════════════════════════════ */
const CHAKRA_NAMES = [
  "Root",
  "Sacral",
  "Solar Plexus",
  "Heart",
  "Throat",
  "Crown",
] as const satisfies KaiSigilProps["chakraDay"][];
// Cross-browser fullscreen signatures without `any`

/* ════════════ Utils ════════════════════════════════════════════ */
const nowPulse = (): number => getLiveKaiPulse();

const isIOS = (): boolean => {
  if (typeof navigator === "undefined") return false; // SSR/Node
  const { userAgent, vendor, platform, maxTouchPoints } = navigator;
  const ua = userAgent || vendor || "";
  const classicIOS = /iPhone|iPad|iPod/i.test(ua);
  const iPadOS13Plus = platform === "MacIntel" && maxTouchPoints > 1;
  return classicIOS || iPadOS13Plus;
};

const prefersReducedMotion = (): boolean => {
  if (typeof window === "undefined" || !("matchMedia" in window)) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
};

/* ════════════ Component ════════════════════════════════════════ */
const StargateViewer: FC<StargateViewerProps> = ({
  sigilUrl:  initialUrl,
  pulse:     initialPulse,
  showPulse  = true,
  size       = 320,
  baseHue    = 180,
  controls   = true,
}) => {
  /* — state — */
  const [sigilUrl,  setSigilUrl ] = useState<string | undefined>(initialUrl);
  const [livePulse, setLivePulse] = useState<number>(initialPulse ?? nowPulse());
  const [paused,    setPaused   ] = useState<boolean>(prefersReducedMotion());
  const [isFull,    setIsFull   ] = useState<boolean>(false);
  const [tilt,      setTilt     ] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragging,  setDragging ] = useState<boolean>(false);

  /* live-sigil derived state */
  const [beat,     setBeat    ] = useState<number>(0);
  const [stepPct,  setStepPct ] = useState<number>(0);
  const [chakra,   setChakra  ] = useState<KaiSigilProps["chakraDay"]>("Root");

  /* refs */
  const rootRef  = useRef<HTMLDivElement>(null);
  const sigilRef = useRef<HTMLElement | null>(null); // img *or* svg wrapper
  const inputRef = useRef<HTMLInputElement>(null);

  /* ══ Upload / drag-drop ═══════════════════════════════════════ */
  const triggerBrowse = useCallback((): void => {
    inputRef.current?.click();
  }, []);

  const handleFile = useCallback((file: File): void => {
    if (["image/svg+xml", "image/png", "image/jpeg"].includes(file.type)) {
      setSigilUrl(URL.createObjectURL(file));
    }
  }, []);

  const onChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const onDrop: DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  /* revoke temp URLs on unmount */
  useEffect(() => {
    return () => {
      if (sigilUrl && sigilUrl.startsWith("blob:")) {
        URL.revokeObjectURL(sigilUrl);
      }
    };
  }, [sigilUrl]);

  /* ══ LIVE loop (geometry + morph) ═════════════════════════════ */
  useEffect(() => {
    if (paused) return;
    const gate = rootRef.current;
    if (!gate) return;

    let lastBeat = beat;
    let lastStep = stepPct;

    const tick = (): void => {
      /* time → sigil maths */
      const now          = kairosEpochNow();
      const msSinceGen   = now - GENESIS_TS;
      const pulsePhase   = (msSinceGen % PULSE_MS) / PULSE_MS; // 0-1
      const subPhase     = (msSinceGen % (PULSE_MS / DIVISIONS)) / (PULSE_MS / DIVISIONS);
      const breath       = 0.5 + 0.5 * Math.sin(pulsePhase * 2 * Math.PI * PHI);

      const pulse        = nowPulse();
      const inBeat       = pulse % PULSES_PER_BEAT;
      const beatIdx      = Math.floor(pulse / PULSES_PER_BEAT) % 36;
      const pulsesInStep = inBeat % PULSES_PER_STEP;
      const stepPercent  = pulsesInStep / PULSES_PER_STEP;

      /* CSS vars on the gate */
      gate.style.setProperty("--kai-phase",  pulsePhase.toString());
      gate.style.setProperty("--kai-breath", breath.toString());

      /* animate the sigil wrapper/element */
      const tgt = sigilRef.current;
      if (tgt) {
        const hue   = subPhase * 360;
        const scale = 0.96 + 0.04 * Math.sin(subPhase * 2 * Math.PI);
        const rot   = subPhase * 360 / DIVISIONS;
        tgt.style.filter =
          `hue-rotate(${hue.toFixed(1)}deg) ` +
          `drop-shadow(0 0 12px hsl(${(baseHue + hue) % 360} 100% 80% / .5))`;
        tgt.style.transform =
          `perspective(800px) rotateX(${-tilt.y * 10}deg) ` +
          `rotateY(${tilt.x * 10}deg) rotate(${rot.toFixed(1)}deg) ` +
          `scale(${scale.toFixed(3)})`;
      }

      /* update counters only when they change */
      if (pulse !== livePulse) setLivePulse(pulse);
      if (beatIdx !== lastBeat) {
        lastBeat = beatIdx;
        setBeat(beatIdx);
        setChakra(CHAKRA_NAMES[Math.floor(beatIdx / 6)]);
      }
      if (Math.abs(stepPercent - lastStep) > 1e-4) {
        lastStep = stepPercent;
        setStepPct(stepPercent);
      }
    };

    /* battery-friendly interval; paused on tab hide */
    let id: number | null = window.setInterval(tick, TICK_MS);
    const onVis = () => {
      if (document.hidden) {
        if (id !== null) { clearInterval(id); id = null; }
      } else if (!paused && id === null) {
        tick();
        id = window.setInterval(tick, TICK_MS);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    tick();

    return () => {
      if (id !== null) clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, tilt.x, tilt.y, baseHue]);

  /* ══ Gyro + pointer parallax (mobile + desktop) ═══════════════ */
  useEffect(() => {
    const handleOri = (e: DeviceOrientationEvent): void => {
      const x = (e.gamma ?? 0) / 45; // left/right
      const y = (e.beta ?? 0) / 45;  // up/down
      setTilt({ x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) });
    };
    window.addEventListener("deviceorientation", handleOri, true);
    return () => { window.removeEventListener("deviceorientation", handleOri); };
  }, []);

  const onPointerMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const nx = (e.clientX - cx) / (rect.width / 2);
    const ny = (e.clientY - cy) / (rect.height / 2);
    setTilt({ x: Math.max(-1, Math.min(1, nx)), y: Math.max(-1, Math.min(1, ny)) });
  };
  const onPointerLeave = () => setTilt({ x: 0, y: 0 });

  /* ══ Full-screen helpers ══════════════════════════════════════ */
// ── Cross-browser fullscreen types (no `any`)
type RequestFs = () => Promise<void> | void;
type ExitFs = () => Promise<void> | void;

type FullscreenTarget = HTMLElement & {
  requestFullscreen?: RequestFs;
  webkitRequestFullscreen?: RequestFs;
  msRequestFullscreen?: RequestFs;
  mozRequestFullScreen?: RequestFs;
};

type FullscreenDoc = Document & {
  exitFullscreen?: ExitFs;
  webkitExitFullscreen?: ExitFs;
  msExitFullscreen?: ExitFs;
  mozCancelFullScreen?: ExitFs;
};

// ── Fullscreen helpers
const enterFull = useCallback((): void => {
  const el = rootRef.current as FullscreenTarget | null;
  if (!el || isIOS()) return;

  const req: RequestFs | undefined =
    el.requestFullscreen ??
    el.webkitRequestFullscreen ??
    el.msRequestFullscreen ??
    el.mozRequestFullScreen;

  if (req) {
    const out = req.call(el);
    if (out && typeof (out as Promise<void>).catch === "function") {
      (out as Promise<void>).catch(() => {});
    }
  }
}, []);

const exitFull = useCallback((): void => {
  if (isIOS()) return;

  const d = document as FullscreenDoc;
  const exit: ExitFs | undefined =
    d.exitFullscreen?.bind(d) ??
    d.webkitExitFullscreen?.bind(d) ??
    d.msExitFullscreen?.bind(d) ??
    d.mozCancelFullScreen?.bind(d);

  if (exit) {
    const out = exit();
    if (out && typeof (out as Promise<void>).catch === "function") {
      (out as Promise<void>).catch(() => {});
    }
  }
}, []);

const toggleFull = useCallback((): void => {
  if (document.fullscreenElement) exitFull();
  else enterFull();
}, [enterFull, exitFull]);

useEffect(() => { enterFull(); }, [enterFull]);

useEffect(() => {
  const onChange = (): void => setIsFull(Boolean(document.fullscreenElement));
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
}, []);

const onDoubleTap = (e: MouseEvent | TouchEvent): void => {
  e.stopPropagation();
  toggleFull();
};


  /* ══ Pause / Resume & keys ═════════════════════════════════════ */
  const togglePause = (): void => { setPaused((p) => !p); };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === " ") {
      e.preventDefault();
      togglePause();
    } else if (e.key.toLowerCase() === "f") {
      e.preventDefault();
      toggleFull();
    } else if (e.key === "Escape" && document.fullscreenElement) {
      exitFull();
    }
  };

  /* ══ Export helpers ═══════════════════════════════════════════ */
  const copyDataUri = (): void => {
    if (sigilUrl) {
      navigator.clipboard.writeText(sigilUrl).catch(() => {});
    }
  };
  const downloadPng = (): void => {
    if (!sigilUrl) return;
    if (/^data:image\/(?:png|jpeg)/.test(sigilUrl)) {
      const a = document.createElement("a");
      a.href = sigilUrl;
      a.download = "sigil.png";
      a.click();
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width  = img.width;
      c.height = img.height;
      c.getContext("2d")?.drawImage(img, 0, 0);
      const a = document.createElement("a");
      a.href = c.toDataURL("image/png");
      a.download = "sigil.png";
      a.click();
    };
    img.src = sigilUrl;
  };

  /* ══ CSS vars (size / hue / tilt) ═════════════════════════════ */
  type GateCSS = CSSProperties & {
    "--size":  string;
    "--hue":   string;
    "--tiltX": string;
    "--tiltY": string;
  };
  const style: GateCSS = {
    "--size":  `${size}px`,
    "--hue":   `${baseHue}`,
    "--tiltX": `${tilt.x}`,
    "--tiltY": `${tilt.y}`,
  };

  /* ══ JSX ══════════════════════════════════════════════════════ */
  return (
    <div
      ref={rootRef}
      className={`stargate-viewer${paused ? " no-motion" : ""}`}
      data-paused={paused ? "true" : "false"}
      data-fullscreen={isFull ? "true" : "false"}
      data-dragging={dragging ? "true" : "false"}
      role="application"
      aria-label="Ω-Gate Viewer — tap to load a sigil, double-tap for full-screen"
      style={style}
      tabIndex={0}
      onClick={triggerBrowse}
      onDoubleClick={onDoubleTap}
      onTouchEnd={onDoubleTap}
      onKeyDown={onKeyDown}
      onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onMouseMove={onPointerMove}
      onMouseLeave={onPointerLeave}
    >
      {/* hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/svg+xml,image/png,image/jpeg"
        style={{ display: "none" }}
        onChange={onChange}
      />

      {/* gate chrome (styled in CSS) */}
      <div className="gate-frame" aria-hidden="true" />
      <div className="spiral-overlay" aria-hidden="true" />
      <div className="breath-gauze" aria-hidden="true" />
      <div className="light-corners" aria-hidden="true" />

      {/* drag-drop hint */}
      <div className="drop-hint" aria-hidden={!dragging}>
        <span className="drop-glyph">⤓</span>
        <span className="drop-text">Drop your sigil here</span>
      </div>

      {/* sigil content */}
      {sigilUrl ? (
        <img
          ref={(el) => { sigilRef.current = el; }}
          src={sigilUrl}
          alt="Kairos sigil"
          className="sigil-img"
          loading="lazy"
          draggable={false}
        />
      ) : (
        <div
          ref={(el) => { sigilRef.current = el; }}
          className="sigil-svg-wrap"
          style={{
            position: "absolute",
            inset: "12%",
            width: "76%",
            height: "76%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          aria-label="Live KaiSigil (auto-evolving with the Eternal Pulse)"
        >
          <KaiSigil
            pulse={livePulse}
            beat={beat}
            stepPct={stepPct}
            chakraDay={chakra}
            size={Math.floor(size * 0.76)}
            quality="high"
            animate={false} /* we animate via wrapper CSS transforms */
          />
        </div>
      )}

      {/* pulse badge */}
      {showPulse && (
        <div
          className="pulse-tag"
          role="status"
          aria-live="polite"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          Eternal&nbsp;Pulse&nbsp;<strong>{livePulse.toLocaleString()}</strong>
        </div>
      )}

      {/* controls */}
      {controls && (
        <div className="gate-controls" role="toolbar" aria-label="Gate controls">
          <button
            type="button"
            className="ctrl-btn"
            title={paused ? "Resume (Space)" : "Pause (Space)"}
            aria-label={paused ? "Resume animation" : "Pause animation"}
            onClick={(e) => { e.stopPropagation(); togglePause(); }}
          >
            {paused ? "▶︎" : "❚❚"}
          </button>
          <button
            type="button"
            className="ctrl-btn"
            title="Save PNG"
            aria-label="Save PNG"
            onClick={(e) => { e.stopPropagation(); downloadPng(); }}
          >
            ⬇︎
          </button>
          <button
            type="button"
            className="ctrl-btn"
            title="Copy data URI"
            aria-label="Copy data URI"
            onClick={(e) => { e.stopPropagation(); copyDataUri(); }}
          >
            📋
          </button>
          <button
            type="button"
            className="ctrl-btn"
            title={isFull ? "Exit full-screen (F)" : "Full-screen (F)"}
            aria-label={isFull ? "Exit full-screen" : "Full-screen"}
            onClick={(e) => { e.stopPropagation(); toggleFull(); }}
          >
            ⤢
          </button>
        </div>
      )}

      {/* screenreader hints */}
      <p className="sr-only" aria-live="polite">
        Tap or click to choose a sigil image. Drag and drop is supported. Press Space to pause or resume. Press F to toggle full-screen.
      </p>
    </div>
  );
};

/* ── exports ──────────────────────────────────────────────────── */
export { StargateViewer };
export default StargateViewer;
