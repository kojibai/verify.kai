// src/components/exhale-note/printer.ts
import { esc } from "./sanitize";

let restorePrintRoot: (() => void) | null = null;

function pinPrintRootToBody(el: HTMLElement): () => void {
  const parent = el.parentElement;
  const next = el.nextSibling;

  if (parent === document.body) return () => {};

  document.body.appendChild(el);

  return () => {
    try {
      if (!parent) return;
      if (next && next.parentNode === parent) parent.insertBefore(el, next);
      else parent.appendChild(el);
    } catch {
      /* ignore */
    }
  };
}

function ensurePrintStyles(printRootEl: HTMLElement): void {
  const STYLE_ID = "kk-print-style";
  let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;

  printRootEl.setAttribute("data-kk-print-scope", "1");

  const css = `
@media screen {
  [data-kk-print-scope] { display: none !important; }
}

@media print {
  /* Undo common "PWA lock" patterns */
  html, body {
    height: auto !important;
    overflow: visible !important;
    background: #fff !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  #root, [data-reactroot] {
    height: auto !important;
    overflow: visible !important;
    position: static !important;
  }

  /* Hide everything except print scope */
  body * { visibility: hidden !important; }
  [data-kk-print-scope],
  [data-kk-print-scope] * { visibility: visible !important; }

  /* Print scope in normal flow (pagination-safe) */
  [data-kk-print-scope] {
    display: block !important;
    position: static !important;
    inset: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    overflow: visible !important;
    width: 100% !important;
    z-index: auto !important;

    /* Force readable print palette regardless of app theme */
    color: #111 !important;
  }

  @page { size: auto; margin: 10mm; }

  .print-page, .kk-print-page {
    display: block;
    box-sizing: border-box;
    width: 100%;
    min-height: 260mm;
    padding: 8mm 10mm;
    break-after: page;
    page-break-after: always;

    /* Ensure page text is dark even if app CSS says otherwise */
    color: #111 !important;
    background: #fff !important;
  }
  .print-page:last-child, .kk-print-page:last-child {
    break-after: auto;
    page-break-after: auto;
  }

  .page-stamp-top,
  .page-stamp-bot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 10pt;
    line-height: 1.25;
    opacity: 0.9;
    margin-bottom: 6mm;
    color: #111 !important;
  }
  .page-stamp-bot { margin-top: 6mm; }

  /* Banknote: prefer raster (exact match). Keep SVG as fallback. */
  .banknote-frame {
    width: 100%;
    display: flex;
    justify-content: center;
  }
  .banknote-frame .banknote-raster {
    display: block;
    width: 182mm;
    height: auto;
  }
  .banknote-frame svg {
    display: block;
    width: 182mm;
    height: auto;
  }

  /* Proof cards: force white background + dark text */
  .proof-card {
    border: 1px solid #d0d0d0;
    border-radius: 6px;
    padding: 6mm;
    margin: 0 0 6mm 0;
    break-inside: avoid-page;
    page-break-inside: avoid;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 10pt;
    background: #fff !important;
    color: #111 !important;
  }
  .proof-card h3 {
    margin: 0 0 8px 0;
    font-size: 12pt;
    color: #111 !important;
  }

  .kv {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 12px;
    align-items: start;
    font: 10pt ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
    word-break: break-word;
    color: #111 !important;
  }
  .kv > strong { font-family: inherit; font-weight: 700; color: #111 !important; }

  .hint { font-size: 9pt; opacity: 0.8; color: #111 !important; }

  code, pre, .out {
    color: #111 !important;
  }

  .out {
    font: 10pt ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
    background: #f6f8fa !important;
    border: 1px solid #e2e4e8 !important;
    border-radius: 6px;
    padding: 10px;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .kk-proof-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10pt;
    color: #111 !important;
  }
  .kk-proof-table th, .kk-proof-table td {
    border: 1px solid #c8c8c8;
    padding: 6px 8px;
    vertical-align: top;
    word-break: break-word;
    color: #111 !important;
    background: #fff !important;
  }
  .kk-proof-table thead th {
    background: #f3f5f7 !important;
  }

  a { color: #111 !important; text-decoration: underline; }
  a:visited { color: #111 !important; }
  a, a:visited { word-break: break-all; }
}
`;

  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = STYLE_ID;
    styleEl.type = "text/css";
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  } else if (styleEl.textContent !== css) {
    styleEl.textContent = css;
  }
}

function normalizeArgs(
  banknoteSVG: string,
  third: string,
  fourth: string
): { svg: string; pulse: string; proof: string } {
  const looksHtml = (s: string) => s.includes("<") && /[a-z][\s\S]*>/i.test(s);
  if (looksHtml(third) && !looksHtml(fourth)) return { svg: banknoteSVG, proof: third, pulse: fourth };
  return { svg: banknoteSVG, pulse: third, proof: fourth };
}

