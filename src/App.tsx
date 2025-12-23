// src/App.tsx
/* ──────────────────────────────────────────────────────────────────────────────
   App.tsx · ΦNet Sovereign Gate Shell (KaiOS-style PWA)
   v29.4.4 → v30.0.0 · Performance-focused modular refactor

   Goals:
   - Preserve instant load / zero-splash behavior.
   - Keep deterministic Kai clock + μpulse checkpoint persistence.
   - Modularize behaviors into focused hooks to minimize re-render surfaces.
   - Prefetch heavy UI only when safe, keep Suspense fallbacks empty.
────────────────────────────────────────────────────────────────────────────── */

import React, {
  Suspense,
  lazy,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";

import {
  momentFromUTC,
  DAYS_PER_MONTH,
  DAYS_PER_YEAR,
  MONTHS_PER_YEAR,
  GENESIS_TS,
  PULSE_MS,
  kairosEpochNow,
  type ChakraDay,
} from "./utils/kai_pulse";
import { fmt2, formatPulse, modPos, readNum } from "./utils/kaiTimeDisplay";
import { usePerfMode } from "./hooks/usePerfMode";
import { SIGIL_EXPLORER_OPEN_EVENT } from "./constants/sigilExplorer";

import SovereignDeclarations from "./components/SovereignDeclarations";
import { DEFAULT_APP_VERSION, SW_VERSION_EVENT } from "./version";

import "./App.css";

declare global {
  interface Window {
    kairosSwVersion?: string;
  }
}

/* ──────────────────────────────────────────────────────────────────────────────
   Lazy-loaded heavy modules (instant first paint)
────────────────────────────────────────────────────────────────────────────── */
const KaiVohModal = lazy(
  () => import("./components/KaiVoh/KaiVohModal"),
) as React.LazyExoticComponent<React.ComponentType<{ open: boolean; onClose: () => void }>>;

const SigilModal = lazy(
  () => import("./components/SigilModal"),
) as React.LazyExoticComponent<
  React.ComponentType<{ initialPulse: number; onClose: () => void }>
>;

const HomePriceChartCard = lazy(
  () => import("./components/HomePriceChartCard"),
) as React.LazyExoticComponent<
  React.ComponentType<{ apiBase: string; ctaAmountUsd: number; chartHeight: number }>
>;

const SigilExplorer = lazy(
  () => import("./components/SigilExplorer"),
) as React.LazyExoticComponent<React.ComponentType<Record<string, never>>>;

type EternalKlockProps = { initialDetailsOpen?: boolean };

const EternalKlockLazy = lazy(
  () => import("./components/EternalKlock"),
) as React.LazyExoticComponent<React.ComponentType<EternalKlockProps>>;

/* ──────────────────────────────────────────────────────────────────────────────
   Splash killer (homepage only)
   - Runs at module eval + again in layout effect to guarantee removal.
────────────────────────────────────────────────────────────────────────────── */
function killSplashOnHome(): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  if (window.location.pathname !== "/") return;

  const ids = ["app-splash", "pwa-splash", "splash", "splash-screen", "boot-splash"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  document
    .querySelectorAll<HTMLElement>(
      "[data-splash], .app-splash, .pwa-splash, .splash-screen, .splash, .boot-splash",
    )
    .forEach((el) => el.remove());
}

// Run ASAP on module load (best effort; removes splash without waiting for React)
try {
  killSplashOnHome();
} catch {
  /* ignore */
}

// Isomorphic layout effect (prevents paint-flash)
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/* ──────────────────────────────────────────────────────────────────────────────
   App constants
────────────────────────────────────────────────────────────────────────────── */
const OFFLINE_ASSETS_TO_WARM: readonly string[] = [
  "/sigil.wasm",
  "/sigil.zkey",
  "/sigil.artifacts.json",
  "/sigil.vkey.json",
  "/verification_key.json",
  "/verifier-core.js",
  "/verifier.inline.html",
  "/verifier.html",
  "/pdf-lib.min.js",
];

const SIGIL_STREAM_ROUTES: readonly string[] = [
  "/stream",
  "/stream/p",
  "/stream/c",
  "/feed",
  "/feed/p",
  "/p",
  "/p~",
];

const SHELL_ROUTES_TO_WARM: readonly string[] = [
  "/",
  "/mint",
  "/voh",
  "/keystream",
  "/klock",
  "/klok",
  "/sigil/new",
  "/pulse",
  "/verify",
  ...SIGIL_STREAM_ROUTES,
];

const APP_SHELL_HINTS: readonly string[] = [
  "/", // canonical shell
  "/?source=pwa",
  "/index.html",
];

const NAV_ITEMS: readonly NavItem[] = [
  { to: "/", label: "Verifier", desc: "Inhale + Exhale", end: true },
  { to: "/mint", label: "Mint ΦKey", desc: "Breath-minted seal" },
  { to: "/voh", label: "KaiVoh", desc: "Memory OS" },
  { to: "/keystream", label: "ΦStream", desc: "Live keystream" },
];

const DNS_IP = "137.66.18.241";

const BREATH_S = 3 + Math.sqrt(5);
const BREATH_MS = BREATH_S * 1000;
const BREATHS_PER_DAY = 17_491.270421;

const BEATS_PER_DAY = 36;
const STEPS_PER_BEAT = 44;
const STEPS_PER_DAY = BEATS_PER_DAY * STEPS_PER_BEAT;

// Canon breath count per day (precision)
const PULSES_PER_DAY = 17_491.270421;

const ARK_COLORS: readonly string[] = [
  "var(--chakra-ark-0)",
  "var(--chakra-ark-1)",
  "var(--chakra-ark-2)",
  "var(--chakra-ark-3)",
  "var(--chakra-ark-4)",
  "var(--chakra-ark-5)",
];

const CHAKRA_DAY_COLORS: Record<ChakraDay, string> = {
  Root: "var(--chakra-ink-0)",
  Sacral: "var(--chakra-ink-1)",
  "Solar Plexus": "var(--chakra-ink-2)",
  Heart: "var(--chakra-ink-3)",
  Throat: "var(--chakra-ink-4)",
  "Third Eye": "var(--chakra-ink-5)",
  Crown: "var(--chakra-ink-6)",
};

const MONTH_CHAKRA_COLORS: readonly string[] = [
  "#ff7a7a",
  "#ffbd66",
  "#ffe25c",
  "#86ff86",
  "#79c2ff",
  "#c99aff",
  "#e29aff",
  "#e5e5e5",
];

/* ──────────────────────────────────────────────────────────────────────────────
   Types
────────────────────────────────────────────────────────────────────────────── */
type NavItem = {
  to: string;
  label: string;
  desc: string;
  end?: boolean;
};

type AppShellStyle = CSSProperties & {
  ["--breath-s"]?: string;
  ["--vvh-px"]?: string;
};

type ExplorerPopoverStyle = CSSProperties & {
  ["--sx-breath"]?: string;
  ["--sx-border"]?: string;
  ["--sx-border-strong"]?: string;
  ["--sx-ring"]?: string;
};

type KlockPopoverStyle = CSSProperties & {
  ["--klock-breath"]?: string;
  ["--klock-border"]?: string;
  ["--klock-border-strong"]?: string;
  ["--klock-ring"]?: string;
  ["--klock-scale"]?: string;
};

type ExplorerPopoverProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

type KlockPopoverProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

type KlockNavState = { openDetails?: boolean };

type TimeoutHandle = number;

const ONE_PULSE_MICRO = 1_000_000n;

// ✅ NEW canonical key (μpulses since Genesis)
const KAI_ANCHOR_PMICRO_KEY = "phi_kai_anchor_pmicro_v1";

// ✅ legacy key you previously wrote (epoch ms)
const KAI_ANCHOR_MSUTC_LEGACY_KEY = "phi_kai_anchor_msutc_v1";

// Vite env typing (no `any`)
type ViteEnv = {
  VITE_KAI_ANCHOR_PMICRO?: string; // preferred: μpulses since Genesis
  VITE_KAI_ANCHOR_MICRO?: string; // legacy name; treat same as above
};

type KaiAnchorSource = "storage" | "env" | "kpp"; // kpp = kai_pulse.ts
type KaiAnchor = { pμ0: bigint; perf0: number; source: KaiAnchorSource };

type KaiMoment = ReturnType<typeof momentFromUTC>;
type VVSize = { width: number; height: number };

type LiveKaiSnapshot = {
  pulse: number;
  pulseStr: string;
  beatStepDMY: BeatStepDMY;
  beatStepLabel: string;
  dmyLabel: string;
  chakraDay: ChakraDay;
};

type BeatStepDMY = {
  beat: number; // 0..35
  step: number; // 0..43
  day: number; // 1..DAYS_PER_MONTH
  month: number; // 1..MONTHS_PER_YEAR
  year: number; // 0-based
};
type NavLinkClassNameFn = Exclude<
  React.ComponentProps<typeof NavLink>["className"],
  string | undefined
>;

type NavLinkClassNameProps = Parameters<NavLinkClassNameFn>[0];

/* ──────────────────────────────────────────────────────────────────────────────
   Kai anchor + deterministic clock helpers
────────────────────────────────────────────────────────────────────────────── */
const kaiAnchorStore: { anchor: KaiAnchor | null } = { anchor: null };

function floorDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  return r !== 0n && (r > 0n) !== (d > 0n) ? q - 1n : q;
}

