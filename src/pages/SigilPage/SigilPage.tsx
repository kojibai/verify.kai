// src/pages/SigilPage/SigilPage.tsx
/* eslint-disable no-empty -- benign lifecycle errors are silenced */
"use client";

import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  useDeferredValue,
  useLayoutEffect,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type SyntheticEvent,
} from "react";

import {useParams, useLocation, useNavigate } from "react-router-dom";
import html2canvas from "html2canvas";
import { createPortal } from "react-dom";
/* ——— Core components ——— */
import KaiSigil from "../../components/KaiSigil";
import "./SigilPage.css";
import SealMomentModal from "../../components/SealMomentModal";
import SigilHeader from "../../components/sigil/SigilHeader";
import SigilFrame from "../../components/sigil/SigilFrame";
import SigilMetaPanel from "../../components/sigil/SigilMetaPanel";
import SigilCTA from "../../components/sigil/SigilCTA";
import ProvenanceList from "../../components/sigil/ProvenanceList";
import SovereignControls from "../../components/sigil/SovereignControls";
import StargateOverlay from "../../components/sigil/StargateOverlay";
import OwnershipPanel from "../../components/sigil/OwnershipPanel";
import UpgradeSigilModal from "../../components/sigil/UpgradeSigilModal";
import SigilConflictBanner from "../../components/SigilConflictBanner";
import ValueHistoryModal from "../../components/ValueHistoryModal";
import { useValueHistory } from "../../hooks/useValueHistory";
/* ——— App-level Kai math ——— */
import {
  ETERNAL_STEPS_PER_BEAT as STEPS_PER_BEAT,
  stepIndexFromPulse,
  percentIntoStepFromPulse,
  beatIndexFromPulse,
} from "../../SovereignSolar";

import { kairosEpochNow, GENESIS_TS } from "../../utils/kai_pulse";

import { DEFAULT_ISSUANCE_POLICY, quotePhiForUsd } from "../../utils/phi-issuance";
import { usd as fmtUsd } from "../../components/valuation/display";
import type { SigilMetadataLite } from "../../utils/valuation";
/* pulses/breaths conversion (expiry math) */
import { stepsToPulses, breathsToPulses } from "../../utils/kaiMath";
import type { VerifyUIState } from "./types";
import { toMetaVerifyState } from "./types";

/* ——— Global utils ——— */
import {
  readProvenance,
  makeProvenanceEntry,
  type ProvenanceEntry,
} from "../../utils/provenance";
import { ensureLink, setJsonLd, setMeta } from "../../utils/domHead";
import { validateSvgForVerifier, putMetadata } from "../../utils/svgMeta";
import { decodeSigilHistory } from "../../utils/sigilUrl";

/* ——— Theme ——— */
import { CHAKRA_THEME, isIOS } from "../../components/sigil/theme";

/* ——— Hooks ——— */
import { useFastPress } from "../../hooks/useFastPress";
import { useSigilPayload } from "../../utils/useSigilPayload";

/** constants.ts */
import { DEFAULT_UPGRADE_BREATHS } from "./constants";

/** utils.ts */
import { currency, b64, signal, ensureHPrefixLocal } from "./utils";

/** verifierCanon.ts */
import {
  sha256HexCanon,
  derivePhiKeyFromSigCanon,
  verifierSigmaString,
  readIntentionSigil,
} from "./verifierCanon";

/** svgOps.ts */
import { ensureCanonicalMetadataFirst,} from "./svgOps";

/** styleInject.ts */
import { injectSigilPageStyles } from "./styleInject";

/** momentKeys.ts */
import { deriveMomentKeys } from "./momentKeys";

/** posterExport.tsx */
import { exportPosterPNG } from "./posterExport";

/** exportZip.ts */
import { exportZIP } from "./exportZip";

/** types.ts (local page-specific) */
import type {
  SigilTransferLite,
  ExpiryUnit,
  SigilMetaLoose,
  // We will extend this locally to guarantee compatibility
  ProvWithSteps as ImportedProvWithSteps,
} from "./types";

/** CENTRAL type to avoid cross-module mismatch */
import type { SigilPayload } from "../../types/sigil";

/** useValuation.ts (live value + drift + chip flash) */
import { useValuation } from "./useValuation";

/** ogImage.ts (effect to build OG image from the stage) */
import { runOgImageEffect } from "./ogImage";

/** linkShare.ts (share + upgrade helpers) */
import {
  shareTransferLink,
  beginUpgradeClaim,
  type ShareableSigilMeta,
} from "./linkShare";

/** ——— v46/v48 ledger/url helpers ——— */
import {
  decodeDebitsQS,
  encodeDebitsQS,
  writeDebitsStored,
  updateDebitsEverywhere,
  bestDebitsForCanonical,
  isDebitsStorageKeyForCanonical,
  tokenFromDebitsKey,
  DEBITS_CH,
  type DebitRecord,
  type DebitQS,
} from "../../utils/cryptoLedger";
import {
  canonicalFromUrl,
  ensureClaimTimeInUrl,
  currentCanonical as currentCanonicalUtil,
  currentToken as currentTokenUtil,
} from "../../utils/urlShort";
// registry.ts
import {
  buildClaim,
  requestRegistrySignature,
  appendAttestationToUrl,
  embedAttestationInSvg,
} from "./registry";

import { enableMobileDismissals } from "../../lib/mobilePopoverFix";

/* ——— v48: deterministic debit-cap + atomic send lock ——— */
const EPS = 1e-9;
const SEND_LOCK_CH = "sigil-sendlock-v1";
const sendLockKey = (canonical: string, token: string) =>
  `sigil:sendlock:${canonical}:t:${token}`;
const SEND_LOCK_TTL_MS = 15_000;
const SEND_LOCK_TTL_PULSES = Math.max(1, Math.ceil(SEND_LOCK_TTL_MS / 5_236)); // ~1 pulse per 5.236ms

type SendLockWire = {
  type: "lock" | "unlock";
  canonical: string;
  token: string;
  id: string;
  atPulse: number;
};

type SendLockRecord = { id: string; atPulse: number };


/** Local loose debit shape that's compatible with SigilPayload['debits'] and DebitRecord */
type DebitLoose = {
  amount: number;
  nonce: string;
  timestamp?: number;
  recipientPhiKey?: string;
};

const verifierVars: CSSVars = {
  "--phi-url": `url(${import.meta.env.BASE_URL}assets/phi.svg)`,
};
/** Absolute URL on current origin (safe for path-only inputs) */
const toAbsUrl = (pathOrUrl: string): string => {
  try {
    return new URL(pathOrUrl, window.location.origin).toString();
  } catch {
    return pathOrUrl;
  }
};

const acquireSendLock = (
  canonical: string | null,
  token: string | null,
  nowPulse: number
): { ok: boolean; id: string } => {
  const id = crypto.getRandomValues(new Uint32Array(4)).join("");
  if (!canonical || !token) return { ok: false, id };
  const key = sendLockKey(canonical.toLowerCase(), token);

  try {
    const raw = localStorage.getItem(key);
    const rec: SendLockRecord | null = raw ? (JSON.parse(raw) as SendLockRecord) : null;

    const stale =
      !rec ||
      !Number.isFinite(rec.atPulse) ||
      nowPulse - rec.atPulse > SEND_LOCK_TTL_PULSES;

    if (!rec || stale) {
      localStorage.setItem(
        key,
        JSON.stringify({ id, atPulse: nowPulse } satisfies SendLockRecord)
      );
      try {
        const bc = new BroadcastChannel(SEND_LOCK_CH);
        const msg: SendLockWire = {
          type: "lock",
          canonical: canonical.toLowerCase(),
          token,
          id,
          atPulse: nowPulse,
        };
        bc.postMessage(msg);
        bc.close();
      } catch {}
      return { ok: true, id };
    }
  } catch {}

  return { ok: false, id };
};



const releaseSendLock = (
  canonical: string | null,
  token: string | null,
  id: string,
  nowPulse: number
): void => {
  if (!canonical || !token) return;
  const key = sendLockKey(canonical.toLowerCase(), token);

  try {
    const raw = localStorage.getItem(key);
    const rec: SendLockRecord | null = raw ? (JSON.parse(raw) as SendLockRecord) : null;
    if (!rec || rec.id === id) {
      localStorage.removeItem(key);
      try {
        const bc = new BroadcastChannel(SEND_LOCK_CH);
        const msg: SendLockWire = {
          type: "unlock",
          canonical: canonical.toLowerCase(),
          token,
          id,
          atPulse: nowPulse,
        };
        bc.postMessage(msg);
        bc.close();
      } catch {}
    }
  } catch {}
};


const isValidDebit = (d: unknown): d is DebitLoose => {
  if (!d || typeof d !== "object") return false;
  const o = d as Record<string, unknown>;
  return (
    typeof o.amount === "number" &&
    Number.isFinite(o.amount) &&
    o.amount > 0 &&
    typeof o.nonce === "string" &&
    o.nonce.length > 0 &&
    typeof o.timestamp === "number" &&
    Number.isFinite(o.timestamp) &&
    (typeof o.recipientPhiKey === "string" || typeof o.recipientPhiKey === "undefined")
  );
};

const sumDebits = (list: ReadonlyArray<DebitLoose> | undefined): number => {
  if (!Array.isArray(list)) return 0;
  let s = 0;
  for (const d of list) if (isValidDebit(d)) s += d.amount;
  return s;
};

const sortDebitsStable = (list: ReadonlyArray<DebitLoose>): DebitLoose[] => {
  // Primary: timestamp asc; Secondary: nonce lex asc for determinism
  return [...list].sort((a, b) => {
    const t = (a.timestamp || 0) - (b.timestamp || 0);
    return t !== 0 ? t : a.nonce.localeCompare(b.nonce);
  });
};

const dedupeByNonce = (list: ReadonlyArray<DebitLoose>): DebitLoose[] => {
  const seen = new Set<string>();
  const out: DebitLoose[] = [];
  for (const d of list) {
    if (!isValidDebit(d)) continue;
    if (seen.has(d.nonce)) continue;
    seen.add(d.nonce);
    out.push(d);
  }
  return out;
};

const capDebitsQS = (qs: DebitQS): DebitQS => {
  const orig =
    typeof qs.originalAmount === "number" && Number.isFinite(qs.originalAmount)
      ? qs.originalAmount
      : Number.NaN;

  // Input may be DebitRecord[], treat as DebitLoose[] for local ops (structurally compatible)
  const rawList =
    Array.isArray(qs.debits) ? (dedupeByNonce(qs.debits as DebitLoose[]) as DebitLoose[]) : [];
  const list = sortDebitsStable(rawList);

  if (!Number.isFinite(orig)) {
    return {
      originalAmount: qs.originalAmount,
      debits: list.length ? (list as unknown as DebitRecord[]) : undefined,
    };
  }

  const kept: DebitLoose[] = [];
  let acc = 0;
  for (const d of list) {
    if (!isValidDebit(d)) continue;
    if (acc + d.amount <= orig + EPS) {
      kept.push(d);
      acc += d.amount;
    } else {
      // deterministically prune overage; drop
    }
  }

  return {
    originalAmount: orig,
    debits: kept.length ? (kept as unknown as DebitRecord[]) : undefined,
  };
};
// ──────────────────────────────────────────────────────────────────────────────
// Kai NOW (deterministic) — SINGLE SOURCE OF TRUTH (NO Chronos sampling)
//   - NOW micro-pulses come ONLY from kairosEpochNow() in kai_pulse.ts
//   - All conversions use exact integer Kai-day math (no float accumulation)
// ──────────────────────────────────────────────────────────────────────────────

const MICRO_PER_PULSE = 1_000_000n;

/**
 * Kai-Klok canon:
 * - Day length = 25:25:36 = 91,536 seconds = 91,536,000 ms (exact integer)
 * - Pulses/day = 17,491.270421 (exact, millionths)
 * - Therefore μpulses/day = 17,491,270,421 (integer)
 */
const KAI_DAY_MS = 91_536_000n;
const MICRO_PULSES_PER_DAY = 17_491_270_421n;

const absBig = (n: bigint): bigint => (n < 0n ? -n : n);

/** Banker’s rounding (ties-to-even) for non-negative numerators */
const divRoundTiesToEvenPos = (num: bigint, den: bigint): bigint => {
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice < den) return q;
  if (twice > den) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
};

/** Banker’s rounding (ties-to-even) supporting signed numerators */
const divRoundTiesToEven = (num: bigint, den: bigint): bigint => {
  if (den <= 0n) throw new Error("divRoundTiesToEven: den must be > 0");
  if (num === 0n) return 0n;
  const sign = num < 0n ? -1n : 1n;
  const q = divRoundTiesToEvenPos(absBig(num), den);
  return sign * q;
};

/** Convert Δμpulses -> Δms (deterministic; integer exact) */
const microPulsesDeltaToMs = (deltaMicro: bigint): bigint =>
  divRoundTiesToEven(deltaMicro * KAI_DAY_MS, MICRO_PULSES_PER_DAY);

/** Convert μpulses since GENESIS -> Unix ms (deterministic; integer exact) */
const microPulsesToUnixMs = (microSinceGenesis: bigint): bigint => {
  const deltaMs = microPulsesDeltaToMs(microSinceGenesis);
  return BigInt(GENESIS_TS) + deltaMs;
};

/** Convert Unix ms -> μpulses since GENESIS (deterministic; integer exact) */
const unixMsToMicroPulses = (unixMs: bigint): bigint => {
  const deltaMs = unixMs - BigInt(GENESIS_TS);
  return divRoundTiesToEven(deltaMs * MICRO_PULSES_PER_DAY, KAI_DAY_MS);
};

/** ✅ NOW pulse (integer) derived ONLY from kairosEpochNow() */
const kaiNowPulseInt = (): number => {
  const micro = kairosEpochNow(); // μpulses since GENESIS (seeded + monotonic)
  return Number(micro / MICRO_PER_PULSE);
};

/** ✅ NOW epoch-ms (deterministic) derived ONLY from kairosEpochNow() */
const kaiNowEpochMs = (): number => {
  const ms = microPulsesToUnixMs(kairosEpochNow());
  return Number(ms); // safe (modern epoch ms range)
};

/**
 * ✅ Bridge Date -> Kai pulse int (ONLY for functions that demand Date signatures).
 * No Date.now usage here; we only read the provided Date.
 */
const getKaiPulseEternalInt = (d: Date): number => {
  const micro = unixMsToMicroPulses(BigInt(d.getTime()));
  return Number(micro / MICRO_PER_PULSE);
};

/**
 * Local deterministic ticker:
 * - Reads kairosEpochNow()
 * - Computes ms to next pulse boundary using exact Kai-day ratio
 * - Schedules with setTimeout (timer is not a data source, only a wake-up)
 */
function useKaiTickerDeterministic(): { pulse: number; msToNextPulse: number } {
  const [pulse, setPulse] = useState<number>(() => kaiNowPulseInt());
  const [msToNextPulse, setMsToNextPulse] = useState<number>(0);

  useEffect(() => {
    let alive = true;
    let t: number | null = null;

    const tick = () => {
      if (!alive) return;

      const micro = kairosEpochNow();
      const p = Number(micro / MICRO_PER_PULSE);

      // Next integer pulse boundary in μpulses
      const rem = micro % MICRO_PER_PULSE;
      const toNextMicro = rem === 0n ? MICRO_PER_PULSE : (MICRO_PER_PULSE - rem);
      const deltaMs = microPulsesDeltaToMs(toNextMicro);

      const nextMs = Number(deltaMs);
      setPulse(p);
      setMsToNextPulse(nextMs);

      // Wake up slightly after boundary; clamp for safety
      const wait = Math.max(1, Math.min(60_000, nextMs));
      t = window.setTimeout(tick, wait);
    };

    tick();
    return () => {
      alive = false;
      if (t != null) window.clearTimeout(t);
    };
  }, []);

  return { pulse, msToNextPulse };
}

// Allow CSS custom properties in style objects (no React namespace needed)
type CSSVars = CSSProperties & Record<`--${string}`, string | number>;



/* ——— Local CSS var typing for the phi.svg mask ——— */
/* Narrower unit guard (no 'any') */
const isExpiryUnit = (u: unknown): u is ExpiryUnit => u === "breaths" || u === "steps";

/* ——— Helper: central strict attachment type ——— */
type StrictAttachment = NonNullable<SigilPayload["attachment"]>;

/* ——— Ensure provenance-with-steps structurally extends ProvenanceEntry ——— */
type ProvWithSteps = (ImportedProvWithSteps extends ProvenanceEntry
  ? ImportedProvWithSteps
  : ProvenanceEntry) & {
  stepIndex: number;
  atStepIndex: number;
};

