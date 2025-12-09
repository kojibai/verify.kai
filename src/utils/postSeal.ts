// src/utils/postSeal.ts
// KaiVoh Private Post Sealing — v1.0.1 (ArrayBuffer-safe)
// - Real privacy: encrypt inner content BEFORE token encode.
// - Envelope supports multiple “grants”:
//    • derived: any derivative glyph exported from issuer verifier can unlock
//    • glyph: specific allowed glyph(s) (pulse-agnostic) can unlock
// - Browser-only: WebCrypto (HKDF-SHA-256 + AES-256-GCM)
// - Fixes TS: Uint8Array<ArrayBufferLike> not assignable to BufferSource
// - No `any`, strict-safe.

export type SealedGrantDerivedV1 = {
  kind: "derived";
  salt_b64url: string; // used to derive the derivative credential + wrap key
  issuerPhiKey?: string; // hint only (not security)
  wrap_iv_b64url: string;
  wrap_ct_b64url: string;
};

export type SealedGrantGlyphV1 = {
  kind: "glyph";
  allowPhiKey: string; // used for fast matching (not security)
  allowSigilId?: string; // hint only
  salt_b64url: string; // used with glyph kaiSignature to derive wrap key
  wrap_iv_b64url: string;
  wrap_ct_b64url: string;
};

export type SealedGrantV1 = SealedGrantDerivedV1 | SealedGrantGlyphV1;

export type SealedEnvelopeV1 = {
  v: 1;
  alg: "AES-256-GCM";
  kdf: "HKDF-SHA-256";

  // Encrypted inner JSON (canonicalized)
  content_iv_b64url: string;
  content_ct_b64url: string;

  // CEK wrapped for one or more grants
  grants: SealedGrantV1[];

  // Optional public preview line
  teaser?: string;
};

/** A glyph identity used to create or unlock grants. */
export type GlyphCredential = {
  phiKey: string;
  kaiSignature: string; // secret-bearing, stored in glyph SVG metadata
  sigilId?: string;
};

export type SealOptions = {
  inner: unknown; // payload fragment to encrypt (body + attachments + etc.)
  teaser?: string;

  /** If provided, create a `derived` grant tied to this issuer's verified glyph. */
  derived?: {
    issuerKaiSignature: string;
    issuerPhiKey?: string;
    salt_b64url?: string; // optional (otherwise random)
  };

  /** If provided, create one `glyph` grant per allowed glyph. */
  allowGlyphs?: GlyphCredential[];
};

export type UnsealResult =
  | { ok: true; inner: unknown; usedGrant: SealedGrantV1 }
  | { ok: false; error: string };

const AAD_CONTENT = "KaiVoh.SealEnvelopeV1.content";
const AAD_WRAP_DERIVED = "KaiVoh.SealEnvelopeV1.wrap.derived";
const AAD_WRAP_GLYPH = "KaiVoh.SealEnvelopeV1.wrap.glyph";

const te = new TextEncoder();

/** DOM WebCrypto expects BufferSource backed by ArrayBuffer (not ArrayBufferLike). */
type Bytes = Uint8Array<ArrayBuffer>;

/** Ensure Uint8Array is backed by a real ArrayBuffer (copy if SAB/other). */
function toBytesAB(u8: Uint8Array): Bytes {
  if (u8.buffer instanceof ArrayBuffer) return u8 as Bytes;
  const out = new Uint8Array(u8.byteLength);
  out.set(u8);
  return out as Bytes;
}

/* ───────────────────────── base64url bytes (no atob/btoa) ───────────────────────── */

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

function randomBytes(n: number): Bytes {
  if (typeof crypto === "undefined" || !crypto.getRandomValues) throw new Error("crypto.getRandomValues unavailable");
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b as Bytes;
}

/* ───────────────────────── canonical JSON (stable key order) ───────────────────────── */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function canonicalize(value: unknown, seen: Set<object>): unknown {
  if (value === null) return null;

  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map((x) => canonicalize(x, seen));
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) throw new Error("Cannot seal cyclic objects");
    seen.add(value);

    const keys = Object.keys(value).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const v = value[k];
      if (typeof v === "undefined") continue; // match JSON.stringify omission
      out[k] = canonicalize(v, seen);
    }

    seen.delete(value);
    return out;
  }

  // Fallback: coerce via JSON stringify semantics (e.g. Date -> ISO via toJSON)
  const asJson = JSON.stringify(value);
  if (typeof asJson !== "string") return null;
  try {
    return JSON.parse(asJson) as unknown;
  } catch {
    return null;
  }
}

