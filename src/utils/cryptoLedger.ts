import { kairosEpochNow } from "./kai_pulse";

/**
 * v46 — cryptoLedger.ts
 * -----------------------------------------------------------------------------
 * High-level dev notes / design:
 *
 * What this module does
 * ---------------------
 * Centralizes the client-side Φ debit/resonance ledger:
 *  - Type safety for debit records carried via `?d=` in the URL.
 *  - Compact base64url codec with UTF-8 semantics.
 *  - Canonical merge semantics for ledgers coming from URL, storage, or sibling tabs.
 *  - Token-scoped persistence to avoid cross-transfer contamination.
 *  - BroadcastChannel + `storage` fanout for multi-tab coherence.
 *
 * Why it exists
 * -------------
 * This logic was previously embedded inside `SigilPage.tsx`. Pulling it out:
 *  - Eliminates duplication across page/components.
 *  - Makes it unit-testable in isolation.
 *  - Gives us a single source of truth for encoding/merging rules.
 *
 * Key decisions
 * -------------
 *  - **Token scoping:** All storage keys may be token-scoped (current transferNonce).
 *    This prevents stale or future ledgers from bleeding across links.
 *  - **Merge is idempotent + commutative:** We de-dupe by `nonce` and sort by `timestamp`
 *    to keep deterministic ordering. Original amount is taken from the first truthy value.
 *  - **Transport format:** `?d=` carries `{ originalAmount, debits[] }` as base64url(JSON).
 *  - **Fanout:** We broadcast *only* after local state is written to URL + storage so a
 *    reloader can hydrate from either source.
 *
 * Security & privacy
 * ------------------
 *  - The ledger contains public transactional metadata only — no secrets.
 *  - We never eval untrusted data; all input is validated structurally.
 *
 * Performance
 * -----------
 *  - All operations are O(n) with small `n`. Sorting is stable and fast for small lists.
 *  - Broadcasts are cheap; listeners filter by canonical + token.
 *
 * Testing hooks
 * -------------
 *  - All pure helpers are exported. Use them in unit tests.
 *  - You can stub `globalThis.BroadcastChannel` and `localStorage` to simulate multi-tab.
 *
 * Integration quick-start
 * -----------------------
 *  - Encode/Decode:     encodeDebitsQS / decodeDebitsQS
 *  - Persist everywhere: updateDebitsEverywhere({ ... }, canonical, token, { broadcast: true })
 *  - Reconcile:         bestDebitsForCanonical(canonical, new URLSearchParams(location.search), token)
 *  - Listen:            addLedgerListener({ canonicals, token }, handler)
 *  - Helpers:           debitsKey, isDebitsStorageKeyForCanonical, tokenFromDebitsKey
 * -----------------------------------------------------------------------------
 */

