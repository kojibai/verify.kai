// src/utils/derivedGlyph.ts
// Deterministic derivative credential (for “derived-glyph access”).
// - Given issuer/base kaiSignature + a per-post salt, derive a new kaiSignature.
// - This derived kaiSignature can be embedded into an exported derivative glyph.
// - Unlock logic can treat a login glyph as either base OR already-derived and still succeed.
// - Browser-only WebCrypto (HKDF-SHA-256).
// - No `any`.

const te = new TextEncoder();

/** DOM HKDF typing expects ArrayBuffer-backed BufferSource (not ArrayBufferLike). */
type Bytes = Uint8Array<ArrayBuffer>;

function requireSubtle(): SubtleCrypto {
  if (typeof crypto === "undefined" || !crypto.subtle) throw new Error("WebCrypto subtle unavailable");
  return crypto.subtle;
}

/** Ensure the returned Uint8Array is backed by a real ArrayBuffer (type + runtime). */
function toBytesAB(u8: Uint8Array): Bytes {
  // Runtime-narrow: if already ArrayBuffer-backed, keep (cast narrows the generic).
  if (u8.buffer instanceof ArrayBuffer) return u8 as Bytes;

  // Otherwise (e.g. SAB), copy into a fresh ArrayBuffer-backed view.
  const out = new Uint8Array(u8.byteLength);
  out.set(u8);
  return out as Bytes;
}

/* ───────────────────────── base64url bytes (no atob/btoa) ───────────────────────── */

function base64UrlToBytes(s: string): Bytes {
  const clean = s.replace(/-/g, "+").replace(/_/g, "/").trim();
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error("Invalid base64/base64url");

  const padLen = (4 - (clean.length % 4)) % 4;
  const padded = clean + "=".repeat(padLen);

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const rev = new Int16Array(128).fill(-1);
  for (let i = 0; i < alphabet.length; i++) rev[alphabet.charCodeAt(i)] = i;

  const outLen = Math.floor((padded.length * 3) / 4) - (padded.endsWith("==") ? 2 : padded.endsWith("=") ? 1 : 0);
  const out = new Uint8Array(outLen);

  let o = 0;
  for (let i = 0; i < padded.length; i += 4) {
    const c0 = padded.charCodeAt(i);
    const c1 = padded.charCodeAt(i + 1);
    const c2 = padded.charCodeAt(i + 2);
    const c3 = padded.charCodeAt(i + 3);

    const b0 = rev[c0] ?? -1;
    const b1 = rev[c1] ?? -1;
    const b2 = c2 === 61 ? -1 : (rev[c2] ?? -1);
    const b3 = c3 === 61 ? -1 : (rev[c3] ?? -1);

    if (b0 < 0 || b1 < 0 || (b2 < 0 && c2 !== 61) || (b3 < 0 && c3 !== 61)) {
      throw new Error("Invalid base64 characters");
    }

    const x = (b0 << 18) | (b1 << 12) | ((b2 < 0 ? 0 : b2) << 6) | (b3 < 0 ? 0 : b3);

    if (o < outLen) out[o++] = (x >>> 16) & 255;
    if (o < outLen && c2 !== 61) out[o++] = (x >>> 8) & 255;
    if (o < outLen && c3 !== 61) out[o++] = x & 255;
  }

  return out as Bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const out: string[] = [];
  const n = bytes.length;
  let i = 0;

  for (; i + 2 < n; i += 3) {
    const x = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out.push(
      alphabet[(x >>> 18) & 63] +
        alphabet[(x >>> 12) & 63] +
        alphabet[(x >>> 6) & 63] +
        alphabet[x & 63],
    );
  }

  const rem = n - i;
  if (rem === 1) {
    const x = bytes[i] << 16;
    out.push(alphabet[(x >>> 18) & 63] + alphabet[(x >>> 12) & 63] + "==");
  } else if (rem === 2) {
    const x = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out.push(alphabet[(x >>> 18) & 63] + alphabet[(x >>> 12) & 63] + alphabet[(x >>> 6) & 63] + "=");
  }

  return out.join("").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/* ───────────────────────── kaiSignature → bytes normalization ───────────────────────── */

function hexToBytes(hex: string): Bytes {
  const h = hex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(h) || h.length % 2 !== 0) throw new Error("Invalid hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out as Bytes;
}

function looksHex(s: string): boolean {
  const t = s.trim();
  return t.length >= 32 && t.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(t);
}

function looksBase64Urlish(s: string): boolean {
  const t = s.trim();
  return t.length >= 16 && /^[A-Za-z0-9\-_]+$/.test(t);
}

export function normalizeKaiSignatureBytes(sig: string): Bytes {
  const s = sig.trim();
  if (!s) throw new Error("Empty kaiSignature");
  if (looksHex(s)) return hexToBytes(s);
  if (looksBase64Urlish(s)) {
    try {
      return base64UrlToBytes(s);
    } catch {
      // fall through
    }
  }
  return toBytesAB(te.encode(s));
}

/* ───────────────────────── HKDF derive ───────────────────────── */

async function hkdfSha256Bits(params: { ikm: Bytes; salt: Bytes; info: Bytes; bits: number }): Promise<Bytes> {
  const subtle = requireSubtle();

  // Import IKM as an HKDF base key.
  const key = await subtle.importKey("raw", params.ikm, { name: "HKDF" }, false, ["deriveBits"]);

  // salt/info are ArrayBuffer-backed views, satisfying strict DOM BufferSource typing.
  const bitsBuf = await subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: params.salt, info: params.info },
    key,
    params.bits,
  );

  return new Uint8Array(bitsBuf) as Bytes;
}

/**
 * Derive a “post-scoped” kaiSignature from a base kaiSignature + salt.
 * This is the exact primitive you use for:
 * - exporting derivative glyphs in Verifier
 * - unlocking derived-grant sealed posts
 */
export async function deriveKaiSignatureBytes(params: {
  baseKaiSignature: string;
  salt_b64url: string;
  context?: string; // optional domain separation
}): Promise<Bytes> {
  const base = toBytesAB(normalizeKaiSignatureBytes(params.baseKaiSignature));
  const salt = toBytesAB(base64UrlToBytes(params.salt_b64url));
  const ctx = (params.context ?? "KaiVoh.deriveKaiSignature.v1").trim();

  return await hkdfSha256Bits({
    ikm: base,
    salt,
    info: toBytesAB(te.encode(ctx)),
    bits: 256,
  });
}

export async function deriveKaiSignatureB64Url(params: {
  baseKaiSignature: string;
  salt_b64url: string;
  context?: string;
}): Promise<string> {
  const b = await deriveKaiSignatureBytes(params);
  return bytesToBase64Url(b);
}

/** Convenience: generate a random salt for derivative grants / exports. */
export function makeDerivationSaltB64Url(bytes: number = 18): string {
  if (typeof crypto === "undefined" || !crypto.getRandomValues) throw new Error("crypto.getRandomValues unavailable");
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return bytesToBase64Url(b);
}