/* ——— Lineage model (propagates via ?p=; balances remain parent-only) ——— */
type LineageNode = {
  token: string;
  parentToken: string | null;
  amount: number;
  timestamp: number;
  depth: number;
  senderPhiKey?: string | null;
};
type PayloadWithLineage = SigilPayload & { lineage?: LineageNode[] };

/* ——— Optional local “descendants minted from THIS link” (UI only) ——— */
type DescendantLocal = {
  token: string;
  parentToken: string | null;
  amount: number;
  timestamp: number;
  depth: number;
  recipientPhiKey?: string | null;
};

const DESC_CH = "sigil-lineage-v1";
const descendantsKey = (canonical: string, token: string | null) =>
  token ? `sigil:desc:${canonical}:t:${token}` : `sigil:desc:${canonical}`;

/* ——— Rotation bus ——— */
const ROTATE_CH = "sigil-xfer-v1";
const rotationKey = (h: string) => `sigil:rotated:${h}`;
type RotationMsg = { type: "rotated"; canonical: string; token: string };

const publishRotation = (keys: string[], token: string) => {
  const uniq = Array.from(new Set(keys.map((k) => k.toLowerCase()).filter(Boolean)));
  uniq.forEach((canonical) => {
    try {
     localStorage.setItem(rotationKey(canonical), `${token}@${kaiNowEpochMs()}`);
    } catch {}
    try {
      const bc = new BroadcastChannel(ROTATE_CH);
      bc.postMessage({ type: "rotated", canonical, token } as RotationMsg);
      bc.close();
    } catch {}
    try {
      window.dispatchEvent(
        new CustomEvent("sigil:transfer-rotated", { detail: { canonical, token } })
      );
    } catch {}
  });
};

/* ——— helpers ——— */
function readDescendantsStored(canonical?: string | null, token?: string | null) {
  const c = (canonical || "").toLowerCase();
  if (!c || !token) return [] as DescendantLocal[];
  try {
    const raw = localStorage.getItem(descendantsKey(c, token));
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr as DescendantLocal[]) : [];
  } catch {
    return [];
  }
}
function writeDescendantsStored(
  canonical?: string | null,
  token?: string | null,
  list?: DescendantLocal[]
) {
  const c = (canonical || "").toLowerCase();
  if (!c || !token) return;
  try {
    localStorage.setItem(descendantsKey(c, token), JSON.stringify(list || []));
  } catch {}
}
type DescendantsMsg = {
  type: "descendants";
  canonical: string;
  token: string;
  list: DescendantLocal[];
  stamp: number;
};
function broadcastDescendants(canonical: string, token: string, list: DescendantLocal[]) {
  try {
    const bc = new BroadcastChannel(DESC_CH);
    const msg: DescendantsMsg = {
      type: "descendants",
      canonical: canonical.toLowerCase(),
      token,
      list,
      stamp: kaiNowEpochMs(),
    };
    bc.postMessage(msg);
    bc.close();
  } catch {}
}

/* ——— Page ——— */
export default function SigilPage() {
  const { hash } = useParams<{ hash: string }>();
  const routerLoc = useLocation();
  const navigate = useNavigate();
  const routeHash = (hash ?? "").toLowerCase();

  const urlQs = useMemo(() => new URLSearchParams(routerLoc.search), [routerLoc.search]);
  const transferToken = urlQs.get("t");

  const [verified, setVerified] = useState<VerifyUIState>("checking");
  const [glyphAuth, setGlyphAuth] = useState<"checking" | "authentic" | "forged">("checking");
  const [ownershipVerified, setOwnershipVerified] = useState<boolean>(false);
  const [ownershipMsg, setOwnershipMsg] = useState<string>("Awaiting Proof Of Breath™");
  const [toast, setToast] = useState<string>("");

  const [sigilSize, setSigilSize] = useState<number>(320);
  const frameRef = useRef<HTMLDivElement>(null!);

  // v46: hydrate payload via hook
  const { payload: payloadState, setPayload, loading, setLoading } = useSigilPayload(
    routerLoc.search
  );
  void setLoading;
  const payload = payloadState;

const { pulse: currentPulse, msToNextPulse } = useKaiTickerDeterministic();
  

  // Sovereign additions
  const [uploadedMeta, setUploadedMeta] = useState<SigilMetaLoose | null>(null);
  const [attachment, setAttachment] = useState<StrictAttachment | null>(null);
  const [exporting, setExporting] = useState<boolean>(false);
  const [newOwner, setNewOwner] = useState<string>("");
  const [newKaiSig, setNewKaiSig] = useState<string>("");
  const [expiryUnit, setExpiryUnit] = useState<ExpiryUnit>("breaths");
  const [expiryAmount, setExpiryAmount] = useState<number>(44);
  const [localHash, setLocalHash] = useState<string>("");

  // v48: send in-flight boolean and last lock id
  const [sendInFlight, setSendInFlight] = useState<boolean>(false);
  const sendLockIdRef = useRef<string>("");

  // Upgrade modal state + one-time lock
  const upgradeLockKey = useMemo(
    () => (routeHash ? `sigil:legacy-upgraded:${routeHash}` : ""),
    [routeHash]
  );
  const [upgradeOpen, setUpgradeOpen] = useState<boolean>(false);
  const [upgradedOnce, setUpgradedOnce] = useState<boolean>(false);
  useEffect(() => {
    if (!upgradeLockKey) return;
    try {
      const v = localStorage.getItem(upgradeLockKey);
      setUpgradedOnce(v === "1");
    } catch {}
  }, [upgradeLockKey]);
  const markLegacyUpgraded = useCallback(() => {
    if (!upgradeLockKey) return;
    try {
      localStorage.setItem(upgradeLockKey, "1");
    } catch {}
    setUpgradedOnce(true);
    signal(setToast, "Upgraded — legacy link locked");
  }, [upgradeLockKey]);

  // SealMoment modal
  const [sealOpen, setSealOpen] = useState(false);
  const [sealUrl, setSealUrl] = useState<string>("");
  const [sealHash, setSealHash] = useState<string>("");

  // Link status
  const [linkStatus, setLinkStatus] = useState<"checking" | "active" | "archived">("checking");

  // Rotation awareness
  const [rotatedToken, setRotatedToken] = useState<string | null>(null);
  useEffect(() => {
    const keys = Array.from(
      new Set(
        [payload?.canonicalHash, routeHash, localHash]
          .filter(Boolean)
          .map((s) => (s as string).toLowerCase())
      )
    );
    if (keys.length === 0) return;

    

    const refreshFromLS = () => {
      let tok: string | null = null;
      try {
        for (const k of keys) {
          const raw = localStorage.getItem(rotationKey(k));
          const val = raw ? String(raw).split("@")[0] : null;
          if (val) {
            tok = val;
            break;
          }
        }
      } catch {}
      setRotatedToken(tok);
    };
    refreshFromLS();

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(ROTATE_CH);
      bc.onmessage = (ev: MessageEvent<RotationMsg>) => {
        const m = ev.data;
        if (m?.type === "rotated") {
          const kn = (m.canonical || "").toLowerCase();
          if (keys.includes(kn)) setRotatedToken(m.token || null);
        }
      };
    } catch {}

    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      for (const k of keys) {
        if (e.key === rotationKey(k)) {
          refreshFromLS();
          break;
        }
      }
    };
    window.addEventListener("storage", onStorage, { passive: true });

    return () => {
      window.removeEventListener("storage", onStorage);
      if (bc && typeof bc.close === "function") {
        try {
          bc.close();
        } catch {}
      }
    };
  }, [payload?.canonicalHash, routeHash, localHash]);
  const signAndAttach = useCallback(
    async (
      meta: SigilPayload,
      canonical: string,
      token: string,
      baseUrl: string,
      svgEl?: SVGSVGElement | null
    ): Promise<string> => {
      try {
        const claim = buildClaim(meta, canonical, token);
        const signed = await requestRegistrySignature(claim);
        if (!signed) return baseUrl;
  
        const u = new URL(baseUrl, window.location.origin);
        appendAttestationToUrl(u, signed.r, signed.s, signed.kid);
  
        // optionally embed into the visible SVG as well
        if (svgEl) embedAttestationInSvg(svgEl, claim, signed.s, signed.kid);
  
        return u.toString();

      } catch {
        return baseUrl;
      }
    },
    []
  );
  // v48: listen for send-lock updates (purely for responsiveness; we still check LS)
  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(SEND_LOCK_CH);
      bc.onmessage = () => {
        // no-op: localStorage remains source of truth; UI reactivity is already sufficient
      };
    } catch {}
    return () => {
      if (bc && typeof bc.close === "function") {
        try {
          bc.close();
        } catch {}
      }
    };
  }, []);
// Mobile popover dismiss helpers (iOS swipe/backdrop quirks)
// current
useEffect(() => {
  const api = enableMobileDismissals();
  return () => {
    api.destroy?.();
    api.teardown?.();
    api.disable?.();
  };
}, []);



  const [suppressAuthUntil, setSuppressAuthUntil] = useState<number>(0);
  const [historyOpen, setHistoryOpen] = useState(false);


  // Legacy detection
  const [legacyInfo, setLegacyInfo] = useState<null | { reason: string; matchedHash: string }>(
    null
  );

  const expectedCanonCandidates = useMemo(() => {
    const vals = [
      payload?.canonicalHash,
      localHash,
      (uploadedMeta?.canonicalHash as string | undefined),
      legacyInfo?.matchedHash,
    ]
      .filter(Boolean)
      .map((s) => (s as string).toLowerCase());
    return Array.from(new Set(vals));
  }, [payload?.canonicalHash, localHash, uploadedMeta?.canonicalHash, legacyInfo]);

  useLayoutEffect(() => {
    injectSigilPageStyles();
  }, []);

  useEffect(() => {
    const day = (payload?.chakraDay ?? "Throat") as keyof typeof CHAKRA_THEME;
    const theme = CHAKRA_THEME[day] ?? { hue: 180, accent: "#00FFD0" };
    const root = document.querySelector(".sigilpage") as HTMLElement | null;
    if (root) {
      root.style.setProperty("--crystal-hue", String(theme.hue));
      root.style.setProperty("--crystal-accent", theme.accent);
    }
  }, [payload?.chakraDay]);

  // History (&h=)
  const [historyLite, setHistoryLite] = useState<SigilTransferLite[] | null>(null);

  // Live valuation
  const { valSeal, livePrice, priceFlash } = useValuation({
    payload,
    urlSearchParams: urlQs,
    currentPulse,
    routeHash,
  });

const histKey = urlQs.get("h") ?? "";
useEffect(() => {
  if (!histKey) {
    setHistoryLite((prev) => (prev === null ? prev : null));
    return;
  }
  try {
    const next = decodeSigilHistory(ensureHPrefixLocal(histKey.trim()));
    setHistoryLite((prev) => {
      // avoid churn on equal arrays
      const same =
        Array.isArray(prev) &&
        Array.isArray(next) &&
        prev.length === next.length &&
        prev.every((v, i) => v === next[i]);
      return same ? prev : next;
    });
  } catch {
    setHistoryLite((prev) => (prev === null ? prev : null));
  }
}, [histKey]);


  const sameMoment = useCallback((a: SigilPayload, b: SigilPayload) => {
    const stepsA: number = (a.stepsPerBeat ?? STEPS_PER_BEAT) as number;
    const stepsB: number = (b.stepsPerBeat ?? STEPS_PER_BEAT) as number;
    const idxA = stepIndexFromPulse(a.pulse, stepsA);
    const idxB = stepIndexFromPulse(b.pulse, stepsB);
    return (
      a.pulse === b.pulse &&
      a.beat === b.beat &&
      idxA === idxB &&
      a.chakraDay === b.chakraDay
    );
  }, []);

  /* ABS URL */
  const absUrl = useMemo(() => {
    if (typeof window !== "undefined") return new URL(window.location.href).toString();
    const base = `/s/${encodeURIComponent(hash ?? "")}`;
    const s = routerLoc.search || "";
    const h2 = routerLoc.hash || "";
    return `${base}${s}${h2}`;
  }, [hash, routerLoc.search, routerLoc.hash]);

  const shortHash = useMemo(() => (hash ? hash.slice(0, 16) : "—"), [hash]);

  const copy = useCallback(async (txt: string, label = "Copied") => {
    try {
      await navigator.clipboard.writeText(txt);
      signal(setToast, label);
      return true;
    } catch {
      signal(setToast, "Copy failed");
      return false;
    }
  }, []);

  const share = useCallback(async () => {
    try {
      const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
      if (typeof nav?.share === "function") {
        await nav.share({
          title: "Kairos Sigil-glyph",
          text: "Sealed Kairos Moment",
          url: absUrl,
        });
        signal(setToast, "Share sheet opened");
      } else {
        await copy(absUrl, "Link copied");
      }
    } catch {}
  }, [absUrl, copy]);

useEffect(() => {
  const now = kaiNowEpochMs();
  const route = (routeHash || "").toLowerCase();

 if (suppressAuthUntil > now) return;
  if (!route) return;
  if (expectedCanonCandidates.length === 0) return;

  const ok = expectedCanonCandidates.includes(route);

  let nextGlyph: typeof glyphAuth = glyphAuth;
  let nextVerified: typeof verified = verified;

  if (!ok && localHash && route !== localHash && !legacyInfo) {
    // keep deep-check result for `verified`, but glyph is authentic
    nextGlyph = "authentic";
  } else if (!ok && (legacyInfo || linkStatus === "archived")) {
    nextGlyph = "authentic";
  } else {
    nextGlyph = ok ? "authentic" : "forged";
    if (verified !== "verified") {
      nextVerified = ok ? "ok" : "mismatch";
    }
  }

  if (nextGlyph !== glyphAuth) setGlyphAuth(nextGlyph);
  if (nextVerified !== verified) setVerified(nextVerified);
}, [expectedCanonCandidates, routeHash, linkStatus, suppressAuthUntil, legacyInfo, localHash, glyphAuth, verified]);

  /* SEO / Sharing text */
  const [ogImgUrl, setOgImgUrl] = useState<string | null>(null);
  const deferredPayload = useDeferredValue(payload);

  const seoStrings = useMemo(() => {
    const stepsNum: number = (deferredPayload?.stepsPerBeat ?? STEPS_PER_BEAT) as number;
    const stepIdx = deferredPayload ? stepIndexFromPulse(deferredPayload.pulse, stepsNum) : 0;
    const chakra = (deferredPayload?.chakraDay ?? "Throat") as SigilPayload["chakraDay"];
    const ownerShort = (deferredPayload?.userPhiKey ?? "").slice(0, 12);
    const pulseStr = (deferredPayload?.pulse ?? 0).toLocaleString();
    const t = `Kai Sigil — ${hash ? hash.slice(0, 16) : "—"}`;
    const d = deferredPayload
      ? `Sealed Sigil-Glyph • Pulse ${pulseStr} • Beat ${deferredPayload.beat}/36 • Step ${
          stepIdx + 1
        }/${stepsNum} • ${chakra}${ownerShort ? ` • Owner ${ownerShort}…` : ""}.`
      : `Sealed Sigil-Glyph`;
    return { title: t, desc: d };
  }, [deferredPayload, hash]);
