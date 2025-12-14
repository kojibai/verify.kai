// src/shortner/kaiPhiShort.ts
"use client";

/**
 * KaiΦ Deterministic Shortener (serverless, reversible) — v3
 *
 * Goals:
 * ✅ Extremely short in real-world Kai links (especially /stream/p/<base64json>)
 * ✅ Fully decodable (self-contained), no server, no cache
 * ✅ Exact payload integrity via CRC16
 *
 * Key improvements vs v2:
 * 1) Smart packing:
 *    - /stream/p/<token> => store *decoded token bytes* (not the base64 string)
 *    - /s/<id>           => store just the id
 *    - fallback          => store normalized URL string bytes
 * 2) Prefer "deflate" CompressionStream when supported (smaller than gzip)
 * 3) No stored seed: XOR seed is derived from CRC16 + body length (saves 4 bytes)
 *
 * NOTE (information theory):
 * - If the input URL is truly high-entropy (random), you cannot compress it much.
 * - If it contains structured text/JSON/base64 (your case), deflate + token-byte packing
 *   gets *very* small.
 */

export type KaiPhiCodecOptions = {
  /** Enable compression when supported (recommended). */
  compress?: boolean;
  /** Enable reversible φ-stream XOR (recommended). */
  obfuscate?: boolean;
  /** If true, store same-origin URLs as relative ("/path?...") to shrink output. */
  storeRelativeIfSameOrigin?: boolean;
};

const DEFAULTS: Required<KaiPhiCodecOptions> = {
  compress: true,
  obfuscate: true,
  storeRelativeIfSameOrigin: true,
};

// ──────────────────────────────────────────────────────────────────────────────
// Packet format v3
// ──────────────────────────────────────────────────────────────────────────────
//
// header (6 bytes):
// [0] 'K'        0x4B
// [1] magic Φ    0xA6
// [2] ver        0x03
// [3] flags:
//      bit0: compressed
//      bit1: obfuscated
//      bit2: relative (only meaningful for kind=URL_BYTES)
//      bit3: compression format (0=deflate, 1=gzip) when compressed
//      bit4..6: pack kind (0..7)
//      bit7: reserved
// [4..5] CRC16-CCITT of PACKED BYTES (before compression/obfuscation)
//
// body:
//  - if obfuscated: xor(phiStream, seedDerivedFrom(crc, bodyLen))
//  - if compressed: compressed packed bytes
//
// packed bytes:
//  [0] kind (duplicated for decode convenience / forward compat)
//  [1..] kind payload
//

const MAGIC_K = 0x4b;
const MAGIC_PHI = 0xa6;

const VER_V3 = 0x03;

const FLAG_COMPRESS = 0x01;
const FLAG_OBF = 0x02;
const FLAG_REL = 0x04;
const FLAG_FMT_GZIP = 0x08; // when compressed: 0=deflate, 1=gzip

const KIND_SHIFT = 4; // bits 4..6
const KIND_MASK = 0x70;

type PackKind = 0 | 1 | 2;
const KIND_URL_BYTES: PackKind = 0; // packed as UTF-8 string
const KIND_STREAM_P_TOKEN_BYTES: PackKind = 1; // packed as raw token bytes (decoded from /stream/p/<token>)
const KIND_SIGIL_S_ID: PackKind = 2; // packed as UTF-8 id (from /s/<id>)

