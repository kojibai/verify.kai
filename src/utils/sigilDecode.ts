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

export interface DecodedNodeData {
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
}

export interface StreamChain {
  v?: string;
  rootRef: string;
  addRefs: string[];
  addData: DecodedNodeData[];
}

export interface DecodeOk {
  ok: true;
  data: DecodedNodeData & {
    /** Present when input is a Memory Stream URL: #root=j:<payload> & #add=j:<payload> ... */
    stream?: StreamChain;
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

function isStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  for (const it of value) if (!isString(it)) return false;
  return true;
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
    // fall through
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
  // Accept direct tokens AND legacy payload refs prefixed with j:/c:
  const core = s.startsWith("j:") || s.startsWith("c:") ? s.slice(2) : s;
  return /^[A-Za-z0-9_-]{16,}$/.test(core);
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
  // Accept raw token OR payload-ref prefixes:
  // - "j:<b64url>" Memory Stream payload ref (FeedCard Remember/Pack)
  // - "c:<b64url>" legacy payload ref (kept for compatibility)
  const trimmed = stripEdgePunct(b64urlOrB64);
  const raw =
    trimmed.startsWith("j:") || trimmed.startsWith("c:")
      ? trimmed.slice(2)
      : trimmed;

  const normalized = normalizeBase64(raw);

  const g = globalThis as unknown as { atob?: unknown; TextDecoder?: unknown };
  if (typeof g.atob !== "function") throw new Error("Base64 decode failure: atob() unavailable");
  if (typeof g.TextDecoder === "undefined")
    throw new Error("Base64 decode failure: TextDecoder unavailable");

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

/* ---------- token extraction (legacy + hash-router) ---------- */

function extractFromPath(pathname: string): string | null {
  // /s/<sigil-token>
  {
    const m = pathname.match(/\/s\/([^/?#]+)/);
    if (m?.[1]) return m[1];
  }
  // /p~TOKEN or /p~/TOKEN (tilde may be encoded)
  {
    const m = pathname.match(/\/p(?:~|%7[Ee])\/?([^/?#]+)/);
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

/**
 * Hash-router support:
 *  - "#/p~TOKEN"
 *  - "#p~TOKEN"
 *  - "#/p~/TOKEN"
 */
function extractFromHashPath(hashRaw: string): string | null {
  const h = stripEdgePunct(hashRaw);
  const s = h.startsWith("#") ? h.slice(1) : h;
  {
    const m = s.match(/\/?s\/([^/?#]+)/);
    if (m?.[1]) return m[1];
  }
  const m = s.match(/\/?p(?:~|%7[Ee])\/?([^/?#]+)/);
  return m?.[1] ?? null;
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

  // ✅ FIX: hash-router path (e.g. "#/p~TOKEN") is NOT query params
  push(extractFromHashPath(u.hash));

  const hashStr = u.hash && u.hash.startsWith("#") ? u.hash.slice(1) : u.hash;
  const hash = new URLSearchParams(hashStr);
  const search = u.searchParams;

  const keys = ["p", "t", "token", "capsule"] as const;
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

/* ---------- Memory Stream extraction (#root=j:... #add=j:...) ---------- */

type StreamRefs = { v?: string; rootRef: string | null; addRefs: string[] };

function extractStreamRefs(rawUrl: string): StreamRefs {
  const raw = stripEdgePunct(rawUrl);

  // Direct embedded payload ref (the FeedCard rootRef / add refs form)
  if (raw.startsWith("j:") || raw.startsWith("c:")) {
    return { rootRef: raw, addRefs: [] };
  }

  const u = tryParseUrl(raw);
  if (!u) return { rootRef: null, addRefs: [] };

  const hashStr = u.hash && u.hash.startsWith("#") ? u.hash.slice(1) : u.hash;
  const hp = new URLSearchParams(hashStr);
  const sp = u.searchParams;

  const rootRefRaw = hp.get("root") ?? sp.get("root");
  const vRaw = hp.get("v") ?? sp.get("v");

  const addRefs = [...hp.getAll("add"), ...sp.getAll("add")]
    .map((x) => stripEdgePunct(x))
    .filter((x) => x.length > 0);

  const rootRef = rootRefRaw ? stripEdgePunct(rootRefRaw) : null;

  return {
    v: vRaw ? stripEdgePunct(vRaw) : undefined,
    rootRef,
    addRefs,
  };
}

/* ---------- loose readers (supports raw Capsule OR decoded.data payload) ---------- */

function readCapsuleLoose(v: unknown): Capsule | null {
  // Most common: payload IS DecodedNodeData (has capsule)
  if (isObject(v) && isObject(v.capsule)) return v.capsule as Capsule;

  // Some wrappers may embed a DecodeOk-like shape
  if (isObject(v) && isObject(v.data)) {
    const d = v.data;
    if (isObject(d) && isObject(d.capsule)) return d.capsule as Capsule;
    if (isObject(d) && (("post" in d) || ("message" in d) || ("share" in d) || ("reaction" in d)))
      return d as Capsule;
  }

  // Raw capsule payload (token decode)
  if (isObject(v) && (("post" in v) || ("message" in v) || ("share" in v) || ("reaction" in v)))
    return v as Capsule;

  // Minimal capsule-like object (pulse/u/kind/userId/etc)
  if (isObject(v) && (("pulse" in v) || ("u" in v) || ("kind" in v) || ("userId" in v) || ("userPhiKey" in v)))
    return v as Capsule;

  return null;
}

function capsuleWithResolvedFields(c: Capsule): Capsule {
  const pulse = isNumber(c.pulse) ? c.pulse : isNumber(c.u) ? c.u : undefined;
  const beat = isNumber(c.beat) ? c.beat : isNumber(c.b) ? c.b : undefined;
  const stepIndex = isNumber(c.stepIndex) ? c.stepIndex : isNumber(c.s) ? c.s : undefined;

  const chakraDay =
    isString(c.chakraDay) || isNumber(c.chakraDay)
      ? c.chakraDay
      : isString(c.c) || isNumber(c.c)
        ? c.c
        : undefined;

  return { ...c, pulse, beat, stepIndex, chakraDay };
}

function decodePayloadFromRef(ref: string): unknown {
  const r = stripEdgePunct(ref);
  const jsonText = base64DecodeUtf8(r);
  return parseJson<unknown>(jsonText);
}

function coerceToDecodedNodeData(payloadUnknown: unknown, sourceUrl: string): DecodedNodeData {
  const capsuleRaw = readCapsuleLoose(payloadUnknown);
  if (!capsuleRaw) throw new Error("Invalid payload (missing capsule)");

  const capsule = capsuleWithResolvedFields(capsuleRaw);

  // If payload is already a decoded node shape, prefer its explicit fields
  const payloadObj = isObject(payloadUnknown) ? payloadUnknown : null;
  const dObj = payloadObj && isObject(payloadObj.data) ? (payloadObj.data as Record<string, unknown>) : null;

  const u = tryParseUrl(sourceUrl);
  const path = (() => {
    const p = payloadObj?.path;
    if (isStringArray(p)) return p;
    const pd = dObj?.path;
    if (isStringArray(pd)) return pd;
    return u ? u.pathname.split("/").filter(Boolean) : [];
  })();

  const appIdFromPayload =
    (payloadObj && isString(payloadObj.appId) ? payloadObj.appId : undefined) ??
    (dObj && isString(dObj.appId) ? (dObj.appId as string) : undefined);

  const appId = appIdFromPayload ?? (path[0] === "s" && path.length >= 2 ? path[1] : undefined);

  const userId =
    (payloadObj && isString(payloadObj.userId) ? payloadObj.userId : undefined) ??
    (dObj && isString(dObj.userId) ? (dObj.userId as string) : undefined) ??
    (isString(capsule.userId) ? capsule.userId : isString(capsule.userPhiKey) ? capsule.userPhiKey : undefined);

  const kindFromPayload =
    (payloadObj && isString(payloadObj.kind) ? payloadObj.kind : undefined) ??
    (dObj && isString(dObj.kind) ? (dObj.kind as string) : undefined) ??
    (isString(capsule.kind)
      ? capsule.kind
      : capsule.post
        ? "post"
        : capsule.message
          ? "message"
          : capsule.share
            ? "share"
            : capsule.reaction
              ? "reaction"
              : undefined);

  const pulse =
    (payloadObj && isNumber(payloadObj.pulse) ? payloadObj.pulse : undefined) ??
    (dObj && isNumber(dObj.pulse) ? (dObj.pulse as number) : undefined) ??
    (isNumber(capsule.pulse) ? capsule.pulse : undefined);

  const beat =
    (payloadObj && isNumber(payloadObj.beat) ? payloadObj.beat : undefined) ??
    (dObj && isNumber(dObj.beat) ? (dObj.beat as number) : undefined) ??
    (isNumber(capsule.beat) ? capsule.beat : undefined);

  const stepIndex =
    (payloadObj && isNumber(payloadObj.stepIndex) ? payloadObj.stepIndex : undefined) ??
    (dObj && isNumber(dObj.stepIndex) ? (dObj.stepIndex as number) : undefined) ??
    (isNumber(capsule.stepIndex) ? capsule.stepIndex : undefined);

  const chakraDay =
    (payloadObj &&
    (isString(payloadObj.chakraDay) || isNumber(payloadObj.chakraDay))
      ? (payloadObj.chakraDay as string | number)
      : undefined) ??
    (dObj &&
    (isString(dObj.chakraDay) || isNumber(dObj.chakraDay))
      ? (dObj.chakraDay as string | number)
      : undefined) ??
    (isString(capsule.chakraDay) || isNumber(capsule.chakraDay)
      ? (capsule.chakraDay as string | number)
      : undefined);

  return {
    url: sourceUrl,
    appId,
    userId,
    kind: kindFromPayload,
    pulse,
    beat,
    stepIndex,
    chakraDay,
    capsule,
    path,
  };
}

/* ---------- main API ---------- */

export function decodeSigilUrl(url: string): DecodeResult {
  try {
    const raw = stripEdgePunct(url);

    // 0) Memory Stream aware:
    //    - decode /stream#root=j:<payload>&add=j:<payload>...
    //    - decode direct embedded ref "j:<payload>"
    const streamRefs = extractStreamRefs(raw);
    if (streamRefs.rootRef) {
      const rootPayload = decodePayloadFromRef(streamRefs.rootRef);
      const rootData = coerceToDecodedNodeData(rootPayload, url);

      // Best-effort decode of add chain payloads (offline reconstruction support)
      const addData: DecodedNodeData[] = [];
      for (const a of streamRefs.addRefs) {
        // Only decode embedded payload refs here. (URLs/tokens are still fine in addRefs;
        // FeedCard handles those as fallbacks, but Remember/Pack produces j: so this covers the main path.)
        if (!a.startsWith("j:") && !a.startsWith("c:")) continue;

        try {
          const p = decodePayloadFromRef(a);
          addData.push(coerceToDecodedNodeData(p, a));
        } catch {
          // best-effort: malformed add payload is skipped; root remains valid
        }
      }

      return {
        ok: true,
        data: {
          ...rootData,
          url, // authoritative: input URL
          stream: {
            v: streamRefs.v,
            rootRef: streamRefs.rootRef,
            addRefs: streamRefs.addRefs,
            addData,
          },
        },
      };
    }

    // 1) legacy token/url decode
    const tokens = extractTokenCandidates(raw);
    const token = tokens[0] ?? null;

    if (!token) {
      return {
        ok: false,
        error:
          "No capsule token found (expected /s/<sigil>, /p~<token>, /stream/p/<token>, ?p=, #t=, #/p~<token>, a raw token, or a Memory Stream with #root=j:<payload>).",
      };
    }

    const jsonText = base64DecodeUtf8(token);
    const parsedUnknown = parseJson<unknown>(jsonText);

    if (!isObject(parsedUnknown)) return { ok: false, error: "Payload is not an object" };

    const capsule = capsuleWithResolvedFields(parsedUnknown as Capsule);

    const u = tryParseUrl(raw);
    const path = u ? u.pathname.split("/").filter(Boolean) : [];

    const appId = path[0] === "s" && path.length >= 2 ? path[1] : undefined;

    const userId =
      isString(capsule.userId) ? capsule.userId : isString(capsule.userPhiKey) ? capsule.userPhiKey : undefined;

    const kindFromPayload = isString(capsule.kind)
      ? capsule.kind
      : capsule.post
        ? "post"
        : capsule.message
          ? "message"
          : capsule.share
            ? "share"
            : capsule.reaction
              ? "reaction"
              : undefined;

    const kindFromPath = path.length >= 8 ? path[6] : undefined;
    const kind = kindFromPayload ?? kindFromPath;

    return {
      ok: true,
      data: {
        url,
        appId,
        userId,
        kind,
        pulse: capsule.pulse,
        beat: capsule.beat,
        stepIndex: capsule.stepIndex,
        chakraDay: capsule.chakraDay,
        capsule,
        path,
      },
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Decode error";
    return { ok: false, error: message };
  }
}
