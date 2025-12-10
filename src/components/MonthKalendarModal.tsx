/* ──────────────────────────────────────────────────────────────
   MonthKalendarModal.tsx · Atlantean Lumitech “Kairos Kalendar”
   v6.4 — Mobile-first gestures (pinch + pan), zero-jank
   • Native-feel pinch-to-zoom with two-finger pan
   • Coalesced RAF camera updates (no re-render storms)
   • Tap guard so drags/pinches don’t trigger day open
   • Auto-switch to “Free” when a gesture starts
   • Keeps all props, markup, & desktop behavior intact
────────────────────────────────────────────────────────────── */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
} from "react";
import type {
  FC,
  Ref,
  PointerEvent as RP,
  WheelEvent as RW,
  MouseEvent as RM,
} from "react";

import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "framer-motion";

import "./MonthKalendarModal.css";
import DayDetailModal from "./DayDetailModal";
import type { HarmonicDayInfo } from "./DayDetailModal";

/* ══════════ domain types (unchanged) ══════════ */
export type Day =
  | "Solhara" | "Aquaris" | "Flamora"
  | "Verdari" | "Sonari"  | "Kaelith";

interface KaiKlockSnapshot {
  harmonicDay          : Day;
  kairos_seal_day_month: string;
  /** Optional live fields (if passed from Week modal) */
  eternalKaiPulseToday?: number;
  SpiralArc?: string;
}

interface Note { pulse:number; id:string; text:string; }

/* ══════════ component props (unchanged) ══════════ */
interface Props {
  DAYS        : readonly Day[];
  initialData : KaiKlockSnapshot | null;
  notes       : Note[];
  onSelectDay : (d:Day, globalIdx:number)=>void;
  onAddNote   : (idx:number)=>void;
  onClose     : ()=>void;
  container?  : HTMLElement|null;
}

/* ══════════ constants ══════════ */
const PULSE_MS   = (3 + Math.sqrt(5)) * 1000; // ≈ 5236 ms
const DAY_PULSES = 17_491.270_421;
const PHI        = (1 + Math.sqrt(5)) / 2;

/* μpulse-accurate timing (SigilModal parity) */
const GENESIS_TS      = Date.UTC(2024, 4, 10, 6, 45, 41, 888);
const KAI_PULSE_SEC   = 3 + Math.sqrt(5);
const PULSE_MS_EXACT  = KAI_PULSE_SEC * 1000;

const ONE_PULSE_MICRO        = 1_000_000n;
const N_DAY_MICRO            = 17_491_270_421n;     // exact μpulses/day
const PULSES_PER_STEP_MICRO  = 11_000_000n;         // 11 pulses/step
const MU_PER_BEAT_EXACT      = (N_DAY_MICRO + 18n) / 36n; // ties-to-even

/* Canonical weekday pigments (fixed per day) */
const COLOR:Record<Day,string>={
  Solhara:"#ff0024", Aquaris:"#ff6f00", Flamora:"#ffd600",
  Verdari:"#00c853", Sonari:"#00b0ff", Kaelith:"#c186ff",
};

/* ── Zoom tuning ─────────────────────────────────────────────── */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 14;
const DOUBLE_TAP_Z_NEAR = 3.2;

/* ══════════ helpers ══════════ */
const squashSeal = (s:string)=>
  s.replace(/D\s+(\d+)/,"D$1").replace(/\/\s*M(\d+)/,"/M$1");

const rad  = (deg:number)=>deg*Math.PI/180;
const lerp = (a:number,b:number,t:number)=>a+(b-a)*t;

/** Stream spiral hue into CSS custom props */
const applySpiralHue = (arc: string | undefined) => {
  const map:Record<string,string>={
    "Ignition ArK":"#ff0024",
    "Integration ArK":"#ff6f00",
    "Harmonization ArK":"#ffd600",
    "Reflection ArK":"#00c853",
    "Purification ArK":"#00b0ff",
    "Dream ArK":"#c186ff",
  };
  const core = (arc && map[arc]) || "#00eaff";
  const rgba = (hex:string,a:number)=>{
    const h=hex.replace("#",""); const n=parseInt(h,16);
    const r=(n>>16)&255, g=(n>>8)&255, b=n&255;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  };
  const doc = document.documentElement;
  doc.style.setProperty("--aqua-core", core);
  doc.style.setProperty("--aqua-soft", rgba(core, 0.14));
  doc.style.setProperty("--seal-glow-inset", rgba(core, 0.36));
  doc.style.setProperty("--seal-glow-mid", rgba(core, 0.42));
  doc.style.setProperty("--seal-glow-outer", rgba(core, 0.24));
};

