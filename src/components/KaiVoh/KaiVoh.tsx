// src/components/KaiVoh/KaiVoh.tsx
"use client";

/**
 * KaiVoh — Stream Exhale Composer
 * v4.7 — FIX: real module-worker file (no Blob + no dynamic import inside worker)
 *        - iOS/Safari-safe: avoids blob-worker + import() CORS/CSP failures
 *        - Worker-first encode with deterministic main-thread fallback
 *        - Keeps SAME token format (encodeTokenWithBudgets from feedPayload)
 *
 * Primary role:
 * - Exhale a /stream/p/<token> URL bound to the current verified Sigil.
 * - Attach documents, folders, tiny inline files, extra URLs, and recorded stories.
 * - Embed parentUrl/originUrl lineage + register the stream URL with Sigil Explorer.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, ReactElement } from "react";
import "./styles/KaiVoh.css";
import {
  ATTACHMENTS_VERSION,
  TOKEN_SOFT_BUDGET,
  TOKEN_HARD_LIMIT,
  type Attachments,
  type AttachmentItem,
  type FeedPostPayload,
  type PostBody,
  makeAttachments,
  makeFileRefAttachment,
  makeInlineAttachment,
  makeUrlAttachment,
  makeBasePayload,
  makeTextBody,
  makeCodeBody,
  makeMarkdownBody,
  makeHtmlBody,
  preparePayloadForLink,
  encodeTokenWithBudgets,
} from "../../utils/feedPayload";

import { momentFromUTC } from "../../utils/kai_pulse";
import { useSigilAuth } from "./SigilAuthContext";
import StoryRecorder, { type CapturedStory } from "./StoryRecorder";
import { registerSigilUrl } from "../../utils/sigilRegistry";
import { getOriginUrl } from "../../utils/sigilUrl";

/* ───────────────────────── Props ───────────────────────── */

export interface KaiVohExhaleResult {
  shareUrl: string;
  token: string;
  payload: FeedPostPayload;
}

export interface KaiVohProps {
  initialCaption?: string;
  initialAuthor?: string;
  onExhale?: (result: KaiVohExhaleResult) => void;
}

/* ───────────────────────── Inline Icons (no visible text) ───────────────────────── */

function IconCamRecord(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="ico" aria-hidden="true" focusable="false">
      <rect x="3" y="6" width="14" height="12" rx="3" stroke="currentColor" strokeWidth="2" fill="none" />
      <circle cx="10" cy="12" r="3" stroke="currentColor" strokeWidth="2" fill="none" />
      <path d="M17 9l4-2v10l-4-2z" stroke="currentColor" strokeWidth="2" fill="none" />
      <circle cx="18.5" cy="5.5" r="2.5" fill="currentColor" />
    </svg>
  );
}

