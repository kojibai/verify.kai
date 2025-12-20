// v48 send-lock utils (atomic exhale guard)
import { kaiNowMs } from "./kaiNow";

export const SEND_LOCK_CH = "sigil-sendlock-v1";
export const SEND_LOCK_TTL_MS = 15_000;

const keyFor = (canonical: string, token: string) =>
  `sigil:sendlock:${canonical}:t:${token}`;

export type SendLockRecord = { id: string; at: number };
export type SendLockWire = {
  type: "lock" | "unlock";
  canonical: string;
  token: string;
  id: string;
  at: number;
};

export const nowMs = () => kaiNowMs();

const noop = () => { /* intentionally empty */ };

/** Acquire a short TTL lock keyed by (canonical, token). */
export function acquireSendLock(
  canonical: string | null,
  token: string | null
): { ok: boolean; id: string } {
  const id = crypto.getRandomValues(new Uint32Array(4)).join("");
  if (!canonical || !token) return { ok: false, id };
  const k = keyFor(canonical.toLowerCase(), token);
  try {
    const raw = localStorage.getItem(k);
    const rec: SendLockRecord | null = raw ? JSON.parse(raw) : null;
    const stale = !rec || !Number.isFinite(rec.at) || nowMs() - rec.at > SEND_LOCK_TTL_MS;
    if (!rec || stale) {
      localStorage.setItem(k, JSON.stringify({ id, at: nowMs() } as SendLockRecord));
      try {
        const bc = new BroadcastChannel(SEND_LOCK_CH);
        const msg: SendLockWire = { type: "lock", canonical: canonical.toLowerCase(), token, id, at: nowMs() };
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
  const k = keyFor(canonical.toLowerCase(), token);
  try {
    const raw = localStorage.getItem(k);
    const rec: SendLockRecord | null = raw ? JSON.parse(raw) : null;
    if (!rec || rec.id === id) {
      localStorage.removeItem(k);
      try {
        const bc = new BroadcastChannel(SEND_LOCK_CH);
        const msg: SendLockWire = { type: "unlock", canonical: canonical.toLowerCase(), token, id, at: nowMs() };
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
    bc.onmessage = (ev: MessageEvent<SendLockWire>) => {
      onMessage?.(ev.data);
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
