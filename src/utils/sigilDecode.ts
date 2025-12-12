// src/utils/sigilDecode.ts
// STRICT: no 'any', no empty catches, production-safe

export interface MediaRef {
  kind: "url" | "svg" | "png" | "audio" | "video" | "pdf";
  url: string;
  sha256?: string;
}

export interface PostPayload {
  title?: string;
  text?: string;
  tags?: string[];
  media?: MediaRef[];
}

export interface MessagePayload {
  toUserId: string;
  text: string;
  media?: Array<Pick<MediaRef, "kind" | "url">>;
  threadId?: string;
}

export interface SharePayload {
  refUrl: string;
  note?: string;
}

export interface ReactionPayload {
  refUrl: string;
  emoji?: string;
  value?: number;
}

/** Legacy short keys present in compact capsules. */
interface LegacyShorts {
  u?: number; // pulse
  b?: number; // beat
  s?: number; // stepIndex
  c?: string | number; // chakraDay
}

/** Canonical capsule shape (extensible with unknown extras). */
export interface Capsule extends LegacyShorts {
  pulse?: number;
  beat?: number;
  stepIndex?: number;
  chakraDay?: string | number;

  userPhiKey?: string;
  userId?: string;
  kaiSignature?: string;
  timestamp?: string;

  appId?: string;
  kind?: string;
  nonce?: string;

  post?: PostPayload;
  message?: MessagePayload;
  share?: SharePayload;
  reaction?: ReactionPayload;

  /** Legacy/aux fields tolerated but not relied on. */
  work?: Record<string, unknown>;
  w?: Record<string, unknown>;

  /** Allow forward-compatible fields without loosening types globally. */
  [k: string]: unknown;
}

export interface DecodeOk {
  ok: true;
  data: {
    url: string;
    appId?: string;
    userId?: string;
    kind?: string;
    pulse?: number;
    beat?: number;
    stepIndex?: number;
    chakraDay?: string | number;
    capsule: Capsule;
    path: string[];
  };
}

export interface DecodeErr {
  ok: false;
  error: string;
}

type DecodeResult = DecodeOk | DecodeErr;

