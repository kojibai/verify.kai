// src/utils/feedPayload.ts
// URL-safe payload utilities for Kai-Klok Stream.
// - Default navigation uses hash (#t=<token>) to avoid request-line limits
// - Back-compat: supports /stream/p/<token> (new) and /feed/p/<token> (old)
// - SMS-safe short alias: /p~<token>
// - No Chronos display in UI; pulse is authoritative

/* ───────── Versioning ───────── */

export const FEED_PAYLOAD_VERSION = 2 as const; // ✅ bumped (v2 adds body/rich content)
export const FEED_PAYLOAD_VERSION_LEGACY = 1 as const; // decode-only
export const ATTACHMENTS_VERSION = 1 as const;

/* ───────── Token budgets (empirically safe across iOS share, SMS, routers) ───────── */
export const TOKEN_SOFT_BUDGET = 1800 as const; // prefer staying under this
export const TOKEN_HARD_LIMIT = 3500 as const; // absolute cut-off for path usage

/* ───────── Sealing (optional) ───────── */
/**
 * Optional sealed envelope (used by KaiVoh “Private (Sealed)” mode).
 * Type-only import to avoid runtime coupling/cycles.
 */
import type { SealedEnvelopeV1 } from "./postSeal";
import {
  USERNAME_CLAIM_KIND,
  type UsernameClaimGlyphEvidence,
  type UsernameClaimPayload,
} from "../types/usernameClaim";

/* ───────── Core Types ───────── */

export type FeedSource = "x" | "manual";

/** Render-safe post body (v2). */
export type PostBodyText = {
  kind: "text";
  text: string;
};

export type PostBodyCode = {
  kind: "code";
  code: string;
  lang?: string; // e.g. "ts", "tsx", "rust", "json"
};

export type PostBodyHtml = {
  kind: "html";
  html: string;
  /**
   * "code" means render as escaped code (default-safe).
   * "sanitized" means render as HTML only after sanitation in the UI layer.
   */
  mode?: "code" | "sanitized";
};

export type PostBodyMarkdown = {
  kind: "md";
  md: string;
};

export type PostBody = PostBodyText | PostBodyCode | PostBodyHtml | PostBodyMarkdown;

export type AttachmentUrl = {
  kind: "url";
  url: string;
  title?: string;
};

export type AttachmentFileRef = {
  kind: "file-ref";
  name?: string;
  type?: string; // MIME
  size?: number; // bytes
  sha256: string; // hex, lowercase
  url?: string; // local ref like /att/<sha> or remote
};

export type AttachmentFileInline = {
  kind: "file-inline";
  name?: string;
  type?: string; // MIME
  size?: number; // bytes of original file
  data_b64url: string; // bytes as base64url (potentially large)
  thumbnail_b64?: string; // optional small preview (image/*), pruned for links
};

export type AttachmentItem = AttachmentUrl | AttachmentFileRef | AttachmentFileInline;

export type Attachments = {
  version: typeof ATTACHMENTS_VERSION;
  totalBytes?: number; // total file bytes (original sizes)
  inlinedBytes?: number; // bytes carried inline (data_b64url + thumbnails)
  items: AttachmentItem[];
};

/**
 * FeedPostPayload — single KaiVoh “memory” / stream post.
 *
 * v2 adds `body` so posts can carry text/code/html/md deterministically.
 * `caption` is kept for back-compat and summaries.
 *
 * Lineage fields:
 *  - parentUrl: canonical immediate parent (sigil or stream URL)
 *  - originUrl: root origin of the thread (top-most sigil/stream)
 *  - parent:    legacy field, kept for back-compat; prefer parentUrl.
 *
 * Optional sealing:
 *  - seal: encrypted envelope containing inner { body, attachments } for Private mode.
 *          When present, outer payload SHOULD omit plaintext body/attachments.
 */
export type FeedPostPayload = {
  v: typeof FEED_PAYLOAD_VERSION; // 2
  url: string; // sigil/action URL to render

  /** Legacy/summary text. Prefer body for content (or seal in Private mode). */
  caption?: string;

  /** v2 rich body (text/code/html/md). */
  body?: PostBody;

  author?: string; // e.g. "@handle"
  source?: FeedSource; // where it came from
  pulse: number; // Kai pulse index of post
  sigilId?: string; // short glyph/sigil identifier
  phiKey?: string; // optional ΦKey (short)
  kaiSignature?: string; // optional Kai Signature (short)

  /** Legacy parent field (can be sigil or stream URL). Prefer parentUrl. */
  parent?: string;

  /** Canonical immediate parent URL (sigil or stream). */
  parentUrl?: string;

  /** Root-most origin URL (sigil or original stream). */
  originUrl?: string;

  ts?: number; // unix ms (optional; never display)
  attachments?: Attachments; // videos/images/files/url refs (plaintext mode)

  /** Optional sealed envelope (Private mode). */
  seal?: SealedEnvelopeV1;

  /** Optional username-claim proof (hash + payload) for bound usernames. */
  usernameClaim?: UsernameClaimGlyphEvidence;
};

