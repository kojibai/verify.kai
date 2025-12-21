// lib/sync/ipfsAdapter.ts
// Minimal IPFS HTTP adapter that implements: export interface IpfsLike { publish(buf: Uint8Array): Promise<{ headCid: string }> }

import { kairosEpochNow } from "../../utils/kai_pulse";

export type PublishResult = { headCid: string };

export interface IpfsLike {
  publish(buf: Uint8Array): Promise<PublishResult>;
}

/**
 * Options for the HTTP adapter.
 * - endpoint: base URL of an IPFS API endpoint, e.g. "https://ipfs.infura.io:5001"
 * - authToken: optional Bearer token for providers that require auth
 * - requestInit: optional extra fetch init (headers, mode, etc.)
 * - maxConsecutiveFailures: after this many failures, stop hitting network and soft-fail (default 2)
 * - cooldownMs: while in soft-fail, how long to wait before trying the network again once (default 5 min)
 * - quiet: if true, never log warnings when falling back (default true)
 */
export type IpfsHttpOptions = {
  endpoint: string;
  authToken?: string;
  requestInit?: Omit<RequestInit, "method" | "body" | "headers"> & {
    headers?: Record<string, string>;
  };
  maxConsecutiveFailures?: number;
  cooldownMs?: number;
  quiet?: boolean;
};

/** Shapes seen from /api/v0/add responses (single file case). */
type IpfsAddLegacy = { Name?: string; Hash?: string; Size?: string };
type IpfsAddCidObject = { "/": string };
type IpfsAddModern = { Name?: string; Cid?: IpfsAddCidObject; Size?: string };
type IpfsAddResponse = IpfsAddLegacy & IpfsAddModern;

/** In-memory NOP adapter (deterministic pseudo-CID) */
export function createNopAdapter(): IpfsLike & { store: Map<string, Uint8Array> } {
  const store = new Map<string, Uint8Array>();
  let seq = 0;
  const pseudoCid = (bytes: Uint8Array): string => {
    // FNV-1a 32-bit
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `inmem-${(++seq).toString(36)}-${h.toString(16).padStart(8, "0")}`;
  };
  return {
    store,
    async publish(buf: Uint8Array): Promise<PublishResult> {
      const id = pseudoCid(buf);
      store.set(id, buf);
      return { headCid: id };
    },
  };
}

/** Safely convert any Uint8Array view to a real ArrayBuffer (not SharedArrayBuffer) */
function toArrayBufferStrict(view: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(view.byteLength);
  new Uint8Array(ab).set(view);
  return ab;
}

/**
 * Create an IpfsLike that talks to a standard IPFS HTTP API (`/api/v0/add`).
 * Soft-fail & cooldown behavior:
 *  - Throw for the first < threshold failures (to surface setup).
 *  - After `maxConsecutiveFailures`, stop hitting network; return NOP CIDs.
 *  - After `cooldownMs`, try network once; on failure, remain in fallback.
 */