function setKind(flags: number, kind: PackKind): number {
  return (flags & ~KIND_MASK) | (((kind & 0x07) << KIND_SHIFT) & KIND_MASK);
}
function getKind(flags: number): PackKind {
  return (((flags & KIND_MASK) >>> KIND_SHIFT) & 0x07) as PackKind;
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

/** Deterministically encode a URL into a short code (no server). */
export async function kaiPhiShortenUrl(
  fullUrl: string,
  opts: KaiPhiCodecOptions = {},
): Promise<string> {
  const o = { ...DEFAULTS, ...opts };

  // 1) Pack smartly (this is where we get big wins for /stream/p/<token>)
  const packed = packUrlSmart(fullUrl, o.storeRelativeIfSameOrigin);
  const packedBytes = packed.bytes;
  const crc = crc16(packedBytes);

  // 2) Optional compression (prefer deflate, fallback gzip)
  let flags = 0;
  flags = setKind(flags, packed.kind);
  if (packed.relative) flags |= FLAG_REL;

  let body = packedBytes;
  let usedFmt: CompressionFormat | null = null;

  if (o.compress) {
    const fmt = bestCompressionFormat();
    if (fmt) {
      body = await compress(fmt, body);
      usedFmt = fmt;
      flags |= FLAG_COMPRESS;
      if (fmt === "gzip") flags |= FLAG_FMT_GZIP;
    }
  }

  // 3) Optional obfuscation (seed derived from crc + body length — no stored seed bytes)
  if (o.obfuscate) {
    const seed = deriveSeed32(crc, body.length);
    body = xorPhiStream(body, seed);
    flags |= FLAG_OBF;
  }

  // 4) Header (6 bytes)
  const header = new Uint8Array(6);
  header[0] = MAGIC_K;
  header[1] = MAGIC_PHI;
  header[2] = VER_V3;
  header[3] = flags & 0xff;
  writeU16BE(header, 4, crc);

  // 5) Final packet -> base64url
  const packet = concatBytes(header, body);

  // Extra: if compression *increased* size (rare but can happen on tiny inputs), fall back.
  // We keep it deterministic by checking the produced packet length.
  if ((flags & FLAG_COMPRESS) !== 0 && usedFmt) {
    const uncompressedBodyLen = packedBytes.length;
    const compressedBodyLen = packet.length - header.length;
    if (compressedBodyLen >= uncompressedBodyLen) {
      // rebuild without compression (still obf optional)
      let flags2 = 0;
      flags2 = setKind(flags2, packed.kind);
      if (packed.relative) flags2 |= FLAG_REL;

      let body2 = packedBytes;
      if (o.obfuscate) {
        const seed2 = deriveSeed32(crc, body2.length);
        body2 = xorPhiStream(body2, seed2);
        flags2 |= FLAG_OBF;
      }

      const header2 = new Uint8Array(6);
      header2[0] = MAGIC_K;
      header2[1] = MAGIC_PHI;
      header2[2] = VER_V3;
      header2[3] = flags2 & 0xff;
      writeU16BE(header2, 4, crc);

      return base64UrlEncode(concatBytes(header2, body2));
    }
  }

  return base64UrlEncode(packet);
}

/** Expand a short code back into the URL string. */
export async function kaiPhiExpandCode(
  code: string,
  opts: KaiPhiCodecOptions = {},
): Promise<string> {
  const o = { ...DEFAULTS, ...opts };
  void o;

  const packet = base64UrlDecode(code);
  if (packet.length < 6) throw new Error("Invalid code (too short).");

  if (packet[0] !== MAGIC_K || packet[1] !== MAGIC_PHI) throw new Error("Invalid code (bad magic).");
  const ver = packet[2];
  if (ver !== VER_V3) throw new Error(`Unsupported code version: ${ver}`);

  const flags = packet[3] & 0xff;
  const expectedCrc = readU16BE(packet, 4);

  const kind = getKind(flags);
  const flagCompress = (flags & FLAG_COMPRESS) !== 0;
  const flagObf = (flags & FLAG_OBF) !== 0;
  const flagRelative = (flags & FLAG_REL) !== 0;
  const fmt: CompressionFormat = (flags & FLAG_FMT_GZIP) !== 0 ? "gzip" : "deflate";

  let body = packet.subarray(6);

  if (flagObf) {
    const seed = deriveSeed32(expectedCrc, body.length);
    body = xorPhiStream(body, seed);
  }

  const packedBytes = flagCompress ? await decompress(fmt, body) : body;

  const gotCrc = crc16(packedBytes);
  if ((gotCrc & 0xffff) !== (expectedCrc & 0xffff)) {
    throw new Error("Integrity check failed (CRC mismatch).");
  }

  const url = unpackUrlSmart(kind, packedBytes, flagRelative);

  // Safety: only allow http(s) redirects
  assertHttpUrl(url);

  return url;
}

/** Build a shareable short URL you can post (you choose the route prefix later). */
export function kaiPhiBuildShortUrl(
  code: string,
  routePrefix = "/go/",
  baseOrigin?: string,
): string {
  const origin = baseOrigin ?? (typeof window !== "undefined" ? window.location.origin : "");
  const prefix = routePrefix.startsWith("/") ? routePrefix : `/${routePrefix}`;
  return `${origin}${prefix}${code}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Smart pack / unpack
// ──────────────────────────────────────────────────────────────────────────────

function originForParse(): string {
  if (typeof window === "undefined") return "https://x.invalid";
  const o = window.location?.origin;
  if (!o || o === "null") return "https://x.invalid";
  return o;
}

function normalizeForPacking(url: string, storeRelativeIfSameOrigin: boolean): { s: string; relative: boolean } {
  const trimmed = String(url ?? "").trim();
  if (!trimmed) throw new Error("URL is empty.");

  if (storeRelativeIfSameOrigin && typeof window !== "undefined") {
    try {
      const u = new URL(trimmed, window.location.origin);
      if (u.origin === window.location.origin) {
        return { s: `${u.pathname}${u.search}${u.hash}`, relative: true };
      }
    } catch {
      // ignore
    }
  }

  try {
    const u = new URL(trimmed);
    return { s: u.toString(), relative: false };
  } catch {
    return { s: trimmed, relative: trimmed.startsWith("/") };
  }
}

function tryParseUrl(raw: string): URL | null {
  const t = String(raw ?? "").trim();
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

function packUrlSmart(fullUrl: string, storeRelativeIfSameOrigin: boolean): {
  kind: PackKind;
  relative: boolean;
  bytes: Uint8Array;
} {
  // Recognize Kai routes first
  const u = tryParseUrl(fullUrl);

  if (u) {
    // /stream/p/<token>
    {
      const parts = u.pathname.split("/").filter(Boolean);
      // e.g. ["stream","p","TOKEN"]
      if (parts.length >= 3 && parts[0] === "stream" && parts[1] === "p" && parts[2]) {
        const token = parts[2];
        const tokenBytes = safeBase64UrlDecode(token);
        if (tokenBytes) {
          // packedBytes = [kindByte] + tokenBytes
          const bytes = concatBytes(new Uint8Array([KIND_STREAM_P_TOKEN_BYTES]), tokenBytes);
          return { kind: KIND_STREAM_P_TOKEN_BYTES, relative: false, bytes };
        }
      }
    }

    // /s/<id>
    {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length >= 2 && parts[0] === "s" && parts[1]) {
        const id = decodeURIComponent(parts[1]);
        const idBytes = utf8Encode(id);
        const bytes = concatBytes(new Uint8Array([KIND_SIGIL_S_ID]), idBytes);
        return { kind: KIND_SIGIL_S_ID, relative: false, bytes };
      }
    }
  }

  // Fallback: store URL string bytes (optionally relative if same-origin)
  const norm = normalizeForPacking(fullUrl, storeRelativeIfSameOrigin);
  const sBytes = utf8Encode(norm.s);
  const bytes = concatBytes(new Uint8Array([KIND_URL_BYTES]), sBytes);
  return { kind: KIND_URL_BYTES, relative: norm.relative, bytes };
}

function unpackUrlSmart(kind: PackKind, packed: Uint8Array, relativeFlag: boolean): string {
  if (packed.length < 1) throw new Error("Invalid packed payload.");

  // First byte is always kind for forward-compat checking.
  const embeddedKind = packed[0] as PackKind;
  const body = packed.subarray(1);

  // Prefer header kind, but require internal match when possible.
  if (embeddedKind !== kind) {
    // Allow forward compat: if header kind is unknown, trust embedded.
    // For now, treat mismatch as error (keeps decoder strict).
    throw new Error("Invalid packed payload (kind mismatch).");
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  if (kind === KIND_STREAM_P_TOKEN_BYTES) {
    const token = base64UrlEncode(body);
    // Always reconstruct to the host running the short-link (same-origin semantics)
    return `${origin}/stream/p/${token}`;
  }

  if (kind === KIND_SIGIL_S_ID) {
    const id = utf8Decode(body);
    return `${origin}/s/${encodeURIComponent(id)}`;
  }

  // KIND_URL_BYTES
  const s = utf8Decode(body);
  if (relativeFlag) {
    if (typeof window === "undefined") return s;
    return new URL(s, window.location.origin).toString();
  }
  return s;
}

function safeBase64UrlDecode(token: string): Uint8Array | null {
  try {
    return base64UrlDecode(token);
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// φ-stream XOR (reversible) + seed derivation (“super mix”)
// ──────────────────────────────────────────────────────────────────────────────

const PHI_32 = 0x9e3779b1; // 2^32 / φ

function deriveSeed32(crc16v: number, bodyLen: number): number {
  // “super hashing” here must remain reversible: we’re not replacing data with a hash,
  // we’re just deriving a deterministic stream seed from known header facts.
  // Mix: (crc16 << 16) ^ bodyLen, then φ-mix.
  const x = (((crc16v & 0xffff) << 16) ^ (bodyLen & 0xffff)) >>> 0;
  return phiMix32(x);
}

function phiMix32(n: number): number {
  let x = n >>> 0;
  x = Math.imul(x ^ (x >>> 16), PHI_32) >>> 0;
  x = (x ^ (x >>> 13)) >>> 0;
  x = Math.imul(x, PHI_32) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x >>> 0;
}

function xorPhiStream(data: Uint8Array, seed32: number): Uint8Array {
  let s = seed32 >>> 0;
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    // xorshift32
    s ^= (s << 13) >>> 0;
    s ^= (s >>> 17) >>> 0;
    s ^= (s << 5) >>> 0;
    out[i] = data[i] ^ (s & 0xff);
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────────
// Compression (deflate/gzip) using built-in streams (no dependencies)
// ──────────────────────────────────────────────────────────────────────────────

type CompressionFormat = "deflate" | "gzip";
type CSLike = { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };
type CompressionStreamCtor = new (format: CompressionFormat) => CSLike;
type DecompressionStreamCtor = new (format: CompressionFormat) => CSLike;

function getCompressionStreamCtor(): CompressionStreamCtor | null {
  const g = globalThis as unknown as { CompressionStream?: CompressionStreamCtor };
  return typeof g.CompressionStream === "function" ? g.CompressionStream : null;
}

function getDecompressionStreamCtor(): DecompressionStreamCtor | null {
  const g = globalThis as unknown as { DecompressionStream?: DecompressionStreamCtor };
  return typeof g.DecompressionStream === "function" ? g.DecompressionStream : null;
}

function bestCompressionFormat(): CompressionFormat | null {
  const CS = getCompressionStreamCtor();
  const DS = getDecompressionStreamCtor();
  if (!CS || !DS) return null;

  // Prefer deflate if constructor accepts it
  try {
    // eslint-disable-next-line no-new
    new CS("deflate");
    // eslint-disable-next-line no-new
    new DS("deflate");
    return "deflate";
  } catch {
    // ignore
  }

  try {
    // eslint-disable-next-line no-new
    new CS("gzip");
    // eslint-disable-next-line no-new
    new DS("gzip");
    return "gzip";
  } catch {
    return null;
  }
}

async function compress(fmt: CompressionFormat, input: Uint8Array): Promise<Uint8Array> {
  const CS = getCompressionStreamCtor();
  if (!CS) return input;

  const cs = new CS(fmt);
  const writer = cs.writable.getWriter();
  await writer.write(input);
  await writer.close();
  const ab = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(ab);
}

async function decompress(fmt: CompressionFormat, input: Uint8Array): Promise<Uint8Array> {
  const DS = getDecompressionStreamCtor();
  if (!DS) return input;

  const ds = new DS(fmt);
  const writer = ds.writable.getWriter();
  await writer.write(input);
  await writer.close();
  const ab = await new Response(ds.readable).arrayBuffer();
  return new Uint8Array(ab);
}

// ──────────────────────────────────────────────────────────────────────────────
// Base64url (bytes) helpers
// ──────────────────────────────────────────────────────────────────────────────

function base64UrlEncode(bytes: Uint8Array): string {
  const b64 = bytesToBase64(bytes);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return base64ToBytes(b64);
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    bin += String.fromCharCode(...slice);
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}

// ──────────────────────────────────────────────────────────────────────────────
// UTF-8 helpers
// ──────────────────────────────────────────────────────────────────────────────

function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function utf8Decode(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

// ──────────────────────────────────────────────────────────────────────────────
// CRC16 (CCITT) for exact round-trip integrity
// ──────────────────────────────────────────────────────────────────────────────

function crc16(data: Uint8Array): number {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= (data[i] << 8) & 0xffff;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc & 0xffff;
}

// ──────────────────────────────────────────────────────────────────────────────
// URL safety
// ──────────────────────────────────────────────────────────────────────────────

function assertHttpUrl(url: string): void {
  let u: URL;
  try {
    u = new URL(url, typeof window !== "undefined" ? window.location.origin : "http://x.invalid");
  } catch {
    throw new Error("Expanded URL is not parseable.");
  }
  const p = u.protocol.toLowerCase();
  if (p !== "http:" && p !== "https:") throw new Error("Refusing to redirect to non-http(s) URL.");
}

// ──────────────────────────────────────────────────────────────────────────────
// Byte utils
// ──────────────────────────────────────────────────────────────────────────────

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function writeU16BE(buf: Uint8Array, off: number, v: number): void {
  buf[off + 0] = (v >>> 8) & 0xff;
  buf[off + 1] = v & 0xff;
}

function readU16BE(buf: Uint8Array, off: number): number {
  return (((buf[off + 0] << 8) | buf[off + 1]) >>> 0) & 0xffff;
}
