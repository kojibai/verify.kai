// src/pages/sigilstream/SigilStreamRoot.tsx
"use client";

/**
 * SigilStreamRoot — Memory Stream Shell
 * v7.2x — v7 payload robustness + v6.1/v6.2 TOAST-driven KOPY sound + UX
 *
 * ✅ Keeps v7 features:
 *    - extractPayloadTokenFromLocation (ALL token forms)
 *    - Brotli-aware decodeFeedPayload
 *    - /p~ preferred share, hash fallback for huge tokens
 *    - per-thread verified session keyed off ANY token form
 *    - body renders: text | md (safe) | html (sanitized) | code
 *
 * ✅ KOPY stays toast-driven (sound is toast system behavior)
 *
 * ✅ Rich URL cards:
 *    - OG meta (best-effort via jina proxy)
 *    - favicon + host + title/desc
 *    - embeds via ./attachments/embeds.tsx (NO duplicate embed mapping here)
 *
 * ✅ Payload attachments:
 *    - Rendered via ./attachments/gallery.tsx
 *    - Validated/coerced into AttachmentManifest via ./attachments/types.ts
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./styles/sigilstream.css";
import { useLocation } from "react-router-dom";

/* Toasts */
import ToastsProvider from "./data/toast/Toasts";
import { useToasts } from "./data/toast/toast";

/* ✅ Auth provider (required for useSigilAuth + SigilLogin) */
import { SigilAuthProvider } from "../../components/KaiVoh/SigilAuthProvider";

/* Data: seeds + storage */
import { loadLinksJson } from "./data/seed";
import { LS_KEY, parseStringArray, prependUniqueToStorage } from "./data/storage";

/* Core: alias + utils */
import { normalizeAddParam } from "./core/alias";
import { coerceAuth, readStringProp, report, isRecord } from "./core/utils";

/* Identity */
import { IdentityBar } from "./identity/IdentityBar";
import { SigilActionUrl } from "./identity/SigilActionUrl";

/* Inhaler / Composer / Status */
import { InhaleSection } from "./inhaler/InhaleSection";
import { Composer } from "./composer/Composer";
import { KaiStatus } from "./status/KaiStatus";

/* External app hooks (existing app) */
import SigilLogin from "../../components/KaiVoh/SigilLogin";
import { useSigilAuth } from "../../components/KaiVoh/SigilAuthContext";

/* Payload token extractor + Brotli-aware decoder */
import {
  extractPayloadTokenFromLocation,
  TOKEN_HARD_LIMIT,
  decodeFeedPayload,
  type FeedPostPayload,
  type PostBody,
} from "../../utils/feedPayload";

/* Explorer bridge: register any stream/sigil URL */
import { registerSigilUrl } from "../../utils/sigilRegistry";

/* Attachments (single source of truth) */
import { AttachmentGallery } from "./attachments/gallery";
import {
  isAttachmentManifest,
  isAttachmentItem,
  type AttachmentManifest,
  type AttachmentItem,
} from "./attachments/types";

/* Embeds (single source of truth) */
import { UrlEmbed } from "./attachments/embeds";

/** Simple source shape */
type Source = { url: string };

/* ────────────────────────────────────────────────────────────────
   Kai display helpers (deterministic fallbacks)
──────────────────────────────────────────────────────────────── */

const WEEKDAYS: readonly string[] = [
  "Solhara",
  "Aquaris",
  "Flamora",
  "Verdari",
  "Sonari",
  "Kaelith",
] as const;

const CHAKRAS: readonly string[] = [
  "Root",
  "Sacral",
  "Solar",
  "Heart",
  "Throat",
  "Third Eye",
  "Crown",
] as const;

