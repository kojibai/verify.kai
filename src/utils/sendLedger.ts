// src/utils/sendLedger.ts
// Deterministic local send ledger for Kai-Sigil flows.
// - Stores ALL amounts as Φ·10^18 BigInt strings (deterministic math, no floats)
// - Normalizes canonicals to lowercase
// - Computes a deterministic record id (sha256 over a fixed-key payload)
// - Broadcasts changes across tabs via BroadcastChannel
// - Exposes helpers for parent-spent and child-incoming base lookups

import { sha256Hex } from "../components/VerifierStamper/crypto"; // adjust path if needed
import { kaiNowMs } from "./kaiNow";

/* ──────────────────────────
   Storage + Broadcast setup
────────────────────────── */
const LS_SENDS = "kai:sends:v1";
const MIGRATE_KEYS = ["sigil:send-ledger"]; // best-effort compatibility
const BC_SENDS = "kai-sends-v1";

const hasWindow = typeof window !== "undefined";
const canStorage = hasWindow && !!window.localStorage;
const channel: BroadcastChannel | null =
  hasWindow && "BroadcastChannel" in window ? new BroadcastChannel(BC_SENDS) : null;

/* ──────────────────────────
   Types
────────────────────────── */
export type SendRecord = {
  id: string;                    // deterministic (sha256 of fixed payload)
  parentCanonical: string;       // lowercase
  childCanonical: string;        // lowercase
  amountPhiScaled: string;       // BigInt string (Φ·10^18)
  senderKaiPulse: number;        // pulse at SEND
  transferNonce: string;         // nonce
  senderStamp: string;           // sender stamp
  previousHeadRoot: string;      // v14 prev-head root at SEND
  transferLeafHashSend: string;  // leaf hash (SEND side)
  confirmed?: boolean;           // set true on receive
  createdAt: number;             // ms epoch
};

type LedgerEvent =
  | { type: "send:add"; record: SendRecord }
  | {
      type: "send:update";
      id?: string;
      parentCanonical?: string;
      childCanonical?: string;
    };

/* ──────────────────────────
   Utilities
────────────────────────── */
const lc = (s: string | undefined | null) => (s ? String(s).toLowerCase() : "");

function coerceBigIntString(v: unknown): string {
  // Ledger amounts are non-negative integers (scaled). Strip everything else.
  const s = typeof v === "string" ? v.trim() : String(v ?? "");
  if (!s) return "0";
  const clean = s.replace(/[^0-9]/g, "") || "0";
  return clean.replace(/^0+(?=\d)/, "") || "0";
}

function nowMs() {
  return kaiNowMs();
}

