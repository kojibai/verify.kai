// src/lib/sigil/breathProof.ts
//
// BreathProof — hardened ECDSA signing & verification with:
// - Non-extractable P-256 private keys by default
// - URL-safe base64url signatures
// - RFC 7638 JWK thumbprints (public key fingerprint)
// - Canonical, domain-separated message encoding (stable key order)
// - Helpers to import/export keys and build canonical Kai messages
//
// Notes:
// • Private keys are generated non-extractable by default.
// • Signatures are base64url for safe use in URLs/QRs.
// • Canonical messages are domain-separated to prevent cross-protocol replay.
// • Bind pulse/beat/step/nonce/expiry in the message you sign.
//

import { kairosEpochNow } from "../../utils/kai_pulse";

export type BreathKeyPair = {
  publicKeyJwk: JsonWebKey;
  privateKey: CryptoKey; // non-extractable by default
};

/**
 * Buffer-like input we accept at the API boundary.
 * We normalize this to ArrayBuffer internally for WebCrypto.
 */
export type Bufferish = Uint8Array | ArrayBuffer | string;

/** Domain separator for message binding (prevents cross-protocol replay). */
export const DOMAIN_SEPARATOR = "kairos.breathproof.v1";

/** WebCrypto algorithm parameters (P-256 ECDSA + SHA-256). */
const EC_KEY_PARAMS: EcKeyGenParams = { name: "ECDSA", namedCurve: "P-256" };
const EC_IMPORT_PARAMS: EcKeyImportParams = {
  name: "ECDSA",
  namedCurve: "P-256",
};
const EC_SIGN_PARAMS: EcdsaParams = {
  name: "ECDSA",
  hash: { name: "SHA-256" },
};

/* ------------------------------------------------------------------------------------------------
 * Public API
 * ----------------------------------------------------------------------------------------------*/

/** Generate a P-256 ECDSA keypair (private key non-extractable by default). */
export async function generateKeyPair(
  opts?: { extractablePrivate?: boolean }
): Promise<BreathKeyPair> {
  const extractablePrivate = Boolean(opts?.extractablePrivate);
  const subtle = getSubtle();
  const keyPair = await subtle.generateKey(
    EC_KEY_PARAMS,
    extractablePrivate,
    ["sign", "verify"]
  );
  const publicKeyJwk = await subtle.exportKey("jwk", keyPair.publicKey);
  return { publicKeyJwk, privateKey: keyPair.privateKey };
}

/** Import a public EC JWK (P-256) for verification. */
export async function importPublicKey(
  publicKeyJwk: JsonWebKey
): Promise<CryptoKey> {
  validateEcP256Jwk(publicKeyJwk);
  const subtle = getSubtle();
  return subtle.importKey("jwk", publicKeyJwk, EC_IMPORT_PARAMS, true, [
    "verify",
  ]);
}

/** Export a public key as JWK. */
export async function exportPublicJwk(
  publicKey: CryptoKey
): Promise<JsonWebKey> {
  const subtle = getSubtle();
  return subtle.exportKey("jwk", publicKey);
}

/** RFC 7638 JWK thumbprint (SHA-256) as base64url. */
export async function jwkThumbprintB64Url(
  jwk: JsonWebKey
): Promise<string> {
  validateEcP256Jwk(jwk);
  const json = `{"crv":"${jwk.crv}","kty":"EC","x":"${jwk.x}","y":"${jwk.y}"}`;
  const hash = await sha256(utf8(json));
  return toBase64Url(hash);
}

/** Sign canonical bytes (ECDSA P-256 + SHA-256). Returns base64url signature. */
export async function signCanonicalMessage(
  privateKey: CryptoKey,
  message: Uint8Array | ArrayBuffer
): Promise<string> {
  const subtle = getSubtle();
  const buf = toArrayBuffer(message);
  const sig = await subtle.sign(EC_SIGN_PARAMS, privateKey, buf);
  return toBase64Url(new Uint8Array(sig));
}

/** Verify ECDSA signature (base64/base64url). Accepts CryptoKey or JWK. */
export async function verifySignature(
  publicKeyOrJwk: CryptoKey | JsonWebKey,
  message: Uint8Array | ArrayBuffer,
  signatureB64OrUrl: string
): Promise<boolean> {
  const subtle = getSubtle();
  const pubKey = isCryptoKey(publicKeyOrJwk)
    ? publicKeyOrJwk
    : await importPublicKey(publicKeyOrJwk);

  // Decode signature and normalize to ArrayBuffer
  const sigBytes = fromMaybeBase64Url(signatureB64OrUrl);
  const sigBuf = toArrayBuffer(sigBytes);

  // Normalize message to ArrayBuffer
  const dataBuf = toArrayBuffer(message);

  // WebCrypto sees only ArrayBuffer → no BufferSource / ArrayBufferLike mismatch
  return subtle.verify(EC_SIGN_PARAMS, pubKey, sigBuf, dataBuf);
}

/**
 * Canonical JSON encoding with domain separator.
 * Drops `undefined`, preserves `null`, sorts object keys at every level.
 */
export function encodeCanonicalMessage(value: unknown): Uint8Array {
  // Ensure we always sign an object; arrays/primitives go under `value`
  let merged: Record<string, unknown> = { _ds: DOMAIN_SEPARATOR };

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    merged = {
      _ds: DOMAIN_SEPARATOR,
      ...dropUndef(value as Record<string, unknown>),
    };
  } else if (value !== undefined) {
    merged = { _ds: DOMAIN_SEPARATOR, value };
  }

  const canon = canonicalize(merged);
  return utf8(JSON.stringify(canon));
}

