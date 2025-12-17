// src/components/exhale-note/sanitize.ts
/*
  sanitize.ts
  - esc(): HTML escape helper for injecting strings into HTML templates
  - trunc(): safe string truncation helper for SVG text fields
  - repairSvgXml(): repairs malformed SVG/XML inside TAGS (ex: `stroke-` with no value)
  - sanitizeSvg(): safe SVG sanitizer (DOMParser when available; regex fallback otherwise)
  - ensureSvgBackground(): ensures embedded sigils have a solid background rect (prevents transparent slot artifacts)
*/

export function esc(input: string): string {
  const s = String(input ?? "");
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Truncate for tight printed fields (keeps it stable + printable). */
export function trunc(input: string, max: number): string {
  const s = String(input ?? "").trim();
  const m = Math.max(0, max | 0);
  if (!m) return "";
  if (s.length <= m) return s;
  if (m <= 1) return "…";
  return s.slice(0, m - 1) + "…";
}

/**
 * Repair malformed attributes that break SVG XML parsing.
 * Example offender: `<path stroke- ...>` (attribute ends with '-' and has no value).
 *
 * IMPORTANT: This only edits *inside tags* (e.g. `<...>`), never text nodes.
 */
export function repairSvgXml(svgRaw: string): string {
  let s = String(svgRaw ?? "");
  if (!s) return "";

  // Normalize newlines (keeps error line numbers stable-ish)
  s = s.replace(/\r\n?/g, "\n");

  // Only operate inside tags so we don't mutate visible text content.
  s = s.replace(/<[^>]+>/g, (tag) => {
    let t = tag;

    // Remove attributes that literally end with "-" and have no "=" value.
    // Matches: ` stroke-` before whitespace, "/>" or ">"
    t = t.replace(/\s([A-Za-z_][\w:.-]*-)(?=[\s/>])/g, "");

    // Remove attributes whose value was stringified as undefined/null (common templating leak)
    t = t.replace(/\s+[A-Za-z_][\w:.-]*="(?:undefined|null)"/g, "");

    // Remove naked "=" with no value if a generator produced `foo=` accidentally
    // (prevents "value mandated" errors)
    t = t.replace(/\s+[A-Za-z_][\w:.-]*=\s*(?=[\s/>])/g, "");

    return t;
  });

  return s.trim();
}

function stripToSingleSvgDocument(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const m = s.match(/<svg\b[\s\S]*<\/svg>/i);
  return (m ? m[0] : s).trim();
}

function isLikelySvg(raw: string): boolean {
  const s = String(raw ?? "");
  return /<svg\b/i.test(s);
}

/**
 * Sanitizes SVG for embedding (removes scripts/foreignObject/event handlers/javascript: hrefs).
 * Returns a *valid SVG string* or "" if it cannot be made safe/parseable.
 */
export function sanitizeSvg(svgRaw: string): string {
  const raw0 = String(svgRaw ?? "").trim();
  if (!raw0) return "";

  // Quick exit if it's not even SVG-ish.
  if (!isLikelySvg(raw0)) return "";

  // Always strip to one <svg> doc and repair obvious XML breakers first.
  const repaired0 = repairSvgXml(stripToSingleSvgDocument(raw0));

  // Browser path: DOMParser + XMLSerializer (most robust).
  if (typeof window !== "undefined" && typeof DOMParser !== "undefined" && typeof XMLSerializer !== "undefined") {
    const parseOnce = (src: string) => {
      const doc = new DOMParser().parseFromString(src, "image/svg+xml");
      const pe = doc.querySelector("parsererror");
      return { doc, ok: !pe };
    };

    let { doc, ok } = parseOnce(repaired0);

    // If still broken, do one more repair pass and retry.
    if (!ok) {
      const repaired1 = repairSvgXml(repaired0);
      ({ doc, ok } = parseOnce(repaired1));
      if (!ok) return "";
    }

    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== "svg") return "";

    // Ensure namespaces (prevents weird embedding edge cases)
    if (!root.getAttribute("xmlns")) root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    if (!root.getAttribute("xmlns:xlink")) root.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");

    // Remove dangerous elements
    const banned = ["script", "foreignObject", "iframe", "object", "embed", "link", "meta"];
    for (const tag of banned) doc.querySelectorAll(tag).forEach((n) => n.remove());

    // Strip dangerous attributes
    doc.querySelectorAll("*").forEach((el) => {
      const attrs = Array.from(el.attributes);
      for (const a of attrs) {
        const name = a.name;
        const val = a.value ?? "";

        // Remove inline event handlers
        if (/^on/i.test(name)) {
          el.removeAttribute(name);
          continue;
        }

        // Remove broken attributes ending with "-"
        if (/-$/.test(name)) {
          el.removeAttribute(name);
          continue;
        }

        // Block javascript: urls in href/xlink:href
        if (name === "href" || name === "xlink:href") {
          if (/^\s*javascript:/i.test(val)) {
            el.removeAttribute(name);
            continue;
          }
        }

        // Strip url(javascript:...) inside style attr
        if (name === "style" && /url\s*\(\s*['"]?\s*javascript:/i.test(val)) {
          el.removeAttribute(name);
          continue;
        }
      }
    });

    // Serialize back to string and run final repair to catch any edge remnants
    const out = new XMLSerializer().serializeToString(root);
    return repairSvgXml(out);
  }

  // Fallback: regex-based sanitize (kept conservative)
  let s = repaired0;

  // Remove scripts + foreignObject blocks
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "");

  // Remove inline event handlers: onload=, onclick=, etc.
  s = s.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*')/gi, "");

  // Remove javascript: hrefs
  s = s.replace(/\s+(href|xlink:href)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, "");

  // Final repair
  s = repairSvgXml(s);

  return s;
}

/**
 * Ensures an SVG has a solid background rect as the back-most painted element.
 * This prevents “transparent slot” artifacts and makes embedded sigils print reliably.
 */
export function ensureSvgBackground(svgRaw: string, fill = "#0b1417"): string {
  const cleaned = sanitizeSvg(svgRaw);
  if (!cleaned) return "";

  // DOM path (best)
  if (typeof window !== "undefined" && typeof DOMParser !== "undefined" && typeof XMLSerializer !== "undefined") {
    const doc = new DOMParser().parseFromString(cleaned, "image/svg+xml");
    if (doc.querySelector("parsererror")) return "";

    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== "svg") return "";

    // If it already has a full background rect, keep it.
    const hasBg = Array.from(root.querySelectorAll(":scope > rect")).some((r) => {
      const w = (r.getAttribute("width") ?? "").trim();
      const h = (r.getAttribute("height") ?? "").trim();
      const x = (r.getAttribute("x") ?? "0").trim();
      const y = (r.getAttribute("y") ?? "0").trim();
      const f = (r.getAttribute("fill") ?? "").trim().toLowerCase();
      const covers = (w === "100%" || w === "100") && (h === "100%" || h === "100");
      const at0 = x === "0" && y === "0";
      const painted = f !== "" && f !== "none";
      return covers && at0 && painted;
    });

    if (!hasBg) {
      const rect = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", "0");
      rect.setAttribute("y", "0");
      rect.setAttribute("width", "100%");
      rect.setAttribute("height", "100%");
      rect.setAttribute("fill", fill);
      rect.setAttribute("pointer-events", "none");

      const first = root.firstElementChild;
      if (first && first.nodeName.toLowerCase() === "defs") {
        // defs doesn’t paint; insert right after defs so the rect is behind everything else
        root.insertBefore(rect, first.nextSibling);
      } else {
        root.insertBefore(rect, first);
      }
    }

    const out = new XMLSerializer().serializeToString(root);
    return repairSvgXml(out);
  }

  // Regex fallback: inject rect immediately after opening <svg ...>
  const injected = cleaned.replace(
    /<svg\b([^>]*)>/i,
    (m, attrs) =>
      `<svg${attrs}>` +
      `<rect x="0" y="0" width="100%" height="100%" fill="${esc(fill)}" pointer-events="none"/>`
  );

  return repairSvgXml(injected);
}