/** Legacy payload (v1) decode-only. */
export type FeedPostPayloadLegacy = {
  v: typeof FEED_PAYLOAD_VERSION_LEGACY; // 1
  url: string;
  caption?: string;
  author?: string;
  source?: FeedSource;
  pulse: number;
  sigilId?: string;
  phiKey?: string;
  kaiSignature?: string;
  parent?: string;
  parentUrl?: string;
  originUrl?: string;
  ts?: number;
  attachments?: Attachments;
};

/* ───────── Tiny runtime guards (no 'any') ───────── */

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}
function isString(x: unknown): x is string {
  return typeof x === "string";
}
function isNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}
function isOptionalString(x: unknown): x is string | undefined {
  return x === undefined || isString(x);
}
function isOptionalNumber(x: unknown): x is number | undefined {
  return x === undefined || isNumber(x);
}
function isValidSource(x: unknown): x is FeedSource | undefined {
  return x === undefined || x === "x" || x === "manual";
}
/* ───────── Username claim guards ───────── */
function isUsernameClaimPayload(x: unknown): x is UsernameClaimPayload {
  if (!isObject(x)) return false;
  return (
    x["kind"] === USERNAME_CLAIM_KIND &&
    isString(x["username"]) &&
    isString(x["normalized"]) &&
    isString(x["originHash"]) &&
    (x["ownerHint"] === undefined || x["ownerHint"] === null || isString(x["ownerHint"]))
  );
}

function isUsernameClaimEvidence(x: unknown): x is UsernameClaimGlyphEvidence {
  if (!isObject(x)) return false;
  return (
    isString(x["hash"]) &&
    (x["url"] === undefined || isString(x["url"])) &&
    isUsernameClaimPayload(x["payload"]) &&
    (x["ownerHint"] === undefined || x["ownerHint"] === null || isString(x["ownerHint"]))
  );
}

/* ───────── PostBody guards ───────── */

function isPostBodyText(x: unknown): x is PostBodyText {
  if (!isObject(x)) return false;
  return x["kind"] === "text" && isString(x["text"]);
}
function isPostBodyCode(x: unknown): x is PostBodyCode {
  if (!isObject(x)) return false;
  return x["kind"] === "code" && isString(x["code"]) && isOptionalString(x["lang"]);
}
function isPostBodyHtml(x: unknown): x is PostBodyHtml {
  if (!isObject(x)) return false;
  const mode = x["mode"];
  const okMode = mode === undefined || mode === "code" || mode === "sanitized";
  return x["kind"] === "html" && isString(x["html"]) && okMode;
}
function isPostBodyMarkdown(x: unknown): x is PostBodyMarkdown {
  if (!isObject(x)) return false;
  return x["kind"] === "md" && isString(x["md"]);
}
function isPostBody(x: unknown): x is PostBody {
  return isPostBodyText(x) || isPostBodyCode(x) || isPostBodyHtml(x) || isPostBodyMarkdown(x);
}
function isOptionalPostBody(x: unknown): x is PostBody | undefined {
  return x === undefined || isPostBody(x);
}

/* ───────── Attachment guards ───────── */

function isAttachmentUrl(x: unknown): x is AttachmentUrl {
  if (!isObject(x)) return false;
  return x["kind"] === "url" && isString(x["url"]) && isOptionalString(x["title"]);
}

function isAttachmentFileRef(x: unknown): x is AttachmentFileRef {
  if (!isObject(x)) return false;
  const hasKind = x["kind"] === "file-ref";
  const sha = x["sha256"];
  return (
    !!hasKind &&
    isString(sha) &&
    /^[0-9a-f]{64}$/.test(sha) && // strict 32-byte sha256 hex
    isOptionalString(x["name"]) &&
    isOptionalString(x["type"]) &&
    isOptionalNumber(x["size"]) &&
    (x["url"] === undefined || isString(x["url"]))
  );
}