function normalizeWeekdayLabel(s: string): string {
  const t = s.trim();
  if (!t) return t;
  if (/^caelith$/i.test(t)) return "Kaelith";
  if (/^kaelith$/i.test(t)) return "Kaelith";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function normalizeChakraLabel(s: string): string {
  const t = s.trim();
  if (!t) return t;
  const u = t.toLowerCase();
  if (u === "third-eye" || u === "third eye" || u === "ajna") return "Third Eye";
  if (u === "solar plexus" || u === "solar-plexus") return "Solar";
  if (u === "root") return "Root";
  if (u === "sacral") return "Sacral";
  if (u === "heart") return "Heart";
  if (u === "throat") return "Throat";
  if (u === "crown") return "Crown";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function safeModulo(n: number, m: number): number {
  const r = n % m;
  return r < 0 ? r + m : r;
}

function pulseToBeatStep(pulse: number): { beat: number; step: number } {
  const PULSES_PER_STEP = 11;
  const STEPS_PER_BEAT = 44;
  const BEATS_PER_DAY = 36;
  const GRID_PULSES_PER_DAY = PULSES_PER_STEP * STEPS_PER_BEAT * BEATS_PER_DAY; // 17424
  const PULSES_PER_BEAT = PULSES_PER_STEP * STEPS_PER_BEAT; // 484

  const gp = safeModulo(pulse, GRID_PULSES_PER_DAY);
  const beat = Math.floor(gp / PULSES_PER_BEAT);
  const step = Math.floor((gp % PULSES_PER_BEAT) / PULSES_PER_STEP);
  return { beat, step };
}

function pulseToWeekday(pulse: number): string {
  const GRID_PULSES_PER_DAY = 17424;
  const day = Math.floor(pulse / GRID_PULSES_PER_DAY);
  return WEEKDAYS[safeModulo(day, WEEKDAYS.length)] ?? "Kaelith";
}

function stepToChakra(step: number): string {
  const STEPS_PER_BEAT = 44;
  const idx = Math.min(
    CHAKRAS.length - 1,
    Math.max(0, Math.floor((step / STEPS_PER_BEAT) * CHAKRAS.length)),
  );
  return CHAKRAS[idx] ?? "Crown";
}

/* ────────────────────────────────────────────────────────────────
   URL helpers
──────────────────────────────────────────────────────────────── */

function sessionTokenKey(token: string): string {
  if (token.length <= 140) return token;
  return `${token.slice(0, 96)}:${token.slice(-32)}`;
}

function canonicalizeCurrentStreamUrl(token: string): string {
  const origin = globalThis.location?.origin ?? "https://kaiklok.com";
  const base = origin.replace(/\/+$/, "");
  return token.length <= TOKEN_HARD_LIMIT
    ? `${base}/stream/p/${encodeURIComponent(token)}`
    : `${base}/stream#t=${token}`;
}

function shortAliasUrl(token: string): string {
  const origin = globalThis.location?.origin ?? "https://kaiklok.com";
  const base = origin.replace(/\/+$/, "");
  return `${base}/p~${token}`;
}

function preferredShareUrl(token: string): string {
  return token.length <= TOKEN_HARD_LIMIT ? shortAliasUrl(token) : canonicalizeCurrentStreamUrl(token);
}

function normalizeIncomingToken(raw: string): string {
  let t = raw.trim();

  // If someone passed a whole URL instead of just a token, extract from it.
  try {
    const u = new URL(t);
    const h = new URLSearchParams(u.hash.startsWith("#") ? u.hash.slice(1) : u.hash);
    const s = new URLSearchParams(u.search);
    const got =
      h.get("t") ??
      h.get("p") ??
      h.get("token") ??
      s.get("t") ??
      s.get("p") ??
      s.get("token");
    if (got) t = got;
    else if (/\/p~/.test(u.pathname)) t = u.pathname.split("/p~")[1] ?? t;
    else if (/\/stream\/p\//.test(u.pathname)) t = u.pathname.split("/stream/p/")[1] ?? t;
  } catch {
    // not a URL, ignore
  }

  // Decode %xx if present
  if (/%[0-9A-Fa-f]{2}/.test(t)) {
    try {
      t = decodeURIComponent(t);
    } catch {
      /* keep raw */
    }
  }

  // Query/base64 legacy: '+' may come through as space; restore it.
  if (t.includes(" ")) t = t.replaceAll(" ", "+");

  // If it looks like standard base64, normalize to base64url (decoder expects base64url)
  if (/[+/=]/.test(t)) {
    t = t.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
  }

  return t;
}

function safeHttpUrl(u: string): string | null {
  try {
    const url = new URL(u);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
    return null;
  } catch {
    return null;
  }
}

function urlHost(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return "";
  }
}

function urlHostPretty(u: string): string {
  const h = urlHost(u);
  return h.replace(/^www\./, "");
}

function faviconFor(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname;
    if (!host) return null;
    return `https://icons.duckduckgo.com/ip3/${host}.ico`;
  } catch {
    return null;
  }
}

/* ────────────────────────────────────────────────────────────────
   Clipboard (robust) — NO audio here (toast system handles sound)
──────────────────────────────────────────────────────────────── */

async function writeClipboardText(text: string): Promise<void> {
  if (typeof window === "undefined") throw new Error("Clipboard unavailable (SSR).");

  const nav = window.navigator;
  const canClipboard =
    typeof nav !== "undefined" &&
    typeof nav.clipboard !== "undefined" &&
    typeof nav.clipboard.writeText === "function" &&
    window.isSecureContext;

  if (canClipboard) {
    await nav.clipboard.writeText(text);
    return;
  }

  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "true");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "0";
  document.body.appendChild(ta);

  const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  ta.focus();
  ta.select();

  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  if (prevFocus) prevFocus.focus();

  if (!ok) throw new Error("Copy failed.");
}

