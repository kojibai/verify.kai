// src/components/ExhaleNote.tsx
/* eslint-disable @typescript-eslint/consistent-type-assertions */
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import type { ValueSeal } from "../utils/valuation";
import { computeIntrinsicUnsigned } from "../utils/valuation";
import { DEFAULT_ISSUANCE_POLICY, quotePhiForUsd } from "../utils/phi-issuance";

/* ---- modular pieces ---- */
import { NOTE_TITLE } from "./exhale-note/titles";
import { kaiPulseNowBridge, msUntilNextPulseBoundary } from "./exhale-note/time";
import { PULSE_MS } from "./exhale-note/constants";
import { renderPreview } from "./exhale-note/dom";
import { buildBanknoteSVG } from "./exhale-note/banknoteSvg";
import buildProofPagesHTML from "./exhale-note/proofPages";
import { printWithTempTitle, renderIntoPrintRoot } from "./exhale-note/printer";
import { fPhi, fUsd, fTiny } from "./exhale-note/format";
import { fetchFromVerifierBridge } from "./exhale-note/bridge";
import { svgStringToPngBlob, triggerDownload } from "./exhale-note/svgToPng";

import type {
  NoteProps,
  BanknoteInputs,
  IntrinsicUnsigned,
  MaybeUnsignedSeal,
  ExhaleNoteRenderPayload,
} from "./exhale-note/types";

/* External stylesheet */
import "./ExhaleNote.css";

/* -----------------------
   Helpers
   ----------------------- */

/**
 * IMPORTANT:
 * In browser builds, setTimeout/setInterval return a number.
 * Never type these as NodeJS.Timeout in React/Vite apps.
 */
type TimerId = number;
type IntervalId = number;

function materializeStampedSeal(input: MaybeUnsignedSeal): ValueSeal {
  if (typeof (input as ValueSeal).stamp === "string") return input as ValueSeal;
  return { ...(input as Omit<ValueSeal, "stamp">), stamp: "LOCKED-NO-STAMP" };
}

/** Create a safe-ish filename for exports */
function makeFileTitle(kaiSig: string, pulse: string, stamp: string): string {
  const serialCore = (kaiSig ? kaiSig.slice(0, 12).toUpperCase() : "SIGIL").replace(/[^0-9A-Z]/g, "Φ");
  const safe = (s: string) =>
    (s || "")
      .replace(/[^\w\-–—\u0394\u03A6\u03C6]+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 180);
  return `SIGIL-KK-${safe(serialCore)}-${safe(pulse)}—VAL-${safe(stamp)}`;
}

function formatPhiParts(val: number): { int: string; frac: string } {
  const s = fTiny(val);
  const [i, f] = s.includes(".") ? s.split(".") : [s, ""];
  return { int: i, frac: f ? `.${f}` : "" };
}

/** Wait two animation frames to guarantee paint before print */
function afterTwoFrames(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

/** Inject preview CSS once so the SVG scales on mobile (kept defensive even if ExhaleNote.css exists). */
function ensurePreviewStylesInjected(): void {
  if (typeof document === "undefined") return;
  const id = "kk-preview-style";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .kk-note-preview { width: 100%; max-width: 980px; margin: 0 auto; }
    .kk-note-preview svg { display:block; width:100% !important; height:auto !important; }
    .kk-hero .kk-value-row { display:flex; gap:16px; align-items:flex-start; }
    @media (max-width: 860px) {
      .kk-hero .kk-value-row { flex-direction:column; }
      .kk-cta { width:100%; }
      .kk-cta .kk-cta-actions { display:flex; gap:8px; flex-wrap:wrap; }
    }
  `;
  document.head.appendChild(style);
}

/** Inject print CSS overrides so #print-root never shows except in print. */
function ensurePrintStylesInjected(): void {
  if (typeof document === "undefined") return;
  const id = "kk-print-style";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    #print-root { display: none; }
    @media print {
      html, body { background: #fff !important; }
      #print-root[aria-hidden="false"] { display: block !important; }
      header, nav, .no-print { display: none !important; }
      .print-page { page-break-after: always; position: relative; padding: 24px; }
      .print-page:last-child { page-break-after: auto; }
      @page { size: auto; margin: 14mm; }
      .banknote-frame{ border:none; box-shadow:none; width:182mm; height:auto; aspect-ratio:1000/618; margin:0 auto; }
      .banknote-frame > svg{ width:182mm; height:auto; }
    }
  `;
  document.head.appendChild(style);
}

/** rAF throttle for heavy preview work */
function useRafThrottle(cb: () => void, fps = 8) {
  const cbRef = useRef(cb);


  const lastRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const limit = 1000 / Math.max(1, fps);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return useCallback(() => {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const run = () => {
      lastRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
      rafRef.current = null;
      cbRef.current();
    };

    if (now - lastRef.current >= limit) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(run);
    } else if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(run);
    }
  }, [limit]);
}

