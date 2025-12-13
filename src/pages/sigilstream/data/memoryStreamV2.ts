// src/utils/memoryStreamV2.ts
// Memory Stream v2 (payload-first, hash-only, deterministic, no cache required)

export const MEM_V = "2";
export const URL_HARD_CAP = 120_000;

export const PAYLOAD_PREFIX = "j:";
export const SEG_PREFIX = "s:";

export const stripEdgePunct = (s: string): string => {
  let t = (s ?? "").trim();
  t = t.replace(/[)\].,;:!?]+$/g, "");
  t = t.replace(/^[([{"'`]+/g, "");
  return t.trim();
};

export function normalizeToken(raw: string): string {
  let t = stripEdgePunct(raw);

  if (/%[0-9A-Fa-f]{2}/.test(t)) {
    try {
      t = decodeURIComponent(t);
    } catch {
      /* keep raw */
    }
  }

  // '+' may come through as spaces
  if (t.includes(" ")) t = t.replaceAll(" ", "+");

  // base64 -> base64url
  if (/[+/=]/.test(t)) {
    t = t.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
  }

  return stripEdgePunct(t);
}

export function isLikelyToken(s: string): boolean {
  return /^[A-Za-z0-9_-]{16,}$/.test(s);
}

function originForParse(): string {
  if (typeof window === "undefined") return "https://x.invalid";
  const o = window.location?.origin;
  if (!o || o === "null") return "https://x.invalid";
  return o;
}

function tryParseUrl(raw: string): URL | null {
  const t = (raw ?? "").trim();
  try {
    return new URL(t);
  } catch {
    try {
      return new URL(t, originForParse());
    } catch {
      return null;
    }
  }
}

export function streamBaseHref(streamPath = "/stream"): string {
  if (typeof window === "undefined") return streamPath;
  const o = window.location?.origin;
  if (o && o !== "null") return `${o.replace(/\/+$/g, "")}${streamPath}`;
  return streamPath;
}

function extractFromPath(pathname: string): string | null {
  // /p~TOKEN or /p~/TOKEN (and %7E)
  {
    const m = pathname.match(/\/p(?:\u007e|%7[Ee])\/?([^/?#]+)/);
    if (m?.[1]) return m[1];
  }
  // /stream/p/TOKEN or /feed/p/TOKEN
  {
    const m = pathname.match(/\/(?:stream|feed)\/p\/([^/?#]+)/);
    if (m?.[1]) return m[1];
  }
  // /p/TOKEN
  {
    const m = pathname.match(/\/p\/([^/?#]+)/);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Extract token candidates from raw URL or bare token (tries nested add= once). */
export function extractTokenCandidates(rawUrl: string, depth = 0): string[] {
  const out: string[] = [];
  const push = (v: string | null | undefined) => {
    if (!v) return;
    const tok = normalizeToken(v);
    if (!tok) return;
    if (!isLikelyToken(tok)) return;
    if (!out.includes(tok)) out.push(tok);
  };

  const raw = stripEdgePunct(rawUrl);

  // bare token
  if (isLikelyToken(raw)) push(raw);

  const u = tryParseUrl(raw);
  if (!u) return out;

  const hashStr = u.hash && u.hash.startsWith("#") ? u.hash.slice(1) : "";
  const hash = new URLSearchParams(hashStr);
  const search = u.searchParams;

  const keys = ["t", "p", "token", "capsule"];
  for (const k of keys) {
    push(hash.get(k));
    push(search.get(k));
  }

  push(extractFromPath(u.pathname));

  // nested add= urls (one level)
  if (depth < 1) {
    const adds = [...search.getAll("add"), ...hash.getAll("add")];
    for (const a of adds) {
      let decoded = stripEdgePunct(a);
      if (!decoded) continue;
      if (/%[0-9A-Fa-f]{2}/.test(decoded)) {
        try {
          decoded = decodeURIComponent(decoded);
        } catch {
          /* ignore */
        }
      }
      for (const tok of extractTokenCandidates(decoded, depth + 1)) push(tok);
    }
  }

  return out;
}

/** hash-only open url: /stream#t=TOKEN */
export function makeStreamOpenUrlFromToken(tokenRaw: string, streamPath = "/stream"): string {
  const base = streamBaseHref(streamPath);
  const t = normalizeToken(tokenRaw);
  return `${base}#t=${encodeURIComponent(t)}`;
}

/** Normalize any non-/s URL into hash-based /stream#t=... form (no server rewrites). */
export function normalizeResolvedUrlForBrowser(rawUrl: string, streamPath = "/stream"): string {
  const raw = stripEdgePunct(rawUrl);

  // If it already is a Memory Stream URL containing root=, normalize it to /stream#...
  const u = tryParseUrl(raw);
  if (u) {
    const hashStr = u.hash && u.hash.startsWith("#") ? u.hash.slice(1) : "";
    const hp = new URLSearchParams(hashStr);
    const sp = u.searchParams;
    const hasRoot = Boolean(hp.get("root") || sp.get("root"));
    if (hasRoot) {
      const base = streamBaseHref(streamPath);
      const out = new URL(base, originForParse());
      const p = new URLSearchParams();
      for (const [k, v] of hp.entries()) p.append(k, v);
      for (const [k, v] of sp.entries()) p.append(k, v);
      out.hash = p.toString() ? `#${p.toString()}` : "";
      out.search = "";
      return out.toString();
    }
  }

  // /s/... passthrough
  const path = u ? u.pathname : raw;
  if (/^\/s(?:\/|$)/.test(path)) return raw;

  const tok = extractTokenCandidates(raw)[0];
  return tok ? makeStreamOpenUrlFromToken(tok, streamPath) : raw;
}

/* ─────────────────────────────────────────────────────────────
   Deterministic JSON canonicalization + base64url encoding
   ───────────────────────────────────────────────────────────── */

export function deepSortForJson(v: unknown): unknown {
  if (v === null) return null;

  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "bigint") return v.toString();

  if (Array.isArray(v)) return v.map(deepSortForJson);

  if (v && typeof v === "object") {
    const rec = v as Record<string, unknown>;
    const keys = Object.keys(rec).sort((a, b) => a.localeCompare(b));
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = deepSortForJson(rec[k]);
    return out;
  }

  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  // browser
  if (typeof btoa === "function") {
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const sub = bytes.subarray(i, i + CHUNK);
      bin += String.fromCharCode(...sub);
    }
    return btoa(bin);
  }

  // node-ish fallback
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B: any = (globalThis as any).Buffer;
  if (B) return B.from(bytes).toString("base64");
  throw new Error("No base64 encoder available");
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B: any = (globalThis as any).Buffer;
  if (B) return new Uint8Array(B.from(b64, "base64"));
  throw new Error("No base64 decoder available");
}

function toBase64UrlFromUtf8(s: string): string {
  const enc = new TextEncoder();
  const bytes = enc.encode(s);
  const b64 = bytesToBase64(bytes);
  return b64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function fromBase64UrlToUtf8(b64url: string): string {
  const b64 =
    b64url.replaceAll("-", "+").replaceAll("_", "/") +
    "===".slice((b64url.length + 3) % 4);
  const bytes = base64ToBytes(b64);
  const dec = new TextDecoder();
  return dec.decode(bytes);
}

export function encodePayloadRef(payload: unknown): string {
  const canon = JSON.stringify(deepSortForJson(payload));
  const b64url = toBase64UrlFromUtf8(canon);
  return `${PAYLOAD_PREFIX}${b64url}`;
}

export function decodePayloadRef(refRaw: string): unknown | null {
  const t = stripEdgePunct(refRaw);
  const v = t.startsWith(PAYLOAD_PREFIX) ? t.slice(PAYLOAD_PREFIX.length) : t;

  if (!/^[A-Za-z0-9_-]{16,}$/.test(v)) return null;

  try {
    const json = fromBase64UrlToUtf8(v);
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

/* ─────────────────────────────────────────────────────────────
   Merkle seal (FNV64) for segments
   ───────────────────────────────────────────────────────────── */

function fnv1a64Hex(s: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

function merkleRootFNV64Hex(leaves: readonly string[]): string {
  if (!leaves.length) return fnv1a64Hex("merkle:empty");
  let level = leaves.map((x) => fnv1a64Hex(`leaf:${x}`));
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1] ?? left;
      next.push(fnv1a64Hex(`node:${left}${right}`));
    }
    level = next;
  }
  return level[0]!;
}

const short = (s: string, head = 8, tail = 6): string =>
  s.length <= head + tail ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;

export type SegMeta = {
  v: string;
  id: string;
  m: string;
  n: number;
  a: number;
  r: string;
};

export function encodeSegMeta(meta: SegMeta): string {
  const canon = JSON.stringify(deepSortForJson(meta));
  const b64url = toBase64UrlFromUtf8(canon);
  return `${SEG_PREFIX}${b64url}`;
}

export type BuiltSegment = {
  url: string;
  rootRef: string;
  adds: string[];
  meta: SegMeta;
};

export function buildMemoryStreamUrl(
  rootRef: string,
  adds: readonly string[],
  streamPath = "/stream",
): BuiltSegment {
  const base = streamBaseHref(streamPath);
  const u = new URL(base, originForParse());

  const leaves = [rootRef, ...adds];
  const merkle = merkleRootFNV64Hex(leaves);
  const segId = `seg:${merkle}:${leaves.length}`;

  const meta: SegMeta = {
    v: MEM_V,
    id: segId,
    m: merkle,
    n: leaves.length,
    a: adds.length,
    r: short(rootRef, 8, 6),
  };

  const hp = new URLSearchParams();
  hp.set("v", MEM_V);
  hp.set("root", rootRef);
  hp.set("seg", encodeSegMeta(meta));
  for (const a of adds) hp.append("add", a);

  u.hash = hp.toString() ? `#${hp.toString()}` : "";
  u.search = "";
  return { url: u.toString(), rootRef, adds: [...adds], meta };
}

/* φ/Fib tail snap */
function fibFloor(n: number): number {
  const x = Math.max(0, Math.floor(n));
  if (x <= 2) return x;
  let a = 1;
  let b = 2;
  while (true) {
    const c = a + b;
    if (c > x) return b;
    a = b;
    b = c;
  }
}

function segmentTailToFit(rootRef: string, adds: readonly string[], streamPath = "/stream") {
  let lo = 0;
  let hi = adds.length;

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const kept = adds.slice(mid);
    const href = buildMemoryStreamUrl(rootRef, kept, streamPath).url;
    if (href.length <= URL_HARD_CAP) hi = mid;
    else lo = mid + 1;
  }

  const maxKept = adds.length - lo;
  const snap = fibFloor(maxKept);
  const keptCount = Math.max(0, Math.min(maxKept, snap > 0 ? snap : maxKept));
  const keepFrom = adds.length - keptCount;

  return { keepFrom, kept: adds.slice(keepFrom) };
}

export function buildSegmentedPack(
  rootRef: string,
  adds: readonly string[],
  streamPath = "/stream",
  guard = 0,
): { primary: BuiltSegment; archives: BuiltSegment[] } {
  if (guard > 64) {
    return { primary: buildMemoryStreamUrl(rootRef, [], streamPath), archives: [] };
  }

  const full = buildMemoryStreamUrl(rootRef, adds, streamPath);
  if (full.url.length <= URL_HARD_CAP) return { primary: full, archives: [] };

  const { keepFrom, kept } = segmentTailToFit(rootRef, adds, streamPath);

  const primary = buildMemoryStreamUrl(rootRef, kept, streamPath);
  if (primary.url.length > URL_HARD_CAP) {
    return { primary: buildMemoryStreamUrl(rootRef, [], streamPath), archives: [] };
  }

  if (keepFrom <= 0) return { primary, archives: [] };

  const dropped = adds.slice(0, keepFrom);
  const boundaryRoot = kept[0];
  if (!boundaryRoot) return { primary, archives: [] };

  const archivePack = buildSegmentedPack(boundaryRoot, dropped, streamPath, guard + 1);
  return { primary, archives: [archivePack.primary, ...archivePack.archives] };
}

/* Parse root/add from URL (search + hash). Values returned raw-ish (decoded once). */
export function extractRootRefFromUrl(rawUrl: string): string | null {
  const u = tryParseUrl(stripEdgePunct(rawUrl));
  if (!u) return null;

  const hashStr = u.hash && u.hash.startsWith("#") ? u.hash.slice(1) : "";
  const hp = new URLSearchParams(hashStr);
  const sp = u.searchParams;

  let r = hp.get("root") ?? sp.get("root");
  if (!r) return null;

  r = stripEdgePunct(r);
  if (/%[0-9A-Fa-f]{2}/.test(r)) {
    try {
      r = decodeURIComponent(r);
    } catch {
      /* ignore */
    }
  }
  return stripEdgePunct(r);
}

export function extractAddChainFromUrl(rawUrl: string, max = 512): string[] {
  const u = tryParseUrl(stripEdgePunct(rawUrl));
  if (!u) return [];

  const hashStr = u.hash && u.hash.startsWith("#") ? u.hash.slice(1) : "";
  const hp = new URLSearchParams(hashStr);
  const sp = u.searchParams;

  const addsRaw = [...hp.getAll("add"), ...sp.getAll("add")];
  const out: string[] = [];

  for (const a of addsRaw) {
    let v = stripEdgePunct(String(a));
    if (!v) continue;

    if (/%[0-9A-Fa-f]{2}/.test(v)) {
      try {
        v = decodeURIComponent(v);
      } catch {
        /* ignore */
      }
    }

    // payload refs are preserved
    if (v.startsWith(PAYLOAD_PREFIX)) {
      out.push(v);
      continue;
    }

    // tokens/urls normalized to /stream#t=...
    out.push(normalizeResolvedUrlForBrowser(v));
  }

  // dedupe preserve order
  const seen = new Set<string>();
  const dedup: string[] = [];
  for (const x of out) {
    const s = stripEdgePunct(x);
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    dedup.push(s);
  }

  return dedup.slice(-max);
}