export function createIpfsHttpAdapter(opts: IpfsHttpOptions): IpfsLike {
  const {
    endpoint,
    authToken,
    requestInit,
    maxConsecutiveFailures = 2,
    cooldownMs = 5 * 60 * 1000,
    quiet = true,
  } = opts;

  const base = endpoint.replace(/\/+$/, "");
  const addUrl = `${base}/api/v0/add?pin=true&cid-version=1&raw-leaves=true`;

  // circuit-breaker state
  let consecutiveFailures = 0;
  let fallbackActive = false;
  let lastFailureAt = 0;
  let warnedOnce = false;
  const nop = createNopAdapter();

  const warnOnce = (msg: string): void => {
    if (quiet || warnedOnce) return;
    try {
      // eslint-disable-next-line no-console
      console.warn(msg);
    } catch { /* ignore */ }
    warnedOnce = true;
  };

  const tryNetworkAdd = async (buf: Uint8Array): Promise<PublishResult> => {
    const form = new FormData();
    // FIX: ensure BlobPart is a real ArrayBuffer (not ArrayBufferLike from a SAB view)
    const ab = toArrayBufferStrict(buf);
    const blob = new Blob([ab], { type: "application/octet-stream" });
    form.append("file", blob, "payload.bin");

    const headers: Record<string, string> = { ...(requestInit?.headers ?? {}) };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;

    const res = await fetch(addUrl, { method: "POST", body: form, ...requestInit, headers });

    if (!res.ok) {
      let detail = "";
      try {
        detail = await res.text();
      } catch { /* ignore */ }
      throw new Error(
        `[ipfsAdapter] HTTP ${res.status} ${res.statusText} while adding file${detail ? ` — ${detail}` : ""}`
      );
    }

    const text = await res.text();
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) throw new Error("[ipfsAdapter] Empty response from IPFS add");

    const last: IpfsAddResponse = JSON.parse(lines[lines.length - 1]) as IpfsAddResponse;
    const cidFromLegacy = typeof last.Hash === "string" ? last.Hash : undefined;
    const cidFromModern = last.Cid && typeof last.Cid["/"] === "string" ? last.Cid["/"] : undefined;
    const cid = cidFromLegacy ?? cidFromModern;
    if (!cid) throw new Error("[ipfsAdapter] Could not parse CID from IPFS add response");

    return { headCid: cid };
  };

  const softFail = async (buf: Uint8Array): Promise<PublishResult> => {
    fallbackActive = true;
    lastFailureAt = kairosEpochNow();
    warnOnce("[ipfsAdapter] IPFS not ready; using in-memory fallback. Will retry later.");
    return nop.publish(buf);
  };

  return {
    async publish(buf: Uint8Array): Promise<PublishResult> {
      const now = kairosEpochNow();

      if (fallbackActive) {
        if (now - lastFailureAt < cooldownMs) {
          return nop.publish(buf);
        }
        // cooldown elapsed → try network once
        try {
          const out = await tryNetworkAdd(buf);
          consecutiveFailures = 0;
          fallbackActive = false;
          warnedOnce = false;
          return out;
        } catch {
          // FIX: no-unused-vars — no var name in catch
          lastFailureAt = now;
          return nop.publish(buf);
        }
      }

      try {
        const out = await tryNetworkAdd(buf);
        consecutiveFailures = 0;
        return out;
      } catch (err: unknown) {
        consecutiveFailures += 1;
        lastFailureAt = now;

        if (consecutiveFailures < maxConsecutiveFailures) {
          throw err instanceof Error ? err : new Error("[ipfsAdapter] Unknown error");
        }
        return softFail(buf);
      }
    },
  };
}

/**
 * Default export adapter via env.
 */
const DEFAULT_ENDPOINT =
  (typeof process !== "undefined" &&
    (process.env.NEXT_PUBLIC_IPFS_API || process.env.IPFS_API)) ||
  "https://ipfs.infura.io:5001";

const DEFAULT_AUTH =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_IPFS_AUTH || process.env.IPFS_AUTH
    : undefined;

const envNumber = (keys: string[], fallback: number): number => {
  if (typeof process === "undefined") return fallback;
  for (const k of keys) {
    const v = process.env[k];
    if (v && !Number.isNaN(Number(v))) return Number(v);
  }
  return fallback;
};

const envBoolean = (keys: string[], fallback: boolean): boolean => {
  if (typeof process === "undefined") return fallback;
  for (const k of keys) {
    const v = process.env[k];
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (s === "true" || s === "1") return true;
      if (s === "false" || s === "0") return false;
    }
  }
  return fallback;
};

const DEFAULT_FAILS_BEFORE_NOP = envNumber(
  ["NEXT_PUBLIC_IPFS_FAILS_BEFORE_NOP", "IPFS_FAILS_BEFORE_NOP"],
  2
);
const DEFAULT_COOLDOWN_MS = envNumber(
  ["NEXT_PUBLIC_IPFS_COOLDOWN_MS", "IPFS_COOLDOWN_MS"],
  5 * 60 * 1000
);
const DEFAULT_QUIET = envBoolean(["NEXT_PUBLIC_IPFS_QUIET", "IPFS_QUIET"], true);

export const ipfs: IpfsLike = createIpfsHttpAdapter({
  endpoint: DEFAULT_ENDPOINT,
  authToken: DEFAULT_AUTH,
  maxConsecutiveFailures: DEFAULT_FAILS_BEFORE_NOP,
  cooldownMs: DEFAULT_COOLDOWN_MS,
  quiet: DEFAULT_QUIET,
});

export const ipfsNop = createNopAdapter();