/* ────────────────────────────────────────────────────────────────
   Render helpers (MD + HTML)
──────────────────────────────────────────────────────────────── */

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Minimal sanitizer:
 * - strips script/style/iframe/object/embed
 * - removes on* handlers
 * - blocks javascript:/data: URLs on href/src
 */
function sanitizeHtml(input: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(input, "text/html");

    const kill = doc.querySelectorAll("script,style,iframe,object,embed");
    kill.forEach((n) => n.remove());

    const all = doc.querySelectorAll<HTMLElement>("*");
    all.forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value;

        if (name.startsWith("on")) {
          el.removeAttribute(attr.name);
          continue;
        }

        if (name === "href" || name === "src") {
          const v = value.trim().toLowerCase();
          if (v.startsWith("javascript:") || v.startsWith("data:")) el.removeAttribute(attr.name);
        }
      }
    });

    return doc.body.innerHTML;
  } catch {
    return escapeHtml(input);
  }
}

function renderMarkdownToSafeHtml(md: string): string {
  const escaped = escapeHtml(md);

  const fenceRe = /```(\w+)?\n([\s\S]*?)```/g;
  let html = escaped.replace(fenceRe, (_m, langRaw: string | undefined, code: string) => {
    const lang = (langRaw || "").trim();
    const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
    return `<pre><code${cls}>${code}</code></pre>`;
  });

  html = html.replace(/^####\s(.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^###\s(.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^##\s(.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^#\s(.+)$/gm, "<h1>$1</h1>");

  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, urlRaw: string) => {
    const safe = safeHttpUrl(urlRaw);
    if (!safe) return `${text} (${escapeHtml(urlRaw)})`;
    return `<a href="${escapeHtml(safe)}" target="_blank" rel="noreferrer noopener">${text}</a>`;
  });

  html = html
    .split(/\n{2,}/g)
    .map((blk) => {
      const t = blk.trim();
      if (!t) return "";
      if (t.startsWith("<h") || t.startsWith("<pre>")) return t;
      return `<p>${t.replace(/\n/g, "<br/>")}</p>`;
    })
    .filter(Boolean)
    .join("\n");

  return html;
}

/* ────────────────────────────────────────────────────────────────
   Rich link previews (favicons + embeds + OG meta)
──────────────────────────────────────────────────────────────── */

type LinkMeta = {
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
};

const META_CACHE = new Map<string, LinkMeta>();

function absUrl(base: string, maybeRel: string): string {
  try {
    return new URL(maybeRel, base).toString();
  } catch {
    return maybeRel;
  }
}

function pickMeta(doc: Document, selector: string): string | undefined {
  const el = doc.querySelector(selector);
  const v = el?.getAttribute("content") ?? el?.getAttribute("href") ?? undefined;
  return v && v.trim().length ? v.trim() : undefined;
}

// Best-effort, CORS-safe fetch via jina proxy.
// If you later add your own endpoint (recommended), swap this function.
async function fetchLinkMeta(url: string, signal?: AbortSignal): Promise<LinkMeta | null> {
  const safe = safeHttpUrl(url);
  if (!safe) return null;

  const cached = META_CACHE.get(safe);
  if (cached) return cached;

  const proxy = `https://r.jina.ai/${safe}`;

  try {
    const res = await fetch(proxy, {
      method: "GET",
      mode: "cors",
      signal,
      headers: { Accept: "text/html, text/plain;q=0.9,*/*;q=0.1" },
    });

    if (!res.ok) return null;

    const text = await res.text();
    if (!text || text.length < 20) return null;

    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "text/html");

    const ogTitle = pickMeta(doc, 'meta[property="og:title"]');
    const ogDesc = pickMeta(doc, 'meta[property="og:description"]');
    const ogSite = pickMeta(doc, 'meta[property="og:site_name"]');
    const ogImage = pickMeta(doc, 'meta[property="og:image"]');

    const twTitle = pickMeta(doc, 'meta[name="twitter:title"]');
    const twDesc = pickMeta(doc, 'meta[name="twitter:description"]');
    const twImage = pickMeta(doc, 'meta[name="twitter:image"]');

    const titleTag = doc.querySelector("title")?.textContent?.trim() || undefined;
    const descTag = pickMeta(doc, 'meta[name="description"]');

    const meta: LinkMeta = {
      title: ogTitle ?? twTitle ?? titleTag,
      description: ogDesc ?? twDesc ?? descTag,
      siteName: ogSite,
      image: ogImage ?? twImage,
    };

    if (meta.image) meta.image = absUrl(safe, meta.image);

    META_CACHE.set(safe, meta);
    return meta;
  } catch {
    return null;
  }
}