/* === Valuation stamp (offline parity) === */
type MinimalValuationStamp = {
  algorithm: string;
  policy: string | null | undefined;
  policyChecksum: string;
  valuePhi: number;
  premium?: number | null;
  inputs?: unknown;
  minimalHead: {
    headHash: string | null;
    transfersWindowRoot: string | null;
    cumulativeTransfers: number;
  };
};

function bufToHex(buf: ArrayBuffer): string {
  const v = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < v.length; i++) s += v[i].toString(16).padStart(2, "0");
  return s;
}

/* robust SHA-256 (SubtleCrypto when available, JS fallback otherwise) */
function sha256HexJs(input: string): string {
  function rotr(n: number, x: number) {
    return (x >>> n) | (x << (32 - n));
  }
  function ch(x: number, y: number, z: number) {
    return (x & y) ^ (~x & z);
  }
  function maj(x: number, y: number, z: number) {
    return (x & y) ^ (x & z) ^ (y & z);
  }
  function s0(x: number) {
    return rotr(7, x) ^ rotr(18, x) ^ (x >>> 3);
  }
  function s1(x: number) {
    return rotr(17, x) ^ rotr(19, x) ^ (x >>> 10);
  }
  function S0(x: number) {
    return rotr(2, x) ^ rotr(13, x) ^ rotr(22, x);
  }
  function S1(x: number) {
    return rotr(6, x) ^ rotr(11, x) ^ rotr(25, x);
  }

  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  const enc = new TextEncoder().encode(input);
  const l = enc.length;
  const withOne = l + 1;
  const k = withOne % 64 <= 56 ? 56 - (withOne % 64) : 56 + 64 - (withOne % 64);
  const total = withOne + k + 8;
  const m = new Uint8Array(total);
  m.set(enc);
  m[l] = 0x80;

  // Write 64-bit big-endian bit length (safe for our message sizes)
  const bitLen = l * 8;
  for (let i = 0; i < 8; i++) m[total - 1 - i] = (bitLen >>> (i * 8)) & 0xff;

  let h0 = 0x6a09e667,
    h1 = 0xbb67ae85,
    h2 = 0x3c6ef372,
    h3 = 0xa54ff53a,
    h4 = 0x510e527f,
    h5 = 0x9b05688c,
    h6 = 0x1f83d9ab,
    h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let i = 0; i < total; i += 64) {
    for (let t = 0; t < 16; t++) {
      const j = i + t * 4;
      w[t] = (m[j] << 24) | (m[j + 1] << 16) | (m[j + 2] << 8) | m[j + 3];
    }
    for (let t = 16; t < 64; t++) w[t] = (s1(w[t - 2]) + w[t - 7] + s0(w[t - 15]) + w[t - 16]) >>> 0;

    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4,
      f = h5,
      g = h6,
      h = h7;

    for (let t = 0; t < 64; t++) {
      const T1 = (h + S1(e) + ch(e, f, g) + K[t] + w[t]) >>> 0;
      const T2 = (S0(a) + maj(a, b, c)) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + T1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (T1 + T2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const hx = (x: number) => x.toString(16).padStart(8, "0");
  return hx(h0) + hx(h1) + hx(h2) + hx(h3) + hx(h4) + hx(h5) + hx(h6) + hx(h7);
}

async function sha256HexCanon(s: string): Promise<string> {
  try {
    const cryptoObj: Crypto | undefined =
      (typeof crypto !== "undefined" ? crypto : undefined) ??
      ((globalThis as unknown as { crypto?: Crypto }).crypto);
    if (cryptoObj?.subtle) {
      const data = new TextEncoder().encode(s);
      const digest = await cryptoObj.subtle.digest("SHA-256", data);
      return bufToHex(digest);
    }
  } catch {
    /* fall through */
  }
  return sha256HexJs(s);
}

function safeJsonStringify(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val));
  } catch {
    try {
      return JSON.stringify({ error: "unstringifiable", kind: typeof v });
    } catch {
      return '{"error":"unstringifiable"}';
    }
  }
}