function isAttachmentFileInline(x: unknown): x is AttachmentFileInline {
  if (!isObject(x)) return false;
  const hasKind = x["kind"] === "file-inline";
  return (
    !!hasKind &&
    isOptionalString(x["name"]) &&
    isOptionalString(x["type"]) &&
    isOptionalNumber(x["size"]) &&
    isString(x["data_b64url"]) &&
    (x["thumbnail_b64"] === undefined || isString(x["thumbnail_b64"]))
  );
}

function isAttachmentItem(x: unknown): x is AttachmentItem {
  return isAttachmentUrl(x) || isAttachmentFileRef(x) || isAttachmentFileInline(x);
}

function isAttachments(x: unknown): x is Attachments {
  if (!isObject(x)) return false;
  if (x["version"] !== ATTACHMENTS_VERSION) return false;
  if (!Array.isArray(x["items"])) return false;
  if (!x["items"].every(isAttachmentItem)) return false;
  if (!isOptionalNumber(x["totalBytes"])) return false;
  if (!isOptionalNumber(x["inlinedBytes"])) return false;
  return true;
}

/* ───────── Seal guards (minimal; postSeal does deep validation) ───────── */

function isOptionalSealEnvelope(x: unknown): x is Record<string, unknown> | undefined {
  return x === undefined || isObject(x);
}

/* ───────── Feed payload guards ───────── */

/** v2 guard (exported; current schema). */
export function isFeedPostPayload(x: unknown): x is FeedPostPayload {
  if (!isObject(x)) return false;
  return (
    x["v"] === FEED_PAYLOAD_VERSION &&
    isString(x["url"]) &&
    isNumber(x["pulse"]) &&
    isValidSource(x["source"]) &&
    isOptionalString(x["caption"]) &&
    isOptionalPostBody(x["body"]) &&
    isOptionalString(x["author"]) &&
    isOptionalString(x["sigilId"]) &&
    isOptionalString(x["phiKey"]) &&
    isOptionalString(x["kaiSignature"]) &&
    isOptionalString(x["parent"]) &&
    isOptionalString(x["parentUrl"]) &&
    isOptionalString(x["originUrl"]) &&
    isOptionalNumber(x["ts"]) &&
    (x["attachments"] === undefined || isAttachments(x["attachments"])) &&
    isOptionalSealEnvelope(x["seal"]) &&
    (x["usernameClaim"] === undefined || isUsernameClaimEvidence(x["usernameClaim"]))
  );
}

/** v1 guard (decode-only). */
export function isFeedPostPayloadLegacy(x: unknown): x is FeedPostPayloadLegacy {
  if (!isObject(x)) return false;
  return (
    x["v"] === FEED_PAYLOAD_VERSION_LEGACY &&
    isString(x["url"]) &&
    isNumber(x["pulse"]) &&
    isValidSource(x["source"]) &&
    isOptionalString(x["caption"]) &&
    isOptionalString(x["author"]) &&
    isOptionalString(x["sigilId"]) &&
    isOptionalString(x["phiKey"]) &&
    isOptionalString(x["kaiSignature"]) &&
    isOptionalString(x["parent"]) &&
    isOptionalString(x["parentUrl"]) &&
    isOptionalString(x["originUrl"]) &&
    isOptionalNumber(x["ts"]) &&
    (x["attachments"] === undefined || isAttachments(x["attachments"]))
  );
}

/* ───────── Base64URL helpers (byte-safe; no btoa/atob/Buffer) ───────── */

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_TABLE: Int16Array = (() => {
  const t = new Int16Array(256);
  for (let i = 0; i < 256; i++) t[i] = -1;
  for (let i = 0; i < B64_ALPHABET.length; i++) t[B64_ALPHABET.charCodeAt(i)] = i;
  return t;
})();

