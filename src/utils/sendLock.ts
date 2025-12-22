// src/utils/sendLock.ts
// v48 send-lock utils (atomic exhale guard)
// Kairos-only time source: kairosEpochNow() returns bigint epoch-ms → we STORE number epoch-ms for TTL math/UI.

import { kairosEpochNow } from "./kai_pulse";

export const SEND_LOCK_CH = "sigil-sendlock-v1";
export const SEND_LOCK_TTL_MS = 15_000;

const keyFor = (canonical: string, token: string) => `sigil:sendlock:${canonical}:t:${token}`;

export type SendLockRecord = { id: string; at: number };
export type SendLockWire = {
  type: "lock" | "unlock";
  canonical: string;
  token: string;
  id: string;
  at: number;
};

const noop = () => {
  /* intentionally empty */
};

/**
 * kairosEpochNow() returns bigint (epoch-ms). Convert → number for TTL arithmetic & JSON storage.
 * Safe for epoch-ms in modern times; clamps if somehow outside MAX_SAFE_INTEGER.
 */
function bigintToSafeNumber(b: bigint): number {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (b > max) return Number.MAX_SAFE_INTEGER;
  if (b < -max) return -Number.MAX_SAFE_INTEGER;
  return Number(b);
}

/** "Now" in epoch-ms as number (derived from Kairos bigint). */
export const nowMs = (): number => bigintToSafeNumber(kairosEpochNow());

function coerceAtMs(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "bigint") return bigintToSafeNumber(v);
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return 0;
    // Allow plain numeric strings (including bigint-serialized digits)
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function safeParseRecord(raw: string | null): SendLockRecord | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== "object") return null;

    const rr = obj as Record<string, unknown>;
    const id = String(rr.id ?? "");
    const at = coerceAtMs(rr.at);

    if (!id) return null;
    return { id, at };
  } catch {
    return null;
  }
}

/** Acquire a short TTL lock keyed by (canonical, token). */
export function acquireSendLock(
  canonical: string | null,
  token: string | null
): { ok: boolean; id: string } {
  const id = crypto.getRandomValues(new Uint32Array(4)).join("");
  if (!canonical || !token) return { ok: false, id };

  const c = canonical.toLowerCase();
  const k = keyFor(c, token);

  try {
    const rec = safeParseRecord(localStorage.getItem(k));
    const now = nowMs();
    const stale = !rec || !Number.isFinite(rec.at) || now - rec.at > SEND_LOCK_TTL_MS;

    if (!rec || stale) {
      const next: SendLockRecord = { id, at: now };
      localStorage.setItem(k, JSON.stringify(next));

      try {
        const bc = new BroadcastChannel(SEND_LOCK_CH);
        const msg: SendLockWire = { type: "lock", canonical: c, token, id, at: now };
        bc.postMessage(msg);
        bc.close();
      } catch {
        noop();
      }

      return { ok: true, id };
    }
  } catch {
    noop();
  }

  return { ok: false, id };
}

/** Release lock if held by id (idempotent). */
export function releaseSendLock(canonical: string | null, token: string | null, id: string): void {
  if (!canonical || !token) return;

  const c = canonical.toLowerCase();
  const k = keyFor(c, token);

  try {
    const rec = safeParseRecord(localStorage.getItem(k));
    if (!rec || rec.id === id) {
      localStorage.removeItem(k);

      const now = nowMs();
      try {
        const bc = new BroadcastChannel(SEND_LOCK_CH);
        const msg: SendLockWire = { type: "unlock", canonical: c, token, id, at: now };
        bc.postMessage(msg);
        bc.close();
      } catch {
        noop();
      }
    }
  } catch {
    noop();
  }
}

/** Passive listener so UI reacts to cross-tab updates (no state kept here). */
export function attachSendLockChannel(onMessage?: (m: SendLockWire) => void): () => void {
  let bc: BroadcastChannel | null = null;

  try {
    bc = new BroadcastChannel(SEND_LOCK_CH);
    bc.onmessage = (ev: MessageEvent) => {
      const data = (ev as MessageEvent<unknown>).data;
      if (!data || typeof data !== "object") return;

      const rr = data as Partial<SendLockWire>;
      const type = rr.type === "lock" || rr.type === "unlock" ? rr.type : null;
      const canonical = typeof rr.canonical === "string" ? rr.canonical : null;
      const token = typeof rr.token === "string" ? rr.token : null;
      const id = typeof rr.id === "string" ? rr.id : null;
      const at = coerceAtMs(rr.at);

      if (!type || !canonical || !token || !id) return;
      onMessage?.({ type, canonical, token, id, at });
    };
  } catch {
    noop();
  }

  return () => {
    try {
      bc?.close?.();
    } catch {
      noop();
    }
  };
}
