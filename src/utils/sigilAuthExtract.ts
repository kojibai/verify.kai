// src/utils/sigilAuthExtract.ts
// Extract secret-bearing auth material from a glyph SVG (Sigil SVG).
// - Used for “specific glyph access” grants and unlock checks.
// - Robust to different metadata placements: <metadata> JSON, CDATA JSON, loose key strings, <a href>, root attrs.
// - No `any`.

export type SigilAuthMaterial = {
  userPhiKey?: string;
  kaiSignature?: string;
  sigilId?: string;
  actionUrl?: string;
  meta?: Record<string, unknown>;
};

const KEY_CANDIDATES = {
  phiKey: ["userPhiKey", "phiKey", "phikey", "ΦKey", "walletPhiKey"],
  kaiSig: ["kaiSignature", "kaiSig", "ksig", "ΣSig", "sig", "signature"],
  sigilId: ["sigilId", "sigilID", "glyphId", "glyphID", "sigil_id", "glyph_id"],
  url: ["sigilActionUrl", "sigilUrl", "actionUrl", "url", "claimedUrl", "loginUrl", "sourceUrl", "originUrl", "link", "href"],
} as const;

function isHttpUrl(v: unknown): v is string {
  if (typeof v !== "string" || !v.trim()) return false;
  try {
    const u = new URL(v, globalThis.location?.origin ?? "https://example.org");
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function readStringProp(obj: unknown, keys: readonly string[]): string | undefined {
  if (typeof obj !== "object" || obj === null) return undefined;
  const r = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  // nested meta pattern
  const meta = r["meta"];
  if (typeof meta === "object" && meta !== null) {
    const m = meta as Record<string, unknown>;
    for (const k of keys) {
      const v = m[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return undefined;
}

function peelCdata(s: string): string {
  return s.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
}

function safeJsonParse(raw: string): Record<string, unknown> | undefined {
  const t = raw.trim();
  if (!t) return undefined;

  // direct parse
  try {
    const v = JSON.parse(t) as unknown;
    if (typeof v === "object" && v !== null) return v as Record<string, unknown>;
  } catch {
    // continue
  }

  // attempt to locate an object substring
  const m = t.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const v = JSON.parse(m[0]) as unknown;
      if (typeof v === "object" && v !== null) return v as Record<string, unknown>;
    } catch {
      // continue
    }
  }

  return undefined;
}

function regexExtract(raw: string, key: string): string | undefined {
  // "key":"value" OR key: value
  const re = new RegExp(`${key}"?\\s*[:=]\\s*"?([^"\\n\\r<>{}]+)"?`, "i");
  const m = raw.match(re);
  if (!m) return undefined;
  const v = (m[1] ?? "").trim();
  return v || undefined;
}

function extractFromRawText(raw: string): SigilAuthMaterial {
  const out: SigilAuthMaterial = {};

  for (const k of KEY_CANDIDATES.phiKey) {
    const v = regexExtract(raw, k);
    if (v) {
      out.userPhiKey = v;
      break;
    }
  }

  for (const k of KEY_CANDIDATES.kaiSig) {
    const v = regexExtract(raw, k);
    if (v) {
      out.kaiSignature = v;
      break;
    }
  }

  for (const k of KEY_CANDIDATES.sigilId) {
    const v = regexExtract(raw, k);
    if (v) {
      out.sigilId = v;
      break;
    }
  }

  // URLs: just find first http(s) if no keyed url present
  for (const k of KEY_CANDIDATES.url) {
    const v = regexExtract(raw, k);
    if (v && isHttpUrl(v)) {
      out.actionUrl = v;
      return out;
    }
  }
  const um = raw.match(/https?:\/\/[^\s"'<>)#]+/i);
  if (um && isHttpUrl(um[0])) out.actionUrl = um[0];

  return out;
}

function mergePreferPrimary(a: SigilAuthMaterial, b: SigilAuthMaterial): SigilAuthMaterial {
  return {
    userPhiKey: a.userPhiKey ?? b.userPhiKey,
    kaiSignature: a.kaiSignature ?? b.kaiSignature,
    sigilId: a.sigilId ?? b.sigilId,
    actionUrl: a.actionUrl ?? b.actionUrl,
    meta: a.meta ?? b.meta,
  };
}

/** Main extractor: parse SVG and pull auth material from metadata + anchors + attrs. */
export function extractSigilAuthFromSvg(svgText: string): SigilAuthMaterial {
  const raw = (svgText ?? "").trim();
  if (!raw) return {};

  // Try DOM parse
  try {
    const doc = new DOMParser().parseFromString(raw, "image/svg+xml");

    const parseErr = doc.getElementsByTagName("parsererror");
    if (parseErr && parseErr.length > 0) {
      // fall back to regex extraction
      return extractFromRawText(raw);
    }

    // 1) Root attrs (rare but cheap)
    const root = doc.documentElement;
    const rootAttrs: Record<string, unknown> = {};
    if (root && root.attributes) {
      for (const attr of Array.from(root.attributes)) {
        rootAttrs[attr.name] = attr.value;
      }
    }
    let best: SigilAuthMaterial = {
      userPhiKey: readStringProp(rootAttrs, KEY_CANDIDATES.phiKey),
      kaiSignature: readStringProp(rootAttrs, KEY_CANDIDATES.kaiSig),
      sigilId: readStringProp(rootAttrs, KEY_CANDIDATES.sigilId),
      actionUrl: (() => {
        const u = readStringProp(rootAttrs, KEY_CANDIDATES.url);
        return u && isHttpUrl(u) ? u : undefined;
      })(),
      meta: undefined,
    };

    // 2) <metadata> blocks (primary)
    const metas = Array.from(doc.getElementsByTagName("metadata"));
    for (const el of metas) {
      const txt = peelCdata((el.textContent ?? "").trim());
      if (!txt) continue;

      const obj = safeJsonParse(txt);
      if (obj) {
        const cand: SigilAuthMaterial = {
          userPhiKey: readStringProp(obj, KEY_CANDIDATES.phiKey),
          kaiSignature: readStringProp(obj, KEY_CANDIDATES.kaiSig),
          sigilId: readStringProp(obj, KEY_CANDIDATES.sigilId),
          actionUrl: (() => {
            const u = readStringProp(obj, KEY_CANDIDATES.url);
            return u && isHttpUrl(u) ? u : undefined;
          })(),
          meta: obj,
        };
        best = mergePreferPrimary(best, cand);
        if (best.userPhiKey && best.kaiSignature) return best;
      } else {
        best = mergePreferPrimary(best, extractFromRawText(txt));
      }
    }

    // 3) <desc> sometimes contains JSON
    for (const el of Array.from(doc.getElementsByTagName("desc"))) {
      const txt = peelCdata((el.textContent ?? "").trim());
      if (!txt) continue;
      const obj = safeJsonParse(txt);
      if (obj) {
        const cand: SigilAuthMaterial = {
          userPhiKey: readStringProp(obj, KEY_CANDIDATES.phiKey),
          kaiSignature: readStringProp(obj, KEY_CANDIDATES.kaiSig),
          sigilId: readStringProp(obj, KEY_CANDIDATES.sigilId),
          actionUrl: (() => {
            const u = readStringProp(obj, KEY_CANDIDATES.url);
            return u && isHttpUrl(u) ? u : undefined;
          })(),
          meta: obj,
        };
        best = mergePreferPrimary(best, cand);
      } else {
        best = mergePreferPrimary(best, extractFromRawText(txt));
      }
      if (best.userPhiKey && best.kaiSignature) return best;
    }

    // 4) <a href> links
    for (const a of Array.from(doc.getElementsByTagName("a"))) {
      const href = a.getAttribute("href") || a.getAttribute("xlink:href");
      if (href && isHttpUrl(href)) {
        best.actionUrl = best.actionUrl ?? href;
        break;
      }
    }

    // If still missing, do a regex sweep as last resort
    if (!best.userPhiKey || !best.kaiSignature) {
      best = mergePreferPrimary(best, extractFromRawText(raw));
    }

    return best;
  } catch {
    return extractFromRawText(raw);
  }
}