function toBase64Url(bytes: Uint8Array): string {
  const out: string[] = [];
  const n = bytes.length;

  let i = 0;
  for (; i + 2 < n; i += 3) {
    const x = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out.push(
      B64_ALPHABET[(x >>> 18) & 63] +
        B64_ALPHABET[(x >>> 12) & 63] +
        B64_ALPHABET[(x >>> 6) & 63] +
        B64_ALPHABET[x & 63],
    );
  }

  const rem = n - i;
  if (rem === 1) {
    const x = bytes[i] << 16;
    out.push(B64_ALPHABET[(x >>> 18) & 63] + B64_ALPHABET[(x >>> 12) & 63] + "==");
  } else if (rem === 2) {
    const x = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out.push(B64_ALPHABET[(x >>> 18) & 63] + B64_ALPHABET[(x >>> 12) & 63] + B64_ALPHABET[(x >>> 6) & 63] + "=");
  }

  return out.join("").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(token: string): Uint8Array {
  const raw = (token ?? "").trim();
  if (!raw) return new Uint8Array(0);

  // base64url -> base64 (+ padding)
  let b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
  b64 = b64.replace(/[\r\n\s]/g, "");
  const pad = (4 - (b64.length % 4)) % 4;
  if (pad) b64 += "=".repeat(pad);

  const len = b64.length;
  if (len % 4 !== 0) throw new Error("Invalid base64 length");

  let outLen = (len / 4) * 3;
  if (len >= 2 && b64[len - 2] === "=" && b64[len - 1] === "=") outLen -= 2;
  else if (len >= 1 && b64[len - 1] === "=") outLen -= 1;

  const out = new Uint8Array(outLen);

  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = b64.charCodeAt(i);
    const c1 = b64.charCodeAt(i + 1);
    const c2 = b64.charCodeAt(i + 2);
    const c3 = b64.charCodeAt(i + 3);

    const v0 = B64_TABLE[c0];
    const v1 = B64_TABLE[c1];
    const v2 = c2 === 61 /* '=' */ ? 64 : B64_TABLE[c2];
    const v3 = c3 === 61 /* '=' */ ? 64 : B64_TABLE[c3];

    if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) throw new Error("Invalid base64 character");

    const triple = (v0 << 18) | (v1 << 12) | ((v2 & 63) << 6) | (v3 & 63);

    out[o++] = (triple >>> 16) & 255;
    if (v2 !== 64 && o < outLen) out[o++] = (triple >>> 8) & 255;
    if (v3 !== 64 && o < outLen) out[o++] = triple & 255;
  }

  return out;
}

/* ───────── Encoding / Decoding ───────── */

export function encodeFeedPayload(p: FeedPostPayload): string {
  const json = JSON.stringify(p);
  const bytes = new TextEncoder().encode(json);
  return toBase64Url(bytes);
}

/**
 * Normalize a legacy v1 payload into v2 (deterministic, lossless).
 * - Keeps caption as-is
 * - Adds body from caption if body is missing (text kind)
 */
export function normalizeLegacyPayload(p1: FeedPostPayloadLegacy): FeedPostPayload {
  const parentUrl = p1.parentUrl ?? p1.parent;
  const caption = p1.caption;
  const body: PostBody | undefined = caption && caption.trim() ? { kind: "text", text: caption } : undefined;

  return {
    v: FEED_PAYLOAD_VERSION,
    url: p1.url,
    pulse: p1.pulse,
    caption: p1.caption,
    body,
    author: p1.author,
    source: p1.source,
    sigilId: p1.sigilId,
    phiKey: p1.phiKey,
    kaiSignature: p1.kaiSignature,
    parent: p1.parent,
    parentUrl,
    originUrl: p1.originUrl,
    ts: p1.ts,
    attachments: p1.attachments,
  };
}

export function decodeFeedPayload(token: string): FeedPostPayload | null {
  try {
    if (!token || token.length > 1_000_000) return null; // defensive: refuse absurd inputs
    const bytes = fromBase64Url(token);
    if (bytes.length === 0) return null;
    const json = new TextDecoder().decode(bytes);
    const parsed: unknown = JSON.parse(json);

    if (isFeedPostPayload(parsed)) return parsed;
    if (isFeedPostPayloadLegacy(parsed)) return normalizeLegacyPayload(parsed);

    return null;
  } catch {
    return null;
  }
}

/* ───────── ArrayBuffer helpers (fix ArrayBufferLike vs ArrayBuffer) ───────── */

function toArrayBuffer(buf: ArrayBufferLike): ArrayBuffer {
  if (buf instanceof ArrayBuffer) return buf;
  // Copy SharedArrayBuffer into a new ArrayBuffer
  const view = new Uint8Array(buf);
  const out = new ArrayBuffer(view.byteLength);
  new Uint8Array(out).set(view);
  return out;
}

function hexOf(bytes: ArrayBufferLike): string {
  const v = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < v.length; i++) s += v[i].toString(16).padStart(2, "0");
  return s;
}

