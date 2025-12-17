// src/components/exhale-note/proofPages.ts
/*
  Proof pages (2–4) renderer
  - Returns an HTML string to drop into your print root (see printer.ts)
  - Exports BOTH a named and default export to satisfy either import style
*/

import { esc, sanitizeSvg } from "./sanitize";
import { makeQrSvgTagSafe } from "./qr";
import type { ProvenanceRow } from "./types";

export interface ProofPagesParams {
  frozenPulse: string;
  kaiSignature?: string;
  userPhiKey?: string;
  sigmaCanon?: string;   // Σ (canonical)
  shaHex?: string;       // sha256(Σ)
  phiDerived?: string;   // Φ derived from sha256(Σ)

  valuePhi: string;
  premiumPhi: string;
  valuationAlg: string;
  valuationStamp?: string;

  zk?: { scheme?: string; poseidon?: string };
  provenance?: ProvenanceRow[];

  sigilSvg?: string;     // raw SVG for page 4 (sanitized)
  verifyUrl?: string;    // used for QR & link on pages 2/4
}

/* --- lightweight view helpers matching portal styles --- */

const kvOpen = `<div class="kv">`;
const kvClose = `</div>`;

function cardHead(title: string): string {
  return `<div class="proof-card"><h3>${esc(title)}</h3>`;
}
const cardTail = `</div>`;

function hint(text: string): string {
  return `<div class="hint">${esc(text)}</div>`;
}

function codeLine(label: string, value: string): string {
  return `<strong>${esc(label)}</strong><div><code>${esc(value || "—")}</code></div>`;
}

/* --- main renderer --- */
export function buildProofPagesHTML(p: ProofPagesParams): string {
  const frozen = p.frozenPulse || "—";
  const ksig = p.kaiSignature || "";
  const uphi = p.userPhiKey || "";
  const sigma = p.sigmaCanon || "";
  const sha = p.shaHex || "";
  const phi = p.phiDerived || "";

  const val = p.valuePhi || "0";
  const prem = p.premiumPhi || "0";
  const alg = p.valuationAlg || "phi/kosmos-vφ-5 • 00000000";
  const stamp = p.valuationStamp || "";

  const verify = p.verifyUrl || "/";
  const qrSvg = makeQrSvgTagSafe(verify, 160, 2);

  // Optional ZK block
  const zkBlock =
    p.zk && (p.zk.scheme || p.zk.poseidon)
      ? `
        ${cardHead("Zero-Knowledge Proof")}
          ${kvOpen}
            ${codeLine("Scheme", p.zk.scheme ?? "—")}
            ${codeLine("Poseidon Hash", p.zk.poseidon ?? "—")}
          ${kvClose}
        ${cardTail}
      `
      : "";

  // Optional provenance table (newest first)
  let provDetail = "";
  if (p.provenance?.length) {
    const rows = p.provenance
      .slice()
      .reverse()
      .map((r) => {
        const ownerShort = r.ownerPhiKey ? `${String(r.ownerPhiKey).slice(0, 16)}…` : "—";
        return `
          <tr>
            <td>${esc(String(r.action ?? ""))}</td>
            <td>${esc(String(r.pulse ?? ""))}</td>
            <td>${esc(String(r.beat ?? ""))}:${esc(String(r.stepIndex ?? ""))}</td>
            <td>${esc(ownerShort)}</td>
          </tr>`;
      })
      .join("");

    provDetail = `
      ${cardHead("Provenance (lineage)")}
        ${hint("Newest first")}
        <table class="kk-proof-table">
          <thead>
            <tr>
              <th style="text-align:left">Action</th>
              <th style="text-align:left">Pulse</th>
              <th style="text-align:left">Beat:Step</th>
              <th style="text-align:left">Owner Φkey</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      ${cardTail}
    `;
  }

  // PAGE 2 — core proofs / identity / valuation
  const page2 = `
    <div class="print-page">
      <div class="page-stamp-top">
        <span>PROOF PAGE • Σ → SHA-256 → Φ</span>
        <span>Valuation Pulse: ${esc(frozen)}</span>
      </div>

      ${cardHead("Identity & Σ")}
        ${kvOpen}
          ${codeLine("kaiSignature", ksig || "—")}
          ${codeLine("userΦkey", uphi || "—")}
          ${codeLine("Σ (canonical)", sigma || "—")}
        ${kvClose}
      ${cardTail}

      ${cardHead("Hash & Derivation")}
        ${kvOpen}
          ${codeLine("sha256(Σ)", sha || "—")}
          ${codeLine("Φ (derived)", phi || "—")}
        ${kvClose}
      ${cardTail}

      ${cardHead("Valuation")}
        ${kvOpen}
          ${codeLine("Algorithm", alg)}
          ${codeLine("Valuation Pulse", frozen)}
          ${codeLine("Value Φ", val)}
          ${codeLine("Premium Φ", prem)}
          ${codeLine("Valuation Stamp", stamp || "—")}
        ${kvClose}
      ${cardTail}

      ${zkBlock}
      ${provDetail}

      ${cardHead("QR • Verify Link (same as seal/QR)")}
        <div style="display:flex; gap:12px; align-items:center">
          <div>${qrSvg}</div>
          <div>
            ${hint("Open / scan:")}
            <div>
              <a href="${esc(verify)}" target="_blank" rel="noopener" style="word-break:break-all">
                ${esc(verify)}
              </a>
            </div>
          </div>
        </div>
      ${cardTail}

      <div class="page-stamp-bot">
        <span>All values computed offline</span>
        <span>PULSE: ${esc(frozen)}</span>
      </div>
    </div>
  `.trim();

  // PAGE 3 — Attestation (reserved; placeholder)
  const page3 = `
    <div class="print-page">
      <div class="page-stamp-top">
        <span>PROOF PAGE • Attestation (optional)</span>
        <span>Valuation Pulse: ${esc(frozen)}</span>
      </div>

      ${cardHead("Registry Attestation")}
        ${kvOpen}
          ${codeLine("Valid", "—")}
          ${codeLine("r (claim)", "—")}
          ${codeLine("s (signature)", "—")}
          ${codeLine("kid", "—")}
        ${kvClose}
        <div style="margin-top:8px">
          ${hint("Decoded claim JSON")}
          <pre class="out">—</pre>
        </div>
      ${cardTail}

      <div class="page-stamp-bot">
        <span>Verifier: offline ECDSA P-256</span>
        <span>PULSE: ${esc(frozen)}</span>
      </div>
    </div>
  `.trim();

  // PAGE 4 — Raw Sigil SVG (sanitized) + verify link again
  const safeSigil = sanitizeSvg(p.sigilSvg || "");
  const page4 = `
    <div class="print-page">
      <div class="page-stamp-top">
        <span>PROOF PAGE • Raw SVG (sanitized)</span>
        <span>Valuation Pulse: ${esc(frozen)}</span>
      </div>

      ${cardHead("SVG")}
        <pre class="out">${esc(safeSigil)}</pre>
      ${cardTail}

      ${cardHead("Verify URL (clickable — same as seal QR)")}
        ${hint("Open / scan:")}
        <div>
          <a href="${esc(verify)}" target="_blank" rel="noopener" style="word-break:break-all">
            ${esc(verify)}
          </a>
        </div>
      ${cardTail}

      <div class="page-stamp-bot">
        <span>Sanitized: no scripts or inline handlers</span>
        <span>PULSE: ${esc(frozen)}</span>
      </div>
    </div>
  `.trim();

  return page2 + page3 + page4;
}

/* allow: import buildProofPagesHTML from './proofPages' */
export default buildProofPagesHTML;
