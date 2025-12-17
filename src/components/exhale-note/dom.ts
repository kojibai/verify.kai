// src/components/exhale-note/dom.ts

/** Render the banknote SVG into the preview host using a stable frame shell. */
export function renderPreview(host: HTMLElement | null, banknoteSVG: string): void {
  // SSR / safety guards
  if (!host || typeof window === "undefined" || typeof document === "undefined") return;

  const raw = (banknoteSVG ?? "").trim();
  if (!raw) {
    host.replaceChildren(); // clear if empty
    return;
  }

  // Ensure we have a top-level <svg> root
  const hasSvgRoot = /^<svg[\s>]/i.test(raw);
  const normalized = hasSvgRoot ? raw : `<svg xmlns="http://www.w3.org/2000/svg">${raw}</svg>`;

  // Parse as SVG to avoid HTML parser quirks and injection issues
  let svgEl: SVGSVGElement | null = null;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(normalized, "image/svg+xml");
    const root = doc.documentElement;

    // Guard against <parsererror>
    if (root && root.nodeName.toLowerCase() !== "parsererror") {
      svgEl = root as unknown as SVGSVGElement;

      // Ensure critical attributes so browsers can lay it out predictably
      if (!svgEl.getAttribute("xmlns")) {
        svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      }
      // If width/height exist but no viewBox, synthesize one for responsive sizing
      if (!svgEl.getAttribute("viewBox") && svgEl.hasAttribute("width") && svgEl.hasAttribute("height")) {
        const num = (v: string) => parseFloat(v.replace(/[^\d.]/g, "")) || 0;
        const w = num(svgEl.getAttribute("width") || "0");
        const h = num(svgEl.getAttribute("height") || "0");
        if (w > 0 && h > 0) svgEl.setAttribute("viewBox", `0 0 ${w} ${h}`);
      }
    }
  } catch {
    svgEl = null;
  }

  // Clear existing content without nuking the host node (less flicker than innerHTML)
  host.replaceChildren();

  // Stable frame ensures consistent sizing via CSS (both screen + print)
  const frame = host.ownerDocument!.createElement("div");
  frame.className = "banknote-frame";

  if (svgEl) {
    frame.appendChild(host.ownerDocument!.importNode(svgEl, true));
  } else {
    // Fallback: if parsing failed, last resort to innerHTML
    frame.innerHTML = normalized;
  }

  host.appendChild(frame);
}