function useInView<T extends Element>(): { ref: React.RefCallback<T>; inView: boolean } {
  const ioSupported = typeof window !== "undefined" && typeof IntersectionObserver !== "undefined";
  const [inView, setInView] = useState<boolean>(() => !ioSupported);

  const ioRef = useRef<IntersectionObserver | null>(null);

  const ref = useCallback(
    (node: T | null) => {
      if (ioRef.current) {
        ioRef.current.disconnect();
        ioRef.current = null;
      }
      if (!ioSupported) return;
      if (!node) return;

      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.target === node && e.isIntersecting) {
              setInView(true);
              io.disconnect();
              break;
            }
          }
        },
        { root: null, rootMargin: "250px 0px", threshold: 0.01 },
      );

      ioRef.current = io;
      io.observe(node);
    },
    [ioSupported],
  );

  useEffect(() => {
    return () => {
      if (ioRef.current) {
        ioRef.current.disconnect();
        ioRef.current = null;
      }
    };
  }, []);

  return { ref, inView };
}

function useLinkMeta(url: string, enabled: boolean): LinkMeta | null {
  const safe = safeHttpUrl(url) ?? "";
  const cached: LinkMeta | null = safe ? (META_CACHE.get(safe) ?? null) : null;

  type FetchedMeta = { safe: string; meta: LinkMeta };
  const [fetched, setFetched] = useState<FetchedMeta | null>(null);
  const fetchedForThisUrl = fetched && fetched.safe === safe ? fetched.meta : null;

  useEffect(() => {
    if (!enabled) return;
    if (!safe) return;
    if (META_CACHE.has(safe)) return;

    const ac = new AbortController();

    (async () => {
      const m = await fetchLinkMeta(safe, ac.signal);
      if (m) setFetched({ safe, meta: m });
    })().catch(() => void 0);

    return () => ac.abort();
  }, [safe, enabled]);

  return cached ?? fetchedForThisUrl;
}

/* ────────────────────────────────────────────────────────────────
   Attachments: coerce payload attachments into AttachmentManifest
──────────────────────────────────────────────────────────────── */

function sumBytes(items: AttachmentItem[]): { total: number; inlined: number } {
  let total = 0;
  let inlined = 0;

  for (const it of items) {
    if (it.kind === "file-inline") {
      if (typeof it.size === "number" && Number.isFinite(it.size) && it.size >= 0) {
        total += it.size;
        inlined += it.size;
      }
      continue;
    }
    if (it.kind === "file-ref") {
      if (typeof it.size === "number" && Number.isFinite(it.size) && it.size >= 0) {
        total += it.size;
      }
      continue;
    }
  }

  return { total, inlined };
}

function coerceAttachmentManifest(v: unknown): AttachmentManifest | null {
  if (isAttachmentManifest(v)) return v;

  if (!isRecord(v)) return null;
  const versionRaw = v["version"];
  const itemsRaw = v["items"];

  if (versionRaw !== 1) return null;
  if (!Array.isArray(itemsRaw)) return null;

  const items: AttachmentItem[] = itemsRaw.filter(isAttachmentItem);
  const totals = sumBytes(items);

  const totalBytes =
    typeof v["totalBytes"] === "number" && Number.isFinite(v["totalBytes"])
      ? v["totalBytes"]
      : totals.total;

  const inlinedBytes =
    typeof v["inlinedBytes"] === "number" && Number.isFinite(v["inlinedBytes"])
      ? v["inlinedBytes"]
      : totals.inlined;

  return { version: 1, totalBytes, inlinedBytes, items };
}

/* ────────────────────────────────────────────────────────────────
   Rich URL cards (List)
──────────────────────────────────────────────────────────────── */