/* ties-to-even rounding Number→BigInt */
function roundTiesToEvenBigInt(x: number): bigint {
  if (!Number.isFinite(x)) return 0n;
  const s = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const i = Math.trunc(ax);
  const frac = ax - i;
  if (frac < 0.5) return BigInt(s * i);
  if (frac > 0.5) return BigInt(s * (i + 1));
  return BigInt(s * (i % 2 === 0 ? i : i + 1));
}

function readLocalStorageBigInt(key: string): bigint | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    if (!/^-?\d+$/.test(raw.trim())) return null;
    return BigInt(raw.trim());
  } catch {
    return null;
  }
}

function writeLocalStorageBigInt(key: string, v: bigint): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, v.toString());
  } catch {
    /* ignore */
  }
}

function readLocalStorageMsUTC(key: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.floor(n);
  } catch {
    return null;
  }
}

/* epoch-ms → μpulses since Genesis (bridge uses canonical GENESIS_TS / PULSE_MS) */
function microPulsesSinceGenesisMs(msUTC: number): bigint {
  const deltaMs = msUTC - GENESIS_TS;
  const pulses = deltaMs / PULSE_MS;
  return roundTiesToEvenBigInt(pulses * 1_000_000);
}

/* Normalize kairosEpochNow() raw → μpulses since Genesis (BigInt) */
function normalizeKaiEpochRawToMicroPulses(raw: bigint): bigint {
  const pulseGuess = floorDiv(raw, ONE_PULSE_MICRO);

  if (pulseGuess >= 0n && pulseGuess < 500_000_000n) return raw;

  const epochMsBI = raw / 1000n;
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  const minSafe = BigInt(Number.MIN_SAFE_INTEGER);
  if (epochMsBI > maxSafe || epochMsBI < minSafe) return raw;

  const epochMs = Number(epochMsBI);
  if (!Number.isFinite(epochMs)) return raw;

  return microPulsesSinceGenesisMs(epochMs);
}

function readInjectedEnvAnchorMicroPulses(): bigint | null {
  try {
    const env = (import.meta as unknown as { env?: ViteEnv }).env;
    const raw = (env?.VITE_KAI_ANCHOR_PMICRO ?? env?.VITE_KAI_ANCHOR_MICRO)?.trim();
    if (!raw) return null;

    if (!/^-?\d+$/.test(raw)) return null;

    const bi = BigInt(raw);

    if (bi > 0n && bi < 4_000_000_000_000n) {
      const ms = Number(bi);
      if (Number.isFinite(ms)) return microPulsesSinceGenesisMs(ms);
    }

    return bi;
  } catch {
    return null;
  }
}

function seedFromKaiPulseNow(): bigint {
  const raw = kairosEpochNow();
  return normalizeKaiEpochRawToMicroPulses(raw);
}

function ensureKaiAnchor(): KaiAnchor {
  if (kaiAnchorStore.anchor) return kaiAnchorStore.anchor;

  if (typeof window === "undefined") {
    kaiAnchorStore.anchor = { pμ0: 0n, perf0: 0, source: "kpp" };
    return kaiAnchorStore.anchor;
  }

  const perf0 = window.performance.now();

  const stored = readLocalStorageBigInt(KAI_ANCHOR_PMICRO_KEY);
  if (stored !== null && stored > 0n) {
    kaiAnchorStore.anchor = { pμ0: stored, perf0, source: "storage" };
    return kaiAnchorStore.anchor;
  }

  const legacyMs = readLocalStorageMsUTC(KAI_ANCHOR_MSUTC_LEGACY_KEY);
  if (legacyMs !== null && legacyMs > 0) {
    const migrated = microPulsesSinceGenesisMs(legacyMs);
    if (migrated > 0n) {
      writeLocalStorageBigInt(KAI_ANCHOR_PMICRO_KEY, migrated);
      kaiAnchorStore.anchor = { pμ0: migrated, perf0, source: "storage" };
      return kaiAnchorStore.anchor;
    }
  }

  const envPμ = readInjectedEnvAnchorMicroPulses();
  if (envPμ !== null && envPμ > 0n) {
    writeLocalStorageBigInt(KAI_ANCHOR_PMICRO_KEY, envPμ);
    kaiAnchorStore.anchor = { pμ0: envPμ, perf0, source: "env" };
    return kaiAnchorStore.anchor;
  }

  const pμ0 = seedFromKaiPulseNow();
  if (pμ0 > 0n) writeLocalStorageBigInt(KAI_ANCHOR_PMICRO_KEY, pμ0);
  kaiAnchorStore.anchor = { pμ0, perf0, source: "kpp" };
  return kaiAnchorStore.anchor;
}

function hardResyncKaiAnchor(): void {
  if (typeof window === "undefined") return;
  const perf0 = window.performance.now();
  const pμ0 = seedFromKaiPulseNow();
  if (pμ0 > 0n) writeLocalStorageBigInt(KAI_ANCHOR_PMICRO_KEY, pμ0);
  kaiAnchorStore.anchor = { pμ0, perf0, source: "kpp" };
}