/* ──────────────────────────
   Read / Write (with migration)
────────────────────────── */
function readAllRaw(): unknown {
  if (!canStorage) return [];
  try {
    const raw = localStorage.getItem(LS_SENDS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function migrateIfNeeded(): void {
  if (!canStorage) return;
  try {
    const existing = localStorage.getItem(LS_SENDS);
    if (existing) return; // already present

    for (const key of MIGRATE_KEYS) {
      const prev = localStorage.getItem(key);
      if (!prev) continue;
      try {
        const arr = JSON.parse(prev);
        if (Array.isArray(arr)) {
          const migrated: SendRecord[] = [];
          for (const r of arr) {
            const rec = r || {};
            const parentCanonical = lc((rec.parentCanonical ?? rec.parent ?? rec.p) as string);
            const childCanonical = lc((rec.childCanonical ?? rec.child ?? rec.c) as string);
            const amountPhiScaled = coerceBigIntString(
              (rec.amountPhiScaled ?? rec.amountScaled ?? rec.a) as string
            );
            const senderKaiPulse = Number(rec.senderKaiPulse ?? rec.k ?? 0) || 0;
            const transferNonce = String(rec.transferNonce ?? rec.n ?? "");
            const senderStamp = String(rec.senderStamp ?? rec.s ?? "");
            const previousHeadRoot = String(rec.previousHeadRoot ?? rec.r ?? "");
            const transferLeafHashSend = String(rec.transferLeafHashSend ?? rec.l ?? "");
            const confirmed = !!rec.confirmed;
            const createdAt = Number(rec.createdAt ?? rec.t ?? nowMs()) || nowMs();

            if (!parentCanonical || !childCanonical) continue;

            migrated.push({
              id: "", // will fill below
              parentCanonical,
              childCanonical,
              amountPhiScaled,
              senderKaiPulse,
              transferNonce,
              senderStamp,
              previousHeadRoot,
              transferLeafHashSend,
              confirmed,
              createdAt,
            });
          }

          (async () => {
            for (const m of migrated) {
              m.id = await buildSendId({
                parentCanonical: m.parentCanonical,
                childCanonical: m.childCanonical,
                amountPhiScaled: m.amountPhiScaled,
                senderKaiPulse: m.senderKaiPulse,
                transferNonce: m.transferNonce,
                senderStamp: m.senderStamp,
                previousHeadRoot: m.previousHeadRoot,
                transferLeafHashSend: m.transferLeafHashSend,
              });
            }
            const uniq = new Map<string, SendRecord>();
            for (const m of migrated) uniq.set(m.id, m);
            writeAll(Array.from(uniq.values()));
          })();
          return;
        }
      } catch {
        /* ignore malformed prior store */
      }
    }
  } catch {
    /* ignore migration failures */
  }
}

function readAll(): SendRecord[] {
  migrateIfNeeded();
  const raw = readAllRaw();
  if (!Array.isArray(raw)) return [];
  const out: SendRecord[] = [];
  for (const r of raw) {
    try {
      const rr = r as Record<string, unknown>;
      const rec: SendRecord = {
        id: String(rr.id ?? ""),
        parentCanonical: lc(rr.parentCanonical as string),
        childCanonical: lc(rr.childCanonical as string),
        amountPhiScaled: coerceBigIntString(rr.amountPhiScaled),
        senderKaiPulse: Number(rr.senderKaiPulse ?? 0) || 0,
        transferNonce: String(rr.transferNonce ?? ""),
        senderStamp: String(rr.senderStamp ?? ""),
        previousHeadRoot: String(rr.previousHeadRoot ?? ""),
        transferLeafHashSend: String(rr.transferLeafHashSend ?? ""),
        confirmed: !!rr.confirmed,
        createdAt: Number(rr.createdAt ?? nowMs()) || nowMs(),
      };
      if (!rec.parentCanonical || !rec.childCanonical) continue;
      if (!rec.id) continue;
      out.push(rec);
    } catch {
      /* ignore corrupted row */
    }
  }
  out.sort((a, b) => a.createdAt - b.createdAt);
  return out;
}

function writeAll(list: SendRecord[]) {
  if (!canStorage) return;
  try {
    const clean = list.map((r) => ({
      ...r,
      parentCanonical: lc(r.parentCanonical),
      childCanonical: lc(r.childCanonical),
      amountPhiScaled: coerceBigIntString(r.amountPhiScaled),
      createdAt: Number(r.createdAt || nowMs()) || nowMs(),
    }));
    localStorage.setItem(LS_SENDS, JSON.stringify(clean));
  } catch {
    /* ignore write failures */
  }
}

/* ──────────────────────────
   Deterministic ID
────────────────────────── */
export async function buildSendId(
  rec: Omit<SendRecord, "id" | "createdAt" | "confirmed">
): Promise<string> {
  const payload = JSON.stringify({
    p: lc(rec.parentCanonical),
    c: lc(rec.childCanonical),
    a: coerceBigIntString(rec.amountPhiScaled),
    k: rec.senderKaiPulse,
    n: rec.transferNonce,
    s: rec.senderStamp,
    r: rec.previousHeadRoot,
    l: rec.transferLeafHashSend,
  });
  return (await sha256Hex(payload)).toLowerCase();
}

/* ──────────────────────────
   Public API
────────────────────────── */

/** Add a send if not present; returns deterministic id. */
export async function recordSend(rec: Omit<SendRecord, "id" | "createdAt">): Promise<string> {
  const list = readAll();
  const id = await buildSendId(rec);

  if (!list.some((r) => r.id === id)) {
    const row: SendRecord = {
      ...rec,
      id,
      parentCanonical: lc(rec.parentCanonical),
      childCanonical: lc(rec.childCanonical),
      amountPhiScaled: coerceBigIntString(rec.amountPhiScaled),
      createdAt: nowMs(),
    };
    writeAll([...list, row]);
    safePost({ type: "send:add", record: row });
  }

  return id;
}

/** Mark a SEND leaf as confirmed (called on RECEIVE). */
export function markConfirmedByLeaf(parentCanonical: string, transferLeafHashSend: string): void {
  const pc = lc(parentCanonical);
  const leaf = String(transferLeafHashSend || "");
  const list = readAll();
  let changed = false;

  for (const r of list) {
    if (r.parentCanonical === pc && r.transferLeafHashSend === leaf && !r.confirmed) {
      r.confirmed = true;
      changed = true;
    }
  }
  if (changed) {
    writeAll(list);
    safePost({ type: "send:update", parentCanonical: pc });
  }
}

/** Get all sends for a given parent canonical (sorted by createdAt ASC). */
export function getSendsFor(parentCanonical: string): SendRecord[] {
  const pc = lc(parentCanonical);
  return readAll().filter((r) => r.parentCanonical === pc);
}

/** Sum of all Φ (scaled) exhaled from a parent canonical. */
export function getSpentScaledFor(parentCanonical: string): bigint {
  const rows = getSendsFor(parentCanonical);
  return rows.reduce<bigint>((acc, r) => acc + BigInt(coerceBigIntString(r.amountPhiScaled)), 0n);
}

/**
 * Incoming base Φ for a CHILD canonical.
 * Returns the most recent amount exhaled *to* this child, as scaled BigInt.
 * We don't require confirmation — child should reflect the base immediately.
 */
export function getIncomingBaseScaledFor(childCanonical: string): bigint {
  const cc = lc(childCanonical);
  const rows = readAll().filter((r) => r.childCanonical === cc);
  if (!rows.length) return 0n;
  for (let i = rows.length - 1; i >= 0; i--) {
    const amt = coerceBigIntString(rows[i].amountPhiScaled);
    try {
      const bi = BigInt(amt);
      if (bi > 0n) return bi;
    } catch {
      /* ignore parse and continue */
    }
  }
  return 0n;
}

/** Fire-and-forget cross-tab notification. */
function safePost(evt: LedgerEvent) {
  try {
    channel?.postMessage(evt);
  } catch {
    /* ignore */
  }
}

/** Simple invalidation listener (coarse). */
export function listen(cb: () => void): () => void {
  if (!channel) return () => {};
  const onMsg = () => cb();
  channel.addEventListener("message", onMsg as EventListener);
  return () => channel.removeEventListener("message", onMsg as EventListener);
}

/** Detailed listener (optional). */
export function listenDetailed(cb: (e: LedgerEvent) => void): () => void {
  if (!channel) return () => {};
  const onMsg = (ev: MessageEvent) => {
    const data = ev?.data;
    if (!data || typeof data !== "object") return;
    const t = (data as LedgerEvent).type;
    if (t === "send:add" || t === "send:update") cb(data as LedgerEvent);
  };
  channel.addEventListener("message", onMsg as EventListener);
  return () => channel.removeEventListener("message", onMsg as EventListener);
}

/* ──────────────────────────
   Optional helpers (Explorer)
────────────────────────── */

/** Return all sends (sorted ASC by createdAt). */
export function getAllSends(): SendRecord[] {
  return readAll();
}

/** Find the newest send to a specific child (or null). */
export function getLatestSendToChild(childCanonical: string): SendRecord | null {
  const cc = lc(childCanonical);
  const rows = readAll();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].childCanonical === cc) return rows[i];
  }
  return null;
}