function RichLinkCard(props: {
  url: string;
  onInhale?: (u: string) => void;
  toast?: (kind: "success" | "warn" | "info", msg: string) => void;
}): React.JSX.Element {
  const { url, onInhale, toast } = props;
  const safe = safeHttpUrl(url);
  const host = safe ? urlHostPretty(safe) : "Invalid URL";
  const fav = safe ? faviconFor(safe) : null;

  const { ref, inView } = useInView<HTMLElement>();
  const meta = useLinkMeta(safe ?? "", inView);

  const title = meta?.title?.trim() || host;
  const desc = meta?.description?.trim() || "";
  const site = meta?.siteName?.trim() || "";
  const ogImgSafe = meta?.image ? safeHttpUrl(meta.image) : null;

  const [copied, setCopied] = useState(false);
  const tRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (tRef.current !== null) window.clearTimeout(tRef.current);
    };
  }, []);

  const onCopyUrl = useCallback(async () => {
    if (!safe) return;
    try {
      await writeClipboardText(safe);
      setCopied(true);
      if (tRef.current !== null) window.clearTimeout(tRef.current);
      tRef.current = window.setTimeout(() => setCopied(false), 900);
      toast?.("success", "Link kopied.");
    } catch {
      toast?.("warn", "Copy failed. Select the address bar.");
    }
  }, [safe, toast]);

  const onInhaleClick = useCallback(() => {
    if (!safe) return;
    onInhale?.(safe);
    toast?.("success", "Inhaled into your stream.");
  }, [safe, onInhale, toast]);

  return (
    <article ref={ref} className="sf-linkcard" role="article" aria-label="Link preview">
      <header className="sf-linkcard__head">
        <div className="sf-linkcard__brand">
          {fav ? (
            <img
              className="sf-favicon"
              src={fav}
              alt=""
              aria-hidden="true"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="sf-favicon sf-favicon--blank" aria-hidden="true" />
          )}

          <div className="sf-linkcard__brandText">
            <div className="sf-linkcard__title" title={title}>
              {title}
            </div>
            <div className="sf-linkcard__sub">
              <span className="sf-linkcard__host">{site || host}</span>
              {safe ? <span className="sf-muted"> · </span> : null}
              <span className="sf-linkcard__url" title={url}>
                {safe ?? url}
              </span>
            </div>
          </div>
        </div>

        <div className="sf-linkcard__actions">
          {safe ? (
            <a className="sf-btn sf-btn--ghost" href={safe} target="_blank" rel="noreferrer noopener">
              Open
            </a>
          ) : null}

          <button type="button" className="sf-btn sf-btn--ghost" onClick={onCopyUrl} disabled={!safe || copied}>
            {copied ? "Kopied" : "Kopy"}
          </button>

          {onInhale ? (
            <button type="button" className="sf-btn" onClick={onInhaleClick} disabled={!safe}>
              Inhale
            </button>
          ) : null}
        </div>
      </header>

      {desc ? <div className="sf-linkcard__desc">{desc}</div> : null}

      {ogImgSafe ? (
        <div className="sf-linkcard__thumb">
          <img
            className="sf-linkcard__thumbImg"
            src={ogImgSafe}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        </div>
      ) : null}

      {safe ? (
        <div className="sf-linkcard__embed">
          <UrlEmbed url={safe} title={title} />
        </div>
      ) : null}
    </article>
  );
}