const { series } = useValueHistory();
  /* Basic meta + JSON-LD */
  useEffect(() => {
    const abs = absUrl;

    document.title = seoStrings.title;
    const canonical = ensureLink("canonical");
    canonical.href = abs;

    const chakra = (payload?.chakraDay ?? "Throat") as SigilPayload["chakraDay"];
    const accent = CHAKRA_THEME[chakra as keyof typeof CHAKRA_THEME]?.accent || "#00FFD0";
    setMeta("name", "theme-color", accent);

    setMeta("property", "og:title", seoStrings.title);
    setMeta("property", "og:description", seoStrings.desc);
    setMeta("property", "og:type", "website");
    setMeta("property", "og:url", abs);
    setMeta("name", "twitter:card", "summary_large_image");
    setMeta("name", "twitter:title", seoStrings.title);
    setMeta("name", "twitter:description", seoStrings.desc);
    setMeta("property", "og:site_name", "Kairos Harmonik Kingdom");

    const stepsNum: number = (payload?.stepsPerBeat ?? STEPS_PER_BEAT) as number;
    const stepIdx = payload ? stepIndexFromPulse(payload.pulse, stepsNum) : 0;
    const withLineage = payload as PayloadWithLineage | null;

    const pExtras = (payload ?? {}) as Partial<{
      claimExtendUnit?: SigilPayload["claimExtendUnit"] | null;
      claimExtendAmount?: number | null;
    }>;

    const jsonld: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "VisualArtwork",
      name: seoStrings.title,
      description: seoStrings.desc,
      url: abs,
      image: ogImgUrl || undefined,
      genre: "Sigil-Glyph",
      identifier: [
        { "@type": "PropertyValue", name: "pulse", value: payload?.pulse ?? null },
        { "@type": "PropertyValue", name: "beat", value: payload?.beat ?? null },
        { "@type": "PropertyValue", name: "stepIndex", value: stepIdx },
        { "@type": "PropertyValue", name: "stepsPerBeat", value: stepsNum },
        { "@type": "PropertyValue", name: "chakraDay", value: payload?.chakraDay ?? null },
        { "@type": "PropertyValue", name: "userPhiKey", value: payload?.userPhiKey ?? null },
        { "@type": "PropertyValue", name: "kaiSignature", value: payload?.kaiSignature ?? null },
        {
          "@type": "PropertyValue",
          name: "canonicalHash",
          value: (payload?.canonicalHash ?? localHash) || null,
        },
        { "@type": "PropertyValue", name: "expiresAtPulse", value: payload?.expiresAtPulse ?? null },
        {
          "@type": "PropertyValue",
          name: "transferNonce",
          value: new URLSearchParams(location.search).get("t") ?? payload?.transferNonce ?? null,
        },
        {
          "@type": "PropertyValue",
          name: "claimExtendUnit",
          value: isExpiryUnit(pExtras.claimExtendUnit) ? pExtras.claimExtendUnit : null,
        },
        {
          "@type": "PropertyValue",
          name: "claimExtendAmount",
          value: pExtras.claimExtendAmount ?? null,
        },
        { "@type": "PropertyValue", name: "historyLiteCount", value: historyLite?.length ?? 0 },
      ].filter((x: { value?: unknown }) => x.value != null),
    };

    if (withLineage?.lineage?.length) {
      (jsonld.identifier as Array<Record<string, unknown>>).push({
        "@type": "PropertyValue",
        name: "lineageDepth",
        value: withLineage.lineage.length,
      });
    }

    setJsonLd("sigil-jsonld", jsonld);
  }, [absUrl, seoStrings.title, seoStrings.desc, payload, ogImgUrl, localHash, historyLite?.length]);

  /* Build OG image */
  useEffect(() => {
    const stop = runOgImageEffect({
      stageId: "sigil-stage",
      payload: payload ? { ...payload } : null,
      localHash,
      setOgImgUrl,
      setMeta,
      seoTitle: seoStrings.title,
      seoDesc: seoStrings.desc,
    });
    return stop;
  }, [payload, localHash, sigilSize, seoStrings.title, seoStrings.desc]);

  /* allow page scroll */
  useLayoutEffect(() => {
    document.documentElement.classList.add("sigil-scroll");
    return () => document.documentElement.classList.remove("sigil-scroll");
  }, []);

  /* responsive size */
  useEffect(() => {
    let raf = 0;
    const compute = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const verticalReserve =
          vw < 640 ? Math.max(220, Math.min(360, vh * 0.48)) : Math.max(160, Math.min(320, vh * 0.35));
        const maxByViewport = Math.max(160, Math.min(640, Math.min(vw, vh - verticalReserve)));
        const frameW = frameRef.current?.clientWidth ?? vw;
        const maxByFrame = Math.max(160, Math.min(640, frameW - 24));
        const size = Math.round(Math.min(maxByViewport, maxByFrame));
        setSigilSize(size);
      });
    };
    const node = frameRef.current ?? document.body;
    const ro = new ResizeObserver(() => compute());
    ro.observe(node);
    window.addEventListener("resize", compute, { passive: true });
    compute();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", compute);
      cancelAnimationFrame(raf);
    };
  }, []);

  /* Load payload from ?p= — handled by useSigilPayload; keep status semantics */
  useEffect(() => {
    if (!loading) {
      if (!payload) {
        setVerified(prev => (prev === "verified" ? "verified" : (routeHash ? "notfound" : "checking")));
        setGlyphAuth(prev => (prev === "authentic" ? "authentic" : (routeHash ? "forged" : "checking")));
      }
    } else {
      setVerified(prev => (prev === "verified" ? "verified" : "checking"));
      setGlyphAuth(prev => (prev === "authentic" ? "authentic" : "checking"));
      setOwnershipVerified(false);
      setOwnershipMsg("Awaiting Verifikation");
    }
  }, [loading, payload, routeHash]);
  

  /* Hydrate debits from &d= — v48: cap/prune on ingest */
  type SigilPayloadWithDebits = SigilPayload & {
    originalAmount?: number;
    debits?: DebitLoose[];
    totalDebited?: number;
  };

  const debitsSignature = (list?: DebitLoose[]): string => {
    if (!Array.isArray(list)) return "";
    return [...list]
      .map((d) => ({
        nonce: d.nonce,
        amount: Number.isFinite(d.amount) ? Number(d.amount) : 0,
        recipient: d.recipientPhiKey ?? "",
        ts: d.timestamp ?? "",
      }))
      .sort((a, b) => a.nonce.localeCompare(b.nonce))
      .map((d) => `${d.nonce}:${d.amount}:${d.recipient}:${d.ts}`)
      .join("|");
  };
  useEffect(() => {
    const dParam = urlQs.get("d");
    const raw = decodeDebitsQS(dParam);
    if (!raw) return;

    const h = currentCanonicalUtil(payload ?? null, localHash, legacyInfo);
    const tok = currentTokenUtil(transferToken, payload ?? null);

    const pruned = capDebitsQS(raw);

    if (h) writeDebitsStored(h, pruned, tok);

    const nextOrig = typeof pruned.originalAmount === "number" ? pruned.originalAmount : undefined;
    const nextDebits = Array.isArray(pruned.debits)
      ? (pruned.debits as unknown as DebitLoose[])
      : undefined;

    setPayload((prev) => {
      if (!prev) return prev;
      const prevWithDebits = prev as SigilPayloadWithDebits;

      const sameOrig = (prevWithDebits.originalAmount ?? undefined) === nextOrig;
      const sameDebits = debitsSignature(prevWithDebits.debits) === debitsSignature(nextDebits);
      if (sameOrig && sameDebits) return prev;

      const nextPayload: SigilPayloadWithDebits = { ...(prev as SigilPayload) };
      if (nextOrig !== undefined) nextPayload.originalAmount = nextOrig;
      if (nextDebits) {
        nextPayload.debits = nextDebits;
        nextPayload.totalDebited = sumDebits(nextDebits);
      }
      return nextPayload as SigilPayload;
    });
  }, [urlQs, payload, localHash, legacyInfo, transferToken, setPayload]);

  /* Local flag for stale link */
  const [oldLinkDetected, setOldLinkDetected] = useState<boolean>(false);

  /* Reconcile URL/store (missing/stale ?d=) — v48: cap/prune before writing */
  useEffect(() => {
    const h = currentCanonicalUtil(payload ?? null, localHash, legacyInfo);
    if (!h) return;
    const tok = currentTokenUtil(transferToken, payload ?? null);

    const { merged, urlIsStale } = bestDebitsForCanonical(h, urlQs, tok);
    const pruned = capDebitsQS(merged);

    if (urlIsStale) setOldLinkDetected(true);

    updateDebitsEverywhere(pruned, h, tok, { broadcast: false, navigate: urlIsStale });

    const nextOrig = typeof pruned.originalAmount === "number" ? pruned.originalAmount : undefined;
    const nextDebits = Array.isArray(pruned.debits)
      ? (pruned.debits as unknown as DebitLoose[])
      : undefined;

    setPayload((prev) => {
      if (!prev) return prev;
      const prevWithDebits = prev as SigilPayloadWithDebits;

      const sameOrig = (prevWithDebits.originalAmount ?? undefined) === nextOrig;
      const sameDebits = debitsSignature(prevWithDebits.debits) === debitsSignature(nextDebits);
      if (sameOrig && sameDebits) return prev;

      const nextPayload: SigilPayloadWithDebits = { ...(prev as SigilPayload) };
      if (nextOrig !== undefined) nextPayload.originalAmount = nextOrig;
      if (nextDebits) {
        nextPayload.debits = nextDebits;
        nextPayload.totalDebited = sumDebits(nextDebits);
      }
      return nextPayload as SigilPayload;
    });
  }, [payload?.canonicalHash, localHash, legacyInfo, urlQs, transferToken, setPayload]);

  /* Canonicalize route to canonical hash when active */
  useEffect(() => {
    if (!payload?.canonicalHash) return;
    const canon = payload.canonicalHash.toLowerCase();
    if (routeHash && canon && canon !== routeHash && linkStatus === "active" && !legacyInfo) {
      const u = new URL(window.location.href);
      u.pathname = `/s/${canon}`;
      navigate(`${u.pathname}${u.search}${u.hash}`, { replace: true });
    }
  }, [payload?.canonicalHash, routeHash, linkStatus, legacyInfo, navigate]);

  /* Canonicalize to computed localHash when payload has no canonical yet (fresh glyph) */
  useEffect(() => {
    if (
      payload &&
      !payload.canonicalHash &&
      localHash &&
      routeHash &&
      localHash !== routeHash &&
      linkStatus === "active" &&
      !legacyInfo
    ) {
      const u = new URL(window.location.href);
      u.pathname = `/s/${localHash}`;
      navigate(`${u.pathname}${u.search}${u.hash}`, { replace: true });
    }
  }, [payload?.canonicalHash, localHash, routeHash, linkStatus, legacyInfo, navigate]);

  /* Cross-tab debit sync — v48: cap/prune merges */
  useEffect(() => {
    const candidates = expectedCanonCandidates;
    if (!candidates.length) return;

    const activeTok = currentTokenUtil(transferToken, payload ?? null);

    type DebitsMsgWire = { type: "debits"; canonical: string; qs: string; token?: string | null };

    const mergeDebitQSLocal = (a: DebitQS | null, b: DebitQS | null): DebitQS => {
      const out: DebitQS = {};
      if (typeof a?.originalAmount === "number") out.originalAmount = a.originalAmount;
      if (out.originalAmount === undefined && typeof b?.originalAmount === "number") {
        out.originalAmount = b.originalAmount;
      }
      const listA: DebitLoose[] = Array.isArray(a?.debits) ? (a!.debits! as unknown as DebitLoose[]) : [];
      const listB: DebitLoose[] = Array.isArray(b?.debits) ? (b!.debits! as unknown as DebitLoose[]) : [];
      const mergedList = dedupeByNonce([...listA, ...listB]);
      const pruned = capDebitsQS({
        originalAmount: out.originalAmount,
        debits: mergedList as unknown as DebitRecord[],
      });
      return pruned;
    };

    const debitQSEqualLocal = (x: DebitQS | null, y: DebitQS | null): boolean => {
      const xx = capDebitsQS(x ?? {});
      const yy = capDebitsQS(y ?? {});
      const ax = typeof xx.originalAmount === "number" ? xx.originalAmount : Number.NaN;
      const ay = typeof yy.originalAmount === "number" ? yy.originalAmount : Number.NaN;
      const bothNa = Number.isNaN(ax) && Number.isNaN(ay);
      const amtEq = bothNa || Math.abs(ax - ay) < EPS;
      const nx = new Set((Array.isArray(xx.debits) ? xx.debits : []).map((d) => d.nonce));
      const ny = new Set((Array.isArray(yy.debits) ? yy.debits : []).map((d) => d.nonce));
      if (!amtEq || nx.size !== ny.size) return false;
      for (const n of nx) if (!ny.has(n)) return false;
      return true;
    };

    const handleIncoming = (canonical: string, qs: string, token?: string | null) => {
      const h = canonical.toLowerCase();
      if (!candidates.includes(h)) return;

      const myTok = activeTok ?? null;
      const incomingTok = token ?? null;
      if (myTok !== incomingTok) return;

      const incoming = decodeDebitsQS(qs);
      if (!incoming) return;

      const currentQS = decodeDebitsQS(new URLSearchParams(window.location.search).get("d"));
      const merged = mergeDebitQSLocal(currentQS, incoming);

      if (!debitQSEqualLocal(currentQS, merged)) {
        updateDebitsEverywhere(merged, h, myTok, { broadcast: false });

        setPayload((prev) => {
          if (!prev) return prev;
          const base = { ...(prev as SigilPayload) };
          const next = base as SigilPayloadWithDebits;
          if (typeof merged.originalAmount === "number") next.originalAmount = merged.originalAmount;
          if (Array.isArray(merged.debits)) {
            next.debits = merged.debits as unknown as DebitLoose[];
            next.totalDebited = sumDebits(merged.debits as unknown as DebitLoose[]);
          }
          return next as SigilPayload;
        });
      }
    };

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(DEBITS_CH);
      bc.onmessage = (ev: MessageEvent<DebitsMsgWire>) => {
        const m = ev.data;
        if (m?.type === "debits" && m.canonical && m.qs) {
          handleIncoming(m.canonical, m.qs, m.token);
        }
      };
    } catch {}

    const onStorage = (e: StorageEvent) => {
      if (!e.key || typeof e.newValue !== "string") return;
      for (const k of candidates) {
        if (!isDebitsStorageKeyForCanonical(e.key, k)) continue;
        const tok = tokenFromDebitsKey(e.key, k);
        handleIncoming(k, e.newValue, tok);
        break;
      }
    };
    window.addEventListener("storage", onStorage, { passive: true });

    return () => {
      window.removeEventListener("storage", onStorage);
      if (bc && typeof bc.close === "function") {
        try {
          bc.close();
        } catch {}
      }
    };
  }, [expectedCanonCandidates, transferToken, payload, setPayload]);

  /* responsive/expiry helpers */
  const expiresPulse = useMemo(() => {
    if (!payload) return null;
    if (typeof payload.expiresAtPulse === "number") return payload.expiresAtPulse;
    return payload.pulse + 11;
  }, [payload]);

  const pulsesLeft = useMemo(() => {
    if (currentPulse == null || expiresPulse == null) return null;
    return Math.max(0, expiresPulse - currentPulse);
  }, [currentPulse, expiresPulse]);

  const expired = useMemo(() => pulsesLeft === 0, [pulsesLeft]);
  const opensInPulses = useMemo(() => {
    if (currentPulse == null || !payload) return null;
    return Math.max(0, payload.pulse - currentPulse);
  }, [payload, currentPulse]);
  const isFutureSealed = useMemo(() => {
    if (currentPulse == null || !payload) return false;
    return payload.pulse > currentPulse;
  }, [payload, currentPulse]);

  /* === QR theming for exports only === */
  const chakraDay = (payload?.chakraDay ?? "Throat") as SigilPayload["chakraDay"];
  const steps: number = (payload?.stepsPerBeat ?? STEPS_PER_BEAT) as number;
  const stepIndex = stepIndexFromPulse(payload?.pulse ?? 0, steps);
  const stepPct =
    typeof payload?.stepPct === "number"
      ? Math.max(0, Math.min(1, payload.stepPct))
      : percentIntoStepFromPulse(payload?.pulse ?? 0);

  const qrAccent = useMemo(() => {
    const baseHue = CHAKRA_THEME[chakraDay as keyof typeof CHAKRA_THEME]?.hue ?? 180;
    const nibble =
      localHash && /^[0-9a-f]+$/i.test(localHash) ? (parseInt(localHash.slice(-2), 16) % 12) : 0;
    const hue = (baseHue + nibble * 2.5) % 360;
    const light = 50 + 15 * Math.sin(stepPct * 2 * Math.PI);
    return `hsl(${hue} 100% ${light}%)`;
  }, [chakraDay, stepPct, localHash]);

  const qrHue = CHAKRA_THEME[chakraDay as keyof typeof CHAKRA_THEME]?.hue ?? 180;

  const qrUid = useMemo(
    () => `qr-${(localHash || routeHash || "seed").slice(0, 12)}-${chakraDay}-${stepIndex}`,
    [localHash, routeHash, chakraDay, stepIndex]
  );
// Breath proof UI
const [proofOpen, setProofOpen] = useState(false);
type BreathProof = {
  pulse: number;
  beat: number;
  stepsPerBeat: number;
  stepIndex: number;
  chakraDay: string;
  intention: string | null;
  sigmaString: string;
  sigmaHash: string;  // sha256HexCanon result
  derivedPhiKey: string;
  payloadKaiSignature?: string | null;
  payloadUserPhiKey?: string | null;
  matches: { sigma: boolean; phi: boolean };
};
const [breathProof, setBreathProof] = useState<BreathProof | null>(null);

