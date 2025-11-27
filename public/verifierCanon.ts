// src/pages/SigilPage/verifierCanon.ts
import { sha256 as nobleSha256 } from "@noble/hashes/sha256";

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export const bytesToHexCanon = (u8: Uint8Array) =>
  Array.from(u8).map((b) => b.toString(16).padStart(2, "0")).join("");

// SHA-256 with secure-context fallback (works on file:// via @noble/hashes)
export async function sha256HexCanon(msg: string | Uint8Array): Promise<string> {
  const data = typeof msg === "string" ? new TextEncoder().encode(msg) : msg;
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const buf = await subtle.digest("SHA-256", data);
    return bytesToHexCanon(new Uint8Array(buf));
  }
  const hash = nobleSha256(data);
  return bytesToHexCanon(hash);
}

function base58EncodeCanon(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) + BigInt(b);
  let out = "";
  while (n > 0n) {
    const mod = Number(n % 58n);
    out = B58_ALPHABET[mod] + out;
    n /= 58n;
  }
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out = "1" + out;
  return out;
}

export async function base58CheckCanon(payload: Uint8Array, version = 0x00): Promise<string> {
  const v = new Uint8Array(1 + payload.length);
  v[0] = version;
  v.set(payload, 1);

  const subtle = globalThis.crypto?.subtle;
  let c2: Uint8Array;

  if (subtle) {
    const d1 = await subtle.digest("SHA-256", v);
    const d2 = await subtle.digest("SHA-256", d1);
    c2 = new Uint8Array(d2);
  } else {
    const h1 = nobleSha256(v);
    c2 = nobleSha256(h1);
  }

  const checksum = c2.slice(0, 4);
  const full = new Uint8Array(v.length + 4);
  full.set(v);
  full.set(checksum, v.length);
  return base58EncodeCanon(full);
}

export async function derivePhiKeyFromSigCanon(sigHex: string): Promise<string> {
  const s = await sha256HexCanon(sigHex + "φ");
  const raw = new Uint8Array(20);
  for (let i = 0; i < 20; i++) raw[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return base58CheckCanon(raw, 0x00);
}

/* Ensure canonical <metadata> first for Verifier */
export function ensureCanonicalMetadataFirst(svgEl: SVGSVGElement) {
  try {
    const metas = Array.from(svgEl.querySelectorAll("metadata"));
    if (!metas.length) return;
    const canon = metas.find((m) => m.getAttribute("data-noncanonical") !== "1") || metas[0];
    if (canon && svgEl.firstChild !== canon) svgEl.insertBefore(canon, svgEl.firstChild);
  } catch {
    /* noop: non-fatal */
  }
}

/* Σ builder — intention is explicitly string|null for API compatibility */
export function verifierSigmaString(
  pulse: number,
  beat: number,
  stepIndex: number,
  chakraDay: string,
  intention: string | null
): string {
  return `${pulse}|${beat}|${stepIndex}|${chakraDay}|${intention ?? ""}`;
}

/* Read optional intentionSigil as string|null (not undefined) */
export function readIntentionSigil(obj: unknown): string | null {
  if (typeof obj !== "object" || obj === null) return null;
  const rec = obj as Record<string, unknown>;
  const v = rec["intentionSigil"];
  return typeof v === "string" ? v : null;
}
