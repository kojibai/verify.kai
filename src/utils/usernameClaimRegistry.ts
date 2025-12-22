// src/utils/usernameClaimRegistry.ts
// Memory Stream–backed registry for username-claim glyphs (explorer-ready).

import {
  USERNAME_CLAIM_KIND,
  type UsernameClaimRegistryEntry,
  type UsernameClaimGlyphEvidence,
} from "../types/usernameClaim";
import { normalizeClaimGlyphRef, normalizeUsername } from "./usernameClaim";
import { kairosEpochNow } from "./kai_pulse";

export type UsernameClaimRegistry = Record<string, UsernameClaimRegistryEntry>;

const hasWindow = typeof window !== "undefined";
const LS_KEY = "kai:username-claims:v1" as const;
const CHANNEL_NAME = "kai-username-claims" as const;
const EVENT_NAME = "username-claim:registered" as const;
const BROADCAST_TYPE = "username-claim" as const;

let memoryRegistry: UsernameClaimRegistry = {};

function cloneRegistry(reg: UsernameClaimRegistry): UsernameClaimRegistry {
  return Object.fromEntries(Object.entries(reg)) as UsernameClaimRegistry;
}

/**
 * kairosEpochNow() returns bigint epoch-ms.
 * Registry types use number epoch-ms for updatedAt (UI sort / JSON / storage).
 */
function bigintToSafeNumber(b: bigint): number {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (b > max) return Number.MAX_SAFE_INTEGER;
  if (b < -max) return -Number.MAX_SAFE_INTEGER;
  return Number(b);
}

function nowMs(): number {
  return bigintToSafeNumber(kairosEpochNow());
}

/** Canonicalize URL to absolute when possible for explorer surfaces. */
function canonicalizeUrl(raw: string): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;

  if (!hasWindow) return t;

  try {
    const u = new URL(t, window.location?.origin ?? undefined);
    return u.toString();
  } catch {
    return t;
  }
}

function coerceUpdatedAt(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "bigint") return bigintToSafeNumber(v);
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function normalizeEntryUnsafe(v: unknown): UsernameClaimRegistryEntry | null {
  if (!v || typeof v !== "object") return null;
  const rr = v as Record<string, unknown>;

  const normalized = typeof rr.normalized === "string" ? rr.normalized : "";
  const claimHash = typeof rr.claimHash === "string" ? rr.claimHash : "";
  if (!normalized || !claimHash) return null;

  const entry: UsernameClaimRegistryEntry = {
    username: typeof rr.username === "string" ? rr.username : normalized,
    normalized,
    claimHash,
    claimUrl: typeof rr.claimUrl === "string" ? rr.claimUrl : "",
    originHash: typeof rr.originHash === "string" ? rr.originHash : "",
    ownerHint:
      rr.ownerHint === null || typeof rr.ownerHint === "string" ? (rr.ownerHint as string | null) : null,
    updatedAt: coerceUpdatedAt(rr.updatedAt),
  };

  if (!entry.claimUrl || !entry.originHash) return null;
  return entry;
}

function readRegistry(): UsernameClaimRegistry {
  if (!hasWindow) return cloneRegistry(memoryRegistry);
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) {
      memoryRegistry = {};
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const rec = parsed as Record<string, unknown>;
    const out: UsernameClaimRegistry = {};
    for (const [k, v] of Object.entries(rec)) {
      const entry = normalizeEntryUnsafe(v);
      if (!entry) continue;
      out[k] = entry;
    }
    memoryRegistry = cloneRegistry(out);
    return cloneRegistry(out);
  } catch {
    return cloneRegistry(memoryRegistry);
  }
}

function writeRegistry(reg: UsernameClaimRegistry): void {
  memoryRegistry = cloneRegistry(reg);
  if (!hasWindow) return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(reg));
  } catch {
    /* ignore */
  }
}

let _bc: BroadcastChannel | null = null;
function getBroadcastChannel(): BroadcastChannel | null {
  if (!hasWindow) return null;
  if (!("BroadcastChannel" in window)) return null;
  if (_bc) return _bc;
  _bc = new BroadcastChannel(CHANNEL_NAME);
  return _bc;
}

function mergeEntry(entryIn: UsernameClaimRegistryEntry): boolean {
  const registry = readRegistry();

  // Coerce updatedAt defensively in case a wire/store payload carries bigint/string.
  const entry: UsernameClaimRegistryEntry = {
    ...entryIn,
    updatedAt: coerceUpdatedAt((entryIn as unknown as Record<string, unknown>)?.updatedAt),
  };

  const existing = registry[entry.normalized];
  if (existing && existing.claimHash !== entry.claimHash) return false;

  const unchanged =
    existing &&
    existing.claimHash === entry.claimHash &&
    existing.claimUrl === entry.claimUrl &&
    existing.originHash === entry.originHash &&
    existing.ownerHint === entry.ownerHint &&
    existing.updatedAt === entry.updatedAt;

  if (unchanged) return true;

  registry[entry.normalized] = entry;
  writeRegistry(registry);
  return true;
}

