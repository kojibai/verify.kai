// src/components/exhale-note/svgToPng.ts

/** Human-readable error message for unknown values. */
export function errorMessage(err: unknown): string {
  try {
    if (err instanceof Error) return err.message || err.name;
    if (typeof err === "string") return err;
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/* ========================
   SVG → PNG core helpers
   ======================== */

/** Common CSS length units -> px (approx; 96dpi baseline). */
function cssLengthToPx(input: string): number | null {
  const s = String(input || "").trim();
  if (!s) return null;
  const m = s.match(/^([+-]?\d+(?:\.\d+)?)(px|pt|pc|in|cm|mm)?$/i);
  if (!m) return null;
  const val = parseFloat(m[1]);
  const unit = (m[2] || "px").toLowerCase();
  const PX_PER_IN = 96;
  switch (unit) {
    case "px":
      return val;
    case "pt":
      return val * (PX_PER_IN / 72); // 1pt = 1/72 in
    case "pc":
      return val * 16; // 1pc = 12pt = 16px
    case "in":
      return val * PX_PER_IN;
    case "cm":
      return val * (PX_PER_IN / 2.54);
    case "mm":
      return val * (PX_PER_IN / 25.4);
    default:
      return null;
  }
}

/** Parse width/height/viewBox from SVG to determine its natural aspect ratio. */
function parseSvgNaturalSize(svgText: string): { w: number; h: number } | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, "image/svg+xml");
    const svg = doc.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== "svg") return null;

    const wAttr = svg.getAttribute("width");
    const hAttr = svg.getAttribute("height");
    const vbAttr = svg.getAttribute("viewBox");

    const wPx = wAttr ? cssLengthToPx(wAttr) : null;
    const hPx = hAttr ? cssLengthToPx(hAttr) : null;

    if (wPx && hPx && wPx > 0 && hPx > 0) return { w: wPx, h: hPx };

    if (vbAttr) {
      const parts = vbAttr.trim().split(/\s+|,/).map(Number);
      if (parts.length === 4) {
        const vbW = Math.max(1, parts[2]);
        const vbH = Math.max(1, parts[3]);
        return { w: vbW, h: vbH };
      }
    }

    return { w: 1000, h: 618 };
  } catch {
    return null;
  }
}

