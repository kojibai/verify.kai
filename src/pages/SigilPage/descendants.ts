// Local lineage storage + cross-tab sync for minted children

import { kairosEpochNow } from "../../utils/kai_pulse";

export const DESC_CH = "sigil-lineage-v1";
export const DESC_EVENT = "sigil:descendants";
export const DESC_ERROR_EVENT = "sigil:descendants-error";


const epochMsNowNumber = (): number => {
  const ms = Number(kairosEpochNow()); // bigint -> number
  return Number.isFinite(ms) ? ms : 0;
};

export type DescendantLocal = {
  token: string;
  parentToken: string | null;
  amount: number;
  timestamp: number;
  depth: number;
  recipientPhiKey?: string | null;
};

export type DescendantsMsg = {
  type: "descendants";
  canonical: string;
  token: string;
  list: DescendantLocal[];
  stamp: number;
};

type DescendantsErrorDetail = {
  stage: "input" | "read" | "parse" | "write" | "broadcast-construct" | "broadcast-post" | "broadcast-close" | "dispatch";
  canonical: string;
  token: string | null;
  error: Record<string, unknown>;
};

export const descendantsKey = (canonical: string, token: string | null) =>
  token ? `sigil:desc:${canonical}:t:${token}` : `sigil:desc:${canonical}`;

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
      // best-effort: also emit an error event
      try {
        window.dispatchEvent(
          new CustomEvent(DESC_ERROR_EVENT, {
            detail: { stage: "dispatch", error: normalizeError(e) },
          }),
        );
      } catch {
        // last resort: no-op
      }
    }
  }, 0);
};

export function readDescendantsStored(
  canonical?: string | null,
  token?: string | null,
): DescendantLocal[] {
  const c = (canonical || "").toLowerCase();
  if (!c || !token) {
    dispatchAsync(DESC_ERROR_EVENT, {
      stage: "input",
      canonical: c,
      token: token ?? null,
      error: { message: "Missing canonical or token." },
    } as DescendantsErrorDetail);
    return [];
  }

  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(descendantsKey(c, token));
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw) as unknown;
      return Array.isArray(arr) ? (arr as DescendantLocal[]) : [];
    } catch (e) {
      dispatchAsync(DESC_ERROR_EVENT, {
        stage: "parse",
        canonical: c,
        token,
        error: normalizeError(e),
      } as DescendantsErrorDetail);
      return [];
    }
  } catch (e) {
    dispatchAsync(DESC_ERROR_EVENT, {
      stage: "read",
      canonical: c,
      token,
      error: normalizeError(e),
    } as DescendantsErrorDetail);
    return [];
  }
}

export function writeDescendantsStored(
  canonical?: string | null,
  token?: string | null,
  list?: DescendantLocal[],
): void {
  const c = (canonical || "").toLowerCase();
  if (!c || !token) {
    dispatchAsync(DESC_ERROR_EVENT, {
      stage: "input",
      canonical: c,
      token: token ?? null,
      error: { message: "Missing canonical or token." },
    } as DescendantsErrorDetail);
    return;
  }

  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(descendantsKey(c, token), JSON.stringify(list || []));
    }
  } catch (e) {
    dispatchAsync(DESC_ERROR_EVENT, {
      stage: "write",
      canonical: c,
      token,
      error: normalizeError(e),
    } as DescendantsErrorDetail);
  }
}

export function broadcastDescendants(
  canonical: string,
  token: string,
  list: DescendantLocal[],
): void {
  const c = canonical.toLowerCase();
  const msg: DescendantsMsg = {
    type: "descendants",
    canonical: c,
    token,
    list,
    stamp: epochMsNowNumber(),
  };

  // DOM event for in-page listeners (best-effort)
  dispatchAsync(DESC_EVENT, msg);

  // BroadcastChannel for cross-tab sync (best-effort)
  try {
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      const bc = new BroadcastChannel(DESC_CH);
      try {
        bc.postMessage(msg);
      } catch (e) {
        dispatchAsync(DESC_ERROR_EVENT, {
          stage: "broadcast-post",
          canonical: c,
          token,
          error: normalizeError(e),
        } as DescendantsErrorDetail);
      } finally {
        try {
          bc.close();
        } catch (e) {
          dispatchAsync(DESC_ERROR_EVENT, {
            stage: "broadcast-close",
            canonical: c,
            token,
            error: normalizeError(e),
          } as DescendantsErrorDetail);
        }
      }
    }
  } catch (e) {
    dispatchAsync(DESC_ERROR_EVENT, {
      stage: "broadcast-construct",
      canonical: c,
      token,
      error: normalizeError(e),
    } as DescendantsErrorDetail);
  }
}
