// src/utils/usernameClaimRegistry.ts
// Memory Stream–backed registry for username-claim glyphs (explorer-ready).

import {
  USERNAME_CLAIM_KIND,
  type UsernameClaimRegistryEntry,
  type UsernameClaimGlyphEvidence,
} from "../types/usernameClaim";
import { normalizeClaimGlyphRef, normalizeUsername } from "./usernameClaim";
import { kaiNowMs } from "./kaiNow";

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
    const rec = parsed as Record<string, UsernameClaimRegistryEntry>;
    const out: UsernameClaimRegistry = {};
    for (const [k, v] of Object.entries(rec)) {
      if (!v || typeof v !== "object") continue;
      if (typeof v.normalized !== "string" || typeof v.claimHash !== "string") continue;
      out[k] = v as UsernameClaimRegistryEntry;
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

function mergeEntry(entry: UsernameClaimRegistryEntry): boolean {
  const registry = readRegistry();
  const existing = registry[entry.normalized];
  if (existing && existing.claimHash !== entry.claimHash) return false;

  const unchanged =
    existing &&
    existing.claimHash === entry.claimHash &&
    existing.claimUrl === entry.claimUrl &&
    existing.originHash === entry.originHash &&
    existing.ownerHint === entry.ownerHint;

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
    updatedAt: kaiNowMs(),
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
      const parsed = JSON.parse(ev.newValue) as UsernameClaimRegistry;
      for (const entry of Object.values(parsed)) {
        if (entry && typeof entry === "object" && mergeEntry(entry)) handler(entry, "storage");
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