function canonicalJsonBytes(value: unknown): Bytes {
  const canon = canonicalize(value, new Set<object>());
  const s = JSON.stringify(canon);
  return toBytesAB(te.encode(s));
}

/* ───────────────────────── signature → bytes normalization ───────────────────────── */

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

function normalizeKaiSignatureBytes(sig: string): Bytes {
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

/* ───────────────────────── WebCrypto helpers ───────────────────────── */

function requireSubtle(): SubtleCrypto {
  if (typeof crypto === "undefined" || !crypto.subtle) throw new Error("WebCrypto subtle unavailable");
  return crypto.subtle;
}

async function hkdfSha256Bits(params: { ikm: Uint8Array; salt: Uint8Array; info: Uint8Array; bits: number }): Promise<Bytes> {
  const subtle = requireSubtle();

  const ikm = toBytesAB(params.ikm);
  const salt = toBytesAB(params.salt);
  const info = toBytesAB(params.info);

  const key = await subtle.importKey("raw", ikm, { name: "HKDF" }, false, ["deriveBits"]);

  const out = await subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    params.bits,
  );

  return new Uint8Array(out) as Bytes;
}

async function importAesGcmKey(raw32: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  if (raw32.length !== 32) throw new Error("AES-256 key must be 32 bytes");
  const subtle = requireSubtle();
  const keyBytes = toBytesAB(raw32);
  return await subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, usages);
}

async function aesGcmEncrypt(opts: { key: CryptoKey; iv12: Uint8Array; aad: string; plaintext: Uint8Array }): Promise<Bytes> {
  if (opts.iv12.length !== 12) throw new Error("AES-GCM iv must be 12 bytes");
  const subtle = requireSubtle();

  const iv = toBytesAB(opts.iv12);
  const aad = toBytesAB(te.encode(opts.aad));
  const pt = toBytesAB(opts.plaintext);

  const ct = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, opts.key, pt);
  return new Uint8Array(ct) as Bytes;
}

async function aesGcmDecrypt(opts: { key: CryptoKey; iv12: Uint8Array; aad: string; ciphertext: Uint8Array }): Promise<Bytes> {
  if (opts.iv12.length !== 12) throw new Error("AES-GCM iv must be 12 bytes");
  const subtle = requireSubtle();

  const iv = toBytesAB(opts.iv12);
  const aad = toBytesAB(te.encode(opts.aad));
  const ct = toBytesAB(opts.ciphertext);

  const pt = await subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad }, opts.key, ct);
  return new Uint8Array(pt) as Bytes;
}

/* ───────────────────────── Derived + Glyph wrap key derivation ───────────────────────── */

async function deriveWrapKeyFromDerivedKaiSig(params: { kaiSigBytes: Uint8Array; salt: Uint8Array }): Promise<Bytes> {
  return await hkdfSha256Bits({
    ikm: params.kaiSigBytes,
    salt: params.salt,
    info: te.encode("KaiVoh.wrapKey.derived.v1"),
    bits: 256,
  });
}

async function deriveWrapKeyFromGlyphKaiSig(params: { kaiSigBytes: Uint8Array; salt: Uint8Array }): Promise<Bytes> {
  return await hkdfSha256Bits({
    ikm: params.kaiSigBytes,
    salt: params.salt,
    info: te.encode("KaiVoh.wrapKey.glyph.v1"),
    bits: 256,
  });
}

/**
 * Derive the “derivative kaiSignature bytes” from a base kaiSignature and a per-post salt.
 * - Used so BOTH issuer base glyph AND exported derivative glyph can unlock:
 *    • if you login with derivative glyph, your kaiSignature already equals derived
 *    • if you login with base glyph, you compute derived from base+salt
 */
export async function deriveDerivativeKaiSignatureBytes(params: { baseKaiSignature: string; salt_b64url: string }): Promise<Bytes> {
  const base = normalizeKaiSignatureBytes(params.baseKaiSignature);
  const salt = base64UrlToBytes(params.salt_b64url);

  return await hkdfSha256Bits({
    ikm: base,
    salt,
    info: te.encode("KaiVoh.deriveKaiSignature.v1"),
    bits: 256,
  });
}

export async function deriveDerivativeKaiSignatureB64Url(params: { baseKaiSignature: string; salt_b64url: string }): Promise<string> {
  const b = await deriveDerivativeKaiSignatureBytes(params);
  return bytesToBase64Url(b);
}

