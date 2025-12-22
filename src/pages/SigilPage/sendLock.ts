// v48 atomic send lock helpers (BroadcastChannel + localStorage)

import { kairosEpochNow } from "../../utils/kai_pulse";

export const SEND_LOCK_CH = "sigil-sendlock-v1";
export const SEND_LOCK_EVENT = "sigil:sendlock";
export const SEND_LOCK_ERROR_EVENT = "sigil:sendlock-error";

const SEND_LOCK_TTL_MS = 15_000;

export type SendLockWire = {
  type: "lock" | "unlock";
  canonical: string;
  token: string;
  id: string;
  at: number; // epoch-ms (number) for JSON/localStorage + cross-tab messaging
};

export type SendLockRecord = { id: string; at: number };

type SendLockErrorDetail = {
  stage:
    | "input"
    | "read"
    | "parse"
    | "stale-check"
    | "write"
    | "broadcast-construct"
    | "broadcast-post"
    | "broadcast-close"
    | "remove";
  canonical: string;
  token: string;
  id: string;
  error: Record<string, unknown>;
};

/**
 * kairosEpochNow() is bigint; this lock layer persists timestamps in JSON,
 * so we downcast to number (safe at present epoch scales).
 */
const nowMs = (): number => {
  const b = kairosEpochNow();
  const n = Number(b);
  // best-effort safety: avoid NaN/Infinity
  if (!Number.isFinite(n)) return Number.MAX_SAFE_INTEGER;
  return n;
};

const sendLockKey = (canonical: string, token: string) =>
  `sigil:sendlock:${canonical}:t:${token}`;

const normalizeError = (err: unknown): Record<string, unknown> => {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack ?? null };
  }
  if (typeof err === "object" && err !== null) return err as Record<string, unknown>;
  return { message: String(err) };
};

const dispatchAsync = (eventName: string, detail: unknown): void => {
  if (typeof window === "undefined") return;
  setTimeout(() => {
    try {
      window.dispatchEvent(new CustomEvent(eventName, { detail }));
    } catch (e) {
      // Intentionally report but do not throw synchronously
      const err = normalizeError(e);
      try {
        window.dispatchEvent(
          new CustomEvent(SEND_LOCK_ERROR_EVENT, {
            detail: { stage: "broadcast-post", error: err },
          }),
        );
      } catch {
        // last resort: no-op
      }
    }
  }, 0);
};

const generateId = (): string => {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const a = new Uint32Array(4);
      crypto.getRandomValues(a);
      return Array.from(a, (n) => n.toString(36)).join("");
    }
  } catch {
    // fall through
  }
  const t = nowMs();
  return `${t.toString(36)}-${Math.random().toString(36).slice(2)}`;
};

