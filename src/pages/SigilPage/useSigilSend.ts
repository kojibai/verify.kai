// src/pages/SigilPage/useSigilSend.ts
/* eslint-disable no-empty */
import { useCallback, useEffect, useRef, useState } from "react";
import type { SigilPayload } from "../../types/sigil";
import { getKaiPulseEternalInt } from "../../SovereignSolar";
import {
  bestDebitsForCanonical,
  updateDebitsEverywhere,
  type DebitRecord,
  type DebitQS,
} from "../../utils/cryptoLedger";
import {
  currentCanonical as currentCanonicalUtil,
  currentToken as currentTokenUtil,
} from "../../utils/urlShort";
import {
  sha256HexCanon,
  derivePhiKeyFromSigCanon,
  verifierSigmaString,
  readIntentionSigil,
} from "./verifierCanon";
import { kaiNowMs } from "../../utils/kaiNow";

/** ─────────────────────────────────────────────────────────────
 * Local helpers — scoped to the hook so we don't fight page types
 * (Page can keep its own copies for non-send features.)
 * ──────────────────────────────────────────────────────────── */
const EPS = 1e-9;

/** Narrow extension the page sometimes augments on SigilPayload */
type DebitLoose = {
  amount: number;
  nonce: string;
  timestamp?: number;
  recipientPhiKey?: string;
};
type SigilPayloadWithDebits = SigilPayload & {
  originalAmount?: number;
  debits?: DebitLoose[];
  totalDebited?: number;
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

  const rawList =
    Array.isArray(qs.debits) ? (dedupeByNonce(qs.debits as unknown as DebitLoose[]) as DebitLoose[]) : [];
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
    }
  }

  return {
    originalAmount: orig,
    debits: kept.length ? (kept as unknown as DebitRecord[]) : undefined,
  };
};

/** ─────────────────────────────────────────────────────────────
 * Cross-tab “send” lock (prevents split-brain concurrent sends)
 * ──────────────────────────────────────────────────────────── */
const SEND_LOCK_CH = "sigil-sendlock-v1";
const SEND_LOCK_TTL_MS = 15_000;
const sendLockKey = (canonical: string, token: string) => `sigil:sendlock:${canonical}:t:${token}`;

type SendLockWire = {
  type: "lock" | "unlock";
  canonical: string;
  token: string;
  id: string;
  at: number;
};
type SendLockRecord = { id: string; at: number };

const acquireSendLock = (canonical: string | null, token: string | null): { ok: boolean; id: string } => {
  const id = crypto.getRandomValues(new Uint32Array(4)).join("");
  if (!canonical || !token) return { ok: false, id };
  const key = sendLockKey(canonical.toLowerCase(), token);
  try {
    const raw = localStorage.getItem(key);
    const rec: SendLockRecord | null = raw ? (JSON.parse(raw) as SendLockRecord) : null;
    const stale = !rec || !Number.isFinite(rec.at) || kaiNowMs() - rec.at > SEND_LOCK_TTL_MS;
    if (!rec || stale) {
      localStorage.setItem(key, JSON.stringify({ id, at: kaiNowMs() } satisfies SendLockRecord));
      try {
        const bc = new BroadcastChannel(SEND_LOCK_CH);
        const msg: SendLockWire = { type: "lock", canonical: canonical.toLowerCase(), token, id, at: kaiNowMs() };
        bc.postMessage(msg);
        bc.close();
      } catch {}
      return { ok: true, id };
    }
  } catch {}
  return { ok: false, id };
};

const releaseSendLock = (canonical: string | null, token: string | null, id: string): void => {
  if (!canonical || !token) return;
  const key = sendLockKey(canonical.toLowerCase(), token);
  try {
    const raw = localStorage.getItem(key);
    const rec: SendLockRecord | null = raw ? (JSON.parse(raw) as SendLockRecord) : null;
    if (!rec || rec.id === id) {
      localStorage.removeItem(key);
      try {
        const bc = new BroadcastChannel(SEND_LOCK_CH);
        const msg: SendLockWire = { type: "unlock", canonical: canonical.toLowerCase(), token, id, at: kaiNowMs() };
        bc.postMessage(msg);
        bc.close();
      } catch {}
    }
  } catch {}
};

/** ─────────────────────────────────────────────────────────────
 * Hook
 * ──────────────────────────────────────────────────────────── */