// Recompute breath proof whenever payload changes
useEffect(() => {
  let cancelled = false;

  (async () => {
    try {
      if (!payload) {
        setBreathProof(null);
        return;
      }
      const stepsNum: number = (payload.stepsPerBeat ?? STEPS_PER_BEAT) as number;
      const sealedIdx = stepIndexFromPulse(payload.pulse, stepsNum);
      const intention = readIntentionSigil(payload);

      const sigmaString = verifierSigmaString(
        payload.pulse,
        payload.beat,
        sealedIdx,
        String(payload.chakraDay ?? ""),
        intention
      );

      const sigmaHash = await sha256HexCanon(sigmaString);
      const derivedPhiKey = await derivePhiKeyFromSigCanon(sigmaHash);

      const sigmaMatches =
        typeof payload.kaiSignature === "string"
          ? payload.kaiSignature.toLowerCase() === sigmaHash.toLowerCase()
          : true;

      const phiMatches =
        typeof payload.userPhiKey === "string"
          ? payload.userPhiKey.toLowerCase() === derivedPhiKey.toLowerCase()
          : true;

      const proof: BreathProof = {
        pulse: payload.pulse,
        beat: payload.beat,
        stepsPerBeat: stepsNum,
        stepIndex: sealedIdx,
        chakraDay: String(payload.chakraDay ?? ""),
        intention: intention ?? null,
        sigmaString,
        sigmaHash,
        derivedPhiKey,
        payloadKaiSignature: payload.kaiSignature ?? null,
        payloadUserPhiKey: payload.userPhiKey ?? null,
        matches: { sigma: sigmaMatches, phi: phiMatches },
      };
      if (!cancelled) setBreathProof(proof);
    } catch {
      if (!cancelled) setBreathProof(null);
    }
  })();

  return () => {
    cancelled = true;
  };
}, [payload]);

  /* Poster Export (module) */
  const posterPress = useFastPress<HTMLButtonElement>(() => {
    const stageEl = document.getElementById("sigil-stage");
    void exportPosterPNG({
      stageEl,
      payload,
      localHash,
      routeHash,
      qr: { uid: qrUid, url: absUrl, hue: qrHue, accent: qrAccent },
      onToast: (m: string) => signal(setToast, m),
    });
  });

  /* Stargate */
  const [stargateOpen, setStargateOpen] = useState(false);
  const [stargateSrc, setStargateSrc] = useState<string>("");

  const openStargate = useCallback(async () => {
    const el = frameRef.current;
    if (!el) return;
    const canvas = await html2canvas(
      el,
      ({ backgroundColor: null } as unknown) as Parameters<typeof html2canvas>[1]
    );
    setStargateSrc(canvas.toDataURL("image/png"));
    setStargateOpen(true);
    if (!isIOS()) {
      const overlay = document.querySelector(".stargate-overlay") as HTMLElement | null;
      overlay?.requestFullscreen?.().catch(() => {});
    }
  }, []);
  const closeStargate = useCallback(() => {
    setStargateOpen(false);
    if (document.fullscreenElement && !isIOS()) {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);
  const stargatePress = useFastPress<HTMLButtonElement>(() => {
    void openStargate();
  });
  const closeStargatePress = useFastPress<HTMLButtonElement>(() => {
    closeStargate();
  });
// Fast/tap-safe toggles
const toggleProofPress = useFastPress<HTMLButtonElement>(() => setProofOpen(v => !v));
const openHistoryPress = useFastPress<HTMLButtonElement>(() => setHistoryOpen(true));

  /* Attach / Mint */
  const onAttachFile = useCallback(async (file: File) => {
    const buf = await file.arrayBuffer();
    const mime = file.type || "application/octet-stream";
    const dataUri = `data:${mime};base64,${b64(buf)}`;

    const att: StrictAttachment = {
      name: file.name,
      mime,
      size: file.size,
      dataUri,
    };
    setAttachment(att);
    signal(setToast, `Remembered ${file.name}`);
  }, []);

  // Show canonical transfer link (via linkShare.ts)
  const openShareTransferModal = useCallback(
    (meta: SigilPayload, forcedToken?: string) => {
      const stepsNum: number = (meta.stepsPerBeat ?? STEPS_PER_BEAT) as number;
      const sealedStepIndex = stepIndexFromPulse(meta.pulse, stepsNum);

      const canonical = (meta.canonicalHash || localHash || "").toLowerCase();

      const rawUnit = (meta as Partial<{ claimExtendUnit?: unknown }>).claimExtendUnit;
      const unitForShare: ExpiryUnit | null = isExpiryUnit(rawUnit) ? rawUnit : null;

      const rawAmount = (meta as Partial<{ claimExtendAmount?: unknown }>).claimExtendAmount;
      const amountForShare: number | null = typeof rawAmount === "number" ? rawAmount : null;

      const shareable: ShareableSigilMeta = {
        pulse: meta.pulse,
        beat: meta.beat,
        chakraDay: meta.chakraDay ?? "Root",
        stepsPerBeat: stepsNum,
        stepIndex: sealedStepIndex,
        userPhiKey: meta.userPhiKey ?? null,
        kaiSignature: meta.kaiSignature ?? null,
        canonicalHash: canonical,
        transferNonce: meta.transferNonce ?? null,
        expiresAtPulse: meta.expiresAtPulse ?? null,
        claimExtendUnit: unitForShare,
        claimExtendAmount: amountForShare,
      };

      const out = shareTransferLink(shareable, forcedToken, {
        localHash,
        routeHash,
        stepsPerBeat: STEPS_PER_BEAT,
        stepIndexFromPulse,
      });

  let finalUrl = out?.url || `/s/${canonical}`;

try {
  const u = new URL(finalUrl, window.location.origin);
  u.pathname = `/s/${canonical}`;

  const currentD = new URLSearchParams(window.location.search).get("d");
  if (currentD) u.searchParams.set("d", currentD);

  const current = new URL(window.location.href);
  current.searchParams.forEach((v, k) => {
    if (k !== "d") u.searchParams.set(k, u.searchParams.get(k) ?? v);
  });

  finalUrl = u.toString();
} catch {}


const u = new URL(finalUrl, window.location.origin);
u.pathname = `/s/${canonical}`;
const current = new URL(window.location.href);
current.searchParams.forEach((v, k) => {
  if (k !== "d") u.searchParams.set(k, u.searchParams.get(k) ?? v);
});

      const extracted = canonicalFromUrl(finalUrl);
      const sealCanonical = extracted || canonical;

      setSealUrl(finalUrl);
      setSealHash(sealCanonical);
      setSealOpen(true);
      return finalUrl;
    },
    [localHash, routeHash]
  );

  /* 11-breath upgrade claim window helper */
  const beginUpgradeClaimLocal = useCallback(
    (meta: SigilPayload, canonical: string, navigateAfter = true) => {
      const stepsNum: number = (meta.stepsPerBeat ?? STEPS_PER_BEAT) as number;
      const sealedStepIndex = stepIndexFromPulse(meta.pulse, stepsNum);

      const rawUnit = (meta as Partial<{ claimExtendUnit?: unknown }>).claimExtendUnit;
      const unitForUpgrade: ExpiryUnit = isExpiryUnit(rawUnit) ? rawUnit : "breaths";

      const rawAmount = (meta as Partial<{ claimExtendAmount?: unknown }>).claimExtendAmount;
      const amountForUpgrade: number =
        typeof rawAmount === "number" ? rawAmount : DEFAULT_UPGRADE_BREATHS;

      const shareable: ShareableSigilMeta = {
        pulse: meta.pulse,
        beat: meta.beat,
        chakraDay: meta.chakraDay ?? "Root",
        stepsPerBeat: stepsNum,
        stepIndex: sealedStepIndex,
        userPhiKey: meta.userPhiKey ?? null,
        kaiSignature: meta.kaiSignature ?? null,
        canonicalHash: canonical,
        transferNonce: meta.transferNonce ?? null,
        expiresAtPulse: meta.expiresAtPulse ?? null,
        claimExtendUnit: unitForUpgrade,
        claimExtendAmount: amountForUpgrade,
      };

      const url = beginUpgradeClaim(shareable, canonical, {
        localHash,
        routeHash,
        stepsPerBeat: STEPS_PER_BEAT,
        stepIndexFromPulse,
        getKaiPulseEternalInt,
        breathsToPulses,
        shareTransferLink,
        publishRotation,
        navigate: (u: string) => {
          if (!navigateAfter) return;
          try {
            navigate(u);
          } catch {
            try {
              window.location.href = u;
            } catch {}
          }
        },
      });

      return url ?? null;
    },
    [localHash, routeHash, navigate]
  );

  // Ownership verify — legacy aware
  const onVerifyOwnershipFile = useCallback(
    async (file: File) => {
      setOwnershipVerified(false);
      setOwnershipMsg("Verifying…");

      const isSvg = /image\/svg\+xml/i.test(file.type) || /\.svg$/i.test(file.name);
      if (!isSvg) {
        setOwnershipMsg("Unsupported file. Upload an SVG sigil (.svg) only.");
        return;
      }

      let uploadedPayload: SigilPayload | null = null;

      try {
        const text = await file.text();
        const { ok, errors, payload: normalized, meta } = validateSvgForVerifier(text);
        if (!ok || !normalized) {
          setOwnershipMsg(errors[0] || "Invalid SVG.");
          return;
        }
        uploadedPayload = normalized as unknown as SigilPayload;
        setUploadedMeta((meta || {}) as SigilMetaLoose);
      } catch {
        setOwnershipMsg("Invalid or unreadable SVG uploaded.");
        return;
      }

      if (!payload || !uploadedPayload) {
        setOwnershipMsg("Load or link a sigil first, then verify stewardship.");
        return;
      }

      if (!sameMoment(payload, uploadedPayload)) {
        setOwnershipMsg("File does not match this sealed kairos moment.");
        setOwnershipVerified(false);
        return;
      }

      if (uploadedPayload.canonicalHash) {
        const up = uploadedPayload.canonicalHash.toLowerCase();
        const lh = (localHash || "").toLowerCase();
        const rh = (routeHash || "").toLowerCase();

        const matchesModern = lh && up === lh;
        const matchesLegacy = rh && up === rh;

        if (!matchesModern && !matchesLegacy) {
          setOwnershipMsg("SVG canonicalHash doesn’t match this link’s hash.");
          setOwnershipVerified(false);
          return;
        }

        if (matchesLegacy && !matchesModern) {
          setLegacyInfo({
            reason: "svg.canonicalHash matched route (legacy)",
            matchedHash: up,
          });
          setGlyphAuth("authentic");
          setVerified("ok");
          setLinkStatus("archived");
          setOwnershipVerified(true);
          setOwnershipMsg("Stewardship verified (legacy SVG). Issuing modern link…");

          if (lh) {
            void beginUpgradeClaimLocal({ ...(payload as SigilPayload) }, lh, true);
            setOwnershipMsg("Legacy verified. Modern transfer link ready.");
          }
          return;
        }
      }

      const setTokens = new Set(
        [
          transferToken ?? undefined,
          payload.transferNonce ?? undefined,
          (uploadedPayload as Partial<{ transferNonce?: string | null }>).transferNonce ?? undefined,
          rotatedToken ?? undefined,
        ].filter((t): t is string => !!t)
      );
      if (setTokens.size > 1) {
        setOwnershipMsg("This is not the active transfer link for that Φkey.");
        setOwnershipVerified(false);
        return;
      }

      setOwnershipVerified(true);
      setOwnershipMsg("Stewardship verified");
    },
    [
      payload,
      sameMoment,
      localHash,
      routeHash,
      transferToken,
      rotatedToken,
      beginUpgradeClaimLocal,
    ]
  );

  /* Claim ZIP Exporter (module) */
  const claimPress = useFastPress<HTMLButtonElement>(async () => {
    if (exporting) return;
    const svgEl = frameRef.current?.querySelector("svg") as SVGSVGElement | null;
    const pExtras = (payload ?? {}) as Partial<{
      claimExtendUnit?: SigilPayload["claimExtendUnit"] | null;
      claimExtendAmount?: number | null;
    }>;
    const unitForExport = isExpiryUnit(pExtras.claimExtendUnit) ? pExtras.claimExtendUnit : undefined;
    const amountForExport =
      typeof pExtras.claimExtendAmount === "number" ? pExtras.claimExtendAmount : null;

    await exportZIP({
      expired: !!expired,
      exporting,
      setExporting,
      svgEl,
      payload: payload
        ? {
            pulse: payload.pulse,
            beat: payload.beat,
            chakraDay: payload.chakraDay ?? null,
            stepsPerBeat: payload.stepsPerBeat ?? undefined,
            stepIndex: payload.stepIndex ?? null,
            exportedAtPulse: payload.exportedAtPulse ?? null,
            canonicalHash: payload.canonicalHash ?? null,
            userPhiKey: payload.userPhiKey ?? null,
            kaiSignature: payload.kaiSignature ?? null,
            transferNonce: payload.transferNonce ?? null,
            expiresAtPulse: payload.expiresAtPulse ?? null,
            claimExtendUnit: unitForExport,
            claimExtendAmount: amountForExport,
            attachment: payload.attachment ?? null,
            provenance: (payload.provenance as ProvenanceEntry[] | null) ?? null,
          }
        : null,
      isFutureSealed,
      linkStatus,
      setToast: (m: string) => signal(setToast, m),
      expiryUnit,
      expiryAmount,
      localHash,
      routeHash,
      transferToken: transferToken ?? null,
      getKaiPulseEternalInt,
      stepIndexFromPulse,
      STEPS_PER_BEAT,
    });
  });
const onReady = useCallback(
  (hOrInfo: { hash?: string } | string | null | undefined) => {
    const h = typeof hOrInfo === "string" ? hOrInfo : hOrInfo?.hash;
    if (!h) return;
    const lc = h.toLowerCase();
    setLocalHash((prev) => (prev === lc ? prev : lc));
  },
  []
);

  /* Render guards */
  const showSkeleton = loading && !payload;
  const showError = verified === "notfound" || verified === "error";

  const pulse = payload?.pulse ?? 0;
  const beat = payload?.beat ?? 0;

  const nextPulseSeconds = (((msToNextPulse ?? 0) / 1000) as number).toFixed(3);

  const isArchived = linkStatus === "archived";
  const ownerVerified = ownershipVerified && !isArchived;

  /* Legacy upgrade eligibility */
  const isLegacyPage = useMemo(() => {
    return (
      glyphAuth === "authentic" &&
      isArchived &&
      !transferToken &&
      !!routeHash &&
      !!localHash &&
      routeHash !== localHash
    );
  }, [glyphAuth, isArchived, transferToken, routeHash, localHash]);

  // ——— Deep verification (URL/authentic + kaiSignature→Φ-key derivation) ———
useEffect(() => {
  // Only attempt deep check when we have something to check and we aren’t already failing
  if (!payload) return;
  if (glyphAuth !== "authentic") return;
  const ALLOW_ARCHIVED_VERIFIED = true;
if (linkStatus === "archived" && !ALLOW_ARCHIVED_VERIFIED) return;           // keep archived links “Authentic”, not “Verified”
  if (verified === "mismatch" || verified === "error" || verified === "notfound") return;

  let cancelled = false;
  (async () => {
    try {
      const stepsNum: number = (payload.stepsPerBeat ?? STEPS_PER_BEAT) as number;
      const sealedIdx = stepIndexFromPulse(payload.pulse, stepsNum);
const intention = readIntentionSigil(payload); // must not depend on debits/originalAmount/…!
const computedSigma = await sha256HexCanon(
  verifierSigmaString(
    payload.pulse,
    payload.beat,
    sealedIdx,
    String(payload.chakraDay ?? ""),
    intention
  )
);


      // If SVG already carried a sigma, accept equality; if not, computed one is the canon
      const sigmaOk =
        typeof payload.kaiSignature === "string"
          ? payload.kaiSignature.toLowerCase() === computedSigma.toLowerCase()
          : true;

      // Derive Φ from sigma and compare to payload’s userPhiKey if present
      const derivedPhi = await derivePhiKeyFromSigCanon(computedSigma);
      const phiOk =
        typeof payload.userPhiKey === "string"
          ? payload.userPhiKey.toLowerCase() === derivedPhi.toLowerCase()
          : true;

      // If all core checks pass, elevate the single badge to "verified"
      // If all core checks pass, elevate the single badge to "verified"
if (!cancelled && sigmaOk && phiOk && verified !== "verified") {
  setVerified("verified"); // allowed by VerifyUIState
}

    } catch {
      // swallow; we keep the "ok" badge rather than showing a second badge or an error
    }
  })();

  return () => { cancelled = true; };
}, [payload, glyphAuth, verified, linkStatus]);


useEffect(() => {
  const route = (routeHash || "").toLowerCase();

  const urlTok = transferToken || null;
  const payTok = payload?.transferNonce || null;

  const windowOpen =
    !!urlTok &&
    !!payTok &&
    urlTok === payTok &&
    (expiresPulse == null || currentPulse == null || currentPulse < expiresPulse);

  let next: typeof linkStatus = linkStatus;

  if (windowOpen) {
    next = "active";
  } else {
    const haveCanon = Boolean(localHash || payload?.canonicalHash || legacyInfo?.matchedHash);
    if (!haveCanon) {
      next = "checking";
    } else {
      const candidates = expectedCanonCandidates;
      if (
        (route && candidates.length && candidates.includes(route)) ||
        (route && localHash && route !== localHash && !legacyInfo)
      ) {
        next = "active";
      } else if (!payTok) {
        next = legacyInfo ? "archived" : "active";
      } else if (!urlTok) {
        next = "archived";
      } else if (rotatedToken && rotatedToken !== urlTok) {
        next = "archived";
      } else {
        next = urlTok === payTok ? "active" : "archived";
      }
    }
  }

  if (next !== linkStatus) setLinkStatus(next);
}, [
  routeHash,
  expectedCanonCandidates,
  localHash,
  payload?.transferNonce,
  transferToken,
  rotatedToken,
  expiresPulse,
  currentPulse,
  legacyInfo,
  linkStatus,
]);

  // derive IDs (deterministic preview)
  const [derivedOwnerPhiKey, setDerivedOwnerPhiKey] = useState<string>("");
  const [derivedKaiSig, setDerivedKaiSig] = useState<string>("");

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!payload) {
        setDerivedOwnerPhiKey("");
        setDerivedKaiSig("");
        return;
      }
      const canon = (payload.canonicalHash || localHash || "").toLowerCase();
     const nowPulseVal = currentPulse || kaiNowPulseInt();
      const nowBeatIdx = beatIndexFromPulse(nowPulseVal);
      const stepsNum = (payload.stepsPerBeat ?? STEPS_PER_BEAT) as number;
const nowStepIdx = stepIndexFromPulse(nowPulseVal, stepsNum);

      const d = await deriveMomentKeys(payload, canon, nowPulseVal, nowBeatIdx, nowStepIdx);
      if (alive) {
        setDerivedOwnerPhiKey(d.ownerPhiKey);
        setDerivedKaiSig(d.kaiSig);
      }
    })();
    return () => {
      alive = false;
    };
  }, [payload, localHash]);

  const handleSeal = useCallback(
    async (e?: SyntheticEvent) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      if (!payload || !localHash || isFutureSealed || isArchived) return;

      const canon = (payload.canonicalHash || localHash || "").toLowerCase();

      const nowPulseVal = currentPulse || kaiNowPulseInt();

      const nowBeatIdx = beatIndexFromPulse(nowPulseVal);
      const stepsNum = (payload.stepsPerBeat ?? STEPS_PER_BEAT) as number;
      const nowStepIdx = stepIndexFromPulse(nowPulseVal, stepsNum);

      const d = await deriveMomentKeys(payload, canon, nowPulseVal, nowBeatIdx, nowStepIdx);
      setNewOwner(d.ownerPhiKey);
      setNewKaiSig(d.kaiSig);
// after
setTimeout(() => {
  try {
    sealAndSend();
    // let the deep verifier effect promote to "verified"
  } catch {}
}, 0);
    },
    [payload, localHash, isFutureSealed, isArchived]
  );
  const openVerifier = useCallback((path: string) => {
    const url = `${import.meta.env.BASE_URL}${path}`;
    try { window.location.assign(url); } catch { window.location.href = url; }
  }, []);
  
  const downloadVerifier = useCallback(async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}verifier.inline.html`, { cache: "no-store" });
      const txt = await res.text();
      const blob = new Blob([txt], { type: "text/html" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "verifier.html";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
      signal(setToast, "Downloading verifier…");
    } catch {
      signal(setToast, "Download failed");
    }
  }, []);

const sealClass =
  "authority-seal " +
  (verified === "verified"
    ? "is-verified"
    : glyphAuth === "authentic"
    ? "is-authentic"
    : "is-failed");

<button
  type="button"
  className={sealClass}
  {...toggleProofPress}
>
  …
</button>

  // Seal & Send — immediate archive + rotation + modal with fresh link
  const sealAndSend = useCallback(() => {
    if (!payload) return signal(setToast, "Nothing to mint");
    const svg = frameRef.current?.querySelector("svg") as SVGSVGElement | null;
    if (!svg) return signal(setToast, "No Φkey in frame");
    if (!localHash) return signal(setToast, "Glyph hash not ready yet");
    if (linkStatus !== "active") return signal(setToast, "Archived link — cannot exhale from here");
    if (isFutureSealed) return signal(setToast, "Opens after the moment—claim unlocks then");

    const prevMeta: SigilMetaLoose = uploadedMeta ?? ({} as SigilMetaLoose);
    const prevProv = readProvenance(prevMeta, payload.pulse) as ReadonlyArray<ProvenanceEntry>;

    const ownerPhiKey = (newOwner || payload.userPhiKey || "").trim();
    if (!ownerPhiKey) return signal(setToast, "Owner ΦKey required");

    const amount = Math.max(0, Math.floor(expiryAmount || 0));
    const addPulses = expiryUnit === "breaths" ? breathsToPulses(amount) : stepsToPulses(amount);
    const nowPulse = currentPulse || kaiNowPulseInt();
    const expiresAtPulse = nowPulse + addPulses;
    
    const canonical = localHash.toLowerCase();
    const freshNonce = crypto.getRandomValues(new Uint32Array(4)).join("");

    const stepsNum = (payload.stepsPerBeat ?? STEPS_PER_BEAT) as number;
    const sealedIdx = stepIndexFromPulse(payload.pulse, stepsNum);
    const claimIdx = stepIndexFromPulse(nowPulse, stepsNum);

    const nextProvEntry: ProvWithSteps = {
      ...makeProvenanceEntry(
        ownerPhiKey,
        newKaiSig || payload.kaiSignature,
        payload,
        prevProv.length ? "transfer" : "mint",
        (attachment ?? payload.attachment)?.name,
        nowPulse
      ),
      stepIndex: sealedIdx,
      atStepIndex: claimIdx,
    };

    const nextMeta: SigilPayload = {
      ...payload,
      userPhiKey: ownerPhiKey,
      kaiSignature: newKaiSig || payload.kaiSignature,
      stepsPerBeat: payload.stepsPerBeat ?? STEPS_PER_BEAT,
      attachment: attachment ?? payload.attachment ?? undefined,
      expiresAtPulse,
      canonicalHash: canonical,
      transferNonce: freshNonce,
      claimExtendUnit: expiryUnit,
      claimExtendAmount: amount,
      provenance: [...prevProv, nextProvEntry],
    };

    (async () => {
      const canonicalSig2 = await sha256HexCanon(
        verifierSigmaString(
          nextMeta.pulse,
          nextMeta.beat,
          sealedIdx,
          String(nextMeta.chakraDay ?? ""),
          readIntentionSigil(nextMeta)
        )
      );
      const phiKeyCanon2 = await derivePhiKeyFromSigCanon(canonicalSig2);
      nextMeta.kaiSignature = canonicalSig2;
      nextMeta.userPhiKey = nextMeta.userPhiKey || phiKeyCanon2;

      const burnKeys = Array.from(
        new Set([payload.canonicalHash, routeHash, localHash].filter(Boolean).map((s) => (s as string).toLowerCase()))
      );
      if (burnKeys.length) publishRotation(burnKeys, freshNonce);
      setLinkStatus("archived");
      setSuppressAuthUntil(kaiNowEpochMs() + 250);


putMetadata(svg, nextMeta);
ensureCanonicalMetadataFirst(svg);

setPayload(nextMeta);
setUploadedMeta(nextMeta as unknown as SigilMetaLoose);
signal(setToast, "Sealed & archived");

// Build & sign exactly once, then open modal
let url = openShareTransferModal(nextMeta, freshNonce) || `/s/${canonical}`;
url = await signAndAttach(nextMeta, canonical, freshNonce, url, svg);

setSealUrl(toAbsUrl(url));

if (nextMeta.canonicalHash) {
  publishRotation([nextMeta.canonicalHash.toLowerCase()], freshNonce);
}
setTimeout(() => setSuppressAuthUntil(0), 0);

    })();
  }, [
    payload,
    uploadedMeta,
    newOwner,
    newKaiSig,
    attachment,
    expiryAmount,
    expiryUnit,
    localHash,
    routeHash,
    linkStatus,
    isFutureSealed,
    openShareTransferModal,
  ]);

  // === debit math ===
  type SPWithDebits = SigilPayload & {
    originalAmount?: number;
    debits?: DebitLoose[];
    totalDebited?: number;
  };
  const payloadD = payload as SPWithDebits | null;

  const totalDebited = useMemo<number>(() => {
    const items = (payloadD?.debits ?? []) as DebitLoose[];
    return sumDebits(items);
  }, [payloadD?.debits]);

  const availablePhi = useMemo<number>(() => {
    const base =
      typeof payloadD?.originalAmount === "number"
        ? payloadD.originalAmount
        : (valSeal?.valuePhi ?? 0);
    const avail = base - totalDebited;
    return avail > 0 ? avail : 0;
  }, [payloadD?.originalAmount, valSeal?.valuePhi, totalDebited]);

  const hasDebitsOrFrozen =
    (payloadD?.debits?.length ?? 0) > 0 || typeof payloadD?.originalAmount === "number";

  const displayedChipPhi = useMemo(() => {
    if (hasDebitsOrFrozen) return availablePhi;
    return livePrice ?? valSeal?.valuePhi ?? 0;
  }, [hasDebitsOrFrozen, availablePhi, livePrice, valSeal?.valuePhi]);
/* ---------- Live USD quote (same model as ValuationModal) ---------- */
// import type { SigilMetadataLite } from "../../utils/valuation";

const issuancePolicy = DEFAULT_ISSUANCE_POLICY;

const { usdPerPhi, phiPerUsd } = useMemo(() => {
  try {
    const nowKai = currentPulse || currentPulse;

    // Safely coerce payload to SigilMe tadataLite without using `any`
    const meta: SigilMetadataLite = payload
      ? (payload as unknown as SigilMetadataLite)
      : ({} as unknown as SigilMetadataLite);

    const q = quotePhiForUsd(
      {
        meta,
        nowPulse: nowKai,
        usd: 100,
        currentStreakDays: 0,
        lifetimeUsdSoFar: 0,
      },
      issuancePolicy
    );

    return {
      usdPerPhi: q.usdPerPhi ?? 0,
      phiPerUsd: q.phiPerUsd ?? 0,
    };
  } catch {
    return { usdPerPhi: 0, phiPerUsd: 0 };
  }
}, [payload, currentPulse, issuancePolicy]);

// USD for whatever number you're currently showing in the chip
const chipUsd: number = (displayedChipPhi ?? 0) * (usdPerPhi || 0);

  /* helper: generate canonical recipient Φkey (verifier algorithm) */
  const generateRecipientPhiKey = useCallback(async () => {
    if (!payload) return "";
    const stepsNum = (payload.stepsPerBeat ?? STEPS_PER_BEAT) as number;
    const sealedIdx = stepIndexFromPulse(payload.pulse, stepsNum);
    const sig =
      payload.kaiSignature ??
      (await sha256HexCanon(
        verifierSigmaString(
          payload.pulse,
          payload.beat,
          sealedIdx,
          String(payload.chakraDay ?? ""),
          readIntentionSigil(payload)
        )
      ));
    const phi = await derivePhiKeyFromSigCanon(sig);
    return phi;
  }, [payload]);

  /* ——— Lineage state (local descendants + current payload lineage path) ——— */
  const [descendants, setDescendants] = useState<DescendantLocal[]>([]);
  const refreshDescendants = useCallback(() => {
    const h = currentCanonicalUtil(payload ?? null, localHash, legacyInfo);
    const tok = currentTokenUtil(transferToken, payload ?? null);
    setDescendants(readDescendantsStored(h, tok));
  }, [payload, localHash, legacyInfo, transferToken]);

  // Keep descendants in sync across tabs
  useEffect(() => {
    refreshDescendants();
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(DESC_CH);
      bc.onmessage = (ev: MessageEvent<DescendantsMsg>) => {
        const m = ev.data;
        if (!m || m.type !== "descendants") return;
        const h = currentCanonicalUtil(payload ?? null, localHash, legacyInfo);
        const tok = currentTokenUtil(transferToken, payload ?? null);
        if (!h || !tok) return;
        if (m.canonical !== h.toLowerCase() || m.token !== tok) return;
        if (Array.isArray(m.list)) setDescendants(m.list);
      };
    } catch {}
    const onStorage = (e: StorageEvent) => {
      if (!e.key || !e.newValue) return;
      const h = currentCanonicalUtil(payload ?? null, localHash, legacyInfo);
      const tok = currentTokenUtil(transferToken, payload ?? null);
      if (!h || !tok) return;
      if (e.key === descendantsKey(h, tok)) {
        try {
          const arr = JSON.parse(e.newValue || "[]") as unknown;
          if (Array.isArray(arr)) setDescendants(arr as DescendantLocal[]);
        } catch {}
      }
    };
    window.addEventListener("storage", onStorage, { passive: true });
    return () => {
      if (bc && typeof bc.close === "function") {
        try {
          bc.close();
        } catch {}
      }
      window.removeEventListener("storage", onStorage);
    };
  }, [payload, localHash, legacyInfo, transferToken, refreshDescendants]);

  /* Mint a child sigil on send — ensures claim window time AND token-scoped ledger + lineage */
  /* Mint a child sigil on send — ensures claim window time AND token-scoped ledger + lineage */
const mintChildSigil = useCallback(
  async (amount: number, parentTokOverride?: string | null) => {
    if (!payload) return null;

    const nowPulse = currentPulse || kaiNowPulseInt();
    const freshNonce = crypto.getRandomValues(new Uint32Array(4)).join("");

    const stepsNum = (payload.stepsPerBeat ?? STEPS_PER_BEAT) as number;
    const sealedIdx = stepIndexFromPulse(payload.pulse, stepsNum);

    const baseCanonical = (localHash || payload.canonicalHash || "").toLowerCase();

    // ✅ use the just-created token if provided
    const parentTok = parentTokOverride ?? currentTokenUtil(transferToken, payload ?? null);

    const parentLineage: LineageNode[] = Array.isArray((payload as PayloadWithLineage).lineage)
      ? ([...(payload as PayloadWithLineage).lineage!] as LineageNode[])
      : [];
    const nextDepth = (parentLineage[parentLineage.length - 1]?.depth ?? 0) + 1;
    const thisChildNode: LineageNode = {
      token: freshNonce,
      parentToken: parentTok ?? null,
      amount: Number(amount.toFixed(6)),
      timestamp: nowPulse,
      depth: nextDepth,
      senderPhiKey: payload.userPhiKey ?? null,
    };

    const childMeta: SigilPayload & {
      originalAmount?: number;
      mintedAtPulse?: number;
      lineage?: LineageNode[];
    } = {
      ...payload,
      userPhiKey: undefined,
      originalAmount: Number(amount.toFixed(6)),
      mintedAtPulse: nowPulse,
      transferNonce: freshNonce,
      expiresAtPulse:
        nowPulse +
        (expiryUnit === "breaths" ? breathsToPulses(expiryAmount) : stepsToPulses(expiryAmount)),
      claimExtendUnit: expiryUnit,
      claimExtendAmount: expiryAmount,
      canonicalHash: baseCanonical,
      lineage: [...parentLineage, thisChildNode],
    };

    const canonicalSig2 = await sha256HexCanon(
      verifierSigmaString(
        childMeta.pulse,
        childMeta.beat,
        sealedIdx,
        String(childMeta.chakraDay ?? ""),
        readIntentionSigil(childMeta)
      )
    );
    const phiKeyCanon2 = await derivePhiKeyFromSigCanon(canonicalSig2);
    childMeta.kaiSignature = canonicalSig2;
    childMeta.userPhiKey = phiKeyCanon2;

const baseUrl = openShareTransferModal(childMeta, freshNonce) || `/s/${baseCanonical}`;

try {
  const u = new URL(baseUrl, window.location.origin);
  u.pathname = `/s/${baseCanonical}`;
  u.searchParams.set("d", encodeDebitsQS({ originalAmount: childMeta.originalAmount }));

  let finalUrl = ensureClaimTimeInUrl(u.toString(), childMeta);
  finalUrl = await signAndAttach(childMeta, baseCanonical, freshNonce, finalUrl);

  const can = canonicalFromUrl(finalUrl) || baseCanonical;

  writeDebitsStored(
    can,
    decodeDebitsQS(new URL(finalUrl).searchParams.get("d")) ?? ({} as DebitQS),
    freshNonce
  );

  // descendants bookkeeping (unchanged)
  const parentCanonical = currentCanonicalUtil(payload ?? null, localHash, legacyInfo);
  const parentActiveTok = parentTok ?? null;
  if (parentCanonical && parentActiveTok) {
    const existing = readDescendantsStored(parentCanonical, parentActiveTok);
    const nextList: DescendantLocal[] = [
      ...existing,
      {
        token: freshNonce,
        parentToken: parentActiveTok,
        amount: Number(amount.toFixed(6)),
        timestamp: nowPulse,
        depth: 1,
        recipientPhiKey: childMeta.userPhiKey!, // set above
      },
    ];
    writeDescendantsStored(parentCanonical, parentActiveTok, nextList);
    broadcastDescendants(parentCanonical, parentActiveTok, nextList);
    setDescendants(nextList);
  }

  setSealUrl(toAbsUrl(finalUrl));
  setSealHash(can);
  setSealOpen(true);
  return finalUrl;

      
    } catch {
      const patched = ensureClaimTimeInUrl(baseUrl || `/s/${baseCanonical}`, childMeta);
      setSealUrl(patched);
      setSealHash(baseCanonical);
      setSealOpen(true);
      return patched || null;
    }
  },
  [payload, expiryUnit, expiryAmount, localHash, openShareTransferModal, legacyInfo, transferToken]
);


  /* keyboard shortcuts */
  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName.toLowerCase();
      return tag === "input" || tag === "textarea" || el.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target)) return;
      const k = e.key.toLowerCase();
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (k === "s") {
        void share();
      } else if (k === "l") {
        void copy(absUrl, "Link copied");
      } else if (k === "h") {
        if (localHash) void copy(localHash, "Hash copied");
      } else if (k === "z") {
        claimPress.onClick?.(
         new MouseEvent("click") as unknown as ReactMouseEvent<HTMLButtonElement>
        );
      } else if (k === "p") {
        posterPress.onClick?.(
          new MouseEvent("click") as unknown as React.MouseEvent<HTMLButtonElement>
        );
      } else if (k === "g") {
        void openStargate();
      }
    };
    
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [share, copy, absUrl, localHash, claimPress, posterPress, openStargate]);

  /* Auto-init a parent token if missing (restores pre-v48 behavior) */
/* Auto-init a parent token if missing (restores pre-v48 behavior) */
const ensureParentTokenActive = useCallback(
  (opts?: { silent?: boolean }): string | null => {
    const silent = opts?.silent ?? true;

    const h = currentCanonicalUtil(payload ?? null, localHash, legacyInfo);
    if (!h) return null;

    // Try existing sources first
    let tok = currentTokenUtil(transferToken, payload ?? null);
    if (tok) return tok;

    // Create a brand-new parent token
    tok = crypto.getRandomValues(new Uint32Array(4)).join("");

    // 1) Persist to URL (?t=) without causing a remount (silent) unless explicitly told otherwise
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("t", tok);
      if (silent) {
        window.history.replaceState(null, "", `${u.pathname}${u.search}${u.hash}`);
      } else {
        navigate(`${u.pathname}${u.search}${u.hash}`, { replace: true });
      }
    } catch {}

    // 2) Persist to payload so UI/logic see it immediately
    setPayload(prev =>
      prev ? ({ ...(prev as SigilPayload), transferNonce: tok } as SigilPayload) : prev
    );

    // 3) Nudge link status
    setLinkStatus("active");

    return tok;
  },
  [payload, localHash, legacyInfo, transferToken, setPayload, navigate, setLinkStatus]
);

  /* === Send Φ flow — v48 hardened === */
  const [sendAmount, setSendAmount] = useState<number>(0);
  const handleSendPhi = useCallback(async () => {
    if (!ownerVerified) return signal(setToast, "Verify Stewardship first");
    if (!payload) return signal(setToast, "No payload");
    if (sendInFlight) return;
  const nowP = currentPulse || kaiNowPulseInt();

    const amt = Number(sendAmount) || 0;
    if (amt <= 0) return signal(setToast, "Enter an amount > 0");
  
    const h = currentCanonicalUtil(payload ?? null, localHash, legacyInfo);
  
    // ✅ silent token init (no navigation/remount)
    let tok = currentTokenUtil(transferToken, payload ?? null);
    if (!tok) tok = ensureParentTokenActive({ silent: true }) || null;
  
    if (!h || !tok) return signal(setToast, "Link not initialized");
  
    if (rotatedToken && rotatedToken !== tok) {
      return signal(setToast, "Archived link — cannot exhale from here");
    }
  
    setSendInFlight(true);
    const { ok: gotLock, id: lockId } = acquireSendLock(h, tok, nowP);
    sendLockIdRef.current = lockId;
    if (!gotLock) {
      setSendInFlight(false);
      return signal(setToast, "Another exhale is in progress");
    }
  
    try {
      const { merged } = bestDebitsForCanonical(
        h,
        new URLSearchParams(window.location.search),
        tok
      );
  
      const frozenOrig =
        typeof merged.originalAmount === "number"
          ? merged.originalAmount
          : typeof (payload as SPWithDebits | null)?.originalAmount === "number"
          ? (payload as SPWithDebits).originalAmount!
          : (valSeal?.valuePhi ?? 0);
  
      const current = capDebitsQS({
        originalAmount: frozenOrig,
        debits: Array.isArray(merged.debits) ? merged.debits : [],
      });
  
      const currentAvail = Math.max(
        0,
        (current.originalAmount ?? 0) -
          sumDebits((current.debits as unknown as DebitLoose[]) || [])
      );
      if (amt > currentAvail + EPS) {
        return signal(setToast, "Amount exceeds available");
      }
  
      const autoRecipientPhiKey = await generateRecipientPhiKey();
      if (!autoRecipientPhiKey) return signal(setToast, "Could not derive Φkey");
  
      const debit: DebitRecord = {
        amount: Number(amt.toFixed(6)),
        nonce: crypto.getRandomValues(new Uint32Array(4)).join(""),
        recipientPhiKey: autoRecipientPhiKey,
       timestamp: currentPulse || kaiNowPulseInt(),
      };
  
      const proposed = capDebitsQS({
        originalAmount: current.originalAmount,
        debits: [...((current.debits as unknown as DebitLoose[]) ?? []), debit] as unknown as DebitRecord[],
      });
  
      updateDebitsEverywhere(proposed, h, tok, { broadcast: true });
  
      const { merged: post } = bestDebitsForCanonical(
        h,
        new URLSearchParams(window.location.search),
        tok
      );
      const postPruned = capDebitsQS(post);
      const committed = ((postPruned.debits as unknown as DebitLoose[]) ?? []).some(
        (d) => d.nonce === debit.nonce
      );
  
      if (!committed) {
        signal(setToast, "Exhale conflicted — try again");
        return;
      }
  
      setPayload((prev) => {
        if (!prev) return prev;
        const base = { ...(prev as SigilPayload) };
        const next = base as SigilPayloadWithDebits;
        next.originalAmount =
          typeof postPruned.originalAmount === "number"
            ? postPruned.originalAmount
            : typeof next.originalAmount === "number"
            ? next.originalAmount
            : (valSeal?.valuePhi ?? 0);
        next.debits = (Array.isArray(postPruned.debits)
          ? (postPruned.debits as unknown as DebitLoose[])
          : []) as DebitLoose[];
        next.totalDebited = sumDebits(next.debits);
        return next as SigilPayload;
      });
  
      setSendAmount(0);
      signal(setToast, `Sent ${currency(debit.amount)} Φ`);
  
      // ✅ pass the fresh token so modal opens & stays open on first send
      void mintChildSigil(debit.amount, tok);
} finally {
  releaseSendLock(h, tok, sendLockIdRef.current, currentPulse
  );
  setSendInFlight(false);
}
  }, [
    ownerVerified,
    payload,
    (payload as SPWithDebits | null)?.originalAmount,
    valSeal?.valuePhi,
    sendAmount,
    rotatedToken,
    localHash,
    legacyInfo,
    transferToken,
    setPayload,
    generateRecipientPhiKey,
    mintChildSigil,
    setSendAmount,
    sendInFlight,
    ensureParentTokenActive,
  ]);
  
  // Disable transform/fixed glitches on iOS while any overlay is up
const anyOverlayOpen =
proofOpen || historyOpen || stargateOpen || sealOpen || (upgradeOpen && isLegacyPage);

useEffect(() => {
const cls = "bp-open";
if (anyOverlayOpen) document.body.classList.add(cls);
else document.body.classList.remove(cls);
return () => document.body.classList.remove(cls);
}, [anyOverlayOpen]);


  /* fast-press wrappers */
  const [remembered, setRemembered] = useState(false);
  const markRemembered = useCallback(() => {
    setRemembered(true);
    window.setTimeout(() => setRemembered(false), 2000);
  }, []);

  const copyHashPress = useFastPress<HTMLButtonElement>(() => {
    void copy(localHash || "", "Hash copied");
  });
  const copyLinkPress = useFastPress<HTMLButtonElement>(async () => {
    const ok = await copy(absUrl, "Link copied");
    if (ok) markRemembered();
  });
  const sharePress = useFastPress<HTMLButtonElement>(() => {
    void share();
  });

  /* Stage node */
  const stageNode = (
    <SigilFrame frameRef={frameRef}>
      {!showSkeleton && !showError && payload && (
        <div
          id="sigil-stage"
          style={{
            position: "relative",
            width: sigilSize,
            height: sigilSize,
            margin: "0 auto",
          }}
        >
          <KaiSigil
            pulse={pulse}
            beat={beat}
            stepPct={stepPct}
            chakraDay={chakraDay}
            size={sigilSize}
            hashMode="deterministic"
            origin=""
            onReady={onReady}
          />
        </div>
      )}

      {showSkeleton && <div className="sp-skeleton" aria-hidden="true" />}
      {showError && (
        <div className="sp-error">
          {verified === "notfound" ? "Waiting for SVG upload or ?p= payload." : "Unable to load sigil."}
        </div>
      )}
    </SigilFrame>
  );

  /* Current sigil lineage path (if provided in ?p=) */
  const payloadLineage = (payload as PayloadWithLineage | null)?.lineage ?? [];
/* Keep the SealMoment modal open unless the explicit "X" is clicked */
/* Keep the SealMoment modal open unless the explicit "X" is clicked */
const onSealModalClose = useCallback((ev?: unknown, reason?: string) => {
  const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null;

  const getReasonFrom = (e: unknown): string => {
    if (typeof reason === "string") return reason;
    if (!isObj(e)) return "";
    const direct =
      typeof (e as { reason?: unknown }).reason === "string"
        ? (e as { reason: string }).reason
        : "";
    const detail = isObj((e as { detail?: unknown }).detail)
      ? (e as { detail: Record<string, unknown> }).detail
      : null;
    const detailReason =
      detail && typeof detail.reason === "string" ? (detail.reason as string) : "";
    return direct || detailReason || "";
  };

  const getTargetEl = (e: unknown): HTMLElement | null => {
    if (!isObj(e)) return null;
    const t = (e as { target?: unknown }).target as unknown;
    return t instanceof HTMLElement ? t : null;
  };

  const r = getReasonFrom(ev);
  const target = getTargetEl(ev);

  const explicitByReason =
    r === "closeClick" || r === "close-button" || r === "explicit" || r === "close";

  const explicitByTarget = !!target?.closest?.(
    '[data-modal-close],[data-close],.sealmoment__close,.sp-modal__close,button[aria-label="Close"],button[aria-label="close"],button[title="Close"]'
  );

  const noArgsExplicit = ev == null && reason == null;

  const isBackdrop =
    r === "backdropClick" || r === "overlay" || r === "pointerDownOutside" || r === "clickOutside";
  const isEsc = r === "escapeKeyDown" || r === "esc" || r === "dismiss";

  if (explicitByReason || explicitByTarget || noArgsExplicit) {
    setSealOpen(false);
    setSealUrl("");
    setSealHash("");
    return;
  }

  // Ignore backdrop/Esc/implicit reasons — keep it open
  if (isBackdrop || isEsc || r) return;
}, []);




  return (
    <main
      className="sigilpage"
      role="main"
      aria-label="Kai Sigil Page"
      data-owner-verified={ownerVerified}
      data-archived={isArchived}
      data-old-link={oldLinkDetected ? "true" : "false"}
      data-version="v48"
    >
      <div className="sp-veil" aria-hidden="true" />
      <div className="sp-veil-stars" aria-hidden="true" />

      <div className="sp-viewport" aria-hidden={false}>
        <section className="sp-shell" data-center>
          <SigilHeader
            glyphAuth={glyphAuth}
            linkStatus={linkStatus}
            isArchived={isArchived}
            localHash={localHash}
            copyHashPress={copyHashPress}
          />{/* Auth badge — toggle Breath Proof (AUTHORITY SEAL • ultra-sleek • centered & compact) */}
          {(glyphAuth === "authentic" || verified === "verified") && (
  <>
    <style>
      {`
      /* ===== Divine Authority Seal — Ultra-Sleek, Compact, Centered ===== */
      .authority-seal{
        --gold:#ffd76e; --mint:#00ffc6; --aqua:#8ab4ff; --ink:#061012; --glass:rgba(10,14,15,.86);
        --fail:#ff184c; --fail-2:#ff4d6d; --fail-3:#ff0f3a; --failGlow: rgba(255, 24, 76, .16);
        --pulse:5.236s; /* Kai breath */

        position:relative;
        display:grid;                         /* block-level so margin:auto centers it */
        grid-template-columns:auto 1fr;
        align-items:center;
        gap:8px;

        /* hug content, stay narrow, and center */
        width:fit-content;
        max-width:min(360px, 92vw);
        min-width:220px;
        margin:8px auto;                      /* <-- centers the badge */
        padding:7px 10px;

        border-radius:9999px;
        box-sizing:border-box;
        text-transform:uppercase;
        letter-spacing:.11em;
        font-weight:900;
        color:#eafff7;
        cursor:pointer;
        overflow:hidden;
        -webkit-tap-highlight-color:transparent;

        background:
          linear-gradient(180deg, var(--glass), rgba(6,10,12,.78)) padding-box,
          conic-gradient(from 180deg at 50% 50%, var(--gold), var(--mint), var(--aqua), var(--gold)) border-box;
        border:1px solid transparent;
        background-clip:padding-box, border-box;
        box-shadow:
          0 1px 0 rgba(255,255,255,.06) inset,
          0 0 0 1px rgba(0,255,198,.14),
          0 10px 28px rgba(0,0,0,.40),
          0 0 22px rgba(0,255,198,.10);
        transition:box-shadow .12s ease;

        /* subtle living breath without obvious looping */
        will-change: transform, box-shadow, filter;
      }

      /* Hover keeps its lift without fighting the breath (we breathe on ::after) */
      .authority-seal:hover{
        transform:translateY(-0.5px);
        box-shadow:
          0 1px 0 rgba(255,255,255,.10) inset,
          0 0 0 1px rgba(0,255,198,.20),
          0 14px 40px rgba(0,0,0,.48),
          0 0 28px rgba(0,255,198,.16);
      }
      .authority-seal:focus-visible{
        outline:none;
        box-shadow:
          0 0 0 2px rgba(255,255,255,.14),
          0 0 0 4px rgba(0,255,198,.22),
          0 18px 52px rgba(0,0,0,.5);
      }

      /* micro-texture */
      .authority-seal::before{
        content:""; position:absolute; inset:0; border-radius:inherit; pointer-events:none;
        opacity:.18; mix-blend-mode:overlay;
        background:
          repeating-radial-gradient(circle at 50% 50%, rgba(255,255,255,.04) 0 1px, transparent 1px 3px),
          repeating-linear-gradient(45deg, rgba(0,255,198,.04) 0 2px, transparent 2px 6px);
      }

      /* φ-breath aura (runs on ::after so hover transform stays clean) */
      .authority-seal::after{
        content:""; position:absolute; inset:-1px; border-radius:inherit; pointer-events:none;
        box-shadow: 0 0 0 0 rgba(0,255,198,0), 0 0 0 0 rgba(255,215,110,0);
        transform: scale(0.998);
        animation: seal-breath var(--pulse) cubic-bezier(.33,.01,.16,1) infinite;
        /* layered faint shimmer to avoid obvious repetition */
        background: radial-gradient(60% 120% at 50% 10%, rgba(0,255,198,.06), transparent 60%);
        mix-blend-mode: screen;
        opacity:.9;
      }

      /* ===== VERIFIED (teal/gold) ===== */
      .authority-seal.is-verified .authority-seal__state{ color:var(--mint); text-shadow:0 0 12px rgba(0,255,198,.18); }

      /* ===== FAILED (neon red) — obvious AF ===== */
      .authority-seal.is-failed{
        background:
          linear-gradient(180deg, var(--glass), rgba(6,10,12,.78)) padding-box,
          conic-gradient(from 180deg at 50% 50%, var(--fail), var(--fail-2), var(--fail-3), var(--fail)) border-box;
        box-shadow:
          0 1px 0 rgba(255,255,255,.06) inset,
          0 0 0 1px rgba(255,24,76,.20),
          0 10px 28px rgba(0,0,0,.40),
          0 0 22px rgba(255,24,76,.16);
      }
      .authority-seal.is-failed::after{
        /* swap to red breath */
        animation-name: seal-breath-fail;
        background: radial-gradient(60% 120% at 50% 10%, rgba(255,24,76,.10), transparent 60%);
      }
      .authority-seal.is-failed .authority-seal__state{
        color:var(--fail);
        text-shadow: 0 0 10px rgba(255,24,76,.55), 0 0 18px rgba(255,24,76,.42);
      }
      .authority-seal.is-failed .authority-seal__chip{
        background: linear-gradient(180deg, var(--fail-2), var(--fail-3));
        color:#130508;
        border-color: rgba(255,24,76,.28);
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.10),
          0 0 16px rgba(255,24,76,.30);
      }
      .authority-seal.is-failed .authority-seal__emblem{
        background:
          radial-gradient(closest-side, rgba(255,255,255,.95), rgba(255,255,255,.36) 62%, rgba(255,255,255,0) 63%),
          conic-gradient(var(--fail), var(--fail-2), var(--fail-3), var(--fail));
        box-shadow:
          0 0 0 1px rgba(255,255,255,.22),
          0 3px 12px rgba(255,24,76,.40),
          inset 0 0 6px rgba(255,255,255,.26);
      }
      .authority-seal.is-failed .authority-seal__headline{
        animation: text-glow-red var(--pulse) ease-in-out infinite;
      }

      /* emblem */
      .authority-seal__emblem{
        position:relative;
        width:22px; height:22px; border-radius:50%;
        display:grid; place-items:center;
        color:var(--ink);
        font-size:13px; font-weight:900;
        background:
          radial-gradient(closest-side, rgba(255,255,255,.95), rgba(255,255,255,.36) 62%, rgba(255,255,255,0) 63%),
          conic-gradient(var(--mint), var(--gold), var(--aqua), var(--mint));
        box-shadow:
          0 0 0 1px rgba(255,255,255,.22),
          0 3px 10px rgba(0,255,198,.28),
          inset 0 0 6px rgba(255,255,255,.26);
        flex:0 0 auto;
      }

      /* quiet “sheen sweep” on the emblem */
      .authority-seal__emblem::after{
        content:""; position:absolute; inset:-2px; border-radius:inherit; pointer-events:none;
        background:
          conic-gradient(from 0deg, transparent 0 38%, rgba(255,255,255,.22) 46%, transparent 54%, transparent 100%);
        filter: blur(.4px) brightness(1.04);
        animation: emblem-sheen calc(var(--pulse) * 2.0) linear infinite;
        opacity:.55;
      }

      .authority-seal__content{ display:grid; grid-auto-rows:min-content; gap:4px; min-width:0; }

      .authority-seal__headline{
        display:flex; align-items:center; gap:6px;
        font-size:clamp(10.5px,1.6vw,12px);
        letter-spacing:.11em;
        white-space:nowrap; min-width:0;
        /* a breath-sync’d tiny luminance lift (teal baseline; red variant above) */
        animation: text-glow var(--pulse) ease-in-out infinite;
      }
      .authority-seal__headline .dot{ opacity:.6; }

      .authority-seal__chip{
        align-self:start; justify-self:start;
        padding:3px 8px;
        border-radius:999px;
        font-size:clamp(10px,1.6vw,11.5px);
        letter-spacing:.11em;
        color:var(--ink);
        border:1px solid rgba(255,255,255,.15);
        box-shadow:inset 0 1px 0 rgba(255,255,255,.14), 0 0 14px rgba(0,255,198,.16);
        background:linear-gradient(180deg,#00ffc6,#00c2aa);
      }

      .authority-seal.is-authentic .authority-seal__state{ color:var(--gold); text-shadow:0 0 12px rgba(255,215,110,.16); }
      .authority-seal.is-verified  .authority-seal__state{ color:var(--mint); text-shadow:0 0 12px rgba(0,255,198,.18); }

      /* ===== φ-exact breath animations ===== */
      @keyframes seal-breath{
        0%   { transform:scale(0.998); box-shadow: 0 0 0 0 rgba(0,255,198,0), 0 0 0 0 rgba(255,215,110,0); }
        23.6%{ transform:scale(1.003); box-shadow: 0 0 0 6px rgba(0,255,198,.05), 0 0 18px 1px rgba(255,215,110,.04); }
        38.2%{ transform:scale(1.006); box-shadow: 0 0 0 10px rgba(0,255,198,.08), 0 0 24px 2px rgba(255,215,110,.06); }
        61.8%{ transform:scale(0.999); box-shadow: 0 0 0 7px rgba(0,255,198,.03), 0 0 12px 1px rgba(255,215,110,.03); }
        85.4%{ transform:scale(1.002); box-shadow: 0 0 0 4px rgba(0,255,198,.02), 0 0 8px rgba(255,215,110,.02); }
        100% { transform:scale(1.000); box-shadow: 0 0 0 0 rgba(0,255,198,0), 0 0 0 rgba(255,215,110,0); }
      }

      /* Red variant for fail */
      @keyframes seal-breath-fail{
        0%   { transform:scale(0.998); box-shadow: 0 0 0 0 rgba(255,24,76,0), 0 0 0 0 rgba(255,24,76,0); }
        23.6%{ transform:scale(1.003); box-shadow: 0 0 0 6px rgba(255,24,76,.10), 0 0 18px 1px rgba(255,24,76,.10); }
        38.2%{ transform:scale(1.006); box-shadow: 0 0 0 12px rgba(255,24,76,.18), 0 0 28px 3px rgba(255,24,76,.18); }
        61.8%{ transform:scale(0.999); box-shadow: 0 0 0 8px rgba(255,24,76,.10), 0 0 14px 2px rgba(255,24,76,.10); }
        85.4%{ transform:scale(1.002); box-shadow: 0 0 0 5px rgba(255,24,76,.06), 0 0 10px rgba(255,24,76,.06); }
        100% { transform:scale(1.000); box-shadow: 0 0 0 0 rgba(255,24,76,0), 0 0 0 rgba(255,24,76,0); }
      }

      @keyframes emblem-sheen{
        0%   { transform: rotate(0deg);   opacity:.45; }
        38.2%{ transform: rotate(118deg); opacity:.62; }
        61.8%{ transform: rotate(198deg); opacity:.50; }
        100% { transform: rotate(360deg); opacity:.42; }
      }

      @keyframes text-glow{
        0%,100% { filter:none; text-shadow: 0 0 0 rgba(0,255,198,0); }
        38.2%   { filter:brightness(1.03); text-shadow: 0 0 8px rgba(0,255,198,.10); }
        61.8%   { filter:brightness(1.01); text-shadow: 0 0 5px rgba(0,255,198,.06); }
      }
      @keyframes text-glow-red{
        0%,100% { filter:none; text-shadow: 0 0 0 rgba(255,24,76,0); }
        38.2%   { filter:brightness(1.05); text-shadow: 0 0 10px rgba(255,24,76,.35); }
        61.8%   { filter:brightness(1.02); text-shadow: 0 0 6px rgba(255,24,76,.22); }
      }

      /* extra-small phones */
      @media (max-width: 380px){
        .authority-seal{ max-width:90vw; min-width:auto; padding:6px 9px; gap:7px; }
        .authority-seal__emblem{ width:20px; height:20px; font-size:12px; }
        .authority-seal__chip{ padding:2px 7px; }
      }
      @media (prefers-reduced-motion: reduce){
        .authority-seal::after,
        .authority-seal__emblem::after,
        .authority-seal__headline{
          animation:none !important;
        }
      }
      `}
    </style>

    <button
      type="button"
      className={`authority-seal ${verified === "verified" ? "is-verified" : "is-failed"}`}
      aria-pressed={proofOpen}
      aria-label="Show breath proof"
      title="Tap to show breath proof"
      {...toggleProofPress}
    >
      <span className="authority-seal__emblem" aria-hidden="true">
        {verified === "verified" ? "✓" : "✕"}
      </span>

      <div className="authority-seal__content">
        <div className="authority-seal__headline">
          <span className="authority-seal__state">
            {verified === "verified" ? "VERIFIED" : "Out•Of•Sync"}
          </span>
          <span className="dot">•</span>
          <span>PROOF•OF•BREATH™</span>
        </div>

        <div className="authority-seal__chip">
          {verified === "verified" ? "SEAL VALID" : "SEAL FAILED"}
        </div>
      </div>
    </button>
  </>
)}

          
          
          
          
          {/* Live/Available Φ chip — opens history chart */}
          {valSeal && (
            <button
              type="button"
              className={`sp-price-chip sp-price-dock ${
                priceFlash === "up" ? "flash-up" : priceFlash === "down" ? "flash-down" : ""
              }`}
              aria-live="polite"
              aria-label="Open historical value chart"
              title={`Kai ${valSeal.computedAtPulse} • premium ×${valSeal.premium.toFixed(6)} • ${fmtUsd(usdPerPhi)}/Φ • ${Number.isFinite(phiPerUsd) ? `${phiPerUsd.toFixed(6)} Φ/$` : "—"} • stamp ${valSeal.stamp.slice(0, 12)}…`}
               {...openHistoryPress}
            >
              {/* Φ rainbow icon — /assets/phi.svg mask */}
              <span
                className="phi"
                aria-hidden="true"
                style={
                  {
                    "--phi-url": `url(${import.meta.env.BASE_URL}assets/phi.svg)`,
                  } as React.CSSProperties
                }
              />
              <span className="price" aria-label={hasDebitsOrFrozen ? "Available amount" : "Live valuation"}>
                {currency(displayedChipPhi)}
              </span>
              <span className="usd-inline" aria-hidden="true">≈ {fmtUsd(chipUsd)}</span>
              <span className="chip-spacer" aria-hidden="true" />
              <span className="live-badge" aria-label={hasDebitsOrFrozen ? "Available amount" : "Live valuation"}>
                {hasDebitsOrFrozen ? "AVAILABLE" : "LIVE"}
                <span className="twinkles" aria-hidden="true" />
              </span>
            </button>
          )}

          <ValueHistoryModal
            open={historyOpen}
            onClose={() => setHistoryOpen(false)}
            series={series}
            latestValue={displayedChipPhi ?? 0}
            label={hasDebitsOrFrozen ? "Available Φ" : "Live Φ"}
          />

          {/* Conflict / Legacy banner */}
          <SigilConflictBanner
            glyphAuth={glyphAuth}
            linkStatus={linkStatus}
            routeHash={routeHash}
            localHash={localHash}
            upgradedOnce={upgradedOnce}
            oldLinkDetected={oldLinkDetected}
            transferToken={transferToken}
            onUpgradeClick={() => setUpgradeOpen(true)}
          />

          <SigilMetaPanel
            absUrl={absUrl}
            payload={payload}
            chakraDay={chakraDay}
            steps={steps}
            stepIndex={stepIndex}
            stepPctDisplay={stepPct}
            isArchived={isArchived}
            isFutureSealed={isFutureSealed}
            pulsesLeft={pulsesLeft}
            opensInPulses={opensInPulses}
            nextPulseSeconds={nextPulseSeconds}
            hash={hash}
            shortHash={shortHash}
            remembered={remembered}
            copyLinkPress={copyLinkPress}
            sharePress={sharePress}
            verified={toMetaVerifyState(verified)}
            showSkeleton={showSkeleton}
            showError={showError}
            stage={stageNode}
          />{/* Breath Proof overlay (portal) */}
          {proofOpen && breathProof &&
            createPortal(
              <div
                className="sp-breathproof__backdrop"
                role="presentation"
                onClick={() => setProofOpen(false)}
                onMouseDown={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
                onTouchMove={(e) => {
                  // prevent page scroll when swiping on the backdrop
                  if (e.target === e.currentTarget) e.preventDefault();
                }}
                style={{
                  position: "fixed",
                  inset: 0,
                  zIndex: 2147483647,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 16,
                  background: "rgba(0,0,0,.55)",
                  overflow: "auto",               // backdrop can scroll on tiny screens
                  overscrollBehavior: "contain",  // don't pass scroll to page behind
                  WebkitOverflowScrolling: "touch",
                  pointerEvents: "auto",          // ensure overlay intercepts clicks/touches
                }}
              >
                <aside
                  className="sp-breathproof sp-card"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="bp-title"
                  onClick={(e) => e.stopPropagation()}
                  tabIndex={-1}
                  // make the SHEET itself scroll on all devices and NEVER overflow horizontally
                  style={{
                    maxHeight: "calc(100dvh - 32px)",      // modern mobile-safe viewport unit
                    overflowY: "auto",
                    overflowX: "hidden",
                    WebkitOverflowScrolling: "touch",      // iOS smooth scrolling
                    outline: "none",
                    boxSizing: "border-box",
                    width: "100%",
                    maxWidth: "min(960px, calc(100vw - 32px))",
                    margin: "0 auto",
                    padding: 16,
                    borderRadius: 16,
                    background:
                      "linear-gradient(180deg, rgba(10,14,15,.92), rgba(6,10,12,.82))",
                    boxShadow:
                      "0 1px 0 rgba(255,255,255,.06) inset, 0 24px 80px rgba(0,0,0,.55)",
                    pointerEvents: "auto",
                  }}
                >
                  <button
                    type="button"
                    className="sp-breathproof__close"
                    aria-label="Close"
                    onClick={() => setProofOpen(false)}
                    // keep close button easy to hit while scrolling
                    style={{
                      position: "sticky",
                      top: -8,
                      marginLeft: "auto",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 36,
                      height: 36,
                      borderRadius: 999,
                      border: "1px solid var(--sp-border, #ffffff22)",
                      background: "var(--sp-glass, rgba(12,18,20,.55))",
                      backdropFilter: "blur(6px)",
                      cursor: "pointer",
                    }}
                  >
                    ×
                  </button>
          
                  <h3 id="bp-title" style={{ marginTop: -40, marginBottom: 10, wordBreak: "break-word" }}>
                    Proof•of•Breath™
                  </h3>
                  One breath. One pulse. One truth. Sealed by breath. Stamped in Kairos. Identity, memory, and value — harmonikally verified at the exakt Kairos moment.
          
                  <div
  className="auth-badge"
  title="Comparison to payload"
  style={{
    position: "relative",
    boxSizing: "border-box",
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    padding: 10,
    borderRadius: 16,
    background:
      "linear-gradient(180deg, rgba(10,14,15,.85), rgba(8,12,14,.65)) padding-box, conic-gradient(from 180deg at 50% 50%, #FFD76E, #00FFC6, #8AB4FF, #FFD76E) border-box",
    border: "1px solid transparent",
    backgroundClip: "padding-box, border-box",
    boxShadow:
      "0 1px 0 rgba(255,255,255,.08) inset, 0 0 1px 1px rgba(0,255,198,.18), 0 12px 40px rgba(0,0,0,.45), 0 0 32px rgba(0,255,198,.15)",
    color: "#E7FFF7",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    fontWeight: 800,
    fontSize: "clamp(10px, 3.2vw, 12.5px)",
    lineHeight: 1.25,
    backdropFilter: "blur(10px) saturate(140%)",
    WebkitBackdropFilter: "blur(10px) saturate(140%)",
    overflow: "hidden",
  }}
>
  {/* Responsive grid: stacks on narrow, 2-up when there's room */}
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
      gap: 10,
      width: "100%",
      maxWidth: "100%",
      minWidth: 0,
    }}
  >
    {/* KAI MATCH pill */}
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        alignItems: "center",
        gap: 8,
        padding: "10px 12px",
        borderRadius: 999,
        background:
          "linear-gradient(180deg, rgba(7,30,26,.85), rgba(6,18,20,.75))",
        border: "1px solid rgba(255,255,255,.16)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,.06), 0 8px 22px rgba(0,0,0,.35)",
        minWidth: 0,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          background:
            "radial-gradient(closest-side, rgba(255,255,255,.9), rgba(255,255,255,.35) 60%, rgba(255,255,255,0) 61%), conic-gradient(#00FFC6, #FFD76E, #8AB4FF, #00FFC6)",
          boxShadow:
            "0 0 0 2px rgba(255,255,255,.25), 0 4px 18px rgba(0,255,198,.35), inset 0 0 10px rgba(255,255,255,.35)",
          color: "#061012",
          fontSize: 16,
          fontWeight: 900,
        }}
      >
        Σ
      </span>
      <span style={{ opacity: 0.9, whiteSpace: "nowrap" }}>KAI MATCH:</span>
      <strong
        style={{
          justifySelf: "end",
          padding: "2px 10px",
          borderRadius: 999,
          fontSize: "clamp(10px, 3vw, 12px)",
          letterSpacing: "0.08em",
          background: breathProof.matches.sigma
            ? "linear-gradient(180deg, #00FFC6, #00C2AA)"
            : "linear-gradient(180deg, #FF5F7A, #C2143F)",
          color: "#061012",
          boxShadow: breathProof.matches.sigma
            ? "0 0 0 1px rgba(0,255,198,.45) inset, 0 0 22px rgba(0,255,198,.35)"
            : "0 0 0 1px rgba(255,95,122,.45) inset, 0 0 22px rgba(255,95,122,.35)",
          border: "1px solid rgba(255,255,255,.15)",
          whiteSpace: "nowrap",
        }}
      >
        {breathProof.matches.sigma ? "YES" : "NO"}
      </strong>
    </div>

    {/* PHI MATCH pill */}
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        alignItems: "center",
        gap: 8,
        padding: "10px 12px",
        borderRadius: 999,
        background:
          "linear-gradient(180deg, rgba(7,30,26,.85), rgba(6,18,20,.75))",
        border: "1px solid rgba(255,255,255,.16)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,.06), 0 8px 22px rgba(0,0,0,.35)",
        minWidth: 0,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          background:
            "radial-gradient(closest-side, rgba(255,255,255,.9), rgba(255,255,255,.35) 60%, rgba(255,255,255,0) 61%), conic-gradient(#00FFC6, #FFD76E, #8AB4FF, #00FFC6)",
          boxShadow:
            "0 0 0 2px rgba(255,255,255,.25), 0 4px 18px rgba(0,255,198,.35), inset 0 0 10px rgba(255,255,255,.35)",
          color: "#061012",
          fontSize: 16,
          fontWeight: 900,
        }}
      >
        Φ
      </span>
      <span style={{ opacity: 0.9, whiteSpace: "nowrap" }}>PHI MATCH:</span>
      <strong
        style={{
          justifySelf: "end",
          padding: "2px 10px",
          borderRadius: 999,
          fontSize: "clamp(10px, 3vw, 12px)",
          letterSpacing: "0.08em",
          background: breathProof.matches.phi
            ? "linear-gradient(180deg, #00FFC6, #00C2AA)"
            : "linear-gradient(180deg, #FF5F7A, #C2143F)",
          color: "#061012",
          boxShadow: breathProof.matches.phi
            ? "0 0 0 1px rgba(0,255,198,.45) inset, 0 0 22px rgba(0,255,198,.35)"
            : "0 0 0 1px rgba(255,95,122,.45) inset, 0 0 22px rgba(255,95,122,.35)",
          border: "1px solid rgba(255,255,255,.15)",
          whiteSpace: "nowrap",
        }}
      >
        {breathProof.matches.phi ? "YES" : "NO"}
      </strong>
    </div>
  </div>
</div>

          
                  <div style={{ marginTop: 12, wordBreak: "break-word" }}>
                    The world’s first self-verifying harmonik Kurrensy.  
                    Bound by breath. Ankored in Kairos. Forged by pulse.
                  </div>
      {/* Offline Verifier CTA */}
<div
  className="verifier-cta"
  role="group"
  aria-label="Offline verifier actions"
  style={verifierVars}
>
  <button
    type="button"
    className="verifier-btn"
    onClick={() => openVerifier("verifier.html")}
    aria-label="Open Offline Verifier"
  >
    <span className="icon" aria-hidden="true" />
    <span className="label">
      Open <em>Offline Verifier</em>
      <small>No network • Σ → sha256 → Φ in-browser</small>
    </span>
  </button>

  <button
    type="button"
    className="verifier-btn verifier-btn--ghost"
    onClick={downloadVerifier}
    aria-label="Download verifier.html"
  >
    <span className="icon dl" aria-hidden="true" />
    <span className="label">
      Download <em>verifier.html</em>
      <small>Single file • Keep forever • Offline</small>
    </span>
  </button>
</div>

                  <dl className="kv">
                    <dt>Pulse</dt><dd>{breathProof.pulse}</dd>
                    <dt>Beat</dt><dd>{breathProof.beat}</dd>
                    <dt>Step</dt><dd>{breathProof.stepIndex}/{breathProof.stepsPerBeat}</dd>
                    <dt>Spiral</dt><dd>{breathProof.chakraDay}</dd>
                    <dt>Intention</dt><dd><code>{breathProof.intention ?? "—"}</code></dd>
                    <dt>Σ string</dt><dd><code className="wrap">{breathProof.sigmaString}</code></dd>
                    <dt>sha256(Σ)</dt><dd><code className="wrap">{breathProof.sigmaHash}</code></dd>
                    <dt>Φ (derived)</dt><dd><code className="wrap">{breathProof.derivedPhiKey}</code></dd>
                    {breathProof.payloadKaiSignature && (
                      <>
                        <dt>SVG kaiSignature</dt>
                        <dd><code className="wrap">{breathProof.payloadKaiSignature}</code></dd>
                      </>
                    )}
                    {breathProof.payloadUserPhiKey && (
                      <>
                        <dt>SVG userPhiKey</dt>
                        <dd><code className="wrap">{breathProof.payloadUserPhiKey}</code></dd>
                      </>
                    )}
                  </dl>
          
                  <div className="sp-breathproof__actions" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    <button className="btn-ghost" onClick={() => copy(breathProof.sigmaString, "Σ string copied")}>
                      Remember Σ string
                    </button>
                    <button className="btn-ghost" onClick={() => copy(breathProof.sigmaHash, "sha256(Σ) copied")}>
                      Remember sha256(Σ)
                    </button>
                    <button className="btn-ghost" onClick={() => copy(breathProof.derivedPhiKey, "Derived Φ copied")}>
                      Remember Φ
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() =>
                        copy(
                          JSON.stringify(
                            {
                              pulse: breathProof.pulse,
                              beat: breathProof.beat,
                              stepsPerBeat: breathProof.stepsPerBeat,
                              stepIndex: breathProof.stepIndex,
                              chakraDay: breathProof.chakraDay,
                              intention: breathProof.intention,
                              sigmaString: breathProof.sigmaString,
                              sigmaHash: breathProof.sigmaHash,
                              derivedPhiKey: breathProof.derivedPhiKey,
                              payloadKaiSignature: breathProof.payloadKaiSignature,
                              payloadUserPhiKey: breathProof.payloadUserPhiKey,
                              matches: breathProof.matches,
                            },
                            null,
                            2
                          ),
                          "Breath proof JSON copied"
                        )
                      }
                    >
                      Remember JSON
                    </button>
                  </div>
                </aside>
              </div>,
              
              document.body
            )
          }
          
          

          {/* Debit summary + ledger */}
          {(payloadD?.debits?.length ?? 0) > 0 && (
            <div className="sp-card sp-debits" role="region" aria-label="Debit summary and ledger">
              <div className="sp-debits__summary">
                <div className="auth-badge auth-badge--debited">
                  Exhaled Φ: <strong>{currency(totalDebited)}</strong>
                </div>
                <div className="auth-badge auth-badge--available">
                  Available Φ: <strong>{currency(availablePhi)}</strong>
                </div>
              </div>

              <h3>Resonanse Stream</h3>

              <ul className="sp-debits__list">
                {(payloadD?.debits ?? []).map((d: DebitLoose) => (
                  <li className="sp-debits__item" key={d.nonce}>
                    <span className="sp-debits__who">
                      Exhale {currency(d.amount)} Φ to{" "}
                      <abbr title={d.recipientPhiKey}>{(d.recipientPhiKey || "").slice(0, 12)}…</abbr>
                    </span>
                    <span className="sp-debits__amt">{currency(d.amount)} Φ</span>
                    <span className="sp-debits__meta">Pulse {d.timestamp}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Lineage */}
          {(payloadLineage.length > 0 || descendants.length > 0) && (
            <div className="sp-card sp-lineage" role="region" aria-label="Lineage">
              {payloadLineage.length > 0 && (
                <>
                  <h3 className="sp-lineage__title">Ansestry Path</h3>
                  <ol className="sp-lineage__path" aria-label="Ancestor lineage path">
                    {payloadLineage.map((node, idx) => (
                      <li className="sp-lineage__node" key={`${node.token}-${idx}`}>
                        <span className="sp-lineage__badge" title={`Depth ${node.depth}`}>{node.depth}</span>
                        <code className="sp-lineage__token" title={`Token ${node.token}`}>{node.token.slice(0, 10)}…</code>
                        <span className="sp-lineage__meta">
                          {currency(node.amount)} Φ • Pulse {node.timestamp}
                          {node.senderPhiKey ? (
                            <> • from <abbr title={node.senderPhiKey}>{node.senderPhiKey.slice(0, 10)}…</abbr></>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ol>
                </>
              )}

              {descendants.length > 0 && (
                <>
                  <h3 className="sp-lineage__title">Exhaled From This Breath</h3>
                  <ul className="sp-lineage__desc" aria-label="Direct descendants minted here">
                    {descendants
                      .slice()
                      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
                      .map((c) => (
                        <li className="sp-lineage__desc-item" key={c.token}>
                          <div className="row">
                            <span className="who">
                              Derivative <code title={c.token}>{c.token.slice(0, 10)}…</code> → {currency(c.amount)} Φ
                              {c.recipientPhiKey ? (
                                <> to <abbr title={c.recipientPhiKey}>{c.recipientPhiKey.slice(0, 10)}…</abbr></>
                              ) : null}
                            </span>
                            <span className="meta">Pulse {c.timestamp}</span>
                          </div>
                        </li>
                      ))}
                  </ul>
                </>
              )}
            </div>
          )}

<SigilCTA
  hasPayload={!!payload}
  showError={showError}
  expired={!!expired}
  exporting={exporting}
  isFutureSealed={isFutureSealed}
  isArchived={isArchived}
  claimPress={claimPress}
  stargatePress={stargatePress}
  posterPress={posterPress}

  /* NEW: mobile-safe Send wiring */
  sendAmount={sendAmount}
  setSendAmount={setSendAmount}
  onSend={handleSendPhi}
  sendBusy={sendInFlight}
  ownerVerified={ownerVerified}
/>


          {payload?.provenance && payload.provenance.length > 0 && (
            <ProvenanceList entries={payload.provenance} steps={steps} />
          )}

          

          <p className="sp-fine">
            Determinate sigil-glyph; the hash mirrors the law-true payload. All Origin and Stewardship are
            embedded in the Φkey metadata. Sovereign. End-to-end.
          </p>

          {/* Ownership panel */}
          <OwnershipPanel
            isArchived={isArchived}
            ownerVerified={ownerVerified}
            ownershipMsg={ownershipMsg}
            onVerifyOwnershipFile={onVerifyOwnershipFile}
          />

{/* Owner-gated controls */}
<div className="owner-gated">
  {ownerVerified && (
    <div className="sp-card" style={{ padding: 16, margin: "8px 0 16px" }}>
      <h3 style={{ marginTop: 0 }}>Exhale Φ</h3>

      <div className="auth-badge auth-badge--checking" style={{ marginBottom: 12 }}>
        Available Φ:&nbsp;<strong>{currency(availablePhi)}</strong>
      </div>

      {/* Amount / claim window / unit (mobile-optimized via CSS hooks) */}
      <div
        className="owner-grid"
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(120px,180px) minmax(120px,160px) minmax(120px,160px)",
          gap: 12,
          alignItems: "center",
        }}
      >
        <input
          id="send-amount"
          name="send-amount"
          type="number"
          inputMode="decimal"
          enterKeyHint="done"
          step="0.000001"
          min={0}
          placeholder="Amount"
          value={sendAmount}
          onChange={(e) => {
            const raw = e.currentTarget.value.replace(/,/g, ".");
            const val = parseFloat(raw);
            setSendAmount(Number.isFinite(val) && val >= 0 ? val : 0);
          }}
          onWheel={(e: React.WheelEvent<HTMLInputElement>) => e.currentTarget.blur()}
          className="btn-ghost"
          style={{ padding: 10 }}
          aria-label="Amount of Φ to send"
          autoComplete="off"
          spellCheck={false}
        />

        <input
          id="claim-window"
          name="claim-window"
          type="number"
          inputMode="numeric"
          enterKeyHint="done"
          min={1}
          step={1}
          placeholder="Claim window"
          value={expiryAmount}
          onChange={(e) =>
            setExpiryAmount(Math.max(1, Math.floor(Number(e.currentTarget.value) || 0)))
          }
          onWheel={(e: React.WheelEvent<HTMLInputElement>) => e.currentTarget.blur()}
          className="btn-ghost"
          style={{ padding: 10 }}
          aria-label="Inhale Step amount"
          title="How long the resipient has to inhale"
          autoComplete="off"
          spellCheck={false}
        />

        <select
          value={expiryUnit}
          onChange={(e) => setExpiryUnit(e.currentTarget.value as ExpiryUnit)}
          className="btn-ghost"
          style={{ padding: 10 }}
          aria-label="Inhale time unit"
          title="Breaths or steps"
        >
          <option value="breaths">breaths</option>
          <option value="steps">steps</option>
        </select>
      </div>

      {/* Send action + helper text (mobile-optimized via CSS hooks) */}
      <div
        className="owner-actions"
        style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center" }}
      >
        <button
          type="button"
          className="btn-primary"
          onClick={handleSendPhi}
          disabled={
            !Number.isFinite(sendAmount) ||
            sendAmount <= 0 ||
            sendAmount > availablePhi ||
            sendInFlight
          }
          aria-label="Exhale Φ now"
          title={sendInFlight ? "Exhale in progress…" : "Exhale Φ now"}
        >
          💨
        </button>

        <div style={{ opacity: 0.85 }}>
          Logs to the resonanse stream, updates the Sigil-Glyph, & exhales a derivative Φkey with a
          inhale time of <strong>{expiryAmount}</strong> {expiryUnit}.
        </div>
      </div>
    </div>
  )}
<section className="sigil-tools">

{/* 2) Publisher — mints derivative action glyphs */}
</section>
  <SovereignControls
    isArchived={isArchived}
    ownerVerified={ownerVerified}
    onAttachFile={onAttachFile}
    attachment={attachment}
    payloadAttachment={payload?.attachment}
    derivedOwnerPhiKey={derivedOwnerPhiKey}
    derivedKaiSig={derivedKaiSig}
    expiryUnit={expiryUnit}
    setExpiryUnit={setExpiryUnit}
    expiryAmount={expiryAmount}
    setExpiryAmount={setExpiryAmount}
    onSealPress={{
      onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
        if (e.pointerType && e.pointerType !== "mouse") handleSeal(e);
      },
      onClick: (e: React.MouseEvent<HTMLButtonElement>) => handleSeal(e),
    }}
    payload={payload}
    localHash={localHash}
    isFutureSealed={isFutureSealed}
  />
</div>

<div className="sr-only" aria-live="polite" aria-atomic="true">
  {toast}
</div>

        </section>
      </div>

      <StargateOverlay
        open={stargateOpen}
        src={stargateSrc}
        onClose={closeStargate}
        closePress={closeStargatePress}
      />

      {/* SealMoment modal */}
      <SealMomentModal
        open={sealOpen}
        url={sealUrl}
        hash={sealHash}
        onClose={onSealModalClose}
        onDownloadZip={() => {
          claimPress.onClick?.(new MouseEvent("click") as unknown as React.MouseEvent<HTMLButtonElement>);
        }}
      />

      {/* UpgradeSigilModal — legacy-only, one-time */}
      <UpgradeSigilModal
        open={upgradeOpen && isLegacyPage && !upgradedOnce}
        onClose={() => setUpgradeOpen(false)}
        legacyHash={routeHash}
        modernHash={localHash}
        currentPayload={payload}
        onVerified={(uploaded) => {
          setUploadedMeta(uploaded as unknown as SigilMetaLoose);
        }}
        onGenerateLink={async (meta) => {
          const canon = (localHash || meta.canonicalHash || "").toLowerCase();
          const url = beginUpgradeClaimLocal(meta as SigilPayload, canon, true);
          if (url) {
            markLegacyUpgraded();
            setUpgradeOpen(false);
          }
          return url;
        }}
      />
    </main>
  );
}