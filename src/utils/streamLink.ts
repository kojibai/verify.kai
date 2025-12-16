// src/utils/streamLink.ts
// v2.0 — Canonical Stream/Sigil link builders (browser-safe; hash-routing first)
//
// Core rule:
// ✅ If you need a link that MUST render in a browser on static hosting (and long posts),
//    use STREAM "t=" routing:  /stream#t=<token>
//    (No server rewrite required; works in any tab.)
//
// Notes:
// - /stream/p/<token> is treated as legacy / “nice to have” (some hosts don’t rewrite it).
// - /s/<id> is for Proof of Breath / sigil surfaces. Proof of Memory should prefer stream t=.

export const STREAM_PATH = "/stream";
export const SIGIL_PATH = "/s";

/** Absolute stream base when possible; otherwise relative (SSR-safe). */
export const STREAM_BASE_URL: string = (() => {
  if (typeof window === "undefined") return STREAM_PATH;
  const o = window.location?.origin;
  if (!o || o === "null") return STREAM_PATH;
  return `${o.replace(/\/+$/g, "")}${STREAM_PATH}`;
})();

/** Absolute sigil base when possible; otherwise relative (SSR-safe). */
export const SIGIL_BASE_URL: string = (() => {
  if (typeof window === "undefined") return SIGIL_PATH;
  const o = window.location?.origin;
  if (!o || o === "null") return SIGIL_PATH;
  return `${o.replace(/\/+$/g, "")}${SIGIL_PATH}`;
})();