function IconTrash(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="ico" aria-hidden="true" focusable="false">
      <path d="M3 6h18M9 6V4h6v2M7 6l1 14h8l1-14" stroke="currentColor" strokeWidth="2" fill="none" />
      <path d="M10 10v6M14 10v6" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/* ───────────────────────── Constants ───────────────────────── */

const MAX_INLINE_BYTES = 6_000 as const; // per-file inline cap
const KB = 1024;
const MB = 1024 * KB;

/* ───────────────────────── Small utils (no any) ───────────────────────── */

const prettyBytes = (n: number): string => {
  if (n >= MB) return `${(n / MB).toFixed(2)} MB`;
  if (n >= KB) return `${(n / KB).toFixed(2)} KB`;
  return `${n} B`;
};

const short = (s: string, head = 8, tail = 6): string =>
  s.length <= head + tail ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;

const isHttpUrl = (s: unknown): s is string => {
  if (typeof s !== "string" || !s) return false;
  try {
    const u = new URL(s, globalThis.location?.origin ?? "https://example.org");
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
};

/** Any supported stream link form? (#t=, ?p=, /stream|feed/p/, /p~) */
function isLikelySigilUrl(u: string): boolean {
  try {
    const url = new URL(u, globalThis.location?.origin ?? "https://example.org");
    const hasHash = new URLSearchParams(url.hash.replace(/^#/, "")).has("t");
    const hasQuery = new URLSearchParams(url.search).has("p");
    const p = url.pathname;
    const hasPath = /^\/(?:stream|feed)\/p\/[^/]+$/.test(p);
    const hasTilde = /^\/p~[^/?#]+$/.test(p);
    return hasHash || hasQuery || hasPath || hasTilde;
  } catch {
    return false;
  }
}

/**
 * base64url (byte-safe, no btoa/atob)
 * Prevents “giant string” stalls and works for any ArrayBuffer size.
 */
function base64UrlEncodeBytes(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const outParts: string[] = [];
  const n = bytes.length;

  let i = 0;
  for (; i + 2 < n; i += 3) {
    const x = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    outParts.push(
      alphabet[(x >>> 18) & 63] +
        alphabet[(x >>> 12) & 63] +
        alphabet[(x >>> 6) & 63] +
        alphabet[x & 63],
    );
  }

  const rem = n - i;
  if (rem === 1) {
    const x = bytes[i] << 16;
    outParts.push(alphabet[(x >>> 18) & 63] + alphabet[(x >>> 12) & 63] + "==");
  } else if (rem === 2) {
    const x = (bytes[i] << 16) | (bytes[i + 1] << 8);
    outParts.push(alphabet[(x >>> 18) & 63] + alphabet[(x >>> 12) & 63] + alphabet[(x >>> 6) & 63] + "=");
  }

  return outParts.join("").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** Read string/number from object or nested meta, safely */
function readStringProp(obj: unknown, key: string): string | undefined {
  if (typeof obj !== "object" || obj === null) return undefined;
  const r = obj as Record<string, unknown>;
  const v = r[key];
  if (typeof v === "string") return v;
  const meta = r["meta"];
  if (typeof meta === "object" && meta !== null) {
    const mv = (meta as Record<string, unknown>)[key];
    if (typeof mv === "string") return mv;
  }
  return undefined;
}

function readNumberProp(obj: unknown, key: string): number | undefined {
  if (typeof obj !== "object" || obj === null) return undefined;
  const r = obj as Record<string, unknown>;
  const v = r[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const meta = r["meta"];
  if (typeof meta === "object" && meta !== null) {
    const mv = (meta as Record<string, unknown>)[key];
    if (typeof mv === "number" && Number.isFinite(mv)) return mv;
  }
  return undefined;
}

/** Extract action URL from SVG text (metadata JSON, CDATA, or <a> href) */
function extractSigilActionUrlFromSvgText(
  svgText?: string | null,
  metaCandidate?: Record<string, unknown>,
): string | undefined {
  if (!svgText) return undefined;

  const keys = [
    "sigilActionUrl",
    "sigilUrl",
    "actionUrl",
    "url",
    "claimedUrl",
    "loginUrl",
    "sourceUrl",
    "originUrl",
    "link",
    "href",
  ];

  if (metaCandidate) {
    for (const k of keys) {
      const v = (metaCandidate as Record<string, unknown>)[k];
      if (isHttpUrl(v)) return v;
    }
  }

  try {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");

    for (const el of Array.from(doc.getElementsByTagName("metadata"))) {
      const raw = (el.textContent ?? "").trim();
      if (!raw) continue;
      const peeled = raw.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
      try {
        const obj = JSON.parse(peeled) as unknown;
        if (typeof obj === "object" && obj !== null) {
          for (const k of keys) {
            const v = (obj as Record<string, unknown>)[k];
            if (isHttpUrl(v)) return v;
          }
        }
      } catch {
        const m = peeled.match(/https?:\/\/[^\s"'<>)#]+/i);
        if (m && isHttpUrl(m[0])) return m[0];
      }
    }

    for (const a of Array.from(doc.getElementsByTagName("a"))) {
      const href = a.getAttribute("href") || a.getAttribute("xlink:href");
      if (isHttpUrl(href)) return href;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

/** Cache helper: store blob under /att/<sha> and return the URL */
async function cachePutAndUrl(
  sha256: string,
  blob: Blob,
  opts: { cacheName?: string; pathPrefix?: string } = {},
): Promise<string | undefined> {
  const cacheName = opts.cacheName ?? "sigil-attachments-v1";
  const pathPrefix = (opts.pathPrefix ?? "/att/").replace(/\/+$/, "") + "/";

  try {
    if (!("caches" in globalThis) || typeof caches.open !== "function") return undefined;
    const cache = await caches.open(cacheName);
    const url = `${pathPrefix}${sha256}`;
    await cache.put(
      new Request(url, { method: "GET" }),
      new Response(blob, { headers: { "Content-Type": blob.type || "application/octet-stream" } }),
    );
    return url;
  } catch {
    return undefined;
  }
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = Math.floor(s / 60)
    .toString()
    .padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function firstLine(s: string): string {
  const n = s.indexOf("\n");
  return n >= 0 ? s.slice(0, n) : s;
}

function trunc(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

type BodyKind = "text" | "code" | "md" | "html";
type HtmlMode = "code" | "sanitized";
type UrlItem = Extract<AttachmentItem, { kind: "url" }>;

/* ───────────────────────── Non-hanging encode (REAL Module Worker file) ───────────────────────── */

type EncodeWorkerRequest = { id: string; payload: FeedPostPayload };

type EncodeWorkerResponse =
  | { id: string; ok: true; token: string; withinHard: boolean; ms: number }
  | { id: string; ok: false; error: string; ms: number };

type EncodeDiag = {
  stage: string;
  totalMs: number;
  prepareMs?: number;
  encodeMs?: number;
  tokenLen?: number;
  items?: number;
  inlinedBytes?: number;
  totalBytes?: number;
  note?: string;
};

const nowMs = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();

const nextPaint = async (): Promise<void> => {
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
};

const withTimeout = async <T,>(p: Promise<T>, ms: number, label: string): Promise<T> => {
  let t: number | null = null;
  const timeoutP = new Promise<never>((_, rej) => {
    t = window.setTimeout(() => rej(new Error(`${label} timed out`)), ms);
  });
  try {
    return await Promise.race([p, timeoutP]);
  } finally {
    if (t !== null) window.clearTimeout(t);
  }
};

const makeId = (): string => {
  const c: Crypto | undefined = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && "randomUUID" in c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

// Singleton worker plumbing (module-scope; not React state)
let _encodeWorker: Worker | null = null;
const _pending = new Map<string, (res: EncodeWorkerResponse) => void>();

function getEncodeWorker(): Worker {
  if (_encodeWorker) return _encodeWorker;
  if (typeof window === "undefined") throw new Error("encode worker unavailable (no window)");
  if (typeof Worker === "undefined") throw new Error("encode worker unavailable (Worker not supported)");

  // ✅ Real worker module file (bundler-safe; no blob; no import() inside worker)
  const url = new URL("./encodeToken.worker.ts", import.meta.url);
  _encodeWorker = new Worker(url, { type: "module", name: "kaiVohEncodeWorker" });

  _encodeWorker.onmessage = (ev: MessageEvent<EncodeWorkerResponse>) => {
    const msg = ev.data;
    const cb = _pending.get(msg.id);
    if (!cb) return;
    _pending.delete(msg.id);
    cb(msg);
  };

  _encodeWorker.onerror = () => {
    // Fail all inflight and reset. Keep ids stable.
    for (const [id, cb] of _pending) cb({ id, ok: false, error: "encode worker crashed", ms: 0 });
    _pending.clear();
    try {
      _encodeWorker?.terminate();
    } catch {
      /* ignore */
    }
    _encodeWorker = null;
  };

  return _encodeWorker;
}

async function encodeTokenInWorker(payload: FeedPostPayload): Promise<EncodeWorkerResponse> {
  const worker = getEncodeWorker();
  const id = makeId();
  const p = new Promise<EncodeWorkerResponse>((resolve) => {
    _pending.set(id, resolve);
    const req: EncodeWorkerRequest = { id, payload };
    worker.postMessage(req);
  });
  return p;
}

/** ✅ Worker-first, deterministic fallback if worker is blocked/unavailable */
async function encodeTokenWorkerFirst(payload: FeedPostPayload): Promise<EncodeWorkerResponse> {
  try {
    return await encodeTokenInWorker(payload);
  } catch {
    const t0 = nowMs();
    try {
      const out = encodeTokenWithBudgets(payload);
      return {
        id: makeId(),
        ok: true,
        token: out.token,
        withinHard: out.withinHard,
        ms: nowMs() - t0,
      };
    } catch (err) {
      return {
        id: makeId(),
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        ms: nowMs() - t0,
      };
    }
  }
}


/* ───────────────────────── Component ───────────────────────── */

export default function KaiVoh({ initialCaption = "", initialAuthor = "", onExhale }: KaiVohProps): ReactElement {
  const { auth } = useSigilAuth();
  const sigilMeta = auth.meta;

  const [caption, setCaption] = useState<string>(initialCaption);
  const [author, setAuthor] = useState<string>(initialAuthor);

  const [bodyKind, setBodyKind] = useState<BodyKind>("text");
  const [codeLang, setCodeLang] = useState<string>("tsx");
  const [htmlMode, setHtmlMode] = useState<HtmlMode>("code");

  const [phiKey, setPhiKey] = useState<string>("");
  const [kaiSignature, setKaiSignature] = useState<string>("");

  const [extraUrlField, setExtraUrlField] = useState<string>("");
  const [extraUrls, setExtraUrls] = useState<UrlItem[]>([]);

  const [files, setFiles] = useState<File[]>([]);
  const [attachments, setAttachments] = useState<Attachments>({
    version: ATTACHMENTS_VERSION,
    totalBytes: 0,
    inlinedBytes: 0,
    items: [],
  });
  const attachmentsRef = useRef<Attachments>(attachments);

  const [storyOpen, setStoryOpen] = useState<boolean>(false);
  const [storyPreview, setStoryPreview] = useState<{ url: string; durationMs: number } | null>(null);

  const [busy, setBusy] = useState<boolean>(false);
  const [stage, setStage] = useState<string>("");
  const [diag, setDiag] = useState<EncodeDiag | null>(null);

  const [err, setErr] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [generatedUrl, setGeneratedUrl] = useState<string>("");
  const [tokenLength, setTokenLength] = useState<number>(0);
  const [urlMode, setUrlMode] = useState<"path" | "hash">("path");

  const dropRef = useRef<HTMLDivElement | null>(null);
  const hasVerifiedSigil = Boolean(sigilMeta);

  useEffect(() => setCaption(initialCaption), [initialCaption]);
  useEffect(() => setAuthor(initialAuthor), [initialAuthor]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  // Clean up story URL if component unmounts
  useEffect(() => {
    return () => {
      if (storyPreview) URL.revokeObjectURL(storyPreview.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Preferred sigil action URL from meta/SVG; fall back to origin */
  const sigilActionUrl = useMemo(() => {
    const metaFirst =
      readStringProp(sigilMeta, "sigilActionUrl") ||
      readStringProp(sigilMeta, "sigilUrl") ||
      readStringProp(sigilMeta, "actionUrl") ||
      readStringProp(sigilMeta, "url") ||
      readStringProp(sigilMeta, "claimedUrl") ||
      readStringProp(sigilMeta, "loginUrl") ||
      readStringProp(sigilMeta, "sourceUrl") ||
      readStringProp(sigilMeta, "originUrl") ||
      readStringProp(sigilMeta, "link") ||
      readStringProp(sigilMeta, "href");

    if (metaFirst) return metaFirst;

    const extracted = extractSigilActionUrlFromSvgText(auth.svgText, (sigilMeta ?? {}) as Record<string, unknown>);
    return extracted || (globalThis.location?.origin ?? "https://kaiklok.com");
  }, [sigilMeta, auth.svgText]);

  /** Lock identity from verified sigil */
  useEffect(() => {
    if (!sigilMeta) return;
    setPhiKey(readStringProp(sigilMeta, "userPhiKey") ?? "");
    setKaiSignature(readStringProp(sigilMeta, "kaiSignature") ?? "");
  }, [sigilMeta]);

  /* ───────────── Extra URL management ───────────── */

  const addExtraUrl = (): void => {
    const raw = extraUrlField.trim();
    if (!isHttpUrl(raw)) {
      setWarn("Invalid URL. Enter a full http(s) link.");
      return;
    }
    setExtraUrls((prev) => [...prev, makeUrlAttachment({ url: raw })]);
    setExtraUrlField("");
    setWarn(null);
  };

  const removeExtraUrl = (i: number): void => {
    setExtraUrls((prev) => prev.filter((_, idx) => idx !== i));
  };

  /* ───────────── File/Folder ingest ───────────── */

  function fileNameWithPath(f: File): string {
    const maybe = f as File & { webkitRelativePath?: string };
    const rel = typeof maybe.webkitRelativePath === "string" ? maybe.webkitRelativePath : "";
    return rel.trim() ? rel : f.name;
  }

  async function sha256FileHex(f: File): Promise<string> {
    const buf = await f.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    const v = new Uint8Array(digest);
    let out = "";
    for (let i = 0; i < v.length; i++) out += v[i].toString(16).padStart(2, "0");
    return out;
  }

  const readFilesToAttachments = async (fileList: File[]): Promise<Attachments> => {
    const baseItems = attachmentsRef.current.items.slice();
    const items = baseItems;

    for (const f of fileList) {
      const displayName = fileNameWithPath(f);

      if (f.size <= MAX_INLINE_BYTES) {
        const buf = await f.arrayBuffer();
        items.push(
          makeInlineAttachment({
            name: displayName,
            type: f.type || "application/octet-stream",
            size: f.size,
            data_b64url: base64UrlEncodeBytes(buf),
          }),
        );
      } else {
        const sha = await sha256FileHex(f);
        const url = await cachePutAndUrl(sha, f, { cacheName: "sigil-attachments-v1", pathPrefix: "/att/" });
        items.push(
          makeFileRefAttachment({
            sha256: sha,
            name: displayName,
            type: f.type || "application/octet-stream",
            size: f.size,
            url,
          }),
        );
      }
    }

    return makeAttachments(items);
  };

  const onPickFiles = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    if (!e.target.files) return;
    const list = Array.from(e.target.files);
    setFiles((prev) => [...prev, ...list]);
    setAttachments(await readFilesToAttachments(list));
  };

  const onDrop = async (e: DragEvent<HTMLDivElement>): Promise<void> => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.dataTransfer?.files?.length) return;
    const list = Array.from(e.dataTransfer.files);
    setFiles((prev) => [...prev, ...list]);
    setAttachments(await readFilesToAttachments(list));
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
  };

  const clearFiles = (): void => {
    setFiles([]);
    const empty: Attachments = { version: ATTACHMENTS_VERSION, totalBytes: 0, inlinedBytes: 0, items: [] };
    setAttachments(empty);
    attachmentsRef.current = empty;
  };

  /* ───────────── Story capture wiring ───────────── */

  function estimateBase64DataSize(dataUrl: string): number {
    const [, data] = dataUrl.split(",", 2);
    if (!data) return 0;
    return Math.ceil((data.length * 3) / 4);
  }

  async function handleStoryCaptured(s: CapturedStory): Promise<void> {
    const videoUrl = await cachePutAndUrl(s.sha256, s.file, { cacheName: "sigil-attachments-v1", pathPrefix: "/att/" });

    const videoRef = makeFileRefAttachment({
      sha256: s.sha256,
      name: s.file.name,
      type: s.mimeType || s.file.type || "video/webm",
      size: s.file.size,
      url: videoUrl,
    });

    const b64 = (s.thumbnailDataUrl.split(",", 2)[1] ?? "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

    const thumbInline = makeInlineAttachment({
      name: s.file.name.replace(/\.(webm|mp4)$/i, "") + "_thumb.png",
      type: "image/png",
      size: estimateBase64DataSize(s.thumbnailDataUrl),
      data_b64url: b64,
    });

    const next = makeAttachments([...attachmentsRef.current.items, videoRef, thumbInline]);
    setAttachments(next);

    if (storyPreview) URL.revokeObjectURL(storyPreview.url);
    setStoryPreview({ url: URL.createObjectURL(s.file), durationMs: s.durationMs });
    setStoryOpen(false);
  }

  /* ───────────── Payload body (v2) ───────────── */

  const effectiveBodyText = caption.trim();

  const postBody: PostBody | undefined = useMemo(() => {
    if (!effectiveBodyText) return undefined;

    if (bodyKind === "text") return makeTextBody(effectiveBodyText);
    if (bodyKind === "md") return makeMarkdownBody(effectiveBodyText);
    if (bodyKind === "html") return makeHtmlBody(effectiveBodyText, htmlMode);

    const lang = codeLang.trim();
    return makeCodeBody(effectiveBodyText, lang ? lang : undefined);
  }, [effectiveBodyText, bodyKind, codeLang, htmlMode]);

  const derivedCaption = useMemo((): string | undefined => {
    if (!effectiveBodyText) return undefined;

    const one = firstLine(effectiveBodyText).trim();
    if (!one) return undefined;

    if (bodyKind === "code") {
      const lang = codeLang.trim();
      const hint = lang ? `code:${lang}` : "code";
      return trunc(`${hint} — ${one}`, 220);
    }
    if (bodyKind === "md") return trunc(`md — ${one}`, 220);
    if (bodyKind === "html") return trunc(`html — ${one}`, 220);
    return trunc(one, 220);
  }, [effectiveBodyText, bodyKind, codeLang]);

  /* ───────────── Generate payload/link (with lineage + registry) ───────────── */

  const onGenerate = async (): Promise<void> => {
    if (busy) return;

    setErr(null);
    setWarn(null);
    setCopied(false);
    setGeneratedUrl("");
    setTokenLength(0);
    setUrlMode("path");
    setDiag(null);

    const rawUrl = (sigilActionUrl || "").trim();
    const looksSigil = isLikelySigilUrl(rawUrl);

    if (!looksSigil) {
      setWarn("Sigil verifikation URL not detected; using fallback. Link generation will still work.");
    }

    let pulse: number;
    try {
      pulse = momentFromUTC(new Date()).pulse;
    } catch {
      setErr("Failed to compute Kai pulse.");
      return;
    }

    const t0 = nowMs();

    try {
      setBusy(true);
      setStage("paint");
      await nextPaint();
      await nextPaint();

      setStage("assemble");

      const mergedItems: AttachmentItem[] = [...attachmentsRef.current.items, ...extraUrls];
      const mergedAttachments = mergedItems.length > 0 ? makeAttachments(mergedItems) : undefined;

      const parentUrl = looksSigil ? rawUrl : undefined;
      const originUrl = parentUrl ? getOriginUrl(parentUrl) ?? parentUrl : undefined;

      const sigilId =
        readStringProp(sigilMeta, "sigilId") ||
        readStringProp(sigilMeta, "sigilID") ||
        readStringProp(sigilMeta, "glyphId") ||
        undefined;

      const basePayload: FeedPostPayload = makeBasePayload({
        url: rawUrl,
        pulse,
        caption: derivedCaption,
        body: postBody,
        author: author.trim() ? author.trim() : undefined,
        source: "manual",
        sigilId,
        phiKey: hasVerifiedSigil && phiKey ? phiKey : undefined,
        kaiSignature: hasVerifiedSigil && kaiSignature ? kaiSignature : undefined,
        ts: Date.now(),
        attachments: mergedAttachments,
        parentUrl,
        originUrl,
      });

      setStage("prepare");
      const tPrep0 = nowMs();

      const prepared = await withTimeout(
        preparePayloadForLink(basePayload, { cacheName: "sigil-attachments-v1", pathPrefix: "/att/" }),
        20_000,
        "preparePayloadForLink",
      );

      const prepareMs = nowMs() - tPrep0;

      setStage("encode(worker)");
      const tEnc0 = nowMs();

      // ✅ Worker-first encode (real module worker), deterministic fallback if needed
      const enc = await withTimeout(encodeTokenWorkerFirst(prepared), 30_000, "encodeTokenWithBudgets(worker)");

      const encodeMs = nowMs() - tEnc0;

      if (!enc.ok) {
        setDiag({
          stage: "encode(worker)",
          totalMs: nowMs() - t0,
          prepareMs,
          encodeMs: enc.ms,
          items: mergedItems.length,
          inlinedBytes: mergedAttachments?.inlinedBytes,
          totalBytes: mergedAttachments?.totalBytes,
          note: enc.error,
        });

        setErr(
          `Token encode failed: ${enc.error}. ` +
            `If you have a strict CSP, allow module workers from 'self' (worker-src 'self'). ` +
            `This build uses a real worker file (no blob workers).`,
        );
        return;
      }

      const { token, withinHard } = enc;

      setTokenLength(token.length);

      const origin = globalThis.location?.origin ?? "https://kaiklok.com";
      const shareUrl = withinHard ? `${origin}/stream/p/${encodeURIComponent(token)}` : `${origin}/stream#t=${token}`;

      setUrlMode(withinHard ? "path" : "hash");

      if (token.length > TOKEN_HARD_LIMIT) {
        setWarn(
          `Token exceeds hard path limit (${token.length.toLocaleString()} > ${TOKEN_HARD_LIMIT.toLocaleString()}). Using hash URL to avoid request-line limits.`,
        );
      } else if (token.length > TOKEN_SOFT_BUDGET) {
        setWarn(`Token is large (${token.length.toLocaleString()} chars). Prefer trimming inlined files or relying on external URLs.`);
      }

      setStage("register");
      registerSigilUrl(shareUrl);

      setStage("clipboard");
      try {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
      } catch {
        setCopied(false);
      }

      setGeneratedUrl(shareUrl);

      setDiag({
        stage: "done",
        totalMs: nowMs() - t0,
        prepareMs,
        encodeMs,
        tokenLen: token.length,
        items: mergedItems.length,
        inlinedBytes: mergedAttachments?.inlinedBytes,
        totalBytes: mergedAttachments?.totalBytes,
      });

      if (onExhale) onExhale({ shareUrl, token, payload: prepared });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "Failed to generate link.";
      setErr(msg);
      setDiag({
        stage: stage || "unknown",
        totalMs: nowMs() - t0,
        note: msg,
      });
    } finally {
      setStage("");
      setBusy(false);
    }
  };

  const onReset = (): void => {
    setCaption(initialCaption || "");
    setAuthor(initialAuthor || "");
    setBodyKind("text");
    setCodeLang("tsx");
    setHtmlMode("code");
    setExtraUrlField("");
    setExtraUrls([]);
    clearFiles();
    setErr(null);
    setWarn(null);
    setCopied(false);
    setGeneratedUrl("");
    setTokenLength(0);
    setUrlMode("path");
    setStage("");
    setDiag(null);
    if (storyPreview) {
      URL.revokeObjectURL(storyPreview.url);
      setStoryPreview(null);
    }
  };

  const bind =
    (setter: (v: string) => void) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void =>
      setter(e.target.value);

  /** Identity banner */
  const identityBanner = useMemo(() => {
    if (!hasVerifiedSigil) return null;
    const lastPulse = readNumberProp(sigilMeta, "pulse");
    return (
      <div className="id-banner" role="status" aria-live="polite">
        <span className="id-dot" />
        <span className="id-text">
          Verified by Sigil — ΦKey <strong>{short(phiKey)}</strong>
          {" • "}
          Last verified pulse <strong>{lastPulse ?? "—"}</strong>
        </span>
        <span className="id-sub mono">ΣSig {short(kaiSignature)}</span>
      </div>
    );
  }, [hasVerifiedSigil, phiKey, kaiSignature, sigilMeta]);

  /** Read-only preview of canonical action URL */
  const urlPreview = useMemo(() => {
    if (!sigilActionUrl) return null;
    return (
      <div className="composer">
        <label className="composer-label">Proof Of Breath™ URL</label>
        <div className="composer-input-row">
          <input className="composer-input locked" type="url" value={sigilActionUrl} readOnly />
          <button
            type="button"
            className="composer-aux"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(sigilActionUrl);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1200);
              } catch {
                /* ignore */
              }
            }}
            title="Remember Proof Of Breath™ URL"
          >
            {copied ? "Remembered ✓" : "Remember"}
          </button>
        </div>
        {!isLikelySigilUrl(sigilActionUrl) && (
          <div className="composer-hint warn">
            No canonical stream token detected in the URL. Fallback will still produce a valid post.
          </div>
        )}
      </div>
    );
  }, [sigilActionUrl, copied]);

  /* ───────────── Attachments panel ───────────── */

  const attachmentsPanel = (
    <div className="attachments">
      <h3 className="attachments-title">Attachments</h3>

      <div className="composer">
        <label className="composer-label">Record a memory</label>
        <div className="story-actions">
          <button
            type="button"
            className="pill prim icon-only"
            aria-label="Open Memory Recorder"
            title="Record story"
            onClick={() => setStoryOpen(true)}
          >
            <IconCamRecord />
          </button>

          {storyPreview && (
            <div className="story-preview">
              <video src={storyPreview.url} playsInline controls className="story-preview-video" />
              <div className="story-preview-meta mono">{formatMs(storyPreview.durationMs)}</div>
              <button
                type="button"
                className="pill danger icon-only"
                onClick={() => {
                  URL.revokeObjectURL(storyPreview.url);
                  setStoryPreview(null);
                }}
                aria-label="Remove recorded preview"
                title="Remove preview"
              >
                <IconTrash />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="composer">
        <label className="composer-label">Add any URL</label>
        <div className="composer-input-row">
          <input
            className="composer-input"
            type="url"
            placeholder="https://example.com/docs/your-file.pdf"
            value={extraUrlField}
            onChange={bind(setExtraUrlField)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <button type="button" className="composer-aux" onClick={addExtraUrl} title="Add URL">
            Add
          </button>
        </div>

        {extraUrls.length > 0 && (
          <ul className="url-list">
            {extraUrls.map((it, i) => (
              <li key={`${it.url}-${i}`} className="url-item">
                <span className="mono">{short(it.url, 28, 16)}</span>
                <button type="button" className="pill danger" onClick={() => removeExtraUrl(i)} title="Remove URL">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div ref={dropRef} className="dropzone" onDragOver={onDragOver} onDrop={onDrop} aria-label="Drop files or folders here">
        <div className="dropzone-inner">
          <div className="dz-title">Seal documents or folders</div>
          <div className="dz-sub">Tiny files get inlined; large files become cache-backed refs.</div>
          <div className="dz-actions">
            <label className="pill">
              <input type="file" multiple onChange={onPickFiles} className="visually-hidden" />
              Inhale files…
            </label>

            <label className="pill">
              <input
                type="file"
                multiple
                // @ts-expect-error webkitdirectory is a non-standard extension
                webkitdirectory=""
                onChange={onPickFiles}
                className="visually-hidden"
              />
              Inhale folder…
            </label>

            {files.length > 0 && (
              <button type="button" className="pill subtle" onClick={clearFiles}>
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {attachments.items.length > 0 && (
        <div className="file-summary">
          <div className="composer-hint">
            Items: <strong>{attachments.items.length}</strong> • Files total: <strong>{prettyBytes(attachments.totalBytes ?? 0)}</strong> • Inlined:{" "}
            <strong>{prettyBytes(attachments.inlinedBytes ?? 0)}</strong> (≤ {prettyBytes(MAX_INLINE_BYTES)} each)
          </div>

          <ul className="file-list">
            {attachments.items.map((it, idx) => {
              if (it.kind === "url") {
                return (
                  <li key={`url-${idx}`} className="file-item">
                    <div className="file-row">
                      <span className="badge">url</span>
                      <span className="mono">{short(it.url, 34, 18)}</span>
                    </div>
                  </li>
                );
              }

              const base = it.name ?? `file-${idx}`;
              const isInline = it.kind === "file-inline";
              const mime = "type" in it && typeof it.type === "string" ? it.type : "application/octet-stream";
              const size = "size" in it && typeof it.size === "number" ? it.size : 0;

              return (
                <li key={`${base}-${idx}`} className="file-item">
                  <div className="file-row">
                    <span className="badge">{isInline ? "inline" : "file"}</span>
                    <span className="mono">{base}</span>
                    <span className="dim">
                      {mime} • {prettyBytes(size)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>

          {attachments.items.some((i) => i.kind === "file-ref") && (
            <div className="composer-hint warn">
              Large files are cached and referenced by SHA-256. You can also host publicly (Drive/S3/IPFS) and attach the public URL above.
            </div>
          )}
        </div>
      )}
    </div>
  );

  /* ───────────── Render ───────────── */

  const textareaRows = bodyKind === "code" ? 10 : 3;
  const textareaPlaceholder =
    bodyKind === "code"
      ? "Paste your code…"
      : bodyKind === "md"
        ? "Write markdown…"
        : bodyKind === "html"
          ? "Write HTML… (default renders as escaped code unless sanitized by the stream UI)"
          : "What Resonants About This Moment…";

  return (
    <div className="social-connector-container">
      <h2 className="social-connector-title">KaiVoh</h2>
      <p className="social-connector-sub">
        Exhale a sealed <strong>Memory Stream</strong>.
      </p>

      {identityBanner}
      {urlPreview}

      <div className="composer">
        <label className="composer-label">Body Format</label>
        <div className="story-actions">
          <button type="button" className={`pill ${bodyKind === "text" ? "prim" : "subtle"}`} onClick={() => setBodyKind("text")} title="Text">
            Text
          </button>
          <button type="button" className={`pill ${bodyKind === "code" ? "prim" : "subtle"}`} onClick={() => setBodyKind("code")} title="Code">
            Code
          </button>
          <button type="button" className={`pill ${bodyKind === "md" ? "prim" : "subtle"}`} onClick={() => setBodyKind("md")} title="Markdown">
            MD
          </button>
          <button type="button" className={`pill ${bodyKind === "html" ? "prim" : "subtle"}`} onClick={() => setBodyKind("html")} title="HTML">
            HTML
          </button>

          {bodyKind === "code" && (
            <input
              className="composer-input"
              style={{ maxWidth: 160 }}
              value={codeLang}
              onChange={bind(setCodeLang)}
              placeholder="lang (tsx)"
              aria-label="Code language"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          )}

          {bodyKind === "html" && (
            <button
              type="button"
              className={`pill ${htmlMode === "code" ? "prim" : "subtle"}`}
              onClick={() => setHtmlMode((m) => (m === "code" ? "sanitized" : "code"))}
              title="HTML mode (stream decides how to render)"
            >
              mode:{htmlMode}
            </button>
          )}
        </div>

        <div className="composer-hint">
          v2 posts include <span className="mono">body.kind</span> so the stream can render code as code (escaped) instead of treating everything as plain text.
        </div>
      </div>

      <div className="composer two">
        <div className="field">
          <label htmlFor="caption" className="composer-label">
            Memory <span className="muted">(Body)</span>
          </label>
          <textarea
            id="caption"
            className={`composer-textarea${bodyKind === "code" ? " mono" : ""}`}
            rows={textareaRows}
            placeholder={textareaPlaceholder}
            value={caption}
            onChange={bind(setCaption)}
            spellCheck={bodyKind === "code" ? false : true}
          />
        </div>

        <div className="field">
          <label htmlFor="author" className="composer-label">
            Author Handle <span className="muted">(optional, e.g., @KaiRexKlok)</span>
          </label>
          <input
            id="author"
            className="composer-input"
            type="text"
            placeholder="@handle"
            value={author}
            onChange={bind(setAuthor)}
            autoCorrect="off"
            autoCapitalize="none"
          />
        </div>
      </div>

      {attachmentsPanel}

      {err && <div className="composer-error">{err}</div>}
      {warn && !err && <div className="composer-warn">{warn}</div>}

      {(busy || diag) && (
        <div className="composer-hint mono" aria-live="polite">
          {busy && stage ? `stage: ${stage}` : null}
          {diag ? (
            <>
              {busy && stage ? " • " : null}
              {`total ${Math.round(diag.totalMs)}ms`}
              {typeof diag.prepareMs === "number" ? ` • prepare ${Math.round(diag.prepareMs)}ms` : ""}
              {typeof diag.encodeMs === "number" ? ` • encode ${Math.round(diag.encodeMs)}ms` : ""}
              {typeof diag.tokenLen === "number" ? ` • token ${diag.tokenLen.toLocaleString()}` : ""}
              {typeof diag.items === "number" ? ` • items ${diag.items}` : ""}
              {typeof diag.inlinedBytes === "number" ? ` • inlined ${prettyBytes(diag.inlinedBytes)}` : ""}
              {typeof diag.totalBytes === "number" ? ` • bytes ${prettyBytes(diag.totalBytes)}` : ""}
              {diag.note ? ` • note: ${diag.note}` : ""}
            </>
          ) : null}
        </div>
      )}

      <div className="composer-actions">
        <button type="button" onClick={onGenerate} className="composer-submit" disabled={busy} title="Exhale Stream URL">
          {busy ? `Exhaling…${stage ? ` (${stage})` : ""}` : "Exhale Stream URL"}
        </button>
        <button type="button" className="composer-reset" onClick={onReset}>
          Reset
        </button>
      </div>

      {generatedUrl && (
        <div className="composer-result">
          <label htmlFor="gen-url" className="composer-label">
            Your shareable link
          </label>
          <input id="gen-url" className="composer-input" type="text" readOnly value={generatedUrl} onFocus={(e) => e.currentTarget.select()} />
          <div className="composer-actions">
            <button
              type="button"
              className="composer-copy"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(generatedUrl);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? "Remembered ✓" : "Remember"}
            </button>
            <a className="composer-open" href={generatedUrl} target="_blank" rel="noopener noreferrer">
              Open in new tab →
            </a>
          </div>
          <p className="composer-hint">
            Token length: <strong>{tokenLength.toLocaleString()}</strong> chars • URL mode:{" "}
            <strong>{urlMode === "path" ? "path" : "hash"}</strong> • soft {TOKEN_SOFT_BUDGET.toLocaleString()} • hard{" "}
            {TOKEN_HARD_LIMIT.toLocaleString()}
          </p>
        </div>
      )}

      <StoryRecorder
        isOpen={storyOpen}
        onClose={() => setStoryOpen(false)}
        onCaptured={handleStoryCaptured}
        maxDurationMs={15_000}
        preferredFacingMode="user"
      />
    </div>
  );
}