function extractSvgSize(svgEl: SVGSVGElement): { w: number; h: number } {
  const vb = svgEl.getAttribute("viewBox");
  if (vb) {
    const parts = vb.trim().split(/[,\s]+/).map((x) => Number(x));
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      return { w: Math.max(1, parts[2]), h: Math.max(1, parts[3]) };
    }
  }
  const wAttr = Number(String(svgEl.getAttribute("width") ?? "").replace(/[^\d.]/g, ""));
  const hAttr = Number(String(svgEl.getAttribute("height") ?? "").replace(/[^\d.]/g, ""));
  if (Number.isFinite(wAttr) && wAttr > 0 && Number.isFinite(hAttr) && hAttr > 0) return { w: wAttr, h: hAttr };
  return { w: 1000, h: 618 };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = url;
  });
}

/**
 * Rasterize the banknote SVG inside the print root into a PNG <img>.
 * This makes the printed note match the in-app render (filters/patterns/etc).
 */
async function rasterizeBanknoteForPrint(printRootEl: HTMLElement): Promise<void> {
  const frame = printRootEl.querySelector(".banknote-frame") as HTMLElement | null;
  if (!frame) return;

  // Already rasterized
  if (frame.querySelector("img.banknote-raster")) return;

  const svg = frame.querySelector("svg") as SVGSVGElement | null;
  if (!svg) return;

  try {
    const { w, h } = extractSvgSize(svg);

    // High-res target (roughly 300+ dpi at 182mm width)
    const targetW = 2400;
    const targetH = Math.round((targetW * h) / w);

    const xml = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    try {
      const img = await loadImage(url);

      // Canvas render
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, targetW, targetH);
      ctx.drawImage(img, 0, 0, targetW, targetH);

      const pngUrl = canvas.toDataURL("image/png");

      // Inject raster image
      const raster = document.createElement("img");
      raster.className = "banknote-raster";
      raster.alt = "Kairos Kurrency Note";
      raster.src = pngUrl;

      // Keep SVG as fallback, but hide it (print engines can be inconsistent)
      svg.style.display = "none";
      frame.insertBefore(raster, frame.firstChild);
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    // If rasterization fails, we keep the SVG path as fallback.
  }
}

export function renderIntoPrintRoot(
  printRootEl: HTMLElement,
  banknoteSVG: string,
  frozenPulse: string,
  proofPagesHTML: string
): void {
  restorePrintRoot?.();
  restorePrintRoot = pinPrintRootToBody(printRootEl);

  ensurePrintStyles(printRootEl);
  printRootEl.setAttribute("aria-hidden", "false");

  const { svg, pulse, proof } = normalizeArgs(banknoteSVG, frozenPulse, proofPagesHTML);

  const coverPageHTML = `
    <div class="print-page">
      <div class="page-stamp-top">
        <span>KAIROS KURRENSY — Sovereign Harmonik Kingdom</span>
        <span>Valuation Pulse: ${esc(pulse)}</span>
      </div>
      <div class="banknote-frame">${svg}</div>
      <div class="page-stamp-bot">
        <span>Σ→sha256(Σ)→Φ • Offline</span>
        <span>PULSE: ${esc(pulse)}</span>
      </div>
    </div>
  `;

  const proofHasPageWrappers = /\b(print-page|kk-print-page)\b/.test(proof);
  const normalizedProof = proofHasPageWrappers ? proof : `<div class="print-page">${proof}</div>`;

  while (printRootEl.firstChild) printRootEl.removeChild(printRootEl.firstChild);

  const tmp = document.createElement("div");
  tmp.innerHTML = coverPageHTML + normalizedProof;

  const frag = document.createDocumentFragment();
  while (tmp.firstChild) frag.appendChild(tmp.firstChild);
  printRootEl.appendChild(frag);
}

export function printWithTempTitle(tempTitle: string): Promise<void> {
  const oldTitle = document.title;
  document.title = tempTitle;

  return new Promise<void>((resolve) => {
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;

      window.removeEventListener("afterprint", onAfterPrint);
      document.title = oldTitle;

      try {
        restorePrintRoot?.();
      } finally {
        restorePrintRoot = null;
      }

      resolve();
    };

    const onAfterPrint = () => finish();
    window.addEventListener("afterprint", onAfterPrint, { once: true });

    requestAnimationFrame(() => {
      Promise.resolve()
        .then(async () => {
          const printRootEl = document.querySelector('[data-kk-print-scope="1"]') as HTMLElement | null;
          if (printRootEl) {
            await rasterizeBanknoteForPrint(printRootEl);
          }
        })
        .then(() => {
          try {
            window.print();
          } finally {
            window.setTimeout(finish, 900); // safari fallback
          }
        });
    });
  });
}