/* ───────────────────────── Public API ───────────────────────── */

export function makeSealSaltB64Url(bytes: number = 18): string {
  return bytesToBase64Url(randomBytes(bytes));
}

export async function sealEnvelopeV1(opts: SealOptions): Promise<SealedEnvelopeV1> {
  const grants: SealedGrantV1[] = [];

  // 1) Build content CEK + encrypt inner JSON
  const cek = randomBytes(32);
  const contentIv = randomBytes(12);
  const contentKey = await importAesGcmKey(cek, ["encrypt", "decrypt"]);
  const innerBytes = canonicalJsonBytes(opts.inner);

  const contentCt = await aesGcmEncrypt({
    key: contentKey,
    iv12: contentIv,
    aad: AAD_CONTENT,
    plaintext: innerBytes,
  });

  // 2) Derived grant (issuer-based, but unlockable by derivative glyph too)
  if (opts.derived) {
    const salt_b64url = opts.derived.salt_b64url ?? makeSealSaltB64Url(18);
    const salt = base64UrlToBytes(salt_b64url);

    // Wrap uses “derived kaiSignature bytes” as the basis.
    const derivedKaiSig = await deriveDerivativeKaiSignatureBytes({
      baseKaiSignature: opts.derived.issuerKaiSignature,
      salt_b64url,
    });

    const wrapKeyRaw = await deriveWrapKeyFromDerivedKaiSig({ kaiSigBytes: derivedKaiSig, salt });
    const wrapKey = await importAesGcmKey(wrapKeyRaw, ["encrypt", "decrypt"]);

    const wrapIv = randomBytes(12);
    const wrapCt = await aesGcmEncrypt({
      key: wrapKey,
      iv12: wrapIv,
      aad: AAD_WRAP_DERIVED,
      plaintext: cek, // wrap the CEK
    });

    grants.push({
      kind: "derived",
      salt_b64url,
      issuerPhiKey: opts.derived.issuerPhiKey,
      wrap_iv_b64url: bytesToBase64Url(wrapIv),
      wrap_ct_b64url: bytesToBase64Url(wrapCt),
    });
  }

  // 3) Specific glyph grants
  if (Array.isArray(opts.allowGlyphs) && opts.allowGlyphs.length > 0) {
    for (const g of opts.allowGlyphs) {
      const salt_b64url = makeSealSaltB64Url(18);
      const salt = base64UrlToBytes(salt_b64url);

      const kaiSigBytes = normalizeKaiSignatureBytes(g.kaiSignature);
      const wrapKeyRaw = await deriveWrapKeyFromGlyphKaiSig({ kaiSigBytes, salt });
      const wrapKey = await importAesGcmKey(wrapKeyRaw, ["encrypt", "decrypt"]);

      const wrapIv = randomBytes(12);
      const wrapCt = await aesGcmEncrypt({
        key: wrapKey,
        iv12: wrapIv,
        aad: AAD_WRAP_GLYPH,
        plaintext: cek,
      });

      grants.push({
        kind: "glyph",
        allowPhiKey: g.phiKey,
        allowSigilId: g.sigilId,
        salt_b64url,
        wrap_iv_b64url: bytesToBase64Url(wrapIv),
        wrap_ct_b64url: bytesToBase64Url(wrapCt),
      });
    }
  }

  if (grants.length === 0) {
    throw new Error("sealEnvelopeV1: no grants provided (derived or allowGlyphs required)");
  }

  return {
    v: 1,
    alg: "AES-256-GCM",
    kdf: "HKDF-SHA-256",
    content_iv_b64url: bytesToBase64Url(contentIv),
    content_ct_b64url: bytesToBase64Url(contentCt),
    grants,
    teaser: opts.teaser,
  };
}