function RichStreamList(props: {
  urls: string[];
  onInhale?: (u: string) => void;
  toast?: (kind: "success" | "warn" | "info", msg: string) => void;
}): React.JSX.Element {
  const { urls, onInhale, toast } = props;

  return (
    <div className="sf-rlist" role="list" aria-label="Stream links">
      {urls.map((u) => (
        <div key={u} role="listitem" className="sf-rlist__item">
          <RichLinkCard url={u} onInhale={onInhale} toast={toast} />
        </div>
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   Post body renderer
──────────────────────────────────────────────────────────────── */

function PostBodyView({ body, caption }: { body?: PostBody; caption?: string }): React.JSX.Element {
  const effectiveBody: PostBody | null =
    body ?? (caption && caption.trim().length ? { kind: "text", text: caption } : null);

  if (!effectiveBody) return <></>;

  if (effectiveBody.kind === "text") {
    return <div className="sf-text">— {`"${effectiveBody.text}"`}</div>;
  }

  if (effectiveBody.kind === "code") {
    return (
      <pre className="sf-code">
        <code>{effectiveBody.code}</code>
      </pre>
    );
  }

  if (effectiveBody.kind === "md") {
    const html = renderMarkdownToSafeHtml(effectiveBody.md);
    return <div className="sf-md" dangerouslySetInnerHTML={{ __html: html }} />;
  }

  const cleaned = sanitizeHtml(effectiveBody.html);
  return <div className="sf-html" dangerouslySetInnerHTML={{ __html: cleaned }} />;
}

function pickString(obj: unknown, keys: readonly string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v.trim().length) return v.trim();
  }
  return null;
}

/* ────────────────────────────────────────────────────────────────
   Payload card (uses AttachmentGallery)
──────────────────────────────────────────────────────────────── */

function PayloadCard(props: {
  token: string;
  payload: FeedPostPayload;
  manifest: AttachmentManifest | null;
  copied: boolean;
  onKopy: () => void;
}): React.JSX.Element {
  const { token, payload, manifest, copied, onKopy } = props;

  const pulse = payload.pulse;
  const { beat, step } = pulseToBeatStep(pulse);

  const payloadWeekdayRaw =
    pickString(payload, ["weekday", "weekdayName", "dayName"]) ??
    pickString((payload as unknown as { kai?: unknown }).kai, ["weekday", "day", "weekdayName", "dayName"]);

  const payloadChakraRaw =
    pickString(payload, ["chakra", "chakraName"]) ??
    pickString((payload as unknown as { kai?: unknown }).kai, ["chakra", "chakraName"]);

  const weekday = normalizeWeekdayLabel(payloadWeekdayRaw ?? pulseToWeekday(pulse));
  const chakra = normalizeChakraLabel(payloadChakraRaw ?? stepToChakra(step));

  const phiKey =
    pickString(payload, ["userPhiKey", "phiKey", "phikey", "authorPhiKey"]) ??
    pickString((payload as unknown as { meta?: unknown }).meta, ["userPhiKey", "phiKey", "phikey"]) ??
    "";

  const modeLabel =
    pickString(payload, ["mode", "source", "origin", "transport"]) ??
    pickString((payload as unknown as { meta?: unknown }).meta, ["mode", "source", "origin"]) ??
    "Manual";

  useEffect(() => {
    try {
      registerSigilUrl(preferredShareUrl(token));
    } catch (e) {
      report("register share url (PayloadCard)", e);
    }
    if (typeof payload.url === "string" && payload.url.length) {
      try {
        registerSigilUrl(payload.url);
      } catch (e) {
        report("register payload.url (PayloadCard)", e);
      }
    }
  }, [token, payload.url]);

  return (
    <section className="sf-payload" role="region" aria-label="Loaded payload">
      <div className="sf-payload-line sf-tags">
        <span className="sf-pill sf-pill--mode">{modeLabel || "Manual"}</span>

        {phiKey ? (
          <span className="sf-pill sf-pill--phikey" title={phiKey}>
            ΦKey <span className="sf-key">{phiKey}</span>
          </span>
        ) : null}
      </div>

      <div className="sf-payload-core">
        <span>Pulse {pulse}</span>
        <span className="sf-muted"> · </span>
        <span className="sf-kai-label">
          Kairos {beat}:{step} — {weekday}
        </span>
        <span className="sf-muted"> · </span>
        <span className="sf-kai-label">{chakra}</span>
      </div>

      <PostBodyView body={payload.body} caption={payload.caption} />

      {manifest ? <AttachmentGallery manifest={manifest} /> : null}

      <div className="sf-reply-actions">
        <button type="button" className="sf-btn" onClick={onKopy} disabled={copied} aria-label="Kopy share link">
          {copied ? "Kopied" : "Kopy"}
        </button>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────
   Root
──────────────────────────────────────────────────────────────── */

export function SigilStreamRoot(): React.JSX.Element {
  return (
    <ToastsProvider>
      <SigilAuthProvider>
        <SigilStreamInner />
      </SigilAuthProvider>
    </ToastsProvider>
  );
}

function SigilStreamInner(): React.JSX.Element {
  const toasts = useToasts();
  const loc = useLocation();

  /** ---------- Sources list (seed + storage + ?add ingestion) ---------- */
  const [sources, setSources] = useState<Source[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const seed = await loadLinksJson();
        const stored = parseStringArray(typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null);

        const merged: Source[] = [...stored.map((u) => ({ url: u })), ...seed];
        const seen = new Set<string>();
        const unique = merged.filter(({ url }) => (seen.has(url) ? false : (seen.add(url), true)));

        setSources(unique);
        for (const { url } of unique) registerSigilUrl(url);
      } catch (e) {
        report("initial seed load", e);
      }
    })().catch((e) => report("initial seed load outer", e));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const search = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(
        window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash,
      );

      const addsRaw = [...search.getAll("add"), ...hash.getAll("add")];
      const adds = addsRaw.map(normalizeAddParam).filter((x): x is string => Boolean(x));
      if (adds.length === 0) return;

      setSources((prev) => {
        const seen = new Set(prev.map((s) => s.url));
        const fresh = adds.filter((u) => !seen.has(u));
        if (fresh.length) {
          prependUniqueToStorage(fresh);
          for (const u of fresh) registerSigilUrl(u);
          return [...fresh.map((u) => ({ url: u })), ...prev];
        }
        return prev;
      });
    } catch (e) {
      report("add ingestion", e);
    }
  }, []);

  /** ---------- Payload (decoded from token; Brotli-aware) ---------- */
  const [activeToken, setActiveToken] = useState<string | null>(null);
  const [payload, setPayload] = useState<FeedPostPayload | null>(null);
  const [payloadError, setPayloadError] = useState<string | null>(null);

  const payloadManifest = useMemo<AttachmentManifest | null>(() => {
    const raw = payload ? (payload as unknown as { attachments?: unknown }).attachments : undefined;
    return raw ? coerceAttachmentManifest(raw) : null;
  }, [payload]);

  const refreshPayloadFromLocation = useCallback(async () => {
    if (typeof window === "undefined") return;

    const raw = extractPayloadTokenFromLocation();
    const token = raw ? normalizeIncomingToken(raw) : null;

    setActiveToken(token);

    if (!token) {
      setPayload(null);
      setPayloadError(null);
      return;
    }

    try {
      registerSigilUrl(canonicalizeCurrentStreamUrl(token));
    } catch (e) {
      report("register current stream url (pre-decode)", e);
    }

    try {
      const decoded =
        (await decodeFeedPayload(token)) ||
        (raw && raw !== token ? await decodeFeedPayload(raw) : null);

      if (!decoded) {
        setPayload(null);
        setPayloadError("Invalid or unreadable payload token.");
        return;
      }

      setPayload(decoded);
      setPayloadError(null);

      if (decoded.url && typeof decoded.url === "string") {
        registerSigilUrl(decoded.url);
        prependUniqueToStorage([decoded.url]);

        setSources((prev) => {
          const seen = new Set(prev.map((s) => s.url));
          if (seen.has(decoded.url)) return prev;
          return [{ url: decoded.url }, ...prev];
        });
      }

      try {
        registerSigilUrl(shortAliasUrl(token));
      } catch (e) {
        report("register short alias url", e);
      }
    } catch (e) {
      report("payload decode", e);
      setPayload(null);
      setPayloadError("Payload decode failed.");
    }
  }, []);

  useEffect(() => {
    void refreshPayloadFromLocation();
  }, [refreshPayloadFromLocation, loc.pathname, loc.search, loc.hash]);

  /** ---------- Verified session flag (per-thread) ---------- */
  const sessionKey = useMemo(() => {
    const token = activeToken ?? (typeof window !== "undefined" ? extractPayloadTokenFromLocation() : null) ?? "root";
    return `sf.verifiedSession:${sessionTokenKey(token)}`;
  }, [activeToken]);

  const [verifiedThisSession, setVerifiedThisSession] = useState<boolean>(() => {
    try {
      if (typeof window === "undefined") return false;
      const t = extractPayloadTokenFromLocation() || "root";
      const k = `sf.verifiedSession:${sessionTokenKey(t)}`;
      return sessionStorage.getItem(k) === "1";
    } catch (e) {
      report("sessionStorage.getItem (init)", e);
      return false;
    }
  });

  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      setVerifiedThisSession(sessionStorage.getItem(sessionKey) === "1");
    } catch (e) {
      report("sessionStorage.getItem (sync)", e);
      setVerifiedThisSession(false);
    }
  }, [sessionKey]);

  const onVerifiedNow = () => {
    setVerifiedThisSession(true);
    try {
      sessionStorage.setItem(sessionKey, "1");
    } catch (e) {
      report("sessionStorage.setItem", e);
    }
    toasts.push("success", "ΦKey inhaled.");
  };

  const onResetVerified = () => {
    setVerifiedThisSession(false);
    try {
      sessionStorage.removeItem(sessionKey);
    } catch (e) {
      report("sessionStorage.removeItem", e);
    }
  };

  /** ---------- Auth metadata (from app context) ---------- */
  const rawSigilAuth = useSigilAuth() as unknown;
  const authLike = useMemo(() => coerceAuth(rawSigilAuth), [rawSigilAuth]);

  const composerMeta = useMemo(() => (verifiedThisSession ? authLike.meta : null), [verifiedThisSession, authLike.meta]);
  const composerSvgText = useMemo(() => (verifiedThisSession ? authLike.svgText : null), [verifiedThisSession, authLike.svgText]);

  const composerPhiKey = useMemo(
    () => (composerMeta ? readStringProp(composerMeta, "userPhiKey") : undefined),
    [composerMeta],
  );
  const composerKaiSig = useMemo(
    () => (composerMeta ? readStringProp(composerMeta, "kaiSignature") : undefined),
    [composerMeta],
  );

  /** ---------- Inhaler: add a link to list ---------- */
  const onAddInhaled = (u: string) => {
    setSources((prev) => {
      const seen = new Set(prev.map((s) => s.url));
      if (!seen.has(u)) {
        prependUniqueToStorage([u]);
        registerSigilUrl(u);
        return [{ url: u }, ...prev];
      }
      return prev;
    });
  };

  /** ---------- KOPY (toast-driven sound + label flip) ---------- */
  const [copied, setCopied] = useState<boolean>(false);
  const copiedTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    };
  }, []);

  const onKopy = useCallback(async () => {
    const tokenRaw = activeToken ?? (typeof window !== "undefined" ? extractPayloadTokenFromLocation() : null);
    const token = tokenRaw ? normalizeIncomingToken(tokenRaw) : null;
    if (!token) return;

    const share = preferredShareUrl(token);

    try {
      await writeClipboardText(share);

      setCopied(true);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1200);

      toasts.push("success", "Link kopied.");
    } catch (e) {
      report("kopy", e);
      setCopied(false);
      toasts.push("warn", "Copy failed. Select the address bar.");
    }
  }, [activeToken, toasts]);

  /** ---------- Derived list: show payload first if present ---------- */
  const urls: string[] = useMemo(() => {
    const base = sources.map((s) => s.url);

    const payloadUrl = payload && typeof payload.url === "string" && payload.url.length ? payload.url : null;
    if (!payloadUrl) return base;

    const rest = base.filter((u) => u !== payloadUrl);
    return [payloadUrl, ...rest];
  }, [sources, payload]);

  /** ---------- Render ---------- */
  const sigilBlock =
    verifiedThisSession && (composerMeta || composerSvgText)
      ? SigilActionUrl({ meta: composerMeta, svgText: composerSvgText || "" })
      : null;

  return (
    <main className="sf">
      <header className="sf-head" role="region" aria-labelledby="glyph-stream-title">
        <h1 id="glyph-stream-title">Memory Stream</h1>

        <KaiStatus />

        {payload && activeToken ? (
          <PayloadCard
            token={activeToken}
            payload={payload}
            manifest={payloadManifest}
            copied={copied}
            onKopy={onKopy}
          />
        ) : payloadError ? (
          <div className="sf-error" role="alert">
            {payloadError}
          </div>
        ) : (
          <p className="sf-sub">
            Open a payload link at <code>/stream/p/&lt;token&gt;</code> (or <code>/stream#t=&lt;token&gt;</code>). Replies are Kai-sealed and thread via{" "}
            <code>?add=</code>. Short alias accepted: <code>/p~&lt;token&gt;</code> (and legacy <code>/p#t=</code>, <code>/p?t=</code>, <code>/stream?p=</code>).
          </p>
        )}

        {!payload && (
          <section className="sf-inhaler" aria-labelledby="inhaler-title">
            <InhaleSection onAdd={onAddInhaled} />
          </section>
        )}

        <IdentityBar phiKey={composerPhiKey} kaiSignature={composerKaiSig} />

        {sigilBlock && sigilBlock.node}

        {payload && (
          <section className="sf-reply" aria-labelledby="reply-title">
            <h2 id="reply-title" className="sf-reply-title">
              Reply
            </h2>

            {!verifiedThisSession ? (
              <div className="sf-reply-login">
                <p className="sf-sub">Inhale ΦKey to resonate a reply.</p>
                <SigilLogin onVerified={onVerifiedNow} />
              </div>
            ) : !composerMeta ? (
              <div className="sf-error" role="alert">
                Verified, but no sigil metadata found. Re-inhale your glyph.
              </div>
            ) : (
              <Composer meta={composerMeta} svgText={composerSvgText} onUseDifferentKey={onResetVerified} />
            )}
          </section>
        )}
      </header>

      <section className="sf-list">
        {urls.length === 0 ? (
          <div className="sf-empty">
            No items yet. Paste a link above or open a <code>/stream/p/&lt;payload&gt;</code> link and reply to start a thread.
          </div>
        ) : (
          <RichStreamList urls={urls} onInhale={onAddInhaled} toast={(kind, msg) => toasts.push(kind, msg)} />
        )}
      </section>
    </main>
  );
}

export default SigilStreamRoot;