async function sha256Hex(bytes: ArrayBufferLike): Promise<string> {
  const ab = toArrayBuffer(bytes);

  // WebCrypto (browser + modern node runtimes that expose crypto.subtle)
  if (typeof globalThis.crypto !== "undefined" && "subtle" in globalThis.crypto) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", ab);
    return hexOf(digest);
  }

  // Node fallback (dynamic to avoid bundling in browser)
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const { createHash } = await import("crypto");

  // ✅ No Buffer reference (avoids requiring @types/node / Buffer polyfills)
  return createHash("sha256").update(new Uint8Array(ab)).digest("hex");
}

function mimeToBlob(bytes: ArrayBufferLike, type?: string): Blob {
  const ab = toArrayBuffer(bytes);
  try {
    return new Blob([ab], { type: type || "application/octet-stream" });
  } catch {
    return new Blob([ab]);
  }
}

/* ───────── Attachment utilities ───────── */

function bytesFromBase64Url(b64url: string): Uint8Array {
  return fromBase64Url(b64url);
}

/**
 * Compute attachment size stats for a payload (or any object with attachments).
 */
export function computeAttachmentStats(p: { attachments?: Attachments }): { totalBytes: number; inlinedBytes: number } {
  let total = 0;
  let inline = 0;
  const A = p.attachments?.items ?? [];
  for (const it of A) {
    if (it.kind === "file-ref") {
      total += it.size ?? 0;
    } else if (it.kind === "file-inline") {
      total += it.size ?? 0;
      inline += it.data_b64url.length * 0.75; // b64 expansion ≈ 4/3; inverse ≈ ×0.75
      if (it.thumbnail_b64) inline += it.thumbnail_b64.length * 0.75;
    }
  }
  return { totalBytes: Math.round(total), inlinedBytes: Math.round(inline) };
}

/**
 * Return a clone with thumbnails removed (kept for UI only, never in links).
 * No unused vars: clone + delete on typed inline object.
 */
export function pruneThumbnails(p: FeedPostPayload): FeedPostPayload {
  if (!p.attachments) return p;
  const items = p.attachments.items.map((it) => {
    if (it.kind === "file-inline" && it.thumbnail_b64) {
      const rest: AttachmentFileInline = { ...it };
      delete rest.thumbnail_b64;
      return rest;
    }
    return it;
  });
  const { totalBytes, inlinedBytes } = computeAttachmentStats({
    attachments: { ...p.attachments, items },
  });
  return {
    ...p,
    attachments: {
      version: ATTACHMENTS_VERSION,
      items,
      totalBytes,
      inlinedBytes,
    },
  };
}

/**
 * Drop all file-inline items (keep URLs and file-refs). Use only as a last resort.
 */
export function dropInlineFiles(p: FeedPostPayload): FeedPostPayload {
  if (!p.attachments) return p;
  const items = p.attachments.items.filter((it) => it.kind !== "file-inline");
  const { totalBytes, inlinedBytes } = computeAttachmentStats({
    attachments: { ...p.attachments, items },
  });
  return {
    ...p,
    attachments: {
      version: ATTACHMENTS_VERSION,
      items,
      totalBytes,
      inlinedBytes,
    },
  };
}

/**
 * Materialize inline files into CacheStorage and convert them to file-refs.
 * - Computes SHA-256 of the content
 * - Stores blobs under /att/<sha> (cache-only URL)
 * - Converts each file-inline → file-ref with the derived sha and url
 * - Prunes thumbnails
 * If CacheStorage is unavailable, inline files are NOT dropped here (truthful + deterministic).
 */
export async function materializeInlineToCache(
  p: FeedPostPayload,
  opts: { cacheName?: string; pathPrefix?: string } = {},
): Promise<FeedPostPayload> {
  const cacheName = opts.cacheName ?? "sigil-attachments-v1";
  const pathPrefix = (opts.pathPrefix ?? "/att/").replace(/\/+$/, "") + "/";

  const pruned = pruneThumbnails(p);
  if (!pruned.attachments || pruned.attachments.items.length === 0) return pruned;

  const hasCaches = typeof globalThis.caches !== "undefined" && typeof globalThis.caches.open === "function";

  // ✅ Never silently drop attachments
  if (!hasCaches) return pruned;

  let cache: Cache | null = null;
  try {
    cache = await globalThis.caches.open(cacheName);
  } catch {
    cache = null;
  }

  const outItems: AttachmentItem[] = [];

  for (const it of pruned.attachments.items) {
    if (it.kind !== "file-inline") {
      outItems.push(it);
      continue;
    }

    // If cache open failed, keep inline (don’t drop)
    if (!cache) {
      outItems.push(it);
      continue;
    }

    try {
      const u8 = bytesFromBase64Url(it.data_b64url);
      const sha = await sha256Hex(u8.buffer);
      const blob = mimeToBlob(u8.buffer, it.type);
      const url = `${pathPrefix}${sha}`;

      await cache.put(
        new Request(url, { method: "GET" }),
        new Response(blob, {
          headers: it.type ? { "Content-Type": it.type } : undefined,
        }),
      );

      const ref: AttachmentFileRef = {
        kind: "file-ref",
        name: it.name,
        type: it.type,
        size: it.size,
        sha256: sha,
        url,
      };
      outItems.push(ref);
    } catch {
      // ✅ Keep inline on failure
      outItems.push(it);
    }
  }

  return {
    ...pruned,
    attachments: makeAttachments(outItems),
  };
}