async function tryUnwrapCekWithDerivedGrant(grant: SealedGrantDerivedV1, kaiSignature: string): Promise<Bytes | null> {
  const salt = base64UrlToBytes(grant.salt_b64url);
  const wrapIv = base64UrlToBytes(grant.wrap_iv_b64url);
  const wrapCt = base64UrlToBytes(grant.wrap_ct_b64url);

  // Attempt A: treat provided kaiSignature as already-derived
  {
    const sigBytes = normalizeKaiSignatureBytes(kaiSignature);
    const wrapKeyRaw = await deriveWrapKeyFromDerivedKaiSig({ kaiSigBytes: sigBytes, salt });
    const wrapKey = await importAesGcmKey(wrapKeyRaw, ["decrypt"]);
    try {
      return await aesGcmDecrypt({ key: wrapKey, iv12: wrapIv, aad: AAD_WRAP_DERIVED, ciphertext: wrapCt });
    } catch {
      // continue
    }
  }

  // Attempt B: treat provided kaiSignature as base, derive derivative bytes first
  try {
    const derived = await deriveDerivativeKaiSignatureBytes({ baseKaiSignature: kaiSignature, salt_b64url: grant.salt_b64url });
    const wrapKeyRaw = await deriveWrapKeyFromDerivedKaiSig({ kaiSigBytes: derived, salt });
    const wrapKey = await importAesGcmKey(wrapKeyRaw, ["decrypt"]);
    return await aesGcmDecrypt({ key: wrapKey, iv12: wrapIv, aad: AAD_WRAP_DERIVED, ciphertext: wrapCt });
  } catch {
    return null;
  }
}

async function tryUnwrapCekWithGlyphGrant(grant: SealedGrantGlyphV1, kaiSignature: string): Promise<Bytes | null> {
  const salt = base64UrlToBytes(grant.salt_b64url);
  const wrapIv = base64UrlToBytes(grant.wrap_iv_b64url);
  const wrapCt = base64UrlToBytes(grant.wrap_ct_b64url);

  try {
    const sigBytes = normalizeKaiSignatureBytes(kaiSignature);
    const wrapKeyRaw = await deriveWrapKeyFromGlyphKaiSig({ kaiSigBytes: sigBytes, salt });
    const wrapKey = await importAesGcmKey(wrapKeyRaw, ["decrypt"]);
    return await aesGcmDecrypt({ key: wrapKey, iv12: wrapIv, aad: AAD_WRAP_GLYPH, ciphertext: wrapCt });
  } catch {
    return null;
  }
}

export async function unsealEnvelopeV1(
  env: SealedEnvelopeV1,
  creds: { kaiSignature: string; phiKey?: string },
): Promise<UnsealResult> {
  if (!env || env.v !== 1) return { ok: false, error: "Unsupported sealed envelope version" };
  if (!Array.isArray(env.grants) || env.grants.length === 0) return { ok: false, error: "No grants" };

  const contentIv = base64UrlToBytes(env.content_iv_b64url);
  const contentCt = base64UrlToBytes(env.content_ct_b64url);

  for (const grant of env.grants) {
    if (grant.kind === "glyph") {
      if (creds.phiKey && creds.phiKey !== grant.allowPhiKey) continue;

      const cek = await tryUnwrapCekWithGlyphGrant(grant, creds.kaiSignature);
      if (!cek || cek.length !== 32) continue;

      try {
        const contentKey = await importAesGcmKey(cek, ["decrypt"]);
        const pt = await aesGcmDecrypt({ key: contentKey, iv12: contentIv, aad: AAD_CONTENT, ciphertext: contentCt });
        const json = new TextDecoder().decode(pt);
        const inner = JSON.parse(json) as unknown;
        return { ok: true, inner, usedGrant: grant };
      } catch {
        // continue
      }
    }

    if (grant.kind === "derived") {
      const cek = await tryUnwrapCekWithDerivedGrant(grant, creds.kaiSignature);
      if (!cek || cek.length !== 32) continue;

      try {
        const contentKey = await importAesGcmKey(cek, ["decrypt"]);
        const pt = await aesGcmDecrypt({ key: contentKey, iv12: contentIv, aad: AAD_CONTENT, ciphertext: contentCt });
        const json = new TextDecoder().decode(pt);
        const inner = JSON.parse(json) as unknown;
        return { ok: true, inner, usedGrant: grant };
      } catch {
        // continue
      }
    }
  }

  if (!creds.phiKey) {
    for (const grant of env.grants) {
      if (grant.kind !== "glyph") continue;

      const cek = await tryUnwrapCekWithGlyphGrant(grant, creds.kaiSignature);
      if (!cek || cek.length !== 32) continue;

      try {
        const contentKey = await importAesGcmKey(cek, ["decrypt"]);
        const pt = await aesGcmDecrypt({ key: contentKey, iv12: contentIv, aad: AAD_CONTENT, ciphertext: contentCt });
        const json = new TextDecoder().decode(pt);
        const inner = JSON.parse(json) as unknown;
        return { ok: true, inner, usedGrant: grant };
      } catch {
        // continue
      }
    }
  }

  return { ok: false, error: "Access denied (no grant could be unlocked with provided glyph)" };
}