/* ── μpulse helpers ────────────────────────────────────────────── */
const pad2 = (n:number)=>String(n).padStart(2,"0");
const imod = (n:bigint,m:bigint)=>((n%m)+m)%m;
function floorDiv(n:bigint,d:bigint):bigint{
  const q=n/d, r=n%d;
  return (r!==0n && (r>0n)!==(d>0n)) ? q-1n : q;
}
function roundTiesToEvenBigInt(x:number):bigint{
  if(!Number.isFinite(x)) return 0n;
  const s = x<0?-1:1, ax=Math.abs(x), i=Math.trunc(ax), f=ax-i;
  if(f<0.5) return BigInt(s*i);
  if(f>0.5) return BigInt(s*(i+1));
  return BigInt(s*(i%2===0?i:i+1));
}
function microPulsesSinceGenesis(date:Date):bigint{
  const deltaSec=(date.getTime()-GENESIS_TS)/1000;
  const pulses = deltaSec / KAI_PULSE_SEC;
  const micro  = pulses   * 1_000_000;
  return roundTiesToEvenBigInt(micro);
}

type LocalKai = {
  beat:number; step:number; pulsesIntoDay:number;
  dayOfMonth:number; monthIndex1:number; weekday:Day;
  sealText:string;       // "beat:SS — D#/M#"
  monthDayIndex:number;  // 0..41
  chakraStepString:string;
};

function computeLocalKai(now:Date):LocalKai{
  const pμ_total  = microPulsesSinceGenesis(now);
  const pμ_in_day = imod(pμ_total, N_DAY_MICRO);
  const dayIndex  = floorDiv(pμ_total, N_DAY_MICRO);

  const beat = Number(floorDiv(pμ_in_day, MU_PER_BEAT_EXACT)); // 0..35
  const pμ_in_beat = pμ_in_day - BigInt(beat) * MU_PER_BEAT_EXACT;

  const step = Math.min(Math.max(Number(floorDiv(pμ_in_beat, PULSES_PER_STEP_MICRO)),0),43);
  const pulsesIntoDay = Number(floorDiv(pμ_in_day, ONE_PULSE_MICRO));

  const weekdayIdx = Number(imod(dayIndex, 6n));
  const WEEKDAY: readonly Day[] = ["Solhara","Aquaris","Flamora","Verdari","Sonari","Kaelith"];
  const weekday = WEEKDAY[weekdayIdx];

  const dayIndexNum = Number(dayIndex);
  const dayOfMonth = ((dayIndexNum % 42) + 42) % 42 + 1;
  const monthIndex0 = Math.floor(dayIndexNum / 42) % 8;
  const monthIndex1 = ((monthIndex0 + 8) % 8) + 1;

  const monthDayIndex = dayOfMonth - 1;
  const chakraStepString = `${beat}:${pad2(step)}`;
  const sealText = `${chakraStepString} — D${dayOfMonth}/M${monthIndex1}`;

  return { beat, step, pulsesIntoDay, dayOfMonth, monthIndex1, weekday, sealText, monthDayIndex, chakraStepString };
}

/* ══════════ Atlantean Glyph Close (kept) ══════════ */
const GlyphClose:FC<{ onClose:()=>void; refBtn:Ref<HTMLButtonElement> }> =
({ onClose, refBtn }) => {
  const reduceMotion = useReducedMotion();
  const hover = reduceMotion ? {} : { rotate: 135, scale: 1.18 };
  const tap   = reduceMotion ? {} : { rotate:  45, scale: 0.92 };

  return (
    <motion.button
      ref={refBtn}
      className="mw-close mw-close--glyph"
      aria-label="Close month view"
      onClick={onClose}
      whileHover={hover}
      whileTap={tap}
      transition={{ type:"spring", stiffness:400, damping:24 }}
    >
      <svg viewBox="0 0 64 64" strokeLinecap="round" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="plasma" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--aqua-core)" />
            <stop offset="100%" stopColor="#ff1559" />
          </linearGradient>
          <filter id="plasmaBlur" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2" result="b"/>
            <feMerge>
              <feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        <polygon
          points="32 4 58 20 58 44 32 60 6 44 6 20"
          stroke="url(#plasma)" strokeWidth="4" filter="url(#plasmaBlur)"
        />
        <g stroke="url(#plasma)" strokeWidth="4" filter="url(#plasmaBlur)">
          <line x1="16" y1="16" x2="48" y2="48" />
          <line x1="48" y1="16" x2="16" y2="48" />
          <line x1="32" y1="8"  x2="32" y2="56" />
          <line x1="8"  y1="32" x2="56" y2="32" />
        </g>
        <g className="glyphSheen">
          <line x1="0" y1="8" x2="64" y2="56" stroke="#fff" strokeWidth="1.2" strokeOpacity="0"/>
        </g>
      </svg>
    </motion.button>
  );
};

/* ══════════ Month Spiral (auto-fit + camera) ══════════ */

type CamMode = "fit" | "follow" | "free";
type Cam = { x:number; y:number; z:number };