function broadcast(entry: UsernameClaimRegistryEntry): void {
  if (!hasWindow) return;

  // CustomEvent for same-tab listeners
  try {
    const evt = new CustomEvent(EVENT_NAME, { detail: entry });
    window.dispatchEvent(evt);
  } catch {
    /* ignore */
  }

  // BroadcastChannel for cross-tab sync
  try {
    const bc = getBroadcastChannel();
    bc?.postMessage({ type: BROADCAST_TYPE, entry });
  } catch {
    /* ignore */
  }
}

export type IngestResult = {
  accepted: boolean;
  updated: boolean;
  reason?: string;
  registry: UsernameClaimRegistry;
};

function upsertEntry(
  registry: UsernameClaimRegistry,
  ref: UsernameClaimGlyphEvidence,
): { updated: boolean; entry?: UsernameClaimRegistryEntry; reason?: string } {
  const payload = ref.payload;
  if (!payload || payload.kind !== USERNAME_CLAIM_KIND) {
    return { updated: false, reason: "not a username-claim glyph" };
  }

  const claimHash = normalizeClaimGlyphRef(ref.hash);
  if (!claimHash) return { updated: false, reason: "missing glyph hash" };

  const normalized = normalizeUsername(payload.normalized || payload.username);
  if (!normalized) return { updated: false, reason: "missing username" };

  const current = registry[normalized];
  if (current && current.claimHash !== claimHash) {
    return { updated: false, reason: "username already bound" };
  }

  const claimUrl = canonicalizeUrl(ref.url ?? "");
  if (!claimUrl) return { updated: false, reason: "missing claim url" };

  const ownerHint = ref.ownerHint ?? payload.ownerHint ?? null;

  const entry: UsernameClaimRegistryEntry = {
    username: payload.username,
    normalized,
    claimHash,
    claimUrl,
    originHash: payload.originHash,
    ownerHint,
    updatedAt: nowMs(), // ✅ number, derived from Kairos bigint
  };

  const unchanged =
    current &&
    current.claimHash === entry.claimHash &&
    current.claimUrl === entry.claimUrl &&
    current.originHash === entry.originHash &&
    current.ownerHint === entry.ownerHint;

  registry[normalized] = entry;
  return { updated: !unchanged, entry };
}

/** Ingest a single username-claim glyph into the global registry. */
export function ingestUsernameClaimGlyph(ref: UsernameClaimGlyphEvidence): IngestResult {
  const registry = readRegistry();
  const { updated, entry, reason } = upsertEntry(registry, ref);

  if (!updated) {
    return { accepted: Boolean(entry), updated: false, reason, registry };
  }

  writeRegistry(registry);
  if (entry) broadcast(entry);
  return { accepted: true, updated: true, registry };
}

/** Batch-ingest multiple username-claim glyphs; stops on first rejection. */
export function ingestUsernameClaimGlyphs(refs: UsernameClaimGlyphEvidence[]): IngestResult {
  const registry = readRegistry();
  for (const ref of refs) {
    const { updated, entry, reason } = upsertEntry(registry, ref);
    if (!updated && !entry) {
      return { accepted: false, updated: false, reason, registry };
    }
    if (!updated) continue; // idempotent replay
    writeRegistry(registry);
    if (entry) broadcast(entry);
  }
  return { accepted: true, updated: true, registry };
}

/** Read-only snapshot of the current registry (SSR-safe). */
export function getUsernameClaimRegistry(): UsernameClaimRegistry {
  return readRegistry();
}

export type UsernameClaimRegistrySource = "event" | "broadcast" | "storage";

/** Subscribe to registry updates across tabs. */
export function subscribeUsernameClaimRegistry(
  handler: (entry: UsernameClaimRegistryEntry, source: UsernameClaimRegistrySource) => void,
): () => void {
  if (!hasWindow) return () => {};

  const onEvent = (ev: Event) => {
    const ce = ev as CustomEvent<UsernameClaimRegistryEntry>;
    if (ce?.detail && mergeEntry(ce.detail)) handler(ce.detail, "event");
  };

  const bc = getBroadcastChannel();
  const onMsg = (ev: MessageEvent) => {
    const data = ev?.data as { type?: string; entry?: UsernameClaimRegistryEntry } | undefined;
    if (data?.type === BROADCAST_TYPE && data.entry && mergeEntry(data.entry)) {
      handler(data.entry, "broadcast");
    }
  };

  const onStorage = (ev: StorageEvent) => {
    if (ev.key !== LS_KEY || typeof ev.newValue !== "string") return;
    try {
      const parsed = JSON.parse(ev.newValue) as Record<string, unknown>;
      for (const entryRaw of Object.values(parsed)) {
        const entry = normalizeEntryUnsafe(entryRaw);
        if (entry && mergeEntry(entry)) handler(entry, "storage");
      }
    } catch {
      /* ignore */
    }
  };

  window.addEventListener(EVENT_NAME, onEvent as EventListener);
  if (bc) bc.addEventListener("message", onMsg as EventListener);
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener(EVENT_NAME, onEvent as EventListener);
    if (bc) bc.removeEventListener("message", onMsg as EventListener);
    window.removeEventListener("storage", onStorage);
  };
}