/** Opinionated helper for Kai messages with time/intent binding. */
export function encodeKaiCanonicalMessage(
  fields: CanonicalMessageFields
): Uint8Array {
  const base: CanonicalMessageFields = {
    ...fields,
    pulse: asSafeInt(fields.pulse, "pulse"),
    beat: asSafeInt(fields.beat, "beat"),
    stepIndex: asSafeInt(fields.stepIndex, "stepIndex"),
    stepsPerBeat: asSafeInt(fields.stepsPerBeat, "stepsPerBeat"),
    expiresAtPulse:
      typeof fields.expiresAtPulse === "number"
        ? asSafeInt(fields.expiresAtPulse, "expiresAtPulse")
        : undefined,
  };
  return encodeCanonicalMessage(base);
}

/** Self-check for diagnostics and audits. */
export async function selfTestBreathProof(): Promise<{
  ok: boolean;
  reason?: string;
  publicKeyThumbprint?: string;
  signature?: string;
}> {
  try {
    const { publicKeyJwk, privateKey } = await generateKeyPair();
    const msg = encodeCanonicalMessage({
      test: true,
      when: kairosEpochNow(),
      rnd: crypto.getRandomValues(new Uint32Array(4)).join(""),
    });
    const sig = await signCanonicalMessage(privateKey, msg);
    const ok = await verifySignature(publicKeyJwk, msg, sig);
    const thumb = await jwkThumbprintB64Url(publicKeyJwk);
    return ok
      ? { ok: true, publicKeyThumbprint: thumb, signature: sig }
      : { ok: false, reason: "verification failed" };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason };
  }
}

/* ------------------------------------------------------------------------------------------------
 * Canonical message typing
 * ----------------------------------------------------------------------------------------------*/

export interface CanonicalMessageFields {
  pulse: number;
  beat: number;
  stepIndex: number;
  stepsPerBeat: number;

  canonicalHash: string;

  intention?: string | null;
  recipientPhiKey?: string | null;
  nonce?: string | null;
  expiresAtPulse?: number;
  context?: Record<string, unknown> | null;
}

/* ------------------------------------------------------------------------------------------------
 * Utilities (base64, utf8, hashing, canonicalization)
 * ----------------------------------------------------------------------------------------------*/

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Normalize a Uint8Array or ArrayBuffer into a plain ArrayBuffer. */
function toArrayBuffer(input: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (input instanceof ArrayBuffer) {
    return input;
  }

  // Copy into a fresh ArrayBuffer so we never surface ArrayBufferLike / SharedArrayBuffer
  const copy = new Uint8Array(input.byteLength);
  copy.set(input);
  return copy.buffer;
}

/** SHA-256 → raw bytes (Uint8Array). */
export async function sha256(
  data: Uint8Array | ArrayBuffer
): Promise<Uint8Array> {
  const subtle = getSubtle();
  const buf = toArrayBuffer(data);
  const d = await subtle.digest("SHA-256", buf);
  return new Uint8Array(d);
}

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export function toBase64Url(bytesOrB64: Uint8Array | string): string {
  const b64 = typeof bytesOrB64 === "string" ? bytesOrB64 : toBase64(bytesOrB64);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function fromBase64Url(b64url: string): Uint8Array {
  const pad = "=".repeat((4 - (b64url.length % 4 || 4)) % 4);
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return fromBase64(b64);
}

export function fromMaybeBase64Url(s: string): Uint8Array {
  return /[-_]/.test(s) ? fromBase64Url(s) : fromBase64(s);
}

/* Stable JSON canonicalization (JCS-style) */
function canonicalize(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => canonicalize(x));
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    out[k] = canonicalize(o[k]);
  }
  return out;
}

function dropUndef<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Partial<T> = {};
  (Object.keys(o) as Array<keyof T>).forEach((k) => {
    const v = o[k];
    if (v !== undefined) {
      (out as Record<keyof T, unknown>)[k] = v;
    }
  });
  return out;
}

function asSafeInt(n: unknown, name: string): number {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new Error(`Invalid number for ${name}`);
  }
  const r = Math.trunc(n);
  if (!Number.isSafeInteger(r)) {
    throw new Error(`Non-safe integer for ${name}`);
  }
  return r;
}

/* ------------------------------------------------------------------------------------------------
 * Environment / validation helpers
 * ----------------------------------------------------------------------------------------------*/

function getSubtle(): SubtleCrypto {
  const g = globalThis as unknown as { crypto?: Crypto };
  const c = g.crypto;
  if (!c || !c.subtle) {
    throw new Error(
      "WebCrypto subtle API not available. Use a secure (HTTPS) context."
    );
  }
  return c.subtle;
}

function isCryptoKey(x: unknown): x is CryptoKey {
  return typeof CryptoKey !== "undefined" && x instanceof CryptoKey;
}

function validateEcP256Jwk(jwk: JsonWebKey): void {
  if (jwk.kty !== "EC") throw new Error("JWK kty must be 'EC'");
  if (jwk.crv !== "P-256") throw new Error("JWK curve must be 'P-256'");
  if (!jwk.x || !jwk.y) throw new Error("EC JWK must include 'x' and 'y'");
}

/* ------------------------------------------------------------------------------------------------
 * Convenience glue (optional)
 * ----------------------------------------------------------------------------------------------*/

export const KaiBreath = {
  encode: encodeKaiCanonicalMessage,
  sign: signCanonicalMessage,
  verify: verifySignature,
  thumbprint: jwkThumbprintB64Url,
};