function microPulsesNow(): bigint {
  if (typeof window === "undefined") return 0n;
  const a = ensureKaiAnchor();
  const elapsedMs = window.performance.now() - a.perf0;
  const deltaPμ = roundTiesToEvenBigInt((elapsedMs / PULSE_MS) * 1_000_000);
  return a.pμ0 + deltaPμ;
}

function epochMsFromMicroPulses(pμ: bigint): number {
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  const minSafe = BigInt(Number.MIN_SAFE_INTEGER);
  if (pμ > maxSafe || pμ < minSafe) return GENESIS_TS;

  const pμN = Number(pμ);
  if (!Number.isFinite(pμN)) return GENESIS_TS;

  const deltaPulses = pμN / 1_000_000; // pulses since Genesis (float)
  const msUTC = GENESIS_TS + deltaPulses * PULSE_MS;
  return Number.isFinite(msUTC) ? Math.floor(msUTC) : GENESIS_TS;
}

function kaiMsUTCNow(): number {
  return epochMsFromMicroPulses(microPulsesNow());
}

function kaiMomentNow(): KaiMoment {
  return momentFromUTC(kaiMsUTCNow());
}

function isInteractiveTarget(t: EventTarget | null): boolean {
  const el = t instanceof Element ? t : null;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select" || tag === "button")
    return true;
  if (tag === "a") return true;
  const ht = el as HTMLElement;
  return Boolean(ht.isContentEditable) || Boolean(el.closest("[contenteditable='true']"));
}

function getInitialAppVersion(): string {
  const swVersion = typeof window !== "undefined" ? window.kairosSwVersion : undefined;
  if (typeof swVersion === "string" && swVersion.length) return swVersion;
  return DEFAULT_APP_VERSION;
}

/* ──────────────────────────────────────────────────────────────────────────────
   KKS v1.0 display math (exact step)
────────────────────────────────────────────────────────────────────────────── */
function computeBeatStepDMY(m: KaiMoment): BeatStepDMY {
  const pulse = readNum(m, "pulse") ?? 0;

  const pulseInDay = modPos(pulse, PULSES_PER_DAY);
  const dayFrac = PULSES_PER_DAY > 0 ? pulseInDay / PULSES_PER_DAY : 0;

  const rawStepOfDay = Math.floor(dayFrac * STEPS_PER_DAY);
  const stepOfDay = Math.min(STEPS_PER_DAY - 1, Math.max(0, rawStepOfDay));

  const beat = Math.min(BEATS_PER_DAY - 1, Math.max(0, Math.floor(stepOfDay / STEPS_PER_BEAT)));
  const step = Math.min(
    STEPS_PER_BEAT - 1,
    Math.max(0, stepOfDay - beat * STEPS_PER_BEAT),
  );

  const dayIndexFromMoment =
    readNum(m, "dayIndex") ?? readNum(m, "dayIndex0") ?? readNum(m, "dayIndexSinceGenesis");

  const eps = 1e-9;
  const dayIndex =
    dayIndexFromMoment !== null
      ? Math.floor(dayIndexFromMoment)
      : Math.floor((pulse + eps) / PULSES_PER_DAY);

  const daysPerYear = Number.isFinite(DAYS_PER_YEAR) ? DAYS_PER_YEAR : 336;
  const daysPerMonth = Number.isFinite(DAYS_PER_MONTH) ? DAYS_PER_MONTH : 42;
  const monthsPerYear = Number.isFinite(MONTHS_PER_YEAR) ? MONTHS_PER_YEAR : 8;

  const year = Math.floor(dayIndex / daysPerYear);
  const dayInYear = modPos(dayIndex, daysPerYear);

  let monthIndex = Math.floor(dayInYear / daysPerMonth);
  if (monthIndex < 0) monthIndex = 0;
  if (monthIndex > monthsPerYear - 1) monthIndex = monthsPerYear - 1;

  const dayInMonth = dayInYear - monthIndex * daysPerMonth;

  const month = monthIndex + 1;
  const day = Math.floor(dayInMonth) + 1;

  return { beat, step, day, month, year };
}

function formatBeatStepLabel(v: BeatStepDMY): string {
  return `${fmt2(v.beat)}:${fmt2(v.step)}`;
}

function formatDMYLabel(v: BeatStepDMY): string {
  return `D${v.day}/M${v.month}/Y${v.year}`;
}

/* ──────────────────────────────────────────────────────────────────────────────
   Zoom lock (bridging behavior, no layout impact)
────────────────────────────────────────────────────────────────────────────── */
function useDisableZoom(): void {
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    let lastTouchEnd = 0;

    const nowTs = (e: TouchEvent): number => {
      const ts = (e as unknown as { timeStamp?: number }).timeStamp;
      return typeof ts === "number" && Number.isFinite(ts) ? ts : performance.now();
    };

    const onTouchEnd = (e: TouchEvent): void => {
      if (isInteractiveTarget(e.target)) return;

      const now = nowTs(e);
      if (now - lastTouchEnd <= 300) e.preventDefault();
      lastTouchEnd = now;
    };

    const onTouchMove = (e: TouchEvent): void => {
      if (e.touches.length > 1) e.preventDefault();
    };

    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };

    const onKeydown = (e: KeyboardEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return;
      const k = e.key;
      if (k === "+" || k === "-" || k === "=" || k === "_" || k === "0") e.preventDefault();
    };

    const onGesture = (e: Event): void => {
      e.preventDefault();
    };

    const html = document.documentElement;
    const body = document.body;

    const prevHtmlTouchAction = html.style.touchAction;
    const prevBodyTouchAction = body.style.touchAction;
    const prevTextSizeAdjust =
      (html.style as unknown as { webkitTextSizeAdjust?: string }).webkitTextSizeAdjust;

    html.style.touchAction = "manipulation";
    body.style.touchAction = "manipulation";
    (html.style as unknown as { webkitTextSizeAdjust?: string }).webkitTextSizeAdjust = "100%";

    document.addEventListener("touchend", onTouchEnd, { passive: false, capture: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    document.addEventListener("gesturestart", onGesture, { passive: false, capture: true });
    document.addEventListener("gesturechange", onGesture, { passive: false, capture: true });
    document.addEventListener("gestureend", onGesture, { passive: false, capture: true });

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeydown);

    return () => {
      document.removeEventListener("touchend", onTouchEnd, true);
      document.removeEventListener("touchmove", onTouchMove, true);
      document.removeEventListener("gesturestart", onGesture, true);
      document.removeEventListener("gesturechange", onGesture, true);
      document.removeEventListener("gestureend", onGesture, true);

      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeydown);

      html.style.touchAction = prevHtmlTouchAction;
      body.style.touchAction = prevBodyTouchAction;
      (html.style as unknown as { webkitTextSizeAdjust?: string }).webkitTextSizeAdjust =
        prevTextSizeAdjust;
    };
  }, []);
}

/* ──────────────────────────────────────────────────────────────────────────────
   Shared VisualViewport publisher (RAF-throttled)
────────────────────────────────────────────────────────────────────────────── */
type VVStore = {
  size: VVSize;
  subs: Set<(s: VVSize) => void>;
  listening: boolean;
  rafId: number | null;
  cleanup?: (() => void) | null;
};