const MonthKalendarModal:FC<Props>=({
  DAYS, initialData, notes, onSelectDay, onAddNote, onClose, container,
})=>{
  const reduceMotion = useReducedMotion();

  /* Initial parse (safe fallback values) */
  const { initIdx, initSeal, spiralArc } = useMemo(()=>{
    const seal = initialData?.kairos_seal_day_month ?? "D?/M?";
    const m = squashSeal(seal).match(/D(\d+)/);
    const idx = m ? Math.max(0, Math.min(41, Number(m[1]) - 1)) : 0;
    return {
      initIdx: idx,
      initSeal: squashSeal(seal),
      spiralArc: initialData?.SpiralArc,
    };
  },[initialData]);

  /* Sync hue when provided */
  useEffect(()=>{ if (spiralArc) applySpiralHue(spiralArc); }, [spiralArc]);

  /* Notes → day index set (0..41) */
  const noteSet = useMemo(()=>{
    const s = new Set<number>();
    notes.forEach(n => s.add(Math.floor(n.pulse / DAY_PULSES)));
    return s;
  },[notes]);

  /* 42 nodes along a logarithmic spiral (7 turns × 6 days/turn) */
  const points = useMemo(()=>{
    const daysPerTurn = 6;
    const turns = 7;
    const total = daysPerTurn * turns;
    const thetaStep = 360 / daysPerTurn;       // 60°
    const theta0 = -90;                        // start at top
    const a = 9.5;                             // base radius
    const growthPerTurn = 1.0 * PHI;           // φ per revolution
    const k = Math.log(growthPerTurn) / (2*Math.PI);
    const out: Array<{x:number;y:number;θ:number;r:number}> = [];
    for (let i=0;i<total;i++){
      const θdeg = theta0 + i * thetaStep;
      const θ = rad(θdeg);
      const rev = i / daysPerTurn;
      const r = a * Math.exp(k * 2*Math.PI * rev);
      const x = r * Math.cos(θ);
      const y = r * Math.sin(θ);
      out.push({ x, y, θ: θdeg, r });
    }
    return out;
  },[]);

  /* Spiral path */
  const spiralPath = useMemo(()=>{
    if (!points.length) return "";
    let d = `M ${points[0].x.toFixed(3)} ${points[0].y.toFixed(3)}`;
    for (let i=1;i<points.length;i++){
      d += ` L ${points[i].x.toFixed(3)} ${points[i].y.toFixed(3)}`;
    }
    return d;
  },[points]);

  /* ── μpulse-aligned live state ─────────────────────────── */
  const [localKai, setLocalKai] = useState<LocalKai | null>(null);
  const [monthProg, setMonthProg] = useState<number>(() => initIdx);

  // DayDetail state
  const [dayDetail, setDD] = useState<HarmonicDayInfo | null>(null);

  // boundary-aligned scheduler (no drift)
  const timeoutRef = useRef<number | null>(null);
  const targetBoundaryRef = useRef<number>(0);
  const epochNow = () => performance.timeOrigin + performance.now();
  const computeNextBoundary = (nowMs:number) => {
    const elapsed = nowMs - GENESIS_TS;
    const periods = Math.ceil(elapsed / PULSE_MS_EXACT);
    return GENESIS_TS + periods * PULSE_MS_EXACT;
  };
  const clearAlignedTimer = () => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const scheduleAlignedTick = () => {
    clearAlignedTimer();

    // initial compute (immediate)
    const k0 = computeLocalKai(new Date());
    setLocalKai(k0);
    setMonthProg(k0.monthDayIndex + Math.min(1, Math.max(0, k0.pulsesIntoDay / DAY_PULSES)));

    const fire = () => {
      const nowMs = epochNow();

      if (nowMs >= targetBoundaryRef.current) {
        const missed = Math.floor((nowMs - targetBoundaryRef.current) / PULSE_MS_EXACT);
        for (let i = 0; i <= missed; i++) {
          const k = computeLocalKai(new Date());
          setLocalKai(k);
          setMonthProg(k.monthDayIndex + Math.min(1, Math.max(0, k.pulsesIntoDay / DAY_PULSES)));
          targetBoundaryRef.current += PULSE_MS_EXACT;
        }
      }

      const delay = Math.max(0, targetBoundaryRef.current - epochNow());
      timeoutRef.current = window.setTimeout(fire, delay) as unknown as number;
    };

    targetBoundaryRef.current = computeNextBoundary(epochNow());
    const initialDelay = Math.max(0, targetBoundaryRef.current - epochNow());
    timeoutRef.current = window.setTimeout(fire, initialDelay) as unknown as number;
  };

  useEffect(() => {
    scheduleAlignedTick();
    const onVis = () => {
      if (document.visibilityState === "visible") scheduleAlignedTick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearAlignedTimer();
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Interpolate comet position */
  const comet = useMemo(()=>{
    if (!points.length) return { x:0,y:0, r:0, θ:0 };
    const clamped = Math.max(0, Math.min(points.length - 1, monthProg));
    const i0 = Math.floor(clamped);
    const i1 = Math.min(points.length - 1, i0 + 1);
    const t  = clamped - i0;
    const p0 = points[i0];
    const p1 = points[i1];
    return {
      x: lerp(p0.x, p1.x, t),
      y: lerp(p0.y, p1.y, t),
      r: lerp(p0.r, p1.r, t),
      θ: lerp(p0.θ, p1.θ, t),
    };
  },[points, monthProg]);

  /* Accessibility + focus + ESC + Home to snap Day 1 */
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(()=>closeRef.current?.focus(),[]);
  useEffect(()=>{
    const h = (e:KeyboardEvent)=>{
      if(e.key==="Escape") onClose();
      if(e.key==="Home"){
        e.preventDefault();
        focusDay(0, 8);
        setCamMode("free");
      }
    };
    window.addEventListener("keydown",h);
    return ()=>window.removeEventListener("keydown",h);
  },[onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  const root = container ?? document.body;

  // live “today” index for highlighting; fall back to parsed init
  const liveTodayIdx = localKai?.monthDayIndex ?? initIdx;
  const sealChipText = squashSeal(localKai?.sealText ?? initSeal);

  /* ── day modal open (exactly like Week) ───────────────────────── */
  const monthDayStartPulse = (targetIdx: number): number => {
    const curIdx = localKai?.monthDayIndex ?? initIdx;
    const pulsesIntoDay =
      (typeof initialData?.eternalKaiPulseToday === "number"
        ? initialData!.eternalKaiPulseToday
        : localKai?.pulsesIntoDay) ?? 0;
    const todayZero = Math.floor(pulsesIntoDay / DAY_PULSES) * DAY_PULSES; // => 0 (intentional)
    return todayZero + (targetIdx - curIdx) * DAY_PULSES;
  };

  const suppressBackdropUntilRef = useRef<number>(0);

  const openDay = (day: Day, idx: number) => {
    try { onSelectDay?.(day, idx); } catch (err) {
      if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn("[MonthKalendarModal] onSelectDay threw:", err);
      }
    }

    const monthIndex = localKai?.monthIndex1 ?? 1;
    const beatStep = localKai?.chakraStepString ?? "0:00";
    const kaiTimestamp = squashSeal(`${beatStep} — D${idx + 1}/M${monthIndex}`);

    const payload: HarmonicDayInfo = {
      name: day,
      kaiTimestamp,
      startPulse: monthDayStartPulse(idx),
    };
    setDD(payload);
  };

  /* Ark color for comet twinkle (live if prop updates) */
  const arkColor = useMemo(() => {
    const map:Record<string,string>={
      "Ignition ArK":"#ff0024",
      "Integration ArK":"#ff6f00",
      "Harmonization ArK":"#ffd600",
      "Reflection ArK":"#00c853",
      "Purification ArK":"#00b0ff",
      "Dream ArK":"#c186ff",
    };
    return (initialData?.SpiralArc && map[initialData.SpiralArc]) || "#8beaff";
  }, [initialData?.SpiralArc]);

  /* ══════════ Auto-fit viewBox (no clipping) ══════════ */
  const svgRef = useRef<SVGSVGElement|null>(null);
  const contentRef = useRef<SVGGElement|null>(null);
  const [viewBox, setViewBox] = useState<string>("-60 -60 120 120");
  const vbNumsRef = useRef<{x:number;y:number;w:number;h:number}>({x:-60,y:-60,w:120,h:120});

  const computeViewBox = () => {
    const g = contentRef.current;
    if (!g) return;
    const bb = g.getBBox(); // geometry bbox (filters not included)
    const PAD = 14;
    const x = bb.x - PAD, y = bb.y - PAD, w = bb.width + PAD*2, h = bb.height + PAD*2;
    vbNumsRef.current = { x, y, w, h };
    setViewBox(`${x} ${y} ${w} ${h}`);
  };

  useLayoutEffect(() => {
    let raf = requestAnimationFrame(computeViewBox);
    const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(computeViewBox); };
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); };
  }, [points.length]);

  /* ══════════ Camera: fit / follow / free ══════════ */
  const [camMode, setCamMode] = useState<CamMode>("fit");

  const [camState, _setCam] = useState<Cam>({ x:0, y:0, z:1 });
  const camRef = useRef<Cam>(camState);
  const rafSetRef = useRef<number | null>(null);

  const setCam: (next: Cam | ((prev: Cam) => Cam)) => void = (next) => {
    const value = typeof next === "function" ? (next as (p:Cam)=>Cam)(camRef.current) : next;
    camRef.current = value;
    if (rafSetRef.current !== null) return;
    rafSetRef.current = requestAnimationFrame(()=>{
      rafSetRef.current = null;
      _setCam(camRef.current);
    });
  };

  const cam = camState; // read-friendly alias

  // helper: snap to specific day index with chosen zoom
  const focusDay = (idx:number, targetZ:number = 6) => {
    const p = points[idx];
    if (!p) return;
    const { x:vbX, y:vbY, w:vbW, h:vbH } = vbNumsRef.current;
    const cx = vbX + vbW/2;
    const cy = vbY + vbH/2;
    const z = Math.max(1, Math.min(ZOOM_MAX, targetZ));
    setCam({ x: cx - z*p.x, y: cy - z*p.y, z });
  };

  // Keep Fit mode centered/normalized whenever viewBox changes
  useEffect(() => {
    if (camMode !== "fit") return;
    setCam({ x: 0, y: 0, z: 1 });
  }, [viewBox, camMode]);

  // Follow comet: center on comet with a gentle spring
  useEffect(() => {
    if (camMode !== "follow") return;
    const { x:vbX, y:vbY, w:vbW, h:vbH } = vbNumsRef.current;
    const cx = vbX + vbW/2;
    const cy = vbY + vbH/2;
    setCam((prev) => {
      const z = prev.z;
      return { x: cx - z*comet.x, y: cy - z*comet.y, z };
    });
  }, [comet.x, comet.y, camMode]);

  /* ══════════ Mobile-first gesture engine (pinch + pan) ══════════ */
  type Pointer = { id:number; clientX:number; clientY:number; };
  const pointers = useRef<Map<number, Pointer>>(new Map());
  const gesture = useRef<{
    active:boolean;
    mode: "none"|"pan"|"pinch";
    startCam:Cam;
    startPt?:DOMPoint;                // for pan
    startClient?:{x:number;y:number}; // for tap guard
    lastCentroid?:DOMPoint;           // for pinch
    lastDist?:number;                 // for pinch
    movedPx:number;                   // tap guard accumulator
  }>({active:false, mode:"none", startCam:{x:0,y:0,z:1}, movedPx:0});

  const svgPoint = (clientX:number, clientY:number):DOMPoint=>{
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = svg.getScreenCTM();
    return ctm ? pt.matrixTransform(ctm.inverse()) : pt;
  };

  const getCentroid = (): {cx:number; cy:number} | null => {
    if (pointers.current.size < 1) return null;
    let sx = 0, sy = 0;
    pointers.current.forEach(p => { sx += p.clientX; sy += p.clientY; });
    const n = pointers.current.size;
    return { cx: sx/n, cy: sy/n };
  };
  const getDistance = (): number => {
    const arr = Array.from(pointers.current.values());
    if (arr.length < 2) return 0;
    const dx = arr[0].clientX - arr[1].clientX;
    const dy = arr[0].clientY - arr[1].clientY;
    return Math.hypot(dx, dy);
  };

  const ensureFreeMode = ()=>{
    if (camMode !== "free") setCamMode("free");
  };

  const dragState = useRef<{ lastTap:number }>({ lastTap: 0 }); // double-tap timing

  const onStagePointerDown = (e:RP<SVGSVGElement>)=>{
    // For best mobile behavior, prevent native page scroll/zoom here.
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);

    ensureFreeMode();

    pointers.current.set(e.pointerId, { id:e.pointerId, clientX:e.clientX, clientY:e.clientY });
    gesture.current.active = true;
    gesture.current.startCam  = camRef.current;
    gesture.current.movedPx   = 0;

    if (pointers.current.size === 1) {
      // One-finger PAN
      gesture.current.mode = "pan";
      gesture.current.startPt = svgPoint(e.clientX, e.clientY);
      gesture.current.startClient = { x:e.clientX, y:e.clientY };
    } else if (pointers.current.size === 2) {
      // Switch to PINCH
      gesture.current.mode = "pinch";
      const c = getCentroid()!;
      gesture.current.lastCentroid = svgPoint(c.cx, c.cy);
      gesture.current.lastDist = getDistance();
    }

    // Double-tap zoom (mobile): toggle 1 ↔ tighter close-up around tap point
    const now = performance.now();
    if (now - dragState.current.lastTap < 300 && pointers.current.size === 1) {
      const p = svgPoint(e.clientX, e.clientY);
      setCam((prev)=>{
        const from = prev.z;
        const to = from < (DOUBLE_TAP_Z_NEAR*0.9) ? DOUBLE_TAP_Z_NEAR : 1.0;
        const x = prev.x + (1 - to/from) * (p.x - prev.x);
        const y = prev.y + (1 - to/from) * (p.y - prev.y);
        return { x, y, z: to };
      });
      // block accidental taps after double-tap
      gesture.current.movedPx = 9999;
    }
    dragState.current.lastTap = now;
  };

  const onStagePointerMove = (e:RP<SVGSVGElement>)=>{
    if (!gesture.current.active) return;
    // Coalesce move deltas
    pointers.current.set(e.pointerId, { id:e.pointerId, clientX:e.clientX, clientY:e.clientY });

    // Tap guard (screen-space px)
    if (gesture.current.startClient) {
      const dx = e.clientX - gesture.current.startClient.x;
      const dy = e.clientY - gesture.current.startClient.y;
      gesture.current.movedPx = Math.max(gesture.current.movedPx, Math.hypot(dx, dy));
    }

    const curCam = camRef.current;

    if (gesture.current.mode === "pan" && pointers.current.size === 1) {
      // One-finger pan in world coordinates
      const cur = svgPoint(e.clientX, e.clientY);
      const startPt = gesture.current.startPt!;
      const dx = cur.x - startPt.x;
      const dy = cur.y - startPt.y;
      setCam({ x: gesture.current.startCam.x + dx, y: gesture.current.startCam.y + dy, z: curCam.z });
    } else {
      // PINCH (two or more fingers) — two-finger pan + scale around centroid
      if (pointers.current.size >= 2) {
        const c = getCentroid()!;
        const cWorld = svgPoint(c.cx, c.cy);
        const prevCentroid = gesture.current.lastCentroid ?? cWorld;
        // world pan component (centroid moved)
        const panDx = cWorld.x - prevCentroid.x;
        const panDy = cWorld.y - prevCentroid.y;

        // scale component
        const dist = getDistance();
        const prevDist = gesture.current.lastDist ?? dist;
        const ratio = dist > 0 && prevDist > 0 ? dist / prevDist : 1.0;
        const zUnclamped = curCam.z * ratio;
        const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zUnclamped));

        // apply pan first
        const x1 = curCam.x + panDx;
        const y1 = curCam.y + panDy;

        // then adjust x/y so the centroid stays put while scaling
        const x = x1 + (curCam.z - z) * cWorld.x;
        const y = y1 + (curCam.z - z) * cWorld.y;

        setCam({ x, y, z });

        gesture.current.lastCentroid = cWorld;
        gesture.current.lastDist = dist;

        // once we pinch, block tap-open
        gesture.current.movedPx = 9999;
      } else if (pointers.current.size === 1 && gesture.current.mode === "pinch") {
        // If second finger lifted, gracefully fall back to PAN
        gesture.current.mode = "pan";
        const p = Array.from(pointers.current.values())[0];
        gesture.current.startCam = camRef.current;
        gesture.current.startPt = svgPoint(p.clientX, p.clientY);
        gesture.current.startClient = { x:p.clientX, y:p.clientY };
      }
    }
  };

  const onStagePointerUp = (e:RP<SVGSVGElement>)=>{
    pointers.current.delete(e.pointerId);

    if (pointers.current.size === 0) {
      // end gesture
      gesture.current.active = false;
      gesture.current.mode = "none";
      gesture.current.startPt = undefined;
      gesture.current.startClient = undefined;
      gesture.current.lastCentroid = undefined;
      gesture.current.lastDist = undefined;
    } else if (pointers.current.size === 1 && gesture.current.mode === "pinch") {
      // drop to pan baseline
      gesture.current.mode = "pan";
      const p = Array.from(pointers.current.values())[0];
      gesture.current.startCam = camRef.current;
      gesture.current.startPt = svgPoint(p.clientX, p.clientY);
      gesture.current.startClient = { x:p.clientX, y:p.clientY };
    }
  };

  // wheel (desktop & trackpads)
  const onStageWheel = (e:RW<SVGSVGElement>)=>{
    if (camMode !== "free") return;
    e.preventDefault();
    const p = svgPoint(e.clientX, e.clientY);
    const dz = Math.exp(-e.deltaY * 0.0015);
    setCam((prev)=>{
      const unclamped = prev.z * dz;
      const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, unclamped));
      const x = prev.x + (1 - z/prev.z) * (p.x - prev.x);
      const y = prev.y + (1 - z/prev.z) * (p.y - prev.y);
      return { x, y, z };
    });
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="mw-backdrop"
        className="mw-backdrop"
        role="presentation"
        onPointerDown={(e) => {
          if (performance.now() < suppressBackdropUntilRef.current) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          if (e.currentTarget === e.target) onClose();
        }}
        initial={{ opacity:0 }}
        animate={{ opacity:0.96 }}
        exit={{ opacity:0 }}
        transition={{ duration:.35 }}
      >
        <motion.div
          className="mw-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Kairos Month Spiral"
          onPointerDown={(e)=>e.stopPropagation()}
          initial={{ scale:0.82, opacity:0 }}
          animate={{ scale:1,    opacity:1 }}
          exit={{ scale:0.82,     opacity:0 }}
          transition={{ type:"spring", stiffness:320, damping:26 }}
        >
          {/* Atlantean close */}
          <GlyphClose onClose={onClose} refBtn={closeRef} />

          {/* ── FULLSCREEN STAGE (auto-fit viewBox, no CSS tilt) ── */}
          <svg
            ref={svgRef}
            className="mw-stage"
            viewBox={viewBox}
            preserveAspectRatio="xMidYMid meet"
            aria-label="Month Spiral"
            onPointerDown={onStagePointerDown}
            onPointerMove={onStagePointerMove}
            onPointerUp={onStagePointerUp}
            onPointerCancel={onStagePointerUp}
            onWheel={onStageWheel}
          >
            <defs>
              <filter id="mw-neon" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="1.6" result="b"/>
                <feMerge>
                  <feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>

              {/* Etherik baby blue for today + comet */}
              <linearGradient id="etherik-baby-blue" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%"   stopColor="#8beaff" />
                <stop offset="100%" stopColor="#c7f4ff" />
              </linearGradient>
              <filter id="etherik-blue-glow" x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation="1.8" result="b1"/>
                <feGaussianBlur in="b1" stdDeviation="3.2" result="b2"/>
                <feMerge>
                  <feMergeNode in="b2"/><feMergeNode in="b1"/><feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
              <filter id="etherik-blue-halo" x="-120%" y="-120%" width="340%" height="340%">
                <feGaussianBlur stdDeviation="5" result="b3"/>
                <feMerge>
                  <feMergeNode in="b3"/><feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>

              {/* Ark twinkle gradient (live color) */}
              <linearGradient id="ark-twinkle" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%"   stopColor={arkColor} stopOpacity="1"/>
                <stop offset="100%" stopColor={arkColor} stopOpacity="0.2"/>
              </linearGradient>

              <linearGradient id="mw-spiral-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%"   stopColor="var(--aqua-core)" />
                <stop offset="100%" stopColor="#ff1559" />
              </linearGradient>
            </defs>

            {/* Camera group: Fit / Follow / Free */}
            <motion.g
              initial={false}
              animate={{ x: cam.x, y: cam.y, scale: cam.z }}
              transition={reduceMotion ? { duration: 0 } : { type:"spring", stiffness:200, damping:26, mass:0.7 }}
            >
              {/* Scene content (group used for bbox auto-fit) */}
              <g ref={contentRef}>
                {/* Spiral ribbon */}
                <motion.path
                  d={spiralPath}
                  fill="none"
                  stroke="url(#mw-spiral-grad)"
                  strokeWidth="1.6"
                  style={{ filter: "url(#mw-neon)" }}
                  animate={reduceMotion ? {} : { opacity: [0.55, 0.85, 0.55] }}
                  transition={reduceMotion ? {} : {
                    duration: PULSE_MS/1000,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />

                {/* Day chips */}
                {points.map((p, i) => {
                  const day = DAYS[i % 6];
                  const isToday = i === liveTodayIdx;
                  const hasNote = noteSet.has(i);
                  const angle = p.θ + 90; // tangent
                  const w = 8.5, h = 4.6, r = 1.6;

                  // Keep today chip unrotated; labels always upright
                  const baseTransform = `translate(${p.x},${p.y})`;
                  const chipAngle = isToday ? 0 : angle;
                  const labelY = -h - 0.6;
                  const aNorm = ((chipAngle % 360) + 360) % 360;
                  const needsFlip = aNorm > 90 && aNorm < 270;

                  // Tap-guard: ignore taps after a drag/pinch
                  const shouldOpen = () => gesture.current.movedPx < 8;

                  return (
                    <g
                      key={i}
                      transform={`${baseTransform} rotate(${chipAngle})`}
                      style={{ cursor: "pointer" }}
                      onPointerUp={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!shouldOpen()) return;
                        suppressBackdropUntilRef.current = performance.now() + 350;
                        openDay(day, i);
                      }}
                      onDoubleClick={() => onAddNote(i)}
                    >
                      <motion.rect
                        x={-w/2} y={-h/2} width={w} height={h} rx={r} ry={r}
                        fill={COLOR[day]}
                        stroke={isToday ? "url(#etherik-baby-blue)" : "rgba(255,255,255,0.2)"}
                        strokeWidth={isToday ? 1.2 : 0.6}
                        className={[
                          "mw-daychip",
                          isToday ? "mw-today" : "",
                          hasNote ? "mw-hasNote" : "",
                        ].join(" ").trim()}
                        style={{ filter: isToday ? "url(#etherik-blue-glow)" : "url(#mw-neon)" }}
                        animate={false}
                      />

                      {/* EXTRA neon outline for today — thinner ring */}
                      {isToday && (
                        <rect
                          x={-w/2} y={-h/2} width={w} height={h} rx={r} ry={r}
                          fill="none"
                          stroke="url(#etherik-baby-blue)"
                          strokeWidth={1.4}
                          style={{ filter: "url(#etherik-blue-halo)" }}
                        />
                      )}

                      {/* Memory dot for notes */}
                      {hasNote && (
                        <circle
                          cx={w/2 - 1.2}
                          cy={-h/2 + 1.2}
                          r={0.9}
                          fill="var(--note-dot)"
                          className="mw-note-dot"
                        />
                      )}

                      {/* Label — always upright */}
                      <text
                        x={0}
                        y={labelY}
                        transform={needsFlip ? `rotate(180, 0, ${labelY})` : undefined}
                        textAnchor="middle"
                        dominantBaseline="auto"
                        fontSize="2.8"
                        fontFamily="Inter, system-ui, sans-serif"
                        fill={COLOR[day]}
                        className={isToday ? "mw-label mw-today-label" : "mw-label"}
                        style={{ filter: "url(#mw-neon)" }}
                      >
                        {day.slice(0,3)} • {i+1}
                      </text>
                    </g>
                  );
                })}

                {/* Comet tracker — baby blue breath + Ark twinkle */}
                <motion.g
                  initial={false}
                  animate={{ x: comet.x, y: comet.y, rotate: comet.θ + 90 }}
                  transition={reduceMotion ? { duration: 0 } : { type:"spring", stiffness:120, damping:18, mass:0.5 }}
                  className="mw-comet"
                  style={{ filter: "url(#etherik-blue-glow)" }}
                >
                  <motion.g
                    animate={reduceMotion ? {} : { scale: [0.98, 1.06, 0.98], opacity: [0.9, 1, 0.9] }}
                    transition={reduceMotion ? {} : { repeat: Infinity, duration: PULSE_MS/1000, ease: "easeInOut" }}
                  >
                    <circle r="2.2" fill="url(#etherik-baby-blue)" />
                    <circle r="4.4" fill="url(#etherik-baby-blue)" opacity="0.55" />
                    <circle r="6.6" fill="url(#etherik-baby-blue)" opacity="0.26" />
                    <circle r="7.6" fill="none" stroke="url(#etherik-baby-blue)" strokeWidth="1.1" opacity="0.9" />
                  </motion.g>

                  <motion.g
                    transform="rotate(45)"
                    animate={reduceMotion ? {} : { rotate: [0, 180, 360], scale: [0.92, 1.18, 0.92], opacity: [0.6, 1, 0.6] }}
                    transition={reduceMotion ? {} : { repeat: Infinity, duration: PULSE_MS/1000, ease: "easeInOut" }}
                  >
                    <line x1="-3.2" y1="0" x2="3.2" y2="0" stroke="url(#ark-twinkle)" strokeWidth="0.45" />
                    <line x1="0" y1="-3.2" x2="0" y2="3.2" stroke="url(#ark-twinkle)" strokeWidth="0.45" />
                    <line x1="-2.2" y1="-2.2" x2="2.2" y2="2.2" stroke="url(#ark-twinkle)" strokeWidth="0.35" opacity="0.85" />
                    <line x1="2.2" y1="-2.2" x2="-2.2" y2="2.2" stroke="url(#ark-twinkle)" strokeWidth="0.35" opacity="0.85" />
                    <circle r="0.9" fill={arkColor} opacity="0.9" />
                  </motion.g>
                </motion.g>
              </g>
            </motion.g>
          </svg>

          {/* Camera controls */}
          <div className="mw-cam">
            <button
              className={`mw-cam-btn ${camMode==="fit" ? "is-active" : ""}`}
              onClick={(e:RM)=>{
                if ((e.shiftKey || e.metaKey)) {
                  focusDay(0, 8);
                  setCamMode("free");
                } else {
                  setCamMode("fit");
                  setCam({x:0,y:0,z:1});
                }
              }}
              aria-pressed={camMode==="fit"}
              title="Fit month (⇧ to snap Day 1)"
            >Fit</button>
            <button
              className={`mw-cam-btn ${camMode==="follow" ? "is-active" : ""}`}
              onClick={()=>setCamMode("follow")}
              aria-pressed={camMode==="follow"}
              title="Follow comet"
            >Follow</button>
            <button
              className={`mw-cam-btn ${camMode==="free" ? "is-active" : ""}`}
              onClick={()=>setCamMode("free")}
              aria-pressed={camMode==="free"}
              title="Drag & zoom"
            >Free</button>
          </div>

          {/* Seal chip — μpulse-accurate */}
          <div className="mw-seal">
            <code>{sealChipText}</code>
          </div>

          {/* Day Detail Modal */}
          {dayDetail && (
            <DayDetailModal day={dayDetail} onClose={() => setDD(null)} />
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    root,
  );
};

export default MonthKalendarModal;