/** Remove chat/markdown edge junk that often wraps URLs/tokens. */
export function stripEdgePunct(input: string): string {
  let t = String(input ?? "").trim();
  t = t.replace(/[)\].,;:!?]+$/g, "");
  t = t.replace(/^[([{"'`]+/g, "");
  return t.trim();
}

/** Best-effort URL parse (absolute or relative to current origin). */
export function tryParseUrl(raw: string): URL | null {
  const t = stripEdgePunct(raw);
  if (!t) return null;

  try {
    return new URL(t);
  } catch {
    // relative → resolve against origin (client only)
    if (typeof window === "undefined") return null;
    const o = window.location?.origin;
    if (!o || o === "null") return null;
    try {
      return new URL(t, o);
    } catch {
      return null;
    }
  }
}

/** Normalize token: decode %xx, restore '+', convert base64→base64url, strip '=' */
export function normalizeToken(raw: string): string {
  let t = stripEdgePunct(raw);

  if (/%[0-9A-Fa-f]{2}/.test(t)) {
    try {
      t = decodeURIComponent(t);
    } catch {
      // keep raw
    }
  }

  // legacy: '+' may appear as space
  if (t.includes(" ")) t = t.replaceAll(" ", "+");

  // base64 → base64url
  if (/[+/=]/.test(t)) {
    t = t.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
  }

  return stripEdgePunct(t);
}

export function isLikelyToken(s: string): boolean {
  return /^[A-Za-z0-9_-]{16,}$/.test(s);
}

export function isSigilUrl(raw: string): boolean {
  const t = stripEdgePunct(raw);
  const u = tryParseUrl(t);
  const path = u ? u.pathname : t;
  return /^\/s(?:\/|$)/.test(path);
}

/**
 * Extract token candidates from:
 * - #t=, ?t=, #p=, ?p=, #token=, ?token=
 * - /stream/t/<token>, /stream/p/<token>, /p/<token>, /s/<id>
 * - (one level) nested add= URLs
 */
export function extractTokenCandidates(rawUrl: string, depth = 0): string[] {
  const out: string[] = [];
  const push = (v: string | null | undefined) => {
    if (!v) return;
    const tok = normalizeToken(v);
    if (!tok) return;
    if (!isLikelyToken(tok)) return;
    if (!out.includes(tok)) out.push(tok);
  };

  const raw = stripEdgePunct(rawUrl);
  if (!raw) return out;

  // bare token support
  if (isLikelyToken(raw)) push(raw);

  const u = tryParseUrl(raw);
  if (!u) return out;

  const hashStr = u.hash && u.hash.startsWith("#") ? u.hash.slice(1) : "";
  const hp = new URLSearchParams(hashStr);
  const sp = u.searchParams;

  for (const k of ["t", "p", "token", "capsule"] as const) {
    push(hp.get(k));
    push(sp.get(k));
  }

  // path patterns
  {
    const m = u.pathname.match(/\/stream\/t\/([^/?#]+)/);
    if (m?.[1]) push(m[1]);
  }
  {
    const m = u.pathname.match(/\/stream\/p\/([^/?#]+)/);
    if (m?.[1]) push(m[1]);
  }
  {
    const m = u.pathname.match(/\/p\/([^/?#]+)/);
    if (m?.[1]) push(m[1]);
  }
  {
    const m = u.pathname.match(/\/s\/([^/?#]+)/);
    if (m?.[1]) push(m[1]);
  }

  // nested add= once
  if (depth < 1) {
    const adds = [...hp.getAll("add"), ...sp.getAll("add")];
    for (const a of adds) {
      let inner = stripEdgePunct(a);
      if (!inner) continue;

      if (/%[0-9A-Fa-f]{2}/.test(inner)) {
        try {
          inner = decodeURIComponent(inner);
        } catch {
          // ignore
        }
      }

      for (const tok of extractTokenCandidates(inner, depth + 1)) push(tok);
    }
  }

  return out;
}

/** Canonical, browser-safe “Proof of Memory” viewer link: /stream#t=<token> */
export function streamTHrefFromToken(tokenRaw: string): string {
  const t = normalizeToken(tokenRaw);
  const base = STREAM_BASE_URL || STREAM_PATH;
  return `${base}#t=${encodeURIComponent(t)}`;
}

/** Optional legacy “pretty” route (requires server rewrites): /stream/t/<token> */
export function streamTRouteFromToken(tokenRaw: string): string {
  const t = normalizeToken(tokenRaw);
  const base = (STREAM_BASE_URL || STREAM_PATH).replace(/\/stream\/?$/g, "");
  return `${base}/stream/t/${encodeURIComponent(t)}`;
}

/** Optional legacy route: /stream/p/<token> (NOT preferred) */
export function streamPRouteFromToken(tokenRaw: string): string {
  const t = normalizeToken(tokenRaw);
  const base = (STREAM_BASE_URL || STREAM_PATH).replace(/\/stream\/?$/g, "");
  return `${base}/stream/p/${encodeURIComponent(t)}`;
}

/** Canonical “Proof of Breath” sigil link: /s/<id> */
export function sigilHrefFromId(idRaw: string): string {
  const id = stripEdgePunct(idRaw);
  const base = SIGIL_BASE_URL || SIGIL_PATH;
  return `${base}/${encodeURIComponent(id)}`;
}

/**
 * Normalize *any* incoming ref into something that will render in a browser:
 * - If it’s already a Memory Stream URL (#root=...), keep it but normalize to /stream#...
 * - If it’s /s/..., keep it
 * - Otherwise, extract a token and return /stream#t=<token>
 * - Fallback: return original input (trimmed)
 */
export function normalizeResolvedUrlForBrowser(rawInput: string): string {
  const raw = stripEdgePunct(rawInput);
  if (!raw) return rawInput;

  const u = tryParseUrl(raw);
  if (u) {
    const hashStr = u.hash && u.hash.startsWith("#") ? u.hash.slice(1) : "";
    const hp = new URLSearchParams(hashStr);
    const sp = u.searchParams;

    // Memory Stream format (root in hash or query) → normalize onto /stream#...
    const hasRoot = Boolean(hp.get("root") || sp.get("root"));
    if (hasRoot) {
      const base = STREAM_BASE_URL || STREAM_PATH;
      const outUrl = tryParseUrl(base) ?? new URL(base, u.origin);

      const p = new URLSearchParams();
      for (const [k, v] of hp.entries()) p.append(k, v);
      for (const [k, v] of sp.entries()) p.append(k, v);

      outUrl.search = "";
      outUrl.hash = p.toString() ? `#${p.toString()}` : "";
      return outUrl.toString();
    }
  }

  if (isSigilUrl(raw)) return raw;

  const tok = extractTokenCandidates(raw)[0];
  return tok ? streamTHrefFromToken(tok) : raw;
}

/**
 * This is the one you want for “open this post by hash/token”.
 * It intentionally returns STREAM t= so long posts always render.
 */
export function canonicalPostLinkFromHash(hashOrToken: string): string {
  return streamTHrefFromToken(hashOrToken);
}

/**
 * Helper: “Proof of Memory” open href from any ref/url/token.
 * Always prefers stream t= (browser-safe).
 */
export function proofOfMemoryOpenHref(raw: string): string {
  const t = stripEdgePunct(raw);
  if (!t) return raw;

  const tok = extractTokenCandidates(t)[0];
  return tok ? streamTHrefFromToken(tok) : normalizeResolvedUrlForBrowser(t);
}