const vvStore: VVStore = {
  size: { width: 0, height: 0 },
  subs: new Set(),
  listening: false,
  rafId: null,
  cleanup: null,
};

function readVVNow(): VVSize {
  if (typeof window === "undefined") return { width: 0, height: 0 };
  const vv = window.visualViewport;
  if (vv) return { width: Math.round(vv.width), height: Math.round(vv.height) };
  return { width: window.innerWidth, height: window.innerHeight };
}

function startVVListeners(): void {
  if (typeof window === "undefined" || vvStore.listening) return;

  vvStore.listening = true;
  vvStore.size = readVVNow();

  const publish = (): void => {
    vvStore.rafId = null;
    const next = readVVNow();
    const prev = vvStore.size;
    if (next.width === prev.width && next.height === prev.height) return;
    vvStore.size = next;
    vvStore.subs.forEach((fn) => fn(next));
  };

  const schedule = (): void => {
    if (vvStore.rafId !== null) return;
    vvStore.rafId = window.requestAnimationFrame(publish);
  };

  const vv = window.visualViewport;

  window.addEventListener("resize", schedule, { passive: true });
  if (vv) {
    vv.addEventListener("resize", schedule, { passive: true });
    vv.addEventListener("scroll", schedule, { passive: true });
  }

  vvStore.cleanup = (): void => {
    if (vvStore.rafId !== null) {
      window.cancelAnimationFrame(vvStore.rafId);
      vvStore.rafId = null;
    }
    window.removeEventListener("resize", schedule);
    if (vv) {
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
    }
    vvStore.cleanup = null;
    vvStore.listening = false;
  };
}

function stopVVListenersIfIdle(): void {
  if (vvStore.subs.size > 0) return;
  vvStore.cleanup?.();
}

function useVisualViewportSize(): VVSize {
  const [size, setSize] = useState<VVSize>(() => readVVNow());

  useEffect(() => {
    if (typeof window === "undefined") return;

    startVVListeners();

    const sub = (s: VVSize): void => setSize(s);
    vvStore.subs.add(sub);
    sub(vvStore.size);

    return () => {
      vvStore.subs.delete(sub);
      stopVVListenersIfIdle();
    };
  }, []);

  return size;
}

/* ──────────────────────────────────────────────────────────────────────────────
   iOS-safe scroll lock
────────────────────────────────────────────────────────────────────────────── */
function useBodyScrollLock(lock: boolean): void {
  const savedRef = useRef<{
    scrollY: number;
    htmlOverflow: string;
    bodyOverflow: string;
    bodyPosition: string;
    bodyTop: string;
    bodyLeft: string;
    bodyRight: string;
    bodyWidth: string;
  } | null>(null);

  useEffect(() => {
    if (!lock) return;
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const html = document.documentElement;
    const body = document.body;

    const scrollY = window.scrollY || window.pageYOffset || 0;

    savedRef.current = {
      scrollY,
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width,
    };

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";

    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";

    return () => {
      const saved = savedRef.current;
      if (!saved) return;

      html.style.overflow = saved.htmlOverflow;
      body.style.overflow = saved.bodyOverflow;
      body.style.position = saved.bodyPosition;
      body.style.top = saved.bodyTop;
      body.style.left = saved.bodyLeft;
      body.style.right = saved.bodyRight;
      body.style.width = saved.bodyWidth;

      window.scrollTo(0, saved.scrollY);
      savedRef.current = null;
    };
  }, [lock]);
}

function isFixedSafeHost(el: HTMLElement): boolean {
  const cs = window.getComputedStyle(el);

  const backdropFilter = (cs as unknown as { backdropFilter?: string }).backdropFilter;
  const willChange = cs.willChange || "";

  const risky =
    (cs.transform && cs.transform !== "none") ||
    (cs.perspective && cs.perspective !== "none") ||
    (cs.filter && cs.filter !== "none") ||
    (backdropFilter && backdropFilter !== "none") ||
    (cs.contain && cs.contain !== "none") ||
    willChange.includes("transform") ||
    willChange.includes("perspective") ||
    willChange.includes("filter");

  return !risky;
}

function getPortalHost(): HTMLElement {
  const shell = document.querySelector(".app-shell");
  if (shell instanceof HTMLElement) {
    try {
      if (isFixedSafeHost(shell)) return shell;
    } catch {
      /* ignore */
    }
  }
  return document.body;
}

/* ──────────────────────────────────────────────────────────────────────────────
   Derived helpers
────────────────────────────────────────────────────────────────────────────── */
function pageTitleFromPath(pathname: string): string {
  if (pathname === "/") return "Verifier";
  if (pathname.startsWith("/mint")) return "Mint Sigil";
  if (pathname.startsWith("/voh")) return "KaiVoh";
  if (pathname.startsWith("/keystream")) return "PhiStream";
  if (pathname.startsWith("/klock")) return "KaiKlok";
  return "Sovereign Gate";
}

function lockPanelForPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname.startsWith("/voh") ||
    pathname.startsWith("/mint") ||
    pathname.startsWith("/keystream") ||
    pathname.startsWith("/klock")
  );
}

function chartHeightFromViewport(height: number): number {
  if (height < 680) return 200;
  return 240;
}

function topbarScrollMaxFromViewport(height: number): number {
  return Math.max(220, Math.min(520, Math.floor(height * 0.52)));
}

function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `ΦNet • ${title}`;
  }, [title]);
}

function useRoomyLayout(vvSize: VVSize): boolean {
  return useMemo(() => {
    const h = vvSize.height || 0;
    const w = vvSize.width || 0;
    return h >= 820 && w >= 980;
  }, [vvSize.height, vvSize.width]);
}

function useAppVersionSync(): string {
  const [appVersion, setAppVersion] = useState<string>(getInitialAppVersion);

  useEffect(() => {
    const onVersion = (event: Event): void => {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail === "string" && detail.length) setAppVersion(detail);
    };

    window.addEventListener(SW_VERSION_EVENT, onVersion);
    return () => window.removeEventListener(SW_VERSION_EVENT, onVersion);
  }, []);

  return appVersion;
}

function useKaiAnchorPersistence(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    hardResyncKaiAnchor();

    const writeAnchor = (): void => {
      const pμ = microPulsesNow();
      if (pμ > 0n) writeLocalStorageBigInt(KAI_ANCHOR_PMICRO_KEY, pμ);
    };

    const onVis = (): void => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") writeAnchor();
    };

    writeAnchor();
    const id = window.setInterval(writeAnchor, 15_000);

    window.addEventListener("pagehide", writeAnchor);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.clearInterval(id);
      window.removeEventListener("pagehide", writeAnchor);
      document.removeEventListener("visibilitychange", onVis);
      writeAnchor();
    };
  }, []);
}

function useHeavyUiGate(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const idleWin = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    const handle =
      typeof idleWin.requestIdleCallback === "function"
        ? idleWin.requestIdleCallback(() => setReady(true), { timeout: 900 })
        : window.setTimeout(() => setReady(true), 220);

    return () => {
      if (typeof idleWin.cancelIdleCallback === "function") idleWin.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    void import("./components/HomePriceChartCard");
    void import("./components/KaiVoh/KaiVohModal");
    void import("./components/SigilModal");
    void import("./components/SigilExplorer");
    void import("./components/EternalKlock");
    void import("./pages/sigilstream/SigilStreamRoot");
  }, [ready]);

  return ready;
}