export type DebitRecord = {
    amount: number;            // > 0
    nonce: string;             // unique per debit
    recipientPhiKey: string;   // derived Φ key of the recipient
    timestamp: number;         // Kai pulse (int)
  };
  
  export type DebitQS = {
    originalAmount?: number;
    debits?: DebitRecord[];
  };
  
  /** Broadcast channel used for inter-tab ledger sync. */
  export const DEBITS_CH = "sigil-debits-v1";
  
  /** Internal: build a localStorage key for a canonical + optional token. */
  export const debitsKey = (canonical: string, token?: string | null) =>
    token ? `sigil:debits:${canonical}:t:${token}` : `sigil:debits:${canonical}`;
  
  /** Detects if a storage key belongs to a canonical (incl. any token variant). */
  export const isDebitsStorageKeyForCanonical = (key: string, canonical: string) =>
    key === debitsKey(canonical) || key.startsWith(`${debitsKey(canonical)}:t:`);
  
  /** Extract token from a storage key for a given canonical (undefined if not a match, null if base key). */
  export const tokenFromDebitsKey = (key: string, canonical: string) => {
    const base = `sigil:debits:${canonical}`;
    if (key === base) return null;
    const prefix = `${base}:t:`;
    return key.startsWith(prefix) ? key.slice(prefix.length) : undefined;
  };
  
  /** Base64url encode (UTF-8). */
  export function b64urlEncodeUtf8(input: string): string {
    const bytes = new TextEncoder().encode(input);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  
  /** Base64url decode (UTF-8). */
  export function b64urlDecodeUtf8(input: string): string {
    const padLen = (4 - (input.length % 4)) % 4;
    const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLen);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  
  /** Encode ledger for `?d=`. */
  export function encodeDebitsQS(data: DebitQS): string {
    try {
      const payload = {
        originalAmount:
          typeof data.originalAmount === "number" && Number.isFinite(data.originalAmount)
            ? data.originalAmount
            : null,
        debits: Array.isArray(data.debits) ? data.debits : [],
      };
      return b64urlEncodeUtf8(JSON.stringify(payload));
    } catch {
      return "";
    }
  }
  
  /** Strict record check. */
  export function isDebitRecord(v: unknown): v is DebitRecord {
    if (typeof v !== "object" || v === null) return false;
    const r = v as Record<string, unknown>;
    return (
      typeof r.nonce === "string" &&
      r.nonce.length > 0 &&
      typeof r.recipientPhiKey === "string" &&
      r.recipientPhiKey.length > 0 &&
      typeof r.amount === "number" &&
      Number.isFinite(r.amount) &&
      r.amount > 0 &&
      typeof r.timestamp === "number" &&
      Number.isFinite(r.timestamp)
    );
  }
  
  /** Decode ledger from `?d=` (null if invalid). */
  export function decodeDebitsQS(raw: string | null): DebitQS | null {
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(b64urlDecodeUtf8(raw));
      if (typeof parsed !== "object" || parsed === null) return null;
  
      const out: DebitQS = {};
      const p = parsed as Record<string, unknown>;
  
      if (typeof p.originalAmount === "number" && Number.isFinite(p.originalAmount)) {
        out.originalAmount = p.originalAmount;
      }
  
      if (Array.isArray(p.debits)) {
        const debits: DebitRecord[] = [];
        for (const it of p.debits) if (isDebitRecord(it)) debits.push(it);
        if (debits.length) out.debits = debits;
      }
      return out;
    } catch {
      return null;
    }
  }
  
  /** Replace `?d=` in the current URL (SPA-safe). */
  export function updateDebitsInUrl(d: DebitQS, opts?: { navigate?: boolean }) {
    try {
      const u = new URL(window.location.href);
      const hasAmount = typeof d.originalAmount === "number" && Number.isFinite(d.originalAmount);
      const hasDebits = Array.isArray(d.debits) && d.debits.length > 0;
      if (!hasAmount && !hasDebits) u.searchParams.delete("d");
      else u.searchParams.set("d", encodeDebitsQS(d));
      const next = `${u.pathname}${u.search}${u.hash}`;
      if (opts?.navigate) {
        window.location.replace(next);
      } else {
        window.history.replaceState(null, "", next);
      }
    } catch {
      // noop — URL manipulation not supported (SSR, etc.)
    }
  }
  
  /** Read token-scoped ledger from storage. */
  export function readDebitsStored(
    canonical: string | null | undefined,
    token?: string | null
  ): DebitQS | null {
    const h = (canonical || "").toLowerCase();
    if (!h) return null;
    try {
      const rawTok = token ? localStorage.getItem(debitsKey(h, token)) : null;
      if (rawTok) return decodeDebitsQS(rawTok);
      const raw = localStorage.getItem(debitsKey(h));
      return raw ? decodeDebitsQS(raw) : null;
    } catch {
      return null;
    }
  }
  
  /** Write token-scoped ledger to storage. */
  export function writeDebitsStored(
    canonical: string | null | undefined,
    d: DebitQS,
    token?: string | null
  ) {
    const h = (canonical || "").toLowerCase();
    if (!h) return;
    try {
      localStorage.setItem(debitsKey(h, token), encodeDebitsQS(d));
    } catch {
      // noop
    }
  }
  
  /** De-dupe by nonce, stable sort by timestamp. */
  export function uniqByNonce(list: DebitRecord[]): DebitRecord[] {
    const seen = new Set<string>();
    const out: DebitRecord[] = [];
    for (const it of list) {
      if (!it || typeof it.nonce !== "string") continue;
      if (seen.has(it.nonce)) continue;
      seen.add(it.nonce);
      out.push(it);
    }
    return out.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }
  
  /** Merge two sources with idempotent semantics. */
  export function mergeDebitQS(a: DebitQS | null, b: DebitQS | null): DebitQS {
    const out: DebitQS = {};
  
    const aAmt = typeof a?.originalAmount === "number" ? a!.originalAmount! : undefined;
    const bAmt = typeof b?.originalAmount === "number" ? b!.originalAmount! : undefined;
    out.originalAmount =
      typeof aAmt === "number" ? aAmt : typeof bAmt === "number" ? bAmt : undefined;
  
    const listA = Array.isArray(a?.debits) ? a!.debits! : [];
    const listB = Array.isArray(b?.debits) ? b!.debits! : [];
    const merged = uniqByNonce([...listA, ...listB]);
    if (merged.length) out.debits = merged;
    return out;
  }
  
  /** Structural equality for ledgers. */
  export function debitQSEqual(x: DebitQS | null, y: DebitQS | null): boolean {
    const ax =
      typeof x?.originalAmount === "number" && Number.isFinite(x!.originalAmount!)
        ? Number(x!.originalAmount!)
        : NaN;
    const ay =
      typeof y?.originalAmount === "number" && Number.isFinite(y!.originalAmount!)
        ? Number(y!.originalAmount!)
        : NaN;
    const bothNa = Number.isNaN(ax) && Number.isNaN(ay);
    const amtEq = bothNa || Math.abs(ax - ay) < 1e-12;
  
    const nx = new Set((Array.isArray(x?.debits) ? x!.debits! : []).map((d) => d?.nonce));
    const ny = new Set((Array.isArray(y?.debits) ? y!.debits! : []).map((d) => d?.nonce));
    if (!amtEq || nx.size !== ny.size) return false;
    for (const n of nx) if (!ny.has(n)) return false;
    return true;
  }
  
  /** Fanout message shape. */
  export type DebitsMsg = {
    type: "debits";
    canonical: string;
    qs: string;
    stamp: number;
    token?: string | null;
  };
  
  /**
   * Write to URL + storage (+ broadcast unless disabled).
   */
  export function updateDebitsEverywhere(
    d: DebitQS,
    canonical?: string | null,
    token?: string | null,
    opts?: { broadcast?: boolean; navigate?: boolean }
  ) {
    updateDebitsInUrl(d, { navigate: !!opts?.navigate });
  
    const h = (canonical || "").toLowerCase();
    if (!h) return;
  
    writeDebitsStored(h, d, token ?? null);
  
    if (opts?.broadcast === false) return;
    try {
      const bc = new BroadcastChannel(DEBITS_CH);
      const msg: DebitsMsg = {
        type: "debits",
        canonical: h,
        qs: encodeDebitsQS(d),
        stamp: kairosEpochNow(),
        token: token ?? null,
      };
      bc.postMessage(msg);
      bc.close();
    } catch {
      // noop if BroadcastChannel unsupported
    }
  }
  
  /**
   * Compute best ledger for a canonical by merging URL + storage.
   */
  export function bestDebitsForCanonical(
    canonical: string | null,
    currentQs: URLSearchParams,
    token?: string | null
  ): { merged: DebitQS; urlIsStale: boolean } {
    const fromUrl = decodeDebitsQS(currentQs.get("d"));
    const fromStore = token ? readDebitsStored(canonical, token) : readDebitsStored(canonical, null);
    const merged = mergeDebitQS(fromStore, fromUrl);
    return { merged, urlIsStale: !debitQSEqual(merged, fromUrl) };
  }
  
  /**
   * Subscribe to all ledger changes for a set of canonicals (optionally narrowed by token).
   * Returns an unsubscribe function.
   */
  export function addLedgerListener(
    params: { canonicals: string[]; token?: string | null },
    handler: (canonical: string, qs: string, token: string | null) => void
  ): () => void {
    const canonicals = Array.from(
      new Set(params.canonicals.map((c) => (c || "").toLowerCase()).filter(Boolean))
    );
    const wantToken = params.token ?? null;
  
    // BroadcastChannel
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(DEBITS_CH);
      bc.onmessage = (ev: MessageEvent<DebitsMsg>) => {
        const m = ev.data;
        if (!m || m.type !== "debits") return;
        const kn = (m.canonical || "").toLowerCase();
        if (!canonicals.includes(kn)) return;
        const incomingTok = m.token ?? null;
        if (wantToken !== incomingTok) return;
        if (typeof m.qs !== "string") return;
        handler(kn, m.qs, incomingTok);
      };
    } catch {
      // noop
    }
  
    // storage events
    const onStorage = (e: StorageEvent) => {
      if (!e.key || typeof e.newValue !== "string") return;
      for (const c of canonicals) {
        if (!isDebitsStorageKeyForCanonical(e.key, c)) continue;
        const tok = tokenFromDebitsKey(e.key, c);
        const tokNorm = tok === undefined ? null : tok;
        if (wantToken !== tokNorm) return;
        handler(c, e.newValue, tokNorm);
        break;
      }
    };
    window.addEventListener("storage", onStorage, { passive: true });
  
    return () => {
      window.removeEventListener("storage", onStorage);
      try {
        if (bc && typeof bc.close === "function") bc.close();
      } catch {
        // noop
      }
    };
  }
  