/* ---------- helpers (strict, no any) ---------- */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function stripEdgePunct(input: string): string {
  let t = input.trim();
  t = t.replace(/[)\].,;:!?]+$/g, "");
  t = t.replace(/^[([{"'`]+/g, "");
  return t.trim();
}

function originFallback(): string {
  const g = globalThis as unknown as { location?: { origin?: unknown } };
  const o = g.location?.origin;
  return typeof o === "string" && o.length > 0 ? o : "https://phi.network";
}

function tryParseUrl(raw: string): URL | null {
  const t = stripEdgePunct(raw);

  try {
    return new URL(t);
  } catch {
    // fall through to base-relative parse
  }

  try {
    return new URL(t, originFallback());
  } catch {
    return null;
  }
}

function normalizeToken(raw: string): string {
  let t = stripEdgePunct(raw);

  if (/%[0-9A-Fa-f]{2}/.test(t)) {
    try {
      t = decodeURIComponent(t);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "decodeURIComponent failed";
      throw new Error(msg);
    }
  }

  // '+' sometimes becomes space in legacy query shares
  if (t.includes(" ")) t = t.replaceAll(" ", "+");

  // base64 -> base64url (strip '=')
  if (/[+/=]/.test(t)) {
    t = t.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
  }

  return stripEdgePunct(t);
}

function looksLikeToken(s: string): boolean {
  return /^[A-Za-z0-9_-]{16,}$/.test(s);
}

function normalizeBase64(input: string): string {
  // base64url -> base64 + padding
  let s = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  if (pad === 2) s += "==";
  else if (pad === 3) s += "=";
  // pad===1 invalid, let atob fail loudly
  return s;
}

function base64DecodeUtf8(b64urlOrB64: string): string {
  const raw = b64urlOrB64.startsWith("c:") ? b64urlOrB64.slice(2) : b64urlOrB64;
  const normalized = normalizeBase64(raw);

  const g = globalThis as unknown as { atob?: unknown; TextDecoder?: unknown };
  if (typeof g.atob !== "function") throw new Error("Base64 decode failure: atob() unavailable");
  if (typeof g.TextDecoder === "undefined") throw new Error("Base64 decode failure: TextDecoder unavailable");

  try {
    const binary = (g.atob as (s: string) => string)(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Base64 decode failure";
    throw new Error(message);
  }
}

function parseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Invalid JSON";
    throw new Error(message);
  }
}

function extractFromPath(pathname: string): string | null {
  // /p~TOKEN (tilde may be encoded)
  {
    const m = pathname.match(/\/p(?:~|%7[Ee])([^/?#]+)/);
    if (m?.[1]) return m[1];
  }
  // /stream/p/TOKEN or /feed/p/TOKEN
  {
    const m = pathname.match(/\/(?:stream|feed)\/p\/([^/?#]+)/);
    if (m?.[1]) return m[1];
  }
  // /p/TOKEN (older)
  {
    const m = pathname.match(/\/p\/([^/?#]+)/);
    if (m?.[1]) return m[1];
  }
  return null;
}

function getFirstParam(
  search: URLSearchParams,
  hash: URLSearchParams,
  keys: readonly string[],
): string | null {
  for (const k of keys) {
    const hv = hash.get(k);
    if (hv && hv.trim().length) return hv;
    const sv = search.get(k);
    if (sv && sv.trim().length) return sv;
  }
  return null;
}

function extractTokenCandidates(rawUrl: string, depth = 0): string[] {
  const out: string[] = [];
  const push = (v: string | null | undefined) => {
    if (!v) return;
    const tok = normalizeToken(v);
    if (!looksLikeToken(tok)) return;
    if (!out.includes(tok)) out.push(tok);
  };

  const raw = stripEdgePunct(rawUrl);

  // bare token
  if (looksLikeToken(raw)) push(raw);

  const u = tryParseUrl(raw);
  if (!u) return out;

  const hashStr = u.hash && u.hash.startsWith("#") ? u.hash.slice(1) : u.hash;
  const hash = new URLSearchParams(hashStr);
  const search = u.searchParams;

  const keys = ["p", "t", "token", "capsule"];
  push(getFirstParam(search, hash, keys));

  // support multiple occurrences too
  for (const k of keys) {
    push(hash.get(k));
    push(search.get(k));
  }

  // path forms
  push(extractFromPath(u.pathname));

  // nested add= (one level)
  if (depth < 1) {
    const adds = [...search.getAll("add"), ...hash.getAll("add")];
    for (const a of adds) {
      const inner = stripEdgePunct(a);
      if (!inner) continue;

      let decoded = inner;
      if (/%[0-9A-Fa-f]{2}/.test(decoded)) {
        try {
          decoded = decodeURIComponent(decoded);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "decodeURIComponent(add) failed";
          throw new Error(msg);
        }
      }

      for (const t of extractTokenCandidates(decoded, depth + 1)) push(t);
    }
  }

  return out;
}

/* ---------- main API ---------- */

export function decodeSigilUrl(url: string): DecodeResult {
  try {
    const raw = stripEdgePunct(url);

    // 1) extract token from ANY supported input form
    const tokens = extractTokenCandidates(raw);
    const token = tokens[0] ?? null;

    if (!token) {
      return {
        ok: false,
        error:
          "No capsule token found (expected /p~<token>, /stream/p/<token>, ?p=, #t=, or a raw token).",
      };
    }

    // 2) decode token -> JSON
    const jsonText = base64DecodeUtf8(token);
    const parsedUnknown = parseJson<unknown>(jsonText);

    if (!isObject(parsedUnknown)) return { ok: false, error: "Payload is not an object" };

    const parsed = parsedUnknown as Capsule;

    // Resolve fields with short/long key support
    const pulse = isNumber(parsed.pulse) ? parsed.pulse : isNumber(parsed.u) ? parsed.u : undefined;
    const beat = isNumber(parsed.beat) ? parsed.beat : isNumber(parsed.b) ? parsed.b : undefined;
    const stepIndex = isNumber(parsed.stepIndex)
      ? parsed.stepIndex
      : isNumber(parsed.s)
        ? parsed.s
        : undefined;

    const chakraDay =
      isString(parsed.chakraDay) || isNumber(parsed.chakraDay)
        ? parsed.chakraDay
        : isString(parsed.c) || isNumber(parsed.c)
          ? parsed.c
          : undefined;

    // Path analysis (best-effort)
    const u = tryParseUrl(raw);
    const path = u ? u.pathname.split("/").filter(Boolean) : [];

    const appId = path[0] === "s" && path.length >= 2 ? path[1] : undefined;

    const userId =
      isString(parsed.userId) ? parsed.userId : isString(parsed.userPhiKey) ? parsed.userPhiKey : undefined;

    const kindFromPayload = isString(parsed.kind)
      ? parsed.kind
      : parsed.post
        ? "post"
        : parsed.message
          ? "message"
          : parsed.share
            ? "share"
            : parsed.reaction
              ? "reaction"
              : undefined;

    const kindFromPath = path.length >= 8 ? path[6] : undefined;
    const kind = kindFromPayload ?? kindFromPath;

    const capsule: Capsule = { ...parsed, pulse, beat, stepIndex, chakraDay };

    return {
      ok: true,
      data: {
        url,
        appId,
        userId,
        kind,
        pulse,
        beat,
        stepIndex,
        chakraDay,
        capsule,
        path,
      },
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Decode error";
    return { ok: false, error: message };
  }
}