function useServiceWorkerWarmup(warmTimerRef: React.MutableRefObject<number | null>): void {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return undefined;

    const aborter = new AbortController();

    const navAny = navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    };
    const saveData = Boolean(navAny.connection?.saveData);
    const et = navAny.connection?.effectiveType || "";
    const slowNet = et === "slow-2g" || et === "2g";

    if (saveData || slowNet) {
      return () => aborter.abort();
    }

    const warmOffline = async (): Promise<void> => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const controller = registration.active || registration.waiting || registration.installing;

        controller?.postMessage({
          type: "WARM_URLS",
          urls: [...OFFLINE_ASSETS_TO_WARM, ...SHELL_ROUTES_TO_WARM, ...APP_SHELL_HINTS],
          mapShell: true,
        });

        await Promise.all(
          [...OFFLINE_ASSETS_TO_WARM, ...SHELL_ROUTES_TO_WARM].map(async (url) => {
            try {
              await fetch(url, { cache: "no-cache", signal: aborter.signal });
            } catch {
              /* non-blocking warm-up */
            }
          }),
        );
      } catch {
        /* ignore */
      }
    };

    const idleWin = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    const runWarm = (): void => void warmOffline();

    const idleHandle =
      typeof idleWin.requestIdleCallback === "function"
        ? idleWin.requestIdleCallback(runWarm, { timeout: 2500 })
        : window.setTimeout(runWarm, 1200);

    const onFocus = (): void => {
      if (warmTimerRef.current !== null) window.clearTimeout(warmTimerRef.current);
      warmTimerRef.current = window.setTimeout(runWarm, 240);
    };

    window.addEventListener("focus", onFocus);

    return () => {
      aborter.abort();

      if (warmTimerRef.current !== null) {
        window.clearTimeout(warmTimerRef.current);
        warmTimerRef.current = null;
      }

      if (typeof idleWin.cancelIdleCallback === "function") {
        idleWin.cancelIdleCallback(idleHandle);
      } else {
        window.clearTimeout(idleHandle);
      }

      window.removeEventListener("focus", onFocus);
    };
  }, [warmTimerRef]);
}

function usePanelScrollMeasurement(
  lockPanelByRoute: boolean,
  pathname: string,
): {
  panelBodyRef: React.MutableRefObject<HTMLDivElement | null>;
  panelCenterRef: React.MutableRefObject<HTMLDivElement | null>;
  panelShouldScroll: boolean;
  panelBodyInlineStyle?: CSSProperties;
  panelCenterInlineStyle?: CSSProperties;
} {
  const panelBodyRef = useRef<HTMLDivElement | null>(null);
  const panelCenterRef = useRef<HTMLDivElement | null>(null);
  const [needsInternalScroll, setNeedsInternalScroll] = useState<boolean>(false);
  const rafIdRef = useRef<number | null>(null);

  const computeOverflow = useCallback((): boolean => {
    const body = panelBodyRef.current;
    const center = panelCenterRef.current;
    if (!body || !center) return false;

    const contentEl = center.firstElementChild as HTMLElement | null;
    const contentHeight = contentEl ? contentEl.scrollHeight : center.scrollHeight;
    const availableHeight = body.clientHeight;

    return contentHeight > availableHeight + 6;
  }, []);

  const scheduleMeasure = useCallback((): void => {
    if (rafIdRef.current !== null) return;

    rafIdRef.current = window.requestAnimationFrame(() => {
      rafIdRef.current = null;
      const next = computeOverflow();
      setNeedsInternalScroll((prev) => (prev === next ? prev : next));
    });
  }, [computeOverflow]);

  useEffect(() => {
    if (!lockPanelByRoute) return;
    scheduleMeasure();
  }, [lockPanelByRoute, pathname, scheduleMeasure]);

  useEffect(() => {
    const body = panelBodyRef.current;
    const center = panelCenterRef.current;
    if (!body || !center) return;

    const contentEl = center.firstElementChild as HTMLElement | null;
    const onAnyResize = (): void => scheduleMeasure();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(onAnyResize);
      ro.observe(body);
      ro.observe(center);
      if (contentEl) ro.observe(contentEl);
    }

    window.addEventListener("resize", onAnyResize, { passive: true });
    scheduleMeasure();

    return () => {
      window.removeEventListener("resize", onAnyResize);
      ro?.disconnect();
      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [scheduleMeasure, pathname]);

  const panelShouldScroll = lockPanelByRoute && needsInternalScroll;

  const panelBodyInlineStyle = useMemo<CSSProperties | undefined>(() => {
    if (!panelShouldScroll) return undefined;
    return {
      overflowY: "auto",
      overflowX: "hidden",
      WebkitOverflowScrolling: "touch",
      alignItems: "stretch",
      justifyContent: "flex-start",
      paddingBottom: "calc(1.25rem + var(--safe-bottom))",
    };
  }, [panelShouldScroll]);

  const panelCenterInlineStyle = useMemo<CSSProperties | undefined>(() => {
    if (!panelShouldScroll) return undefined;
    return {
      height: "auto",
      minHeight: "100%",
      alignItems: "flex-start",
      justifyContent: "flex-start",
    };
  }, [panelShouldScroll]);

  return {
    panelBodyRef,
    panelCenterRef,
    panelShouldScroll,
    panelBodyInlineStyle,
    panelCenterInlineStyle,
  };
}

function useNavAutoscroll(navListRef: React.MutableRefObject<HTMLDivElement | null>, pathname: string): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const list = navListRef.current;
    if (!list) return;

    if (!window.matchMedia("(max-width: 980px)").matches) return;

    const active = list.querySelector<HTMLElement>(".nav-item--active");
    if (!active) return;

    window.requestAnimationFrame(() => {
      try {
        active.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center",
        });
      } catch {
        active.scrollIntoView();
      }
    });
  }, [pathname, navListRef]);
}