/* ───────── Token helpers & URL builders ───────── */

/**
 * Encode a payload into a token, enforcing budgets:
 * - We always prune thumbnails first.
 * - If still too large for path usage, caller should prefer hash/#t=.
 */
export function encodeTokenWithBudgets(p: FeedPostPayload): { token: string; withinSoft: boolean; withinHard: boolean } {
  const pruned = pruneThumbnails(p);
  const token = encodeFeedPayload(pruned);
  return {
    token,
    withinSoft: token.length <= TOKEN_SOFT_BUDGET,
    withinHard: token.length <= TOKEN_HARD_LIMIT,
  };
}

/** Extract token from current location (hash → tilde path → query → path), with budget awareness. */
export function normalizePayloadToken(raw: string): string {
  let t = (raw ?? "").trim();
  if (!t) return "";

  // decode %xx if present
  if (/%[0-9A-Fa-f]{2}/.test(t)) {
    try {
      t = decodeURIComponent(t);
    } catch {
      /* keep raw */
    }
  }

  // '+' sometimes arrives as space in legacy query transport (URLSearchParams)
  if (t.includes(" ")) t = t.replace(/ /g, "+");

  // normalize standard base64 -> base64url
  if (/[+/=]/.test(t)) {
    t = t.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  return t;
}

/** DOM-free shape so this file can compile in non-DOM contexts too. */
export type LocationLike = { hash: string; search: string; pathname: string };

export function extractPayloadTokenFromLocation(loc?: LocationLike): string | null {
  try {
    const L: LocationLike | null =
      loc ?? (typeof window !== "undefined" && window.location ? window.location : null);
    if (!L) return null;

    const hashRaw = L.hash.startsWith("#") ? L.hash.slice(1) : L.hash;
    const searchRaw = L.search.startsWith("?") ? L.search.slice(1) : L.search;

    const hashParams = new URLSearchParams(hashRaw);
    const searchParams = new URLSearchParams(searchRaw);

    const fromHash = hashParams.get("t") ?? hashParams.get("p") ?? hashParams.get("token");
    if (fromHash) return normalizePayloadToken(fromHash);

    const fromSearch = searchParams.get("t") ?? searchParams.get("p") ?? searchParams.get("token");
    if (fromSearch) return normalizePayloadToken(fromSearch);

    // /stream/p/<token> or /feed/p/<token> (allow trailing slash)
    const m1 = L.pathname.match(/^\/(?:stream|feed)\/p\/([^/?#]+)\/?$/);
    if (m1?.[1]) return normalizePayloadToken(m1[1]);

    // /p~<token> (allow trailing slash)
    const m2 = L.pathname.match(/^\/p~([^/?#]+)\/?$/);
    if (m2?.[1]) return normalizePayloadToken(m2[1]);

    return null;
  } catch {
    return null;
  }
}

/** Extract token from an arbitrary pathname string. */
export function extractPayloadToken(pathname: string): string | null {
  const raw = (pathname ?? "").trim();
  if (!raw) return null;

  // Strip query/hash defensively
  const pathOnly = raw.split("?")[0].split("#")[0];

  const safeDecode = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };

  const mTilde = pathOnly.match(/^\/p~([^/?#]+)\/?$/);
  if (mTilde?.[1]) return normalizePayloadToken(safeDecode(mTilde[1]));

  const m = pathOnly.match(/^\/(?:stream|feed)\/p\/([^/?#]+)\/?$/);
  if (m?.[1]) return normalizePayloadToken(safeDecode(m[1]));

  return null;
}

/** Extract payload token from an arbitrary string (URL or bare token). */
export function extractPayloadTokenFromUrlString(rawUrl: string): string | null {
  const base = typeof window !== "undefined" ? window.location?.origin ?? undefined : undefined;
  const t = rawUrl.trim();
  if (!t) return null;

  // bare token support (for #add=TOKEN)
  if (/^[A-Za-z0-9_-]{16,}$/u.test(t)) return normalizePayloadToken(t);

  let u: URL;
  try {
    u = new URL(t);
  } catch {
    try {
      u = new URL(t, base);
    } catch {
      return null;
    }
  }

  const path = u.pathname || "";

  // /stream/p/<token> | /feed/p/<token>
  {
    const m = path.match(/\/(?:stream|feed)\/p\/([^/?#]+)/u);
    if (m?.[1]) return normalizePayloadToken(m[1]);
  }

  // /p/<token>
  {
    const m = path.match(/\/p\/([^/?#]+)/u);
    if (m?.[1]) return normalizePayloadToken(m[1]);
  }

  // /p~TOKEN or /p~/TOKEN (and %7E)
  {
    const m = path.match(/\/p(?:\u007e|%7[Ee])\/?([^/?#]+)/u);
    if (m?.[1]) return normalizePayloadToken(m[1]);
  }

  const hashStr = u.hash && u.hash.startsWith("#") ? u.hash.slice(1) : "";
  const hashParams = new URLSearchParams(hashStr);

  const keys = ["t", "p", "token", "capsule"] as const;
  for (const k of keys) {
    const hv = hashParams.get(k);
    if (hv) return normalizePayloadToken(hv);
    const sv = u.searchParams.get(k);
    if (sv) return normalizePayloadToken(sv);
  }

  return null;
}

/** Build a URL using hash as the default (safest): `${origin}/stream#t=<token>` */
export function buildHashUrl(origin: string, payload: FeedPostPayload): string {
  const { token } = encodeTokenWithBudgets(payload);
  const base = origin.replace(/\/+$/, "");
  return `${base}/stream#t=${token}`;
}

/** Build a path URL `${origin}/stream/p/<token>` — ONLY if within hard limit; otherwise falls back to hash. */
export function buildPathUrl(origin: string, payload: FeedPostPayload): string {
  const { token, withinHard } = encodeTokenWithBudgets(payload);
  const base = origin.replace(/\/+$/, "");
  return withinHard ? `${base}/stream/p/${token}` : `${base}/stream#t=${token}`;
}

/** Build an SMS-safe alias `${origin}/p~<token>` (still falls back to hash if absurdly large). */
export function buildSmsUrl(origin: string, payload: FeedPostPayload): string {
  const { token, withinHard } = encodeTokenWithBudgets(payload);
  const base = origin.replace(/\/+$/, "");
  return withinHard ? `${base}/p~${token}` : `${base}/stream#t=${token}`;
}

/** Back-compat canonical builder (prefers path if small, otherwise hash). */
export function buildFeedUrl(origin: string, payload: FeedPostPayload): string {
  return buildPathUrl(origin, payload);
}

/* ───────── High-level safe flow helpers ───────── */
export async function preparePayloadForLink(
  p: FeedPostPayload,
  opts: { cacheName?: string; pathPrefix?: string } = {},
): Promise<FeedPostPayload> {
  // 1) Always prune thumbnails first (safe + reduces size)
  const pruned = pruneThumbnails(p);

  // 2) If already within hard budget, keep inline files inline (portable)
  const first = encodeTokenWithBudgets(pruned);
  if (first.withinHard) return pruned;

  // 3) If there are no inline files, nothing to materialize; caller will use hash mode
  const hasInline = pruned.attachments?.items?.some((it) => it.kind === "file-inline") ?? false;
  if (!hasInline) return pruned;

  // 4) Try converting inline → cache-backed refs to shrink token
  const hasCaches = typeof globalThis.caches !== "undefined" && typeof globalThis.caches.open === "function";

  if (!hasCaches) {
    // ✅ Don’t silently drop: fail loudly so UI can tell the truth
    throw new Error(
      "Inline attachments exceed safe token size, but CacheStorage is unavailable on this device/session. " +
        "Attach via a public URL (Drive/S3/IPFS) or use smaller files.",
    );
  }

  const withRefs = await materializeInlineToCache(pruned, opts);

  // If we still exceed hard budget AND inline remains (cache failed), fail loudly.
  const second = encodeTokenWithBudgets(withRefs);
  const inlineStillPresent = withRefs.attachments?.items?.some((it) => it.kind === "file-inline") ?? false;

  if (!second.withinHard && inlineStillPresent) {
    throw new Error(
      "Inline attachments are still too large to share safely (and could not be cached). " +
        "Attach via public URL or reduce inline file size/count.",
    );
  }

  return pruneThumbnails(withRefs);
}

export async function buildPreparedHashUrl(
  origin: string,
  payload: FeedPostPayload,
  opts?: { cacheName?: string; pathPrefix?: string },
): Promise<string> {
  const prepared = await preparePayloadForLink(payload, opts);
  return buildHashUrl(origin, prepared);
}

export async function buildPreparedShareUrl(
  origin: string,
  payload: FeedPostPayload,
  opts?: { cacheName?: string; pathPrefix?: string },
): Promise<string> {
  const prepared = await preparePayloadForLink(payload, opts);
  return buildSmsUrl(origin, prepared);
}

/* ───────── Strict constructors (to avoid accidental schema drift) ───────── */

export function makeTextBody(text: string): PostBodyText {
  return { kind: "text", text };
}
export function makeCodeBody(code: string, lang?: string): PostBodyCode {
  return { kind: "code", code, lang };
}
export function makeHtmlBody(html: string, mode?: "code" | "sanitized"): PostBodyHtml {
  return { kind: "html", html, mode };
}
export function makeMarkdownBody(md: string): PostBodyMarkdown {
  return { kind: "md", md };
}

export function makeBasePayload(args: {
  url: string;
  pulse: number;

  /** Legacy/summary. Optional in v2; keep if you want a short preview string. */
  caption?: string;

  /** v2 canonical content (text/code/html/md). */
  body?: PostBody;

  author?: string;
  source?: FeedSource;
  sigilId?: string;
  phiKey?: string;
  kaiSignature?: string;

  /** Legacy parent; if parentUrl not provided, we mirror this into parentUrl. */
  parent?: string;

  /** Canonical immediate parent URL (preferred). */
  parentUrl?: string;

  /** Root-most origin URL for the thread. */
  originUrl?: string;

  ts?: number;
  attachments?: Attachments;

  /** Optional sealed envelope (Private mode). */
  seal?: SealedEnvelopeV1;

  /** Optional username-claim proof for bound usernames. */
  usernameClaim?: UsernameClaimGlyphEvidence;
}): FeedPostPayload {
  const parentUrl = args.parentUrl ?? args.parent;

  // If caller supplies body but not caption, we can optionally derive a tiny caption
  // (kept deterministic; no heuristics besides truncation).
  const derivedCaption =
    args.caption ??
    (args.body?.kind === "text" ? (args.body.text.length > 0 ? args.body.text : undefined) : undefined);

  const p: FeedPostPayload = {
    v: FEED_PAYLOAD_VERSION,
    url: args.url,
    pulse: args.pulse,
    caption: derivedCaption,
    body: args.body,
    author: args.author,
    source: args.source,
    sigilId: args.sigilId,
    phiKey: args.phiKey,
    kaiSignature: args.kaiSignature,
    parent: args.parent,
    parentUrl,
    originUrl: args.originUrl,
    ts: args.ts,
    attachments: args.attachments,
    seal: args.seal,
    usernameClaim: args.usernameClaim,
  };
  return p;
}

/* ───────── Attachment builders ───────── */

export function makeAttachments(items: AttachmentItem[]): Attachments {
  const A: Attachments = { version: ATTACHMENTS_VERSION, items: items.slice() };
  const { totalBytes, inlinedBytes } = computeAttachmentStats({ attachments: A });
  A.totalBytes = totalBytes;
  A.inlinedBytes = inlinedBytes;
  return A;
}

export function makeInlineAttachment(params: {
  name?: string;
  type?: string;
  data_b64url: string;
  size?: number;
  thumbnail_b64?: string;
}): AttachmentFileInline {
  return {
    kind: "file-inline",
    name: params.name,
    type: params.type,
    size: params.size,
    data_b64url: params.data_b64url,
    thumbnail_b64: params.thumbnail_b64,
  };
}

export function makeFileRefAttachment(params: {
  sha256: string;
  name?: string;
  type?: string;
  size?: number;
  url?: string;
}): AttachmentFileRef {
  if (!/^[0-9a-f]{64}$/.test(params.sha256)) {
    throw new Error("sha256 must be 64 hex chars");
  }
  return {
    kind: "file-ref",
    sha256: params.sha256,
    name: params.name,
    type: params.type,
    size: params.size,
    url: params.url,
  };
}

export function makeUrlAttachment(params: { url: string; title?: string }): AttachmentUrl {
  return {
    kind: "url",
    url: params.url,
    title: params.title,
  };
}