export function acquireSendLock(
  canonical: string | null,
  token: string | null,
): { ok: boolean; id: string } {
  const id = generateId();

  if (!canonical || !token) {
    dispatchAsync(SEND_LOCK_ERROR_EVENT, {
      stage: "input",
      canonical: canonical ?? "",
      token: token ?? "",
      id,
      error: { message: "Missing canonical or token." },
    } as SendLockErrorDetail);
    return { ok: false, id };
  }

  const c = canonical.toLowerCase();
  const key = sendLockKey(c, token);

  let rec: SendLockRecord | null = null;

  // Read existing
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (
            typeof parsed === "object" &&
            parsed !== null &&
            typeof (parsed as Record<string, unknown>).id === "string" &&
            typeof (parsed as Record<string, unknown>).at === "number"
          ) {
            rec = parsed as SendLockRecord;
          } else {
            rec = null;
          }
        } catch (e) {
          dispatchAsync(SEND_LOCK_ERROR_EVENT, {
            stage: "parse",
            canonical: c,
            token,
            id,
            error: normalizeError(e),
          } as SendLockErrorDetail);
          rec = null;
        }
      }
    }
  } catch (e) {
    dispatchAsync(SEND_LOCK_ERROR_EVENT, {
      stage: "read",
      canonical: c,
      token,
      id,
      error: normalizeError(e),
    } as SendLockErrorDetail);
    // proceed; we'll try to acquire anyway
  }

  const stale = !rec || !Number.isFinite(rec.at) || nowMs() - rec.at > SEND_LOCK_TTL_MS;

  if (!rec || stale) {
    // Write lock
    try {
      if (typeof localStorage !== "undefined") {
        const payload: SendLockRecord = { id, at: nowMs() };
        localStorage.setItem(key, JSON.stringify(payload));
      }
    } catch (e) {
      dispatchAsync(SEND_LOCK_ERROR_EVENT, {
        stage: "write",
        canonical: c,
        token,
        id,
        error: normalizeError(e),
      } as SendLockErrorDetail);
      // If we cannot persist, treat as not acquired to be safe
      return { ok: false, id };
    }

    // Broadcast lock
    try {
      if (typeof window !== "undefined" && "BroadcastChannel" in window) {
        const bc = new BroadcastChannel(SEND_LOCK_CH);
        try {
          const msg: SendLockWire = { type: "lock", canonical: c, token, id, at: nowMs() };
          bc.postMessage(msg);
          dispatchAsync(SEND_LOCK_EVENT, msg);
        } catch (e) {
          dispatchAsync(SEND_LOCK_ERROR_EVENT, {
            stage: "broadcast-post",
            canonical: c,
            token,
            id,
            error: normalizeError(e),
          } as SendLockErrorDetail);
        } finally {
          try {
            bc.close();
          } catch (e) {
            dispatchAsync(SEND_LOCK_ERROR_EVENT, {
              stage: "broadcast-close",
              canonical: c,
              token,
              id,
              error: normalizeError(e),
            } as SendLockErrorDetail);
          }
        }
      }
    } catch (e) {
      dispatchAsync(SEND_LOCK_ERROR_EVENT, {
        stage: "broadcast-construct",
        canonical: c,
        token,
        id,
        error: normalizeError(e),
      } as SendLockErrorDetail);
    }

    return { ok: true, id };
  }

  // Existing live lock; report stale-check decision
  dispatchAsync(SEND_LOCK_ERROR_EVENT, {
    stage: "stale-check",
    canonical: c,
    token,
    id,
    error: { message: "Lock already held and not stale." },
  } as SendLockErrorDetail);

  return { ok: false, id };
}

export function releaseSendLock(
  canonical: string | null,
  token: string | null,
  id: string,
): void {
  if (!canonical || !token) {
    dispatchAsync(SEND_LOCK_ERROR_EVENT, {
      stage: "input",
      canonical: canonical ?? "",
      token: token ?? "",
      id,
      error: { message: "Missing canonical or token." },
    } as SendLockErrorDetail);
    return;
  }

  const c = canonical.toLowerCase();
  const key = sendLockKey(c, token);

  let rec: SendLockRecord | null = null;

  // Read current lock
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          typeof (parsed as Record<string, unknown>).id === "string" &&
          typeof (parsed as Record<string, unknown>).at === "number"
        ) {
          rec = parsed as SendLockRecord;
        } else {
          rec = null;
        }
      }
    }
  } catch (e) {
    dispatchAsync(SEND_LOCK_ERROR_EVENT, {
      stage: "read",
      canonical: c,
      token,
      id,
      error: normalizeError(e),
    } as SendLockErrorDetail);
    // Continue; we'll attempt to remove anyway
  }

  // Remove if no record or if caller owns the lock
  if (!rec || rec.id === id) {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(key);
      }
    } catch (e) {
      dispatchAsync(SEND_LOCK_ERROR_EVENT, {
        stage: "remove",
        canonical: c,
        token,
        id,
        error: normalizeError(e),
      } as SendLockErrorDetail);
      // Continue to broadcast even if local removal failed
    }

    // Broadcast unlock
    try {
      if (typeof window !== "undefined" && "BroadcastChannel" in window) {
        const bc = new BroadcastChannel(SEND_LOCK_CH);
        try {
          const msg: SendLockWire = { type: "unlock", canonical: c, token, id, at: nowMs() };
          bc.postMessage(msg);
          dispatchAsync(SEND_LOCK_EVENT, msg);
        } catch (e) {
          dispatchAsync(SEND_LOCK_ERROR_EVENT, {
            stage: "broadcast-post",
            canonical: c,
            token,
            id,
            error: normalizeError(e),
          } as SendLockErrorDetail);
        } finally {
          try {
            bc.close();
          } catch (e) {
            dispatchAsync(SEND_LOCK_ERROR_EVENT, {
              stage: "broadcast-close",
              canonical: c,
              token,
              id,
              error: normalizeError(e),
            } as SendLockErrorDetail);
          }
        }
      }
    } catch (e) {
      dispatchAsync(SEND_LOCK_ERROR_EVENT, {
        stage: "broadcast-construct",
        canonical: c,
        token,
        id,
        error: normalizeError(e),
      } as SendLockErrorDetail);
    }
  }
}