/* ──────────────────────────────────────────────────────────────────────────────
   Popovers
────────────────────────────────────────────────────────────────────────────── */
function ExplorerPopover({
  open,
  onClose,
  children,
}: ExplorerPopoverProps): React.JSX.Element | null {
  const isClient = typeof document !== "undefined";
  const vvSize = useVisualViewportSize();

  const portalHost = useMemo<HTMLElement | null>(() => {
    if (!isClient) return null;
    return getPortalHost();
  }, [isClient]);

  useBodyScrollLock(open && isClient);

  useEffect(() => {
    if (!open || !isClient) return;

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, isClient]);

  useEffect(() => {
    if (!open || !isClient) return;
    window.dispatchEvent(new CustomEvent(SIGIL_EXPLORER_OPEN_EVENT));
  }, [open, isClient]);

  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => closeBtnRef.current?.focus());
  }, [open]);

  const overlayStyle = useMemo<ExplorerPopoverStyle | undefined>(() => {
    if (!open || !isClient) return undefined;

    const h = vvSize.height;
    const w = vvSize.width;

    return {
      position: "fixed",
      inset: 0,
      pointerEvents: "auto",
      height: h > 0 ? `${h}px` : undefined,
      width: w > 0 ? `${w}px` : undefined,

      ["--sx-breath"]: "5.236s",
      ["--sx-border"]: "rgba(60, 220, 205, 0.35)",
      ["--sx-border-strong"]: "rgba(55, 255, 228, 0.55)",
      ["--sx-ring"]:
        "0 0 0 2px rgba(55, 255, 228, 0.25), 0 0 0 6px rgba(55, 255, 228, 0.12)",
    };
  }, [open, isClient, vvSize]);

  const onBackdropPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  const onBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): void => {
      if (e.target === e.currentTarget) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  const onClosePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>): void => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  if (!open || !isClient || !portalHost) return null;

  return createPortal(
    <div
      className="explorer-pop"
      style={overlayStyle}
      role="dialog"
      aria-modal="true"
      aria-label="PhiStream Explorer"
      onPointerDown={onBackdropPointerDown}
      onClick={onBackdropClick}
    >
      <div className="explorer-pop__panel" role="document">
        <button
          ref={closeBtnRef}
          type="button"
          className="explorer-pop__close kx-x"
          onPointerDown={onClosePointerDown}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }}
          aria-label="Close PhiStream Explorer"
          title="Close (Esc)"
        >
          ×
        </button>

        <div className="explorer-pop__body">{children}</div>

        <div className="sr-only" aria-live="polite">
          PhiStream explorer portal open
        </div>
      </div>
    </div>,
    portalHost,
  );
}

function KlockPopover({ open, onClose, children }: KlockPopoverProps): React.JSX.Element | null {
  const isClient = typeof document !== "undefined";
  const vvSize = useVisualViewportSize();

  const portalHost = useMemo<HTMLElement | null>(() => {
    if (!isClient) return null;
    return getPortalHost();
  }, [isClient]);

  useBodyScrollLock(open && isClient);

  useEffect(() => {
    if (!open || !isClient) return;

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, isClient]);

  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => closeBtnRef.current?.focus());
  }, [open]);

  const overlayStyle = useMemo<KlockPopoverStyle | undefined>(() => {
    if (!open || !isClient) return undefined;

    const h = vvSize.height;
    const w = vvSize.width;

    return {
      position: "fixed",
      inset: 0,
      pointerEvents: "auto",
      height: h > 0 ? `${h}px` : undefined,
      width: w > 0 ? `${w}px` : undefined,

      ["--klock-breath"]: "5.236s",
      ["--klock-border"]: "rgba(255, 216, 120, 0.26)",
      ["--klock-border-strong"]: "rgba(255, 231, 160, 0.55)",
      ["--klock-ring"]:
        "0 0 0 2px rgba(255, 225, 150, 0.22), 0 0 0 6px rgba(255, 210, 120, 0.10)",
      ["--klock-scale"]: "5",
    };
  }, [open, isClient, vvSize]);

  const onBackdropPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  const onBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): void => {
      if (e.target === e.currentTarget) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  const onClosePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>): void => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  if (!open || !isClient || !portalHost) return null;

  return createPortal(
    <div
      className="klock-pop"
      style={overlayStyle}
      role="dialog"
      aria-modal="true"
      aria-label="Eternal KaiKlok"
      onPointerDown={onBackdropPointerDown}
      onClick={onBackdropClick}
    >
      <div className="klock-pop__panel" role="document" data-klock-size="xl">
        <button
          ref={closeBtnRef}
          type="button"
          className="klock-pop__close kx-x"
          onPointerDown={onClosePointerDown}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }}
          aria-label="Close Eternal KaiKlok"
          title="Close (Esc)"
        >
          ×
        </button>

        <div className="klock-pop__body">
          <div className="klock-stage" role="presentation" data-klock-stage="1">
            <div className="klock-stage__inner">{children}</div>
          </div>
        </div>

        <div className="sr-only" aria-live="polite">
          Eternal KaiKlok portal open
        </div>
      </div>
    </div>,
    portalHost,
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Routes (lazy + no “splash” fallbacks)
────────────────────────────────────────────────────────────────────────────── */
export function KaiVohRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const [open, setOpen] = useState<boolean>(true);

  const handleClose = useCallback((): void => {
    setOpen(false);
    navigate("/", { replace: true });
  }, [navigate]);

  return (
    <>
      <Suspense fallback={null}>
        <KaiVohModal open={open} onClose={handleClose} />
      </Suspense>
      <div className="sr-only" aria-live="polite">
        KaiVoh portal open
      </div>
    </>
  );
}

export function SigilMintRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const [open, setOpen] = useState<boolean>(true);

  const initialPulse = useMemo<number>(() => {
    const m = kaiMomentNow();
    const p = readNum(m, "pulse") ?? 0;
    return p;
  }, []);

  const handleClose = useCallback((): void => {
    setOpen(false);
    navigate("/", { replace: true });
  }, [navigate]);

  return (
    <>
      <Suspense fallback={null}>
        {open ? <SigilModal initialPulse={initialPulse} onClose={handleClose} /> : null}
      </Suspense>
      <div className="sr-only" aria-live="polite">
        Sigil mint portal open
      </div>
    </>
  );
}

export function ExplorerRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const [open, setOpen] = useState<boolean>(true);

  const handleClose = useCallback((): void => {
    setOpen(false);
    navigate("/", { replace: true });
  }, [navigate]);

  return (
    <>
      <ExplorerPopover open={open} onClose={handleClose}>
        <Suspense fallback={null}>
          <SigilExplorer />
        </Suspense>
      </ExplorerPopover>

      <div className="sr-only" aria-live="polite">
        PhiStream explorer portal open
      </div>
    </>
  );
}

export function KlockRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState<boolean>(true);

  const handleClose = useCallback((): void => {
    setOpen(false);
    navigate("/", { replace: true });
  }, [navigate]);

  const navState = (location.state as KlockNavState | null) ?? null;
  const initialDetailsOpen = navState?.openDetails ?? true;

  return (
    <>
      <KlockPopover open={open} onClose={handleClose}>
        <Suspense fallback={null}>
          <EternalKlockLazy initialDetailsOpen={initialDetailsOpen} />
        </Suspense>
      </KlockPopover>

      <div className="sr-only" aria-live="polite">
        Eternal KaiKlok portal open
      </div>
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Live Kai ticker
────────────────────────────────────────────────────────────────────────────── */
function snapshotFromMicroPulses(pμ: bigint): LiveKaiSnapshot {
  const msUTC = epochMsFromMicroPulses(pμ);
  const m = momentFromUTC(msUTC);

  const pulseBI = floorDiv(pμ, ONE_PULSE_MICRO);
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  const pulse = pulseBI > maxSafe ? Number.MAX_SAFE_INTEGER : pulseBI < 0n ? 0 : Number(pulseBI);

  const pulseStr = formatPulse(pulse);
  const m2 = { ...m, pulse } as KaiMoment;

  const bsd = computeBeatStepDMY(m2);
  const beatStepLabel = formatBeatStepLabel(bsd);
  const dmyLabel = formatDMYLabel(bsd);

  return {
    pulse,
    pulseStr,
    beatStepDMY: bsd,
    beatStepLabel,
    dmyLabel,
    chakraDay: m2.chakraDay,
  };
}

function useLiveKaiTicker(): LiveKaiSnapshot {
  const [snap, setSnap] = useState<LiveKaiSnapshot>(() => snapshotFromMicroPulses(microPulsesNow()));

  useEffect(() => {
    let alive = true;
    let t: TimeoutHandle | null = null;

    const clear = (): void => {
      if (t !== null) {
        window.clearTimeout(t);
        t = null;
      }
    };

    const applyMicro = (pμ: bigint): void => {
      const next = snapshotFromMicroPulses(pμ);
      setSnap((prev) => {
        if (
          prev.pulseStr === next.pulseStr &&
          prev.beatStepLabel === next.beatStepLabel &&
          prev.dmyLabel === next.dmyLabel
        ) {
          return prev;
        }
        return next;
      });
    };

    const scheduleNext = (): void => {
      if (!alive) return;

      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        clear();
        return;
      }

      const pμ = microPulsesNow();
      applyMicro(pμ);

      let into = pμ % ONE_PULSE_MICRO;
      if (into < 0n) into += ONE_PULSE_MICRO;
      const remainMicro = ONE_PULSE_MICRO - into;
      const remainMicroN = Number(remainMicro);
      const delayMs = Math.max(0, Math.floor((remainMicroN / 1_000_000) * PULSE_MS));

      clear();
      t = window.setTimeout(scheduleNext, delayMs);
    };

    scheduleNext();

    const onVis = (): void => {
      if (!alive) return;
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        hardResyncKaiAnchor();
        scheduleNext();
      }
    };

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);

    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      clear();
    };
  }, []);

  return snap;
}