function buildMinimalForStamp(u: IntrinsicUnsigned): MinimalValuationStamp {
  type HeadRefLike = {
    headRef?: {
      headHash?: string | null;
      transfersWindowRoot?: string | null;
      cumulativeTransfers?: number;
    };
    policyId?: string | null | undefined;
    inputs?: unknown;
  };
  const like = u as unknown as HeadRefLike;
  return {
    algorithm: u.algorithm,
    policy: like.policyId ?? null,
    policyChecksum: u.policyChecksum,
    valuePhi: u.valuePhi,
    premium: u.premium ?? null,
    inputs: like.inputs,
    minimalHead: {
      headHash: like.headRef?.headHash ?? null,
      transfersWindowRoot: like.headRef?.transfersWindowRoot ?? null,
      cumulativeTransfers: like.headRef?.cumulativeTransfers ?? 0,
    },
  };
}

async function computeValuationStamp(u: IntrinsicUnsigned): Promise<string> {
  const minimal = buildMinimalForStamp(u);
  return sha256HexCanon(`val-stamp:${safeJsonStringify(minimal)}`);
}

/* -----------------------
   Component
   ----------------------- */

const ExhaleNote: React.FC<NoteProps> = ({
  meta,
  usdSample = 100,
  policy = DEFAULT_ISSUANCE_POLICY,
  getNowPulse,
  onRender,
  initial,
  className,
}) => {
  const uid = useId();
  const previewHostRef = useRef<HTMLDivElement>(null);
  const printRootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ensurePreviewStylesInjected();
    ensurePrintStylesInjected();
  }, []);

  /* Live Kai pulse + timers */
  const [pulse, setPulse] = useState<number>(() => (getNowPulse ? getNowPulse() : kaiPulseNowBridge()));
  const intervalRef = useRef<IntervalId | null>(null);
  const timeoutRef = useRef<TimerId | null>(null);
  const lastFloorRef = useRef<number>(Math.floor(pulse));

  const armTimers = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    const nowP = () => (getNowPulse ? getNowPulse() : kaiPulseNowBridge());
    const p0 = nowP();
    setPulse(p0);
    lastFloorRef.current = Math.floor(p0);

    const waitRaw = msUntilNextPulseBoundary(p0);
    const wait = Math.max(0, Number.isFinite(waitRaw) ? waitRaw : 0);

    timeoutRef.current = window.setTimeout(() => {
      const tick = () => {
        const p = nowP();
        const f = Math.floor(p);
        if (f !== lastFloorRef.current) {
          lastFloorRef.current = f;
          setPulse(p);
        }
      };
      const intervalMs = Math.max(PULSE_MS, 50);
      intervalRef.current = window.setInterval(tick, intervalMs);
    }, wait);
  }, [getNowPulse]);

  useEffect(() => {
    armTimers();
    return () => {
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    };
  }, [armTimers]);

  const defaultVerifyUrl = useMemo(() => {
    if (typeof window === "undefined") return "/";
    const o = window.location.origin;
    return o && o !== "null" ? `${o}/` : "/";
  }, []);

  /* Builder state */
  const [form, setForm] = useState<BanknoteInputs>({
    purpose: "",
    to: "",
    from: "",
    location: "",
    witnesses: "",
    reference: "",
    remark: "In Yahuah We Trust — Secured by Φ, not man-made law",
    valuePhi: "",
    premiumPhi: "",
    computedPulse: "",
    nowPulse: "",
    kaiSignature: "",
    userPhiKey: "",
    sigmaCanon: "",
    shaHex: "",
    phiDerived: "",
    valuationAlg: "",
    valuationStamp: "",
    provenance: [],
    zk: undefined,
    sigilSvg: "",
    verifyUrl: defaultVerifyUrl,
    ...(initial ?? {}),
  });

  /* Lock state */
  const [locked, setLocked] = useState<ExhaleNoteRenderPayload | null>(null);
  const lockedRef = useRef(false);
  const [isRendering, setIsRendering] = useState(false);

  const u =
    (k: keyof BanknoteInputs) =>
    (v: string): void =>
      setForm((prev) => ({ ...prev, [k]: v }));

  /* Live valuation (derived) */
  const nowFloor = Math.floor(pulse);

  const liveUnsigned = useMemo<IntrinsicUnsigned>(() => {
    const { unsigned } = computeIntrinsicUnsigned(meta, nowFloor) as { unsigned: IntrinsicUnsigned };
    return unsigned;
  }, [meta, nowFloor]);

  const liveAlgString = useMemo(
    () => `${liveUnsigned.algorithm} • ${liveUnsigned.policyChecksum}`,
    [liveUnsigned.algorithm, liveUnsigned.policyChecksum]
  );

  useEffect(() => {
    setForm((prev) => (prev.valuationAlg ? prev : { ...prev, valuationAlg: liveAlgString }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveAlgString]);

  const liveQuote = useMemo(
    () =>
      quotePhiForUsd(
        { meta, nowPulse: nowFloor, usd: usdSample, currentStreakDays: 0, lifetimeUsdSoFar: 0 },
        policy
      ),
    [meta, nowFloor, usdSample, policy]
  );

  const liveValuePhi = liveUnsigned.valuePhi;
  const livePremium = liveUnsigned.premium ?? 0;
  const usdPerPhi = liveQuote.usdPerPhi;
  const phiPerUsd = liveQuote.phiPerUsd;
  const valueUsdIndicative = liveValuePhi * usdPerPhi;

  /* Build SVG for preview */
  const buildCurrentSVG = useCallback((): string => {
    const usingLocked = Boolean(locked);

    const valuePhiStr = usingLocked ? fTiny(locked!.valuePhi) : fTiny(liveValuePhi);
    const premiumPhiStr = usingLocked ? form.premiumPhi || fTiny(livePremium) : fTiny(livePremium);

    const lockedPulseStr = usingLocked ? String(locked!.lockedPulse) : "";
    const valuationStampStr = usingLocked ? form.valuationStamp || locked!.seal.stamp : "";

    return buildBanknoteSVG({
      purpose: form.purpose,
      to: form.to,
      from: form.from,
      location: form.location,
      witnesses: form.witnesses,
      reference: form.reference,
      remark: form.remark,

      valuePhi: valuePhiStr,
      premiumPhi: premiumPhiStr,

      computedPulse: lockedPulseStr,
      nowPulse: String(nowFloor),

      kaiSignature: form.kaiSignature || "",
      userPhiKey: form.userPhiKey || "",
      valuationAlg: form.valuationAlg || liveAlgString,
      valuationStamp: valuationStampStr,

      sigilSvg: form.sigilSvg || "",
      verifyUrl: form.verifyUrl || "/",
      provenance: form.provenance ?? [],
    });
  }, [form, liveValuePhi, livePremium, nowFloor, liveAlgString, locked]);

  const renderPreviewThrottled = useRafThrottle(() => {
    const host = previewHostRef.current;
    if (!host) return;
    try {
      renderPreview(host, buildCurrentSVG());
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("preview render failed", e);
    }
  }, 8);

  useEffect(() => {
    renderPreviewThrottled();
  }, [renderPreviewThrottled, buildCurrentSVG]);

  /* Single final Render (locks pulse + valuation) */
  const handleRenderLock = useCallback(async () => {
    if (lockedRef.current || isRendering) return;
    setIsRendering(true);
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const lockedPulse = nowFloor;
      const { unsigned: lockedUnsigned } = computeIntrinsicUnsigned(meta, lockedPulse) as {
        unsigned: IntrinsicUnsigned;
      };

      const valuationStamp = await computeValuationStamp(lockedUnsigned);

      const quote = quotePhiForUsd(
        { meta, nowPulse: lockedPulse, usd: usdSample, currentStreakDays: 0, lifetimeUsdSoFar: 0 },
        policy
      );

      const sealedBase: ValueSeal = materializeStampedSeal(lockedUnsigned as unknown as MaybeUnsignedSeal);
      const sealed: ValueSeal = { ...sealedBase, stamp: valuationStamp };

      const payload: ExhaleNoteRenderPayload = {
        lockedPulse,
        seal: sealed,
        usdPerPhi: quote.usdPerPhi,
        phiPerUsd: quote.phiPerUsd,
        valuePhi: sealed.valuePhi,
        valueUsdIndicative: sealed.valuePhi * quote.usdPerPhi,
        quote,
      };

      // Freeze LIVE timers (note is now pulse-locked)
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      lockedRef.current = true;
      setLocked(payload);

      setForm((prev) => ({
        ...prev,
        computedPulse: String(lockedPulse),
        nowPulse: String(lockedPulse),
        valuationStamp,
        premiumPhi: lockedUnsigned.premium !== undefined ? fTiny(lockedUnsigned.premium) : prev.premiumPhi,
        valuationAlg: prev.valuationAlg || `${lockedUnsigned.algorithm} • ${lockedUnsigned.policyChecksum}`,
        valuePhi: fTiny(sealed.valuePhi),
      }));

      onRender?.(payload);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Render/Lock failed", err);
      window.alert(`Render failed.\n${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsRendering(false);
    }
  }, [nowFloor, meta, usdSample, policy, onRender, isRendering]);

  /* Bridge hydration + updates */
  const lastBridgeJsonRef = useRef<string>("");

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const payload = await fetchFromVerifierBridge();
        if (!active || !payload) return;
        setForm((prev) => ({ ...prev, ...payload }));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("bridge hydration failed", e);
      }
    })();

    const onEvt: EventListener = (evt: Event) => {
      try {
        const detail = (evt as CustomEvent<BanknoteInputs>).detail;
        if (!detail) return;

        if (lockedRef.current) {
          // After lock: ONLY allow identity/provenance fields to update.
          const allow: Array<keyof BanknoteInputs> = [
            "kaiSignature",
            "userPhiKey",
            "sigmaCanon",
            "shaHex",
            "phiDerived",
            "zk",
            "provenance",
            "sigilSvg",
            "verifyUrl",
          ];

          const safe = Object.fromEntries(
            Object.entries(detail).filter(([k]) => allow.includes(k as keyof BanknoteInputs))
          ) as Partial<BanknoteInputs>;

          const json = JSON.stringify(safe);
          if (json === lastBridgeJsonRef.current) return;
          lastBridgeJsonRef.current = json;

          setForm((prev) => ({ ...prev, ...safe }));
          return;
        }

        const json = JSON.stringify(detail);
        if (json === lastBridgeJsonRef.current) return;
        lastBridgeJsonRef.current = json;

        setForm((prev) => ({ ...prev, ...detail }));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("bridge event failed", err);
      }
    };

    window.addEventListener("kk:note-data", onEvt, { passive: true });
    return () => {
      active = false;
      window.removeEventListener("kk:note-data", onEvt);
    };
  }, []);

  /* Print + PNG (require lock) */
  const onPrint = useCallback(async () => {
    const root = printRootRef.current;
    if (!root) return;
    if (!lockedRef.current || !locked) {
      window.alert("Please Render to lock the valuation before printing.");
      return;
    }

    const banknote = buildBanknoteSVG({
      ...form,
      valuePhi: form.valuePhi || fTiny(locked.valuePhi),
      premiumPhi: form.premiumPhi || fTiny(livePremium),
      computedPulse: String(locked.lockedPulse),
      nowPulse: String(locked.lockedPulse),
      kaiSignature: form.kaiSignature || "",
      userPhiKey: form.userPhiKey || "",
      valuationAlg: form.valuationAlg || liveAlgString,
      valuationStamp: form.valuationStamp || locked.seal.stamp,
      sigilSvg: form.sigilSvg || "",
      verifyUrl: form.verifyUrl || "/",
      provenance: form.provenance ?? [],
    });

    const proofPages = buildProofPagesHTML({
      frozenPulse: String(locked.lockedPulse),
      kaiSignature: form.kaiSignature || "",
      userPhiKey: form.userPhiKey || "",
      sigmaCanon: form.sigmaCanon || "",
      shaHex: form.shaHex || "",
      phiDerived: form.phiDerived || "",
      valuePhi: form.valuePhi || fTiny(locked.valuePhi),
      premiumPhi: form.premiumPhi || fTiny(livePremium),
      valuationAlg: form.valuationAlg || liveAlgString,
      valuationStamp: form.valuationStamp || locked.seal.stamp,
      zk: form.zk,
      provenance: form.provenance ?? [],
      sigilSvg: form.sigilSvg || "",
      verifyUrl: form.verifyUrl || "/",
    });

    // Render print root and make it visible only for the print pass
    renderIntoPrintRoot(root, banknote, String(locked.lockedPulse), proofPages);
    root.setAttribute("aria-hidden", "false");
    await afterTwoFrames();

    const title = makeFileTitle(
      form.kaiSignature || "",
      String(locked.lockedPulse),
      form.valuationStamp || locked.seal.stamp || ""
    );
  await printWithTempTitle(title);
root.setAttribute("aria-hidden", "true");

  }, [form, locked, livePremium, liveAlgString]);

  const onSavePng = useCallback(async () => {
    try {
      if (!lockedRef.current || !locked) {
        window.alert("Please Render to lock the valuation before saving PNG.");
        return;
      }

      const banknote = buildBanknoteSVG({
        ...form,
        valuePhi: form.valuePhi || fTiny(locked.valuePhi),
        premiumPhi: form.premiumPhi || fTiny(livePremium),
        computedPulse: String(locked.lockedPulse),
        nowPulse: String(locked.lockedPulse),
        kaiSignature: form.kaiSignature || "",
        userPhiKey: form.userPhiKey || "",
        valuationAlg: form.valuationAlg || liveAlgString,
        valuationStamp: form.valuationStamp || locked.seal.stamp,
        sigilSvg: form.sigilSvg || "",
        verifyUrl: form.verifyUrl || "/",
        provenance: form.provenance ?? [],
      });

      const png = await svgStringToPngBlob(banknote, 2400);
      const title = makeFileTitle(
        form.kaiSignature || "",
        String(locked.lockedPulse),
        form.valuationStamp || locked.seal.stamp || ""
      );
      triggerDownload(`${title}.png`, png, "image/png");
    } catch (err) {
      window.alert("Save PNG failed: " + (err instanceof Error ? err.message : String(err)));
      // eslint-disable-next-line no-console
      console.error(err);
    }
  }, [form, locked, livePremium, liveAlgString]);

  /* Derived display values */
  const displayPulse = locked ? locked.lockedPulse : nowFloor;
  const displayPhi = locked ? locked.valuePhi : liveValuePhi;
  const displayUsd = locked ? locked.valueUsdIndicative : valueUsdIndicative;
  const displayUsdPerPhi = locked ? locked.usdPerPhi : usdPerPhi;
  const displayPhiPerUsd = locked ? locked.phiPerUsd : phiPerUsd;
  const displayPremium = locked ? (form.premiumPhi ? Number(form.premiumPhi) : 0) : livePremium;
  const phiParts = formatPhiParts(displayPhi);

  /* UI */
  return (
    <div data-kk-scope={uid} className={`kk-note ${className ?? ""}`}>
      {/* Header */}
      <div className="kk-bar">
        <div className="kk-brand">
          <strong>KAIROS KURRENSY — Sovereign Harmonik Kingdom</strong>
        </div>
        <div className="kk-legal-pill">Issued under Yahuah’s Law of Eternal Light (Φ • Kai-Turah)</div>
      </div>

      {/* Pricing hero */}
      <section className={`kk-hero ${locked ? "is-locked" : "is-live"}`}>
        <div className="kk-status">
          <span className={`kk-chip ${locked ? "chip-locked" : "chip-live"}`}>{locked ? "LOCKED" : "LIVE"}</span>
          <span className="kk-chip kk-chip-pulse">pulse {displayPulse}</span>
          <span className="kk-chip">value: {fPhi(displayPhi)}</span>
          <span className="kk-chip">$ / φ: {fTiny(displayUsdPerPhi)}</span>
          <span className="kk-chip">φ / $: {fTiny(displayPhiPerUsd)}</span>
          <span className="kk-chip">premium φ: {fTiny(displayPremium)}</span>
        </div>

        <div className="kk-value-row">
          <div className="kk-value-block">
            <div className="kk-value-label">VALUE</div>
            <div className="kk-value">
              <span className="kk-value-sigil">Φ</span>
              <span className="kk-value-int">{phiParts.int}</span>
              <span className="kk-value-frac">{phiParts.frac}</span>
            </div>
            <div className="kk-value-usd">≈ {fUsd(displayUsd)}</div>
          </div>

          <div className="kk-cta">
            {!locked ? (
              <button
                className="kk-btn kk-btn-primary kk-btn-xl"
                onClick={handleRenderLock}
                title="Freeze current pulse and valuation"
                disabled={isRendering}
              >
                {isRendering ? "Rendering…" : "Render — Lock Valuation"}
              </button>
            ) : (
              <div className="kk-locked-banner" role="status" aria-live="polite">
                <div className="kk-locked-title">Valuation Locked</div>
                <div className="kk-locked-sub">
                  Pulse {locked.lockedPulse} • Hash: {form.valuationStamp || locked.seal.stamp || "—"}
                </div>
              </div>
            )}

            <div className="kk-cta-actions">
              <button className="kk-btn" onClick={onPrint} disabled={!locked} title="Print proof pages">
                Print / Save PDF
              </button>
              <button className="kk-btn kk-btn-ghost" onClick={onSavePng} disabled={!locked} title="Export note PNG">
                Save PNG
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Immutable title */}
      <div className="kk-row">
        <label>Title</label>
        <input value={NOTE_TITLE} disabled className="kk-out" />
      </div>

      {/* Printed metadata */}
      <div className="kk-grid">
        <div className="kk-stack">
          <div className="kk-row">
            <label>Purpose</label>
            <input
              value={form.purpose}
              onChange={(e) => u("purpose")(e.target.value)}
              placeholder="e.g., consideration for work / gift / exchange"
              disabled={!!locked}
            />
          </div>
          <div className="kk-row">
            <label>To</label>
            <input value={form.to} onChange={(e) => u("to")(e.target.value)} placeholder="Recipient" disabled={!!locked} />
          </div>
          <div className="kk-row">
            <label>From</label>
            <input value={form.from} onChange={(e) => u("from")(e.target.value)} placeholder="Issuer" disabled={!!locked} />
          </div>
        </div>

        <div className="kk-stack">
          <div className="kk-row">
            <label>Location</label>
            <input value={form.location} onChange={(e) => u("location")(e.target.value)} placeholder="(optional)" disabled={!!locked} />
          </div>
          <div className="kk-row">
            <label>Witnesses</label>
            <input value={form.witnesses} onChange={(e) => u("witnesses")(e.target.value)} placeholder="(optional)" disabled={!!locked} />
          </div>
          <div className="kk-row">
            <label>Reference</label>
            <input value={form.reference} onChange={(e) => u("reference")(e.target.value)} placeholder="(optional)" disabled={!!locked} />
          </div>
        </div>
      </div>

      <div className="kk-row">
        <label>Remark</label>
        <input
          value={form.remark}
          onChange={(e) => u("remark")(e.target.value)}
          placeholder="In Yahuah We Trust — Secured by Φ, not man-made law"
          disabled={!!locked}
        />
      </div>

      <details className="kk-stack" style={{ marginTop: 8 }} open>
        <summary>
          <strong>Identity &amp; Valuation</strong> <span className="kk-hint">— appears on the bill + proof pages</span>
        </summary>

        <div className="kk-grid" style={{ marginTop: 8 }}>
          <div className="kk-stack">
            <div className="kk-row">
              <label>Value Φ</label>
              <input value={fTiny(displayPhi)} readOnly />
            </div>
            <div className="kk-row">
              <label>Premium Φ</label>
              <input value={fTiny(displayPremium)} readOnly />
            </div>
            <div className="kk-row">
              <label>Valuation Alg</label>
              <input value={form.valuationAlg || liveAlgString} readOnly />
            </div>
            <div className="kk-row">
              <label>Valuation Stamp</label>
              <input value={locked ? form.valuationStamp || locked.seal.stamp || "—" : ""} readOnly />
            </div>
          </div>

          <div className="kk-stack">
            <div className="kk-row">
              <label>Pulse (locked)</label>
              <input value={locked ? String(locked.lockedPulse) : ""} readOnly placeholder="set on Render" />
            </div>
            <div className="kk-row">
              <label>Pulse (live)</label>
              <input value={String(nowFloor)} readOnly placeholder="live" />
            </div>
            <div className="kk-row">
              <label>kaiSignature</label>
              <input value={form.kaiSignature} onChange={(e) => u("kaiSignature")(e.target.value)} disabled={!!locked} />
            </div>
            <div className="kk-row">
              <label>userΦkey</label>
              <input value={form.userPhiKey} onChange={(e) => u("userPhiKey")(e.target.value)} disabled={!!locked} />
            </div>
            <div className="kk-row">
              <label>Σ (canonical)</label>
              <input value={form.sigmaCanon} onChange={(e) => u("sigmaCanon")(e.target.value)} disabled={!!locked} />
            </div>
            <div className="kk-row">
              <label>sha256(Σ)</label>
              <input value={form.shaHex} onChange={(e) => u("shaHex")(e.target.value)} disabled={!!locked} />
            </div>
            <div className="kk-row">
              <label>Φ (derived)</label>
              <input value={form.phiDerived} onChange={(e) => u("phiDerived")(e.target.value)} disabled={!!locked} />
            </div>
          </div>
        </div>

        <div className="kk-row">
          <label>Verify URL</label>
          <input
            value={form.verifyUrl}
            onChange={(e) => u("verifyUrl")(e.target.value)}
            placeholder="Used for QR & clickable sigil"
            disabled={!!locked}
          />
        </div>

        <div className="kk-row">
          <label>Sigil SVG (raw)</label>
          <textarea value={form.sigilSvg} onChange={(e) => u("sigilSvg")(e.target.value)} className="kk-out" disabled={!!locked} />
        </div>
      </details>

      {/* Preview + actions */}
      <div className="kk-row kk-actions">
        <div />
        <div className="kk-flex">
          {!locked && (
            <button className="kk-btn kk-btn-primary" onClick={handleRenderLock} disabled={isRendering}>
              {isRendering ? "Rendering…" : "Render — Lock Valuation"}
            </button>
          )}
          <button className="kk-btn" onClick={onPrint} disabled={!locked}>
            Print / Save PDF
          </button>
          <button className="kk-btn kk-btn-ghost" onClick={onSavePng} disabled={!locked}>
            Save PNG
          </button>
        </div>
        <div />
      </div>

      <div ref={previewHostRef} id="note-preview" className="kk-note-preview kk-out" />
      <div ref={printRootRef} id="print-root" aria-hidden="true" />
    </div>
  );
};

export default ExhaleNote;