/** Ensure XML header + xmlns on <svg> root; return normalized SVG string. */
function normalizeSvg(svgText: string): string {
  const hasXml = svgText.trimStart().startsWith("<?xml");
  let out = hasXml ? svgText : `<?xml version="1.0" encoding="UTF-8"?>\n${svgText}`;
  // Guarantee an xmlns on the <svg> element for better cross-browser decode
  out = out.replace(/<svg(?=\s|>)(?![^>]*\sxmlns=(['"])[^'"]+\1)/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return out;
}

/** Document type with optional CSS Font Loading API (narrow typed; no any). */
type DocumentWithFonts = Document & {
  fonts?: { ready?: Promise<unknown> };
};

/** Wait for document fonts, but don't hang forever. */
async function waitForDocumentFonts(timeoutMs = 2000): Promise<void> {
  try {
    const d = document as DocumentWithFonts;
    const ready = d.fonts?.ready;
    if (!ready || typeof (ready as { then?: unknown }).then !== "function") return;
    await Promise.race([ready, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
  } catch {
    /* ignore */
  }
}

/** Try to decode an SVG blob as ImageBitmap (fast in many browsers). */
async function decodeWithImageBitmap(svgBlob: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap === "function") {
    return await createImageBitmap(svgBlob);
  }
  throw new Error("createImageBitmap not available");
}

/** Decode using HTMLImageElement as a robust fallback. */
async function decodeWithHTMLImage(url: string): Promise<HTMLImageElement> {
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = url;
  });
}

/** Type guard for OffscreenCanvas. */
function isOffscreenCanvas(c: HTMLCanvasElement | OffscreenCanvas): c is OffscreenCanvas {
  return typeof (c as OffscreenCanvas).convertToBlob === "function";
}

/** Canvas → Blob with Safari-safe fallback. */
async function canvasToPngBlob(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  if (isOffscreenCanvas(canvas)) {
    return await canvas.convertToBlob({ type: "image/png" });
  }
  const c = canvas as HTMLCanvasElement;
  if (typeof c.toBlob === "function") {
    const blob = await new Promise<Blob>((resolve, reject) => {
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
    });
    return blob;
  }
  const dataUrl = c.toDataURL("image/png");
  const res = await fetch(dataUrl);
  return await res.blob();
}

/** Options for svgStringToPngBlob (keeps old signature compatible). */
export type SvgToPngOptions = {
  /** Output width in pixels. Default 2400. */
  outWidth?: number;
  /** Output height in pixels. If omitted, preserves the SVG aspect ratio. */
  outHeight?: number;
  /** Optional background fill (e.g. "#fff"). If omitted, preserves transparency. */
  background?: string | null;
  /** If true, multiplies pixel dimensions by devicePixelRatio. Default: false. */
  scaleWithDPR?: boolean;
};

/** Global type with optional OffscreenCanvas constructor (no any). */
type GlobalWithOffscreen = typeof globalThis & {
  OffscreenCanvas?: new (width: number, height: number) => OffscreenCanvas;
};

function getOffscreenCtor(): (new (w: number, h: number) => OffscreenCanvas) | null {
  const g = globalThis as GlobalWithOffscreen;
  return typeof g.OffscreenCanvas === "function" ? g.OffscreenCanvas : null;
}

/** Type guard for ImageBitmap.close (Safari lacks it). */
function hasCloseMethod(b: ImageBitmap | null): b is ImageBitmap & { close: () => void } {
  return !!b && typeof (b as { close?: unknown }).close === "function";
}

/**
 * Render an SVG string to a high-res PNG Blob using an offscreen/onscreen canvas.
 * Accepts either (svgText, outWidth) or (svgText, options).
 */
export async function svgStringToPngBlob(
  svgText: string,
  outWidthOrOptions: number | SvgToPngOptions = 2400
): Promise<Blob> {
  const opts: SvgToPngOptions = typeof outWidthOrOptions === "number" ? { outWidth: outWidthOrOptions } : outWidthOrOptions;

  const outWidth = Math.max(1, Math.floor(opts.outWidth ?? 2400));
  const scaleWithDPR = !!opts.scaleWithDPR; // default OFF for stable downloadable pixels
  const background = opts.background ?? null;

  const normalized = normalizeSvg(svgText);
  const natural = parseSvgNaturalSize(normalized) ?? { w: 1000, h: 618 };
  const ratio = natural.h / Math.max(1, natural.w);
  const outHeight = Math.max(1, Math.floor(opts.outHeight ?? Math.round(outWidth * ratio)));

  const dpr = scaleWithDPR ? Math.max(1, Math.round(window.devicePixelRatio || 1)) : 1;
  const targetW = outWidth * dpr;
  const targetH = outHeight * dpr;

  const MAX_SIDE = 16384;
  if (targetW > MAX_SIDE || targetH > MAX_SIDE) {
    const scale = Math.min(MAX_SIDE / targetW, MAX_SIDE / targetH);
    const newOutW = Math.max(1, Math.floor(outWidth * scale * (scaleWithDPR ? 1 : dpr)));
    const newOutH = Math.max(1, Math.floor(outHeight * scale * (scaleWithDPR ? 1 : dpr)));
    console.warn(`[svgToPng] Requested size ${targetW}x${targetH} exceeded limits. Clamped.`);
    return svgStringToPngBlob(svgText, { ...opts, outWidth: newOutW, outHeight: newOutH });
  }

  const svgBlob = new Blob([normalized], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  try {
    await waitForDocumentFonts(2000);

    let bitmap: ImageBitmap | null = null;
    let imgEl: HTMLImageElement | null = null;

    try {
      bitmap = await decodeWithImageBitmap(svgBlob);
    } catch {
      imgEl = await decodeWithHTMLImage(url);
    }

    const OffCtor = getOffscreenCtor();
    let useOffscreen = false;
    if (OffCtor) {
      try {
        const test = new OffCtor(1, 1);
        useOffscreen = !!test.getContext && !!test.getContext("2d");
      } catch {
        useOffscreen = false;
      }
    }

    let canvas: HTMLCanvasElement | OffscreenCanvas;
    if (useOffscreen && OffCtor) {
      canvas = new OffCtor(targetW, targetH);
    } else {
      const c = document.createElement("canvas");
      c.width = targetW;
      c.height = targetH;
      canvas = c;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable.");

    if (background) {
      (ctx as CanvasRenderingContext2D).save?.();
      (ctx as CanvasRenderingContext2D).fillStyle = background;
      (ctx as CanvasRenderingContext2D).fillRect(0, 0, targetW, targetH);
      (ctx as CanvasRenderingContext2D).restore?.();
    }

    (ctx as CanvasRenderingContext2D).imageSmoothingEnabled = true;
    (ctx as CanvasRenderingContext2D).imageSmoothingQuality = "high";

    if (bitmap) {
      (ctx as CanvasRenderingContext2D).drawImage(bitmap, 0, 0, targetW, targetH);
      if (hasCloseMethod(bitmap)) bitmap.close();
    } else if (imgEl) {
      (ctx as CanvasRenderingContext2D).drawImage(imgEl, 0, 0, targetW, targetH);
    } else {
      throw new Error("Failed to decode SVG image.");
    }

    return await canvasToPngBlob(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Trigger a browser download for a Blob with a given filename. */
export function triggerDownload(filename: string, blob: Blob, mime = "application/octet-stream"): void {
  const href = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = href;
    a.download = filename || "download";
    a.rel = "noopener";
    a.type = mime;
    document.body.appendChild(a);
    a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(href);
    }, 0);
  } catch {
    window.open(href, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(href), 0);
  }
}