type LiveKaiButtonProps = {
  onOpenKlock: () => void;
  breathS: number;
  breathMs: number;
  breathsPerDay: number;
};

const LiveKaiButton = memo(function LiveKaiButton({
  onOpenKlock,
  breathS,
  breathMs,
  breathsPerDay,
}: LiveKaiButtonProps): React.JSX.Element {
  const snap = useLiveKaiTicker();

  const neonTextStyle = useMemo<CSSProperties>(
    () => ({
      color: "var(--accent-color)",
      textShadow: "0 0 14px rgba(0, 255, 255, 0.22), 0 0 28px rgba(0, 255, 255, 0.12)",
    }),
    [],
  );

  const neonTextStyleHalf = useMemo<CSSProperties>(
    () => ({
      color: "var(--accent-color)",
      textShadow: "0 0 14px rgba(0, 255, 255, 0.22), 0 0 28px rgba(0, 255, 255, 0.12)",
      fontSize: "0.5em",
      lineHeight: 1.05,
    }),
    [],
  );

  const arcColor = useMemo(() => {
    const pos = modPos(snap.pulse, PULSES_PER_DAY);
    const arcSize = PULSES_PER_DAY / ARK_COLORS.length;
    const idx = Math.min(ARK_COLORS.length - 1, Math.max(0, Math.floor(pos / arcSize)));
    return ARK_COLORS[idx] ?? ARK_COLORS[0];
  }, [snap.pulse]);

  const chakraColor = useMemo(() => {
    return CHAKRA_DAY_COLORS[snap.chakraDay] ?? CHAKRA_DAY_COLORS.Heart;
  }, [snap.chakraDay]);

  const monthColor = useMemo(() => {
    const idx = Math.min(
      MONTH_CHAKRA_COLORS.length - 1,
      Math.max(0, snap.beatStepDMY.month - 1),
    );
    return MONTH_CHAKRA_COLORS[idx] ?? CHAKRA_DAY_COLORS.Heart;
  }, [snap.beatStepDMY.month]);

  const timeStyle = useMemo<CSSProperties>(
    () =>
      ({
        ["--kai-ark"]: arcColor,
        ["--kai-chakra"]: chakraColor,
        ["--kai-month"]: monthColor,
      }) as CSSProperties,
    [arcColor, chakraColor, monthColor],
  );

  const liveTitle = useMemo(() => {
    return `LIVE • NOW PULSE ${snap.pulseStr} • ${snap.beatStepLabel} • ${snap.dmyLabel} • Breath ${breathS.toFixed(
      6,
    )}s (${Math.round(breathMs)}ms) • ${breathsPerDay.toLocaleString("en-US", {
      minimumFractionDigits: 6,
      maximumFractionDigits: 6,
    })}/day • Open Eternal KaiKlok`;
  }, [snap.pulseStr, snap.beatStepLabel, snap.dmyLabel, breathS, breathMs, breathsPerDay]);

  const liveAria = useMemo(() => {
    return `LIVE. Kai Pulse now ${snap.pulse}. Beat ${snap.beatStepDMY.beat} step ${snap.beatStepDMY.step}. D ${snap.beatStepDMY.day}. M ${snap.beatStepDMY.month}. Y ${snap.beatStepDMY.year}. Open Eternal KaiKlok.`;
  }, [snap]);

  return (
    <button
      type="button"
      className="topbar-live"
      onClick={onOpenKlock}
      aria-label={liveAria}
      title={liveTitle}
      style={timeStyle}
    >
      <span className="live-orb" aria-hidden="true" />
      <div className="live-scroll" aria-hidden="true">
        <div className="live-text">
          <div className="live-meta">
            <span className="mono" style={neonTextStyle}>
              ☤KAI
            </span>
          </div>

          <div className="live-meta">
            <span className="mono" style={neonTextStyle}>
              {snap.pulseStr}
            </span>
          </div>

          <div className="live-sub">
            <span className="mono" style={neonTextStyleHalf}>
              <span className="kai-num kai-num--ark">{snap.beatStepLabel}</span>{" "}
              <span aria-hidden="true" style={{ opacity: 0.7 }}>
                •
              </span>{" "}
              <span className="kai-tag">D</span>
              <span className="kai-num kai-num--chakra">{snap.beatStepDMY.day}</span>
              <span className="kai-sep">/</span>
              <span className="kai-tag">M</span>
              <span className="kai-num kai-num--month">{snap.beatStepDMY.month}</span>
              <span className="kai-sep">/</span>
              <span className="kai-tag">Y</span>
              <span className="kai-num">{snap.beatStepDMY.year}</span>
            </span>
          </div>
        </div>
      </div>
    </button>
  );
});

