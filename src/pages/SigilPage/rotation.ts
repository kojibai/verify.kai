// Link rotation (burn old tokens, broadcast new)

import { kairosEpochNow } from "../../utils/kai_pulse";

export const ROTATE_CH = "sigil-xfer-v1";
export const ROTATION_EVENT = "sigil:transfer-rotated";
export const ROTATION_ERROR_EVENT = "sigil:rotation-error";

export type RotationMsg = { type: "rotated"; canonical: string; token: string };
export type RotationErrorDetail = {
  stage: "localStorage" | "broadcast" | "dispatch" | "input";
  canonical: string;
  token: string;
  error: Record<string, unknown>;
};

export const rotationKey = (h: string) => `sigil:rotated:${h}`;

const CANONICAL_HEX = /^[0-9a-f]{64}$/;

/** Normalize unknown errors into a simple object for safe transport. */
function normalizeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack ?? null };
  }
  if (typeof err === "object" && err !== null) {
    return err as Record<string, unknown>;
  }
  return { message: String(err) };
}

/** Best-effort async dispatcher that never throws synchronously. */
function dispatchAsync(eventName: string, detail: unknown): void {
  if (typeof window === "undefined") return;
  setTimeout(() => {
    try {
      window.dispatchEvent(new CustomEvent(eventName, { detail }));
    } catch {
      // As a last resort, swallow to avoid cascading failures while still satisfying no-empty-catch.
      void 0;
    }
  }, 0);
}

export function publishRotation(keys: readonly string[], token: string): void {
  const now = kairosEpochNow();

  // Deduplicate, normalize, and validate keys
  const uniq = Array.from(
    new Set(
      keys
        .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
        .map((k) => k.trim().toLowerCase()),
    ),
  );

  for (const canonical of uniq) {
    if (!CANONICAL_HEX.test(canonical)) {
      dispatchAsync(ROTATION_ERROR_EVENT, {
        stage: "input",
        canonical,
        token,
        error: { message: "Invalid canonical hash; expected 64 hex chars." },
      } as RotationErrorDetail);
      continue;
    }

    // 1) Persist latest rotation token locally (best-effort)
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(rotationKey(canonical), `${token}@${now}`);
      }
    } catch (err) {
      dispatchAsync(ROTATION_ERROR_EVENT, {
        stage: "localStorage",
        canonical,
        token,
        error: normalizeError(err),
      } as RotationErrorDetail);
    }

    // 2) Broadcast to same-origin tabs via BroadcastChannel (best-effort)
    try {
      if (typeof window !== "undefined" && "BroadcastChannel" in window) {
        const bc = new BroadcastChannel(ROTATE_CH);
        try {
          const msg: RotationMsg = { type: "rotated", canonical, token };
          bc.postMessage(msg);
        } catch (err) {
          dispatchAsync(ROTATION_ERROR_EVENT, {
            stage: "broadcast",
            canonical,
            token,
            error: normalizeError(err),
          } as RotationErrorDetail);
        } finally {
          try {
            bc.close();
          } catch (err) {
            dispatchAsync(ROTATION_ERROR_EVENT, {
              stage: "broadcast",
              canonical,
              token,
              error: normalizeError(err),
            } as RotationErrorDetail);
          }
        }
      }
    } catch (err) {
      // Constructing BroadcastChannel itself failed
      dispatchAsync(ROTATION_ERROR_EVENT, {
        stage: "broadcast",
        canonical,
        token,
        error: normalizeError(err),
      } as RotationErrorDetail);
    }

    // 3) Fire a DOM-level CustomEvent for any in-page listeners (best-effort)
    try {
      if (typeof window !== "undefined") {
        const domMsg: RotationMsg = { type: "rotated", canonical, token };
        window.dispatchEvent(new CustomEvent<RotationMsg>(ROTATION_EVENT, { detail: domMsg }));
      }
    } catch (err) {
      dispatchAsync(ROTATION_ERROR_EVENT, {
        stage: "dispatch",
        canonical,
        token,
        error: normalizeError(err),
      } as RotationErrorDetail);
    }
  }
}
