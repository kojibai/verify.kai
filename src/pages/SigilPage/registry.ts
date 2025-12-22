// src/pages/SigilPage/registry.ts
import { putMetadata } from "../../utils/svgMeta";
import type { SigilPayload } from "../../types/sigil";
import { kairosEpochNow } from "../../utils/kai_pulse";

/**
 * The attestation claim we sign & verify.
 * IMPORTANT: the key order is fixed by CLAIM_KEYS and canonicalString().
 */
export type Claim = {
  canonicalHash: string;          // lowercase hex of sha256(Σ)
  token: string;                  // transfer token / nonce (string)
  expiresAtPulse: number | null;  // or null
  issuedAt: number;               // epoch seconds
  version: 1;                     // constant for now
};

const CLAIM_KEYS: Array<keyof Claim> = [
  "canonicalHash",
  "token",
  "expiresAtPulse",
  "issuedAt",
  "version",
];
const epochSecondsNow = (): number => Number(kairosEpochNow() / 1000n);

/**
 * Produce a canonical JSON string with a stable key order.
 */
const canonicalString = (c: Claim): string =>
  JSON.stringify(
    {
      canonicalHash: c.canonicalHash,
      token: c.token,
      expiresAtPulse: c.expiresAtPulse,
      issuedAt: c.issuedAt,
      version: c.version,
    },
    CLAIM_KEYS
  );

/** base64url encode (no padding) */
const b64u = (u8: Uint8Array): string =>
  btoa(String.fromCharCode(...u8))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

/** Compute r = base64url(canonicalString(claim)) */
export const computeR = (claim: Claim): string =>
  b64u(new TextEncoder().encode(canonicalString(claim)));

/**
 * Ask your signer to produce an ECDSA signature over the canonical string.
 * The server may return {s,kid} (preferred) or {r,s,kid}. If r is omitted,
 * we compute it locally from the claim to guarantee consistency.
 *
 * Adjust the POST shape if your backend expects JSON instead of text/plain.
 */
export async function requestRegistrySignature(
  claim: Claim
): Promise<{ r: string; s: string; kid: string } | null> {
  try {
    // Send the canonical string as the exact bytes to be signed.
    const res = await fetch("/api/sign-claim", {
      method: "POST",
      headers: { "content-type": "text/plain;charset=UTF-8" },
      body: canonicalString(claim),
    });
    if (!res.ok) return null;

    const out = (await res.json()) as
      | { r?: string; s: string; kid: string }
      | null;

    if (!out || !out.s || !out.kid) return null;

    const r = out.r ?? computeR(claim);
    return { r, s: out.s, kid: out.kid };
  } catch {
    return null;
  }
}

/** Add r/s/kid to a share URL. */
export function appendAttestationToUrl(u: URL, r: string, s: string, kid: string): void {
  u.searchParams.set("r", r);
  u.searchParams.set("s", s);
  u.searchParams.set("kid", kid);
}

/**
 * Embed attestation into the SVG’s <metadata>.
 * NOTE: registryClaim is the base64url string (r), not raw JSON.
 */
export function embedAttestationInSvg(
  svgEl: SVGSVGElement,
  claim: Claim,
  s: string,
  kid: string
): void {
  const r = computeR(claim);
  putMetadata(svgEl, {
    registryClaim: r,  // base64url of canonical JSON
    registrySig: s,    // base64url DER ECDSA signature
    registryKid: kid,  // base64url key id (SHA-256 of raw 65-byte pubkey)
  });
}

/**
 * Build a well-formed claim from your page data.
 * - canonicalHash MUST be lowercase hex (we normalize here).
 * - token should be a unique transfer token / nonce you generate.
 */
export function buildClaim(meta: SigilPayload, canonicalHash: string, token: string): Claim {
  return {
    canonicalHash: canonicalHash.toLowerCase(),
    token,
    expiresAtPulse: meta.expiresAtPulse ?? null,
    issuedAt: epochSecondsNow(),
    version: 1,
  };
}