/* ──────────────────────────────────────────────────────────────────────────────
   AppChrome
────────────────────────────────────────────────────────────────────────────── */
export function AppChrome(): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();

  useDisableZoom();
  usePerfMode();

  useIsoLayoutEffect(() => {
    killSplashOnHome();
  }, [location.pathname]);

  useKaiAnchorPersistence();

  const appVersion = useAppVersionSync();
  const heavyUiReady = useHeavyUiGate();
  const warmTimerRef = useRef<number | null>(null);
  useServiceWorkerWarmup(warmTimerRef);

  const vvSize = useVisualViewportSize();
  const roomy = useRoomyLayout(vvSize);

  const shellStyle = useMemo<AppShellStyle>(
    () => ({
      "--breath-s": `${BREATH_S}s`,
      "--vvh-px": `${vvSize.height}px`,
    }),
    [vvSize.height],
  );

  const pageTitle = useMemo<string>(() => pageTitleFromPath(location.pathname), [location.pathname]);
  useDocumentTitle(pageTitle);

  const lockPanelByRoute = useMemo(() => lockPanelForPath(location.pathname), [location.pathname]);
  const showAtriumChartBar = lockPanelByRoute;

  const chartHeight = useMemo<number>(() => chartHeightFromViewport(vvSize.height || 800), [vvSize.height]);
  const topbarScrollMaxH = useMemo<number>(
    () => topbarScrollMaxFromViewport(vvSize.height || 800),
    [vvSize.height],
  );

  const {
    panelBodyRef,
    panelCenterRef,
    panelShouldScroll,
    panelBodyInlineStyle,
    panelCenterInlineStyle,
  } = usePanelScrollMeasurement(lockPanelByRoute, location.pathname);

  const navListRef = useRef<HTMLDivElement | null>(null);
  useNavAutoscroll(navListRef, location.pathname);

  const openKlock = useCallback((): void => {
    const st: KlockNavState = { openDetails: true };
    navigate("/klock", { state: st });
  }, [navigate]);

  const copyDnsIp = useCallback(async (btn?: HTMLButtonElement | null) => {
    try {
      await navigator.clipboard.writeText(DNS_IP);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = DNS_IP;
      ta.setAttribute("readonly", "true");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }

    if (btn) {
      btn.classList.add("is-copied");
      window.setTimeout(() => btn.classList.remove("is-copied"), 900);
    }
  }, []);

  const navInlineStyle = useMemo<CSSProperties | undefined>(() => {
    if (!roomy) return undefined;
    return { alignSelf: "start", height: "auto" };
  }, [roomy]);

  return (
    <div
      className="app-shell"
      data-ui="atlantean-banking"
      data-panel-scroll={panelShouldScroll ? "1" : "0"}
      data-roomy={roomy ? "1" : "0"}
      style={shellStyle}
    >
      <a className="skip-link" href="#app-content">
        Skip to content
      </a>

      <div className="app-bg-orbit" aria-hidden="true" />
      <div className="app-bg-grid" aria-hidden="true" />
      <div className="app-bg-glow" aria-hidden="true" />

      <header className="app-topbar" role="banner" aria-label="ΦNet Sovereign Gate Header">
        <div className="topbar-left">
          <div className="brand" aria-label="ΦNet Sovereign Gate">
            <div className="brand__mark" aria-hidden="true">
              <img src="/phi.svg" alt="" className="brand__mark-img" />
            </div>
            <div className="brand__text">
              <div className="brand__title">PHI.NETWORK</div>
              <div className="brand__subtitle">Breath-Minted Value · Kairos Identity Registry</div>
            </div>
          </div>
        </div>

        <div className="topbar-right" aria-label="Live Kai clock">
          <LiveKaiButton
            onOpenKlock={openKlock}
            breathS={BREATH_S}
            breathMs={BREATH_MS}
            breathsPerDay={BREATHS_PER_DAY}
          />
        </div>
      </header>

      <main className="app-stage" id="app-content" role="main" aria-label="Sovereign Value Workspace">
        <div className="app-frame" role="region" aria-label="Secure frame">
          <div className="app-frame-inner">
            <div className="app-workspace">
              {showAtriumChartBar && (
                <div
                  className="workspace-topbar"
                  aria-label="Atrium live Φ value + chart"
                  style={{ overflow: "visible", position: "relative" }}
                >
                  <div
                    className="workspace-topbar-scroll"
                    style={{
                      maxHeight: `${topbarScrollMaxH}px`,
                      overflowY: "auto",
                      overflowX: "hidden",
                      WebkitOverflowScrolling: "touch",
                      overscrollBehavior: "contain",
                      borderRadius: "inherit",
                    }}
                  >
                    {heavyUiReady ? (
                      <Suspense fallback={<div style={{ height: chartHeight }} aria-hidden="true" />}>
                        <HomePriceChartCard
                          apiBase="https://pay.kaiklok.com"
                          ctaAmountUsd={144}
                          chartHeight={chartHeight}
                        />
                      </Suspense>
                    ) : (
                      <div style={{ height: chartHeight }} aria-hidden="true" />
                    )}
                  </div>
                </div>
              )}

              <nav
                className="app-nav"
                aria-label="Primary navigation"
                data-nav-roomy={roomy ? "1" : "0"}
                style={navInlineStyle}
              >
                <div className="nav-head">
                  <div className="nav-head__title">Atrium</div>
                  <div className="nav-head__sub">Breath-Sealed Identity · Kairos-ZK Proof</div>
                </div>

                <div
                  ref={navListRef}
                  className="nav-list"
                  role="list"
                  aria-label="Atrium navigation tiles"
                >
                  {NAV_ITEMS.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={(p: NavLinkClassNameProps) =>
  `nav-item ${p.isActive ? "nav-item--active" : ""}`
}

                      aria-label={`${item.label}: ${item.desc}`}
                    >
                      <div className="nav-item__label">{item.label}</div>
                      <div className="nav-item__desc">{item.desc}</div>
                    </NavLink>
                  ))}
                </div>

                <div className="nav-writ-slot" data-writ-slim="1">
                  <SovereignDeclarations />
                </div>
              </nav>

              <section className="app-panel" aria-label="Sovereign Gate panel">
                <div className="panel-head">
                  <div className="panel-head__title">{pageTitle}</div>
                  <div className="panel-head__meta">
                    <span className="meta-chip">Proof of Breath™</span>
                    <span className="meta-chip">Kai-Signature™</span>
                  </div>
                </div>

                <div
                  ref={panelBodyRef}
                  className={`panel-body ${lockPanelByRoute ? "panel-body--locked" : ""} ${
                    panelShouldScroll ? "panel-body--scroll" : ""
                  }`}
                  style={panelBodyInlineStyle}
                >
                  <div ref={panelCenterRef} className="panel-center" style={panelCenterInlineStyle}>
                    <Outlet />
                  </div>
                </div>

                <footer className="panel-foot" aria-label="Footer">
                  <div className="panel-foot__left">
                    <span className="mono">ΦNet</span> • Sovereign Gate •{" "}
                    <button
                      type="button"
                      className="dns-copy mono"
                      onClick={(e) => void copyDnsIp(e.currentTarget)}
                      aria-label={`Remember .kai DNS IP ${DNS_IP}`}
                      title="Remember DNS IP"
                    >
                      .kai DNS: <span className="mono">{DNS_IP}</span>
                    </button>
                  </div>

                  <div className="panel-foot__right">
                    <span className="mono">V</span>{" "}
                    <a
                      className="mono"
                      href="https://github.com/phinetwork/phi.network"
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Version ${appVersion} (opens GitHub)`}
                      title="Open GitHub"
                    >
                      {appVersion}
                    </a>
                  </div>
                </footer>
              </section>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export function NotFound(): React.JSX.Element {
  return (
    <div className="notfound" role="region" aria-label="Not found">
      <div className="notfound__code">404</div>
      <div className="notfound__title">Route not found</div>
      <div className="notfound__hint">
        Use the Sovereign Gate navigation to return to Verifier, Mint Sigil, KaiVoh, or PhiStream.
      </div>
      <div className="notfound__actions">
        <NavLink className="notfound__cta" to="/">
          Go to Verifier
        </NavLink>
      </div>
    </div>
  );
}

export default AppChrome;