export function useSigilSend(params: {
  payload: SigilPayload | null;
  setPayload: React.Dispatch<React.SetStateAction<SigilPayload | null>>;
  ownerVerified: boolean;
  localHash: string;
  legacyInfo: { reason: string; matchedHash: string } | null;
  transferToken: string | null;
  rotatedToken: string | null;
  valSealValuePhi: number; // fallback for originalAmount when not frozen
  onMintChild: (amount: number, parentTok?: string | null) => Promise<string | null>;
  setToast: (m: string) => void; // wrapper so caller can keep its signal() UX
}) {
  const {
    payload,
    setPayload,
    ownerVerified,
    localHash,
    legacyInfo,
    transferToken,
    rotatedToken,
    valSealValuePhi,
    onMintChild,
    setToast,
  } = params;

  const [sendAmount, setSendAmount] = useState<number>(0);
  const [sendInFlight, setSendInFlight] = useState<boolean>(false);
  const sendLockIdRef = useRef<string>("");

  // Optional: keep a BC listener alive (no-op but improves UI responsiveness)
  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(SEND_LOCK_CH);
      bc.onmessage = () => {};
    } catch {}
    return () => {
      if (bc && typeof bc.close === "function") {
        try {
          bc.close();
        } catch {}
      }
    };
  }, []);

  /** Ensure parent token exists silently (URL + payload), return token */
  const ensureParentTokenActive = useCallback((): string | null => {
    const h = currentCanonicalUtil(payload ?? null, localHash, legacyInfo);
    if (!h) return null;

    // Try existing first
    let tok = currentTokenUtil(transferToken, payload ?? null);
    if (tok) return tok;

    // Create new
    tok = crypto.getRandomValues(new Uint32Array(4)).join("");

    try {
      const u = new URL(window.location.href);
      u.searchParams.set("t", tok);
      // silent—no remount
      window.history.replaceState(null, "", `${u.pathname}${u.search}${u.hash}`);
    } catch {}

    setPayload((prev) =>
      prev ? ({ ...(prev as SigilPayload), transferNonce: tok } as SigilPayload) : prev
    );

    return tok;
  }, [payload, localHash, legacyInfo, transferToken, setPayload]);

  /** Canonical recipient Φkey (verifier algorithm) */
  const generateRecipientPhiKey = useCallback(async () => {
    if (!payload) return "";
    const stepsNum = (payload.stepsPerBeat ?? 44) as number; // default isn’t used; sealedIdx computed from payload
    const sealedIdx = Math.floor(((payload.pulse % (stepsNum || 1)) + (stepsNum || 1)) % (stepsNum || 1));
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

  /** Main handler */
  const handleSendPhi = useCallback(async () => {
    if (!ownerVerified) return setToast("Verify Stewardship first");
    if (!payload) return setToast("No payload");
    if (sendInFlight) return;

    const amt = Number(sendAmount) || 0;
    if (amt <= 0) return setToast("Enter an amount > 0");

    const h = currentCanonicalUtil(payload ?? null, localHash, legacyInfo);

    // Token: prefer URL/payload, silently init if missing
    let tok = currentTokenUtil(transferToken, payload ?? null);
    if (!tok) tok = ensureParentTokenActive() || null;

    if (!h || !tok) return setToast("Link not initialized");

    if (rotatedToken && rotatedToken !== tok) {
      return setToast("Archived link — cannot exhale from here");
    }

    setSendInFlight(true);
    const { ok: gotLock, id: lockId } = acquireSendLock(h, tok);
    sendLockIdRef.current = lockId;
    if (!gotLock) {
      setSendInFlight(false);
      return setToast("Another exhale is in progress");
    }

    try {
      // Snapshot current debits (merged across URL/store)
      const { merged } = bestDebitsForCanonical(h, new URLSearchParams(window.location.search), tok);

      const withDebits = payload as SigilPayloadWithDebits | null;
      const frozenOrig =
        typeof merged.originalAmount === "number"
          ? merged.originalAmount
          : typeof withDebits?.originalAmount === "number"
          ? withDebits.originalAmount
          : valSealValuePhi;

      const current = capDebitsQS({
        originalAmount: frozenOrig,
        debits: Array.isArray(merged.debits) ? merged.debits : [],
      });

      const currentAvail = Math.max(
        0,
        (current.originalAmount ?? 0) - sumDebits((current.debits as unknown as DebitLoose[]) || [])
      );
      if (amt > currentAvail + EPS) {
        return setToast("Amount exceeds available");
      }

      const autoRecipientPhiKey = await generateRecipientPhiKey();
      if (!autoRecipientPhiKey) return setToast("Could not derive Φkey");

      const debit: DebitRecord = {
        amount: Number(amt.toFixed(6)),
        nonce: crypto.getRandomValues(new Uint32Array(4)).join(""),
        recipientPhiKey: autoRecipientPhiKey,
        timestamp: getKaiPulseEternalInt(new Date()),
      };

      const proposed = capDebitsQS({
        originalAmount: current.originalAmount,
        debits: [...((current.debits as unknown as DebitLoose[]) ?? []), debit] as unknown as DebitRecord[],
      });

      // Persist (URL + store + broadcast)
      updateDebitsEverywhere(proposed, h, tok, { broadcast: true });

      // Re-read and confirm commit
      const { merged: post } = bestDebitsForCanonical(h, new URLSearchParams(window.location.search), tok);
      const postPruned = capDebitsQS(post);
      const committed = ((postPruned.debits as unknown as DebitLoose[]) ?? []).some(
        (d) => d.nonce === debit.nonce
      );

      if (!committed) {
        setToast("Exhale conflicted — try again");
        return;
      }

      // Reflect in local payload immediately
      setPayload((prev) => {
        if (!prev) return prev;
        const base = { ...(prev as SigilPayload) } as SigilPayloadWithDebits;
        const next = base;
        next.originalAmount =
          typeof postPruned.originalAmount === "number"
            ? postPruned.originalAmount
            : typeof next.originalAmount === "number"
            ? next.originalAmount
            : valSealValuePhi;
        next.debits = (Array.isArray(postPruned.debits)
          ? (postPruned.debits as unknown as DebitLoose[])
          : []) as DebitLoose[];
        next.totalDebited = sumDebits(next.debits);
        return next as SigilPayload;
      });

      setSendAmount(0);
      setToast(`Sent ${Number(amt.toFixed(6)).toLocaleString(undefined, { maximumFractionDigits: 6 })} Φ`);

      // Mint child sigil under SAME token so modal stays open on first send
      void onMintChild(debit.amount, tok);
    } finally {
      releaseSendLock(h, tok, sendLockIdRef.current);
      setSendInFlight(false);
    }
  }, [
    sendInFlight,
    ownerVerified,
    payload,
    localHash,
    legacyInfo,
    transferToken,
    rotatedToken,
    sendAmount,
    setPayload,
    ensureParentTokenActive,
    generateRecipientPhiKey,
    valSealValuePhi,
    onMintChild,
    setToast,
  ]);

  return {
    sendAmount,
    setSendAmount,
    sendInFlight,
    handleSendPhi,
  };
}
