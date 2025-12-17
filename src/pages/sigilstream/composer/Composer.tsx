// src/pages/sigilstream/composer/Composer.tsx
"use client";

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import { useToasts } from "../data/toast/toast";
import { computeLocalKai } from "../core/kai_time";

import {
  canonicalBase,
  expandShortAliasToCanonical,
  isLikelySigilUrl,
  buildStreamUrl,
} from "../core/alias";

import { coerceAuth, readStringProp } from "../core/utils";

import { AttachmentCard } from "../attachments/gallery";
import type { AttachmentManifest, AttachmentUrl } from "../attachments/types";

import { filesToManifest } from "../attachments/files";
import { normalizeWebLink, addLinkItem, removeLinkItem } from "./linkHelpers";

import { SigilActionUrl } from "../identity/SigilActionUrl";
import {
  ingestUsernameClaimGlyph,
  getUsernameClaimRegistry,
  subscribeUsernameClaimRegistry,
} from "../../../utils/usernameClaimRegistry";
import { normalizeClaimGlyphRef, normalizeUsername, mintUsernameClaimGlyph } from "../../../utils/usernameClaim";
import type { UsernameClaimRegistry } from "../../../utils/usernameClaimRegistry";
import { USERNAME_CLAIM_KIND, type UsernameClaimGlyphEvidence } from "../../../types/usernameClaim";

/* NEW v3 payload engine */
import {
  makeBasePayload,
  makeUrlAttachment,
  makeFileRefAttachment,
  makeInlineAttachment,
  makeAttachments,
  type FeedPostPayload,
  type AttachmentItem as PayloadAttachmentItem,
  encodeFeedPayload,
  decodeFeedPayload,
  extractPayloadTokenFromLocation,
  extractPayloadTokenFromUrlString,
} from "../../../utils/feedPayload";

type ComposerProps = {
  meta: Record<string, unknown> | null;
  svgText: string | null;
  onUseDifferentKey?: () => void;
  inlineLimitBytes?: number;
};

type ParentPreview = {
  author?: string;
  url: string;
  snippet: string;
};

const ADD_CHAIN_MAX = 512;

/** Explorer + Feed integration (no backend): persist + cross-tab notify */
const EXPLORER_FALLBACK_LS_KEY = "sigil:urls";
const FEED_FALLBACK_LS_KEY = "sigil:feed";
const EXPLORER_BC_NAME = "kai-sigil-registry";
const FEED_BC_NAME = "kai-feed-registry";

function safeDecodeURIComponent(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function looksLikeBareToken(s: string): boolean {
  const t = s.trim();
  if (t.length < 16) return false;
  return /^[A-Za-z0-9_-]+$/u.test(t);
}

function canonicalizeForStorage(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  try {
    return new URL(t, canonicalBase().origin).toString();
  } catch {
    return t;
  }
}

function extractTokenKeyFromUrl(rawUrl: string): string | null {
  const t = extractPayloadTokenFromUrlString(rawUrl);
  return t ? `t:${t}` : null;
}

function countAddsInUrl(rawUrl: string): number {
  try {
    const u = new URL(rawUrl, canonicalBase().origin);
    const hashStr = u.hash.startsWith("#") ? u.hash.slice(1) : "";
    const hp = new URLSearchParams(hashStr);
    return hp.getAll("add").length + u.searchParams.getAll("add").length;
  } catch {
    return 0;
  }
}

function registryScore(rawUrl: string): number {
  const adds = countAddsInUrl(rawUrl);
  return adds * 100_000 + rawUrl.length;
}

/**
 * Upsert URL into a list stored in localStorage:
 * - Uniqueness by token key (preferred), else by canonical string.
 * - If same key exists, keep the richer URL (more add= or longer).
 */
function upsertUrlIntoList(lsKey: string, rawUrl: string): { changed: boolean; value: string } {
  if (typeof window === "undefined") return { changed: false, value: rawUrl };
  if (typeof window.localStorage === "undefined") return { changed: false, value: rawUrl };

  const canonical = canonicalizeForStorage(rawUrl);
  if (!canonical) return { changed: false, value: rawUrl };

  try {
    const raw = window.localStorage.getItem(lsKey);

    const existing: string[] = [];
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const v of parsed) if (typeof v === "string") existing.push(v);
      }
    }

    // Build best entry per key, preserve first-seen order.
    const order: string[] = [];
    const best = new Map<string, { url: string; score: number }>();

    const keyOf = (u: string): string => {
      const k = extractTokenKeyFromUrl(u);
      return k ?? `u:${canonicalizeForStorage(u)}`;
    };

    for (const v of existing) {
      const c = canonicalizeForStorage(v);
      if (!c) continue;

      const k = keyOf(c);
      const sc = registryScore(c);

      if (!best.has(k)) {
        best.set(k, { url: c, score: sc });
        order.push(k);
      } else {
        const prior = best.get(k)!;
        if (sc > prior.score) best.set(k, { url: c, score: sc });
      }
    }

    const newKey = keyOf(canonical);
    const newScore = registryScore(canonical);

    if (!best.has(newKey)) {
      best.set(newKey, { url: canonical, score: newScore });
      order.push(newKey);
    } else {
      const prior = best.get(newKey)!;
      if (newScore > prior.score) best.set(newKey, { url: canonical, score: newScore });
    }

    const next: string[] = [];
    for (const k of order) {
      const it = best.get(k);
      if (it) next.push(it.url);
    }

    const prevJson = JSON.stringify(existing);
    const nextJson = JSON.stringify(next);

    if (prevJson !== nextJson) {
      window.localStorage.setItem(lsKey, nextJson);
      return { changed: true, value: canonical };
    }

    return { changed: false, value: canonical };
  } catch {
    return { changed: false, value: canonical };
  }
}

function notifyExplorerOfNewUrl(url: string): void {
  if (typeof window === "undefined") return;

  // (1) In-page hook (Explorer mounted)
  try {
    const w = window as unknown as {
      __SIGIL__?: { registerSigilUrl?: (u: string) => void };
    };
    w.__SIGIL__?.registerSigilUrl?.(url);
  } catch {
    // silent
  }

  // (2) DOM event fallback
  try {
    window.dispatchEvent(new CustomEvent("sigil:url-registered", { detail: { url } }));
  } catch {
    // silent
  }

  // (3) Cross-tab BroadcastChannel
  try {
    if ("BroadcastChannel" in window) {
      const bc = new BroadcastChannel(EXPLORER_BC_NAME);
      bc.postMessage({ type: "sigil:add", url });
      bc.close();
    }
  } catch {
    // silent
  }
}

function notifyFeedOfNewUrl(url: string): void {
  if (typeof window === "undefined") return;

  // (1) In-page hook (Feed mounted)
  try {
    const w = window as unknown as {
      __FEED__?: { registerFeedUrl?: (u: string) => void };
    };
    w.__FEED__?.registerFeedUrl?.(url);
  } catch {
    // silent
  }

  // (2) DOM event fallback
  try {
    window.dispatchEvent(new CustomEvent("feed:url-registered", { detail: { url } }));
  } catch {
    // silent
  }

  // (3) Cross-tab BroadcastChannel
  try {
    if ("BroadcastChannel" in window) {
      const bc = new BroadcastChannel(FEED_BC_NAME);
      bc.postMessage({ type: "feed:add", url });
      bc.close();
    }
  } catch {
    // silent
  }
}

/** Parse add= from BOTH query and hash, normalize to canonical URL strings OR keep j: payload refs. */
function extractAddChainFromHref(href: string): string[] {
  try {
    const u = new URL(href, canonicalBase().origin);
    const hashStr = u.hash.startsWith("#") ? u.hash.slice(1) : "";
    const hashParams = new URLSearchParams(hashStr);

    const addsRaw = [...u.searchParams.getAll("add"), ...hashParams.getAll("add")];

    const out: string[] = [];
    for (const a of addsRaw) {
      const decoded = safeDecodeURIComponent(String(a)).trim();
      if (!decoded) continue;

      // ✅ Keep embedded payload refs (Memory Stream v2 style)
      if (decoded.startsWith("j:") && decoded.length > 10) {
        if (!out.includes(decoded)) out.push(decoded);
        continue;
      }

      // ✅ If add= is a bare token, convert into a canonical stream URL first
      if (looksLikeBareToken(decoded)) {
        try {
          const canonTokUrl = expandShortAliasToCanonical(buildStreamUrl(decoded));
          if (canonTokUrl && !out.includes(canonTokUrl)) out.push(canonTokUrl);
          continue;
        } catch {
          // fall through
        }
      }

      try {
        const canon = expandShortAliasToCanonical(decoded);
        if (canon && !out.includes(canon)) out.push(canon);
      } catch {
        // ignore
      }
    }

    return out.slice(-ADD_CHAIN_MAX);
  } catch {
    return [];
  }
}

/** Add add= entries into the URL *hash* (never query) so servers/proxies never see them. */
function withHashAdds(baseUrl: string, adds: readonly string[]): string {
  const u = new URL(baseUrl, canonicalBase().origin);

  // preserve existing hash params (ex: t=...); just rewrite add=
  const hashStr = u.hash.startsWith("#") ? u.hash.slice(1) : "";
  const h = new URLSearchParams(hashStr);
  h.delete("add");

  for (const a of adds) h.append("add", a);

  // IMPORTANT: keep query empty so we never hit 414
  u.search = "";
  const nextHash = h.toString();
  u.hash = nextHash ? `#${nextHash}` : "";
  return u.toString();
}

type ReplyContext = {
  replyToUrl: string | null; // immediate parent (most recent message)
  originUrl: string | null; // thread root if known
  addChain: string[]; // ancestor chain excluding replyToUrl (root..parent-of-parent)
};

function buildMomentUrlFromToken(tok: string): string {
  const origin = canonicalBase().origin.replace(/\/+$/g, "");
  return `${origin}/stream/p/${encodeURIComponent(tok)}`;
}

function extractRootRefFromHref(href: string): string | null {
  try {
    const u = new URL(href, canonicalBase().origin);

    const hashStr = u.hash.startsWith("#") ? u.hash.slice(1) : "";
    const hp = new URLSearchParams(hashStr);

    const rRaw = hp.get("root") ?? u.searchParams.get("root");
    if (!rRaw) return null;

    const decoded = safeDecodeURIComponent(String(rRaw)).trim();
    if (!decoded) return null;

    if (decoded.startsWith("j:") && decoded.length > 10) return decoded;

    // bare blob fallback (accept as j:<blob> if it looks like base64url)
    if (/^[A-Za-z0-9_-]{16,}$/u.test(decoded)) return `j:${decoded}`;

    return null;
  } catch {
    return null;
  }
}

function computeReplyContextFromWindow(): ReplyContext {
  if (typeof window === "undefined") return { replyToUrl: null, originUrl: null, addChain: [] };

  const href = window.location.href;
  const addChain = extractAddChainFromHref(href);

  // detect current token even on /stream/p/<token>
  const hereToken =
    extractPayloadTokenFromUrlString(href) ?? extractPayloadTokenFromLocation(window.location);

  const replyToFromHere = hereToken
    ? (() => {
        try {
          return expandShortAliasToCanonical(buildMomentUrlFromToken(hereToken));
        } catch {
          return buildMomentUrlFromToken(hereToken);
        }
      })()
    : null;

  // If we're on a Memory Stream v2 URL (#root=j:...), treat root as the reply target
  const rootRef = extractRootRefFromHref(href);

  // Otherwise, the reply target is the last add=
  const replyToFallback =
    !replyToFromHere && !rootRef && addChain.length ? addChain[addChain.length - 1] : null;

  const replyTo = replyToFromHere ?? rootRef ?? replyToFallback;

  // Origin/root: first add= if present, else replyTo
  const origin = addChain.length ? addChain[0] : replyTo;

  // Ancestors: if replyTo came from last add=, ancestors are everything before it
  const ancestors = replyToFallback && addChain.length ? addChain.slice(0, -1) : addChain.slice(0);

  return {
    replyToUrl: replyTo,
    originUrl: origin,
    addChain: ancestors.slice(-ADD_CHAIN_MAX),
  };
}

export function Composer({
  meta,
  svgText,
  onUseDifferentKey,
  inlineLimitBytes = 512 * 1024,
}: ComposerProps): React.JSX.Element {
  const toasts = useToasts();

  /* Safe meta + SVG */
  const { meta: safeMeta, svgText: safeSvgText } = useMemo(
    () => coerceAuth({ meta, svgText }),
    [meta, svgText],
  );

  const composerPhiKey = useMemo(
    () => (safeMeta ? readStringProp(safeMeta, "userPhiKey") : undefined),
    [safeMeta],
  );

  const composerKaiSig = useMemo(
    () => (safeMeta ? readStringProp(safeMeta, "kaiSignature") : undefined),
    [safeMeta],
  );

  const { value: sigilActionUrl } = SigilActionUrl({
    meta: safeMeta,
    svgText: safeSvgText,
  });

  /* Reply State */
  const [replyText, setReplyText] = useState("");
  const [replyAuthor, setReplyAuthor] = useState("");
  const [claimGlyphRef, setClaimGlyphRef] = useState("");
  const [composerAtt, setComposerAtt] = useState<AttachmentManifest>({
    version: 1,
    totalBytes: 0,
    inlinedBytes: 0,
    items: [],
  });

  const [linkField, setLinkField] = useState("");
  const [linkItems, setLinkItems] = useState<AttachmentUrl[]>([]);

  const attachInputId = useId();
  const cameraInputId = useId();
  const attachInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [replyBusy, setReplyBusy] = useState(false);
  const [replyUrl, setReplyUrl] = useState("");
  const [copiedReply, setCopiedReply] = useState(false);
  const [usernameClaims, setUsernameClaims] = useState<UsernameClaimRegistry>(() => getUsernameClaimRegistry());

  // Parent payload (previous message) for "Replying to" context
  const [parentPayload, setParentPayload] = useState<FeedPostPayload | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const ctx = computeReplyContextFromWindow();
      if (!ctx.replyToUrl) return;

      const tok =
        extractPayloadTokenFromUrlString(ctx.replyToUrl) ??
        extractPayloadTokenFromLocation(window.location);

      if (!tok) return;

      const decoded = decodeFeedPayload(tok);
      if (decoded) setParentPayload(decoded);
    } catch {
      // silent
    }
  }, []);

  const parentPreview: ParentPreview | null = useMemo(() => {
    if (!parentPayload) return null;

    const body = parentPayload.body;
    let rawText = parentPayload.caption ?? "";

    if (body) {
      if (body.kind === "text") rawText = body.text;
      else if (body.kind === "md") rawText = body.md;
      else if (body.kind === "code") rawText = body.code;
      else if (body.kind === "html") rawText = body.html;
    }

    const trimmed = rawText.trim();
    if (!trimmed) {
      return {
        author: parentPayload.author,
        url: parentPayload.url,
        snippet: "(Previous memory has no visible text content.)",
      };
    }

    const maxLen = 280;
    const snippet = trimmed.length > maxLen ? `${trimmed.slice(0, maxLen - 1)}…` : trimmed;

    return {
      author: parentPayload.author,
      url: parentPayload.url,
      snippet,
    };
  }, [parentPayload]);

  /* Keep username-claim registry in sync (cross-tab). */
  useEffect(() => {
    setUsernameClaims(getUsernameClaimRegistry());
    const unsub = subscribeUsernameClaimRegistry((entry, source) => {
      void source;
      setUsernameClaims((prev: UsernameClaimRegistry) => ({ ...prev, [entry.normalized]: entry }));
    });
    return () => unsub();
  }, []);

  const normalizedUsername = useMemo(() => normalizeUsername(replyAuthor), [replyAuthor]);
  const claimEntry = normalizedUsername ? usernameClaims[normalizedUsername] : undefined;

  const claimGlyphHash = useMemo(() => normalizeClaimGlyphRef(claimGlyphRef), [claimGlyphRef]);

  const usernameClaimLabel = useMemo(() => {
    if (!normalizedUsername) return "";
    if (!claimEntry) return "Username available";
    if (claimEntry.claimHash === claimGlyphHash) return "Username claimed by you";
    if (claimEntry.ownerHint && composerPhiKey && claimEntry.ownerHint === composerPhiKey)
      return "Username claimed by you";
    return "Username claimed by another";
  }, [claimEntry, claimGlyphHash, normalizedUsername, composerPhiKey]);

  // ────────────────────────────────────────────────────────────────
  // ATTACHMENTS
  // ────────────────────────────────────────────────────────────────

  const onPickFiles = useCallback(
    async (ev: ChangeEvent<HTMLInputElement>) => {
      const list = ev.currentTarget.files;
      if (!list || list.length === 0) return;

      try {
        const manifest = await filesToManifest(list, inlineLimitBytes);

        setComposerAtt((prev) => ({
          version: 1,
          totalBytes: prev.totalBytes + manifest.totalBytes,
          inlinedBytes: prev.inlinedBytes + manifest.inlinedBytes,
          items: [...manifest.items, ...prev.items],
        }));

        ev.currentTarget.value = "";
        toasts.push("success", "Attached.");
      } catch (err) {
        console.error("[Composer] onPickFiles:", err);
        toasts.push("error", "Attach failed.");
      }
    },
    [inlineLimitBytes, toasts],
  );

  const removeAttachmentAt = useCallback((idx: number): void => {
    setComposerAtt((prev) => {
      const nextItems = [...prev.items];
      const removed = nextItems.splice(idx, 1)[0];

      const removedTotalBytes =
        removed && (removed.kind === "file-inline" || removed.kind === "file-ref")
          ? (removed.size ?? 0)
          : 0;

      const removedInlinedBytes =
        removed && removed.kind === "file-inline" ? (removed.size ?? 0) : 0;

      return {
        version: 1,
        totalBytes: Math.max(0, prev.totalBytes - removedTotalBytes),
        inlinedBytes: Math.max(0, prev.inlinedBytes - removedInlinedBytes),
        items: nextItems,
      };
    });
  }, []);

  // ────────────────────────────────────────────────────────────────
  // LINKS (converted into v3 attachments)
  // ────────────────────────────────────────────────────────────────

  const onAddLink = (raw: string): void => {
    const normalized = normalizeWebLink(raw);
    if (!normalized) {
      toasts.push("warn", "Invalid URL. Use https://example.com");
      return;
    }

    const { next, added, error } = addLinkItem(linkItems, normalized);
    if (error) {
      toasts.push("warn", error);
      return;
    }

    setLinkItems(next);
    setLinkField("");
    if (added) toasts.push("success", "Link added.");
  };

  const onRemoveLink = (idx: number): void => {
    setLinkItems((prev) => removeLinkItem(prev, idx));
  };

  // ────────────────────────────────────────────────────────────────
  // EXHALE (Create payload token + carry thread in hash add= witness chain)
  // ────────────────────────────────────────────────────────────────

  const onGenerateReply = async (): Promise<void> => {
    if (replyBusy) return;
    setReplyBusy(true);

    try {
      const actionUrl = (sigilActionUrl || "").trim();
      if (!actionUrl || !isLikelySigilUrl(actionUrl)) {
        toasts.push("info", "No sigil URL detected; using fallback.");
      }

      const replyTextTrimmed = replyText.trim();
      const replyAuthorTrimmed = replyAuthor.trim();
      const normalizedAuthor = normalizeUsername(replyAuthorTrimmed);

      const linkAsAttachments: PayloadAttachmentItem[] = linkItems.map((it) =>
        makeUrlAttachment({ url: it.url, title: it.title }),
      );

      const fileAsAttachments: PayloadAttachmentItem[] = composerAtt.items.map((it) => {
        if (it.kind === "file-ref") {
          return makeFileRefAttachment({
            sha256: it.sha256,
            name: it.name,
            type: it.type,
            size: it.size,
            url: undefined,
          });
        }

        if (it.kind === "file-inline") {
          return makeInlineAttachment({
            name: it.name,
            type: it.type,
            size: it.size,
            data_b64url: it.data_b64url,
            thumbnail_b64: undefined,
          });
        }

        return it as unknown as PayloadAttachmentItem;
      });

      const allAttachments: PayloadAttachmentItem[] = [...linkAsAttachments, ...fileAsAttachments];
      const attachments = allAttachments.length > 0 ? makeAttachments(allAttachments) : undefined;

      // Kai pulse is authoritative (no Chronos stamp required for identity)
      const pulseNow = computeLocalKai(new Date()).pulse;

      const payloadBody =
        replyTextTrimmed.length > 0
          ? ({ kind: "text", text: replyTextTrimmed } as const)
          : undefined;
      let usernameClaimEvidence: UsernameClaimGlyphEvidence | undefined;

      if (normalizedAuthor) {
        if (claimEntry) {
          if (!claimGlyphHash) {
            toasts.push("warn", "Username is claimed. Provide your claim glyph token to seal.");
            return;
          }
          if (claimGlyphHash !== claimEntry.claimHash) {
            toasts.push("warn", "Claim glyph mismatch. Memory not sealed.");
            return;
          }

          usernameClaimEvidence = {
            hash: claimEntry.claimHash,
            url: claimEntry.claimUrl,
            payload: {
              kind: USERNAME_CLAIM_KIND,
              username: claimEntry.username,
              normalized: claimEntry.normalized,
              originHash: claimEntry.originHash,
              ownerHint: claimEntry.ownerHint ?? null,
            },
            ownerHint: claimEntry.ownerHint ?? null,
          };
        } else {
          if (!safeMeta || !composerKaiSig) {
            toasts.push("warn", "Inhale your sigil to mint a username claim.");
            return;
          }

          const originGlyph = {
            hash: composerKaiSig,
            pulseCreated: (safeMeta as { pulse?: number })?.pulse ?? pulseNow,
            pulseGenesis: (safeMeta as { pulse?: number })?.pulse ?? pulseNow,
            value: 1,
            sentTo: [],
            receivedFrom: [],
            metadata: {
              kaiSignature: composerKaiSig,
              creator: composerPhiKey ?? undefined,
            },
          };

          const claimGlyph = mintUsernameClaimGlyph({
            origin: originGlyph,
            username: replyAuthorTrimmed,
            pulse: pulseNow,
            ownerHint: composerPhiKey ?? null,
          });

          const claimPayload = claimGlyph.metadata?.usernameClaim;
          if (claimPayload) {
            usernameClaimEvidence = {
              hash: claimGlyph.hash,
              payload: claimPayload,
              ownerHint: claimPayload.ownerHint ?? null,
            };
          } else {
            toasts.push("warn", "Could not mint username-claim glyph.");
            return;
          }
        }
      }

      // Thread context is carried ONLY in link hash add= witness chain.
      const basePayload: FeedPostPayload = makeBasePayload({
        url: actionUrl || canonicalBase().origin,
        pulse: pulseNow,
        caption: replyTextTrimmed || undefined,
        body: payloadBody,
        author: replyAuthorTrimmed || undefined,
        sigilId: undefined,
        phiKey: composerPhiKey ?? undefined,
        kaiSignature: composerKaiSig ?? undefined,
        parent: undefined,
        parentUrl: undefined,
        originUrl: undefined,
        ts: undefined,
        attachments,
        usernameClaim: usernameClaimEvidence,
      });

      // Optional hint for downstream renderers: this is a memory/post (not a raw sigil)
      const payloadObj: FeedPostPayload & { kind: "post" } = {
        ...basePayload,
        kind: "post",
      };

      const token = encodeFeedPayload(payloadObj);

      // Base share URL
      const baseShare = buildMomentUrlFromToken(token);

      // Build hash-based add= witness chain as TOKENS ONLY (not full URLs)
      const ctx = computeReplyContextFromWindow();

      const ancestorTokens: string[] = [];
      for (const a of ctx.addChain) {
        const t = extractPayloadTokenFromUrlString(a);
        if (t && !ancestorTokens.includes(t)) ancestorTokens.push(t);
      }

      const parentTok = ctx.replyToUrl ? extractPayloadTokenFromUrlString(ctx.replyToUrl) : null;

      const adds: string[] = [...ancestorTokens];
      if (parentTok && !adds.includes(parentTok)) adds.push(parentTok);

      const share = adds.length ? withHashAdds(baseShare, adds.slice(-ADD_CHAIN_MAX)) : baseShare;

      if (usernameClaimEvidence) {
        const ingest = ingestUsernameClaimGlyph({
          ...usernameClaimEvidence,
          url: usernameClaimEvidence.url ?? share,
        });

        if (!ingest.accepted) {
          toasts.push("warn", ingest.reason || "Unable to register username claim.");
          return;
        }

        setUsernameClaims(ingest.registry);
      }

      await navigator.clipboard.writeText(share);
      toasts.push("success", "Link kopied. Kai-sealed.");

      setReplyUrl(share);

      // ✅ Auto-register: Explorer (all), Feed (only the new reply URL)
      try {
        // Explorer: upsert ancestors (canonical stream URLs) + the new share
        for (const t of adds) {
          const u = buildMomentUrlFromToken(t);
          const ex = upsertUrlIntoList(EXPLORER_FALLBACK_LS_KEY, u);
          if (ex.changed) notifyExplorerOfNewUrl(ex.value);
        }

        const exSelf = upsertUrlIntoList(EXPLORER_FALLBACK_LS_KEY, share);
        if (exSelf.changed) notifyExplorerOfNewUrl(exSelf.value);

        // Feed: only the new reply URL (unique, upgrade if richer)
        const fd = upsertUrlIntoList(FEED_FALLBACK_LS_KEY, share);
        if (fd.changed) notifyFeedOfNewUrl(fd.value);
      } catch {
        // silent
      }
    } catch (err) {
      console.error("[Composer] onGenerateReply:", err);
      toasts.push("error", "Could not seal reply.");
    } finally {
      setReplyBusy(false);
    }
  };

  // ────────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────────

  return (
    <section className="sf-reply" aria-labelledby="reply-title">
      {parentPreview && (
        <aside className="sf-reply-context" aria-label="Replying to previous memory">
          <div className="sf-reply-context-header">
            <span className="sf-pill">Replying to</span>
            {parentPreview.author && (
              <span className="sf-reply-context-author">{parentPreview.author}</span>
            )}
          </div>
          <p className="sf-reply-context-body">{parentPreview.snippet}</p>
        </aside>
      )}

      <div className="sf-reply-row">
        <label className="sf-label">Attach</label>

        <div className="sf-reply-row-inline">
          <label className="sf-btn" htmlFor={cameraInputId}>
            Record Memory
          </label>
          <label className="sf-btn sf-btn--ghost" htmlFor={attachInputId}>
            Inhale files
          </label>
        </div>

        <input
          id={cameraInputId}
          ref={cameraInputRef}
          type="file"
          accept="image/*,video/*"
          capture="environment"
          multiple
          onChange={onPickFiles}
          style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
        />

        <input
          id={attachInputId}
          ref={attachInputRef}
          type="file"
          accept="image/*,video/*,audio/*,application/pdf,text/plain,application/json,application/xml,application/svg+xml"
          multiple
          onChange={onPickFiles}
          style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
        />

        {composerAtt.items.length > 0 && (
          <div className="sf-att-grid">
            {composerAtt.items.map((it, i) => (
              <div key={`${it.kind}:${i}`} className="sf-att-item" style={{ position: "relative" }}>
                <AttachmentCard item={it} />
                <button
                  className="sf-btn sf-btn--icon"
                  onClick={() => removeAttachmentAt(i)}
                  style={{ position: "absolute", top: 8, right: 8 }}
                  type="button"
                  aria-label="Remove attachment"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="sf-reply-row">
        <label className="sf-label">Add links</label>

        <div className="sf-reply-row-inline">
          <input
            className="sf-input"
            type="url"
            placeholder="https://example.com"
            value={linkField}
            onChange={(e) => setLinkField(e.target.value)}
          />
          <button className="sf-btn" onClick={() => onAddLink(linkField)} type="button">
            Add
          </button>
        </div>

        {linkItems.length > 0 && (
          <div className="sf-att-grid">
            {linkItems.map((it, i) => (
              <div
                key={`${it.kind}:${it.url}:${i}`}
                className="sf-att-item"
                style={{ position: "relative" }}
              >
                <AttachmentCard item={it} />
                <button
                  className="sf-btn sf-btn--icon"
                  onClick={() => onRemoveLink(i)}
                  style={{ position: "absolute", top: 8, right: 8 }}
                  type="button"
                  aria-label="Remove link"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="sf-reply-row">
        <label className="sf-label">Author</label>
        <input
          className="sf-input"
          type="text"
          value={replyAuthor}
          onChange={(e) => setReplyAuthor(e.target.value)}
          placeholder="@you"
          aria-describedby={usernameClaimLabel ? "username-claim-status" : undefined}
        />
        {usernameClaimLabel ? (
          <div id="username-claim-status" className="sf-sub" role="status" aria-live="polite">
            {usernameClaimLabel}
          </div>
        ) : null}
      </div>

      {normalizedUsername ? (
        <div className="sf-reply-row">
          <label className="sf-label">Claim glyph</label>
          <input
            className="sf-input"
            type="text"
            value={claimGlyphRef}
            onChange={(e) => setClaimGlyphRef(e.target.value)}
            placeholder="Paste claim glyph hash or Memory Stream link"
          />
        </div>
      ) : null}

      <div className="sf-reply-row">
        <label className="sf-label">Memory</label>
        <textarea
          className="sf-textarea"
          rows={3}
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          placeholder="What do you want this moment to remember?"
        />
      </div>

      <div className="sf-reply-actions">
        <button
          className="sf-btn"
          onClick={() => void onGenerateReply()}
          disabled={replyBusy}
          type="button"
        >
          {replyBusy ? "Sealing…" : "Exhale Reply"}
        </button>

        {onUseDifferentKey && (
          <button className="sf-btn sf-btn--ghost" onClick={onUseDifferentKey} type="button">
            Use a different ΦKey
          </button>
        )}
      </div>

      {replyUrl && (
        <div className="sf-reply-result">
          <label className="sf-label">Share this link</label>

          <input
            className="sf-input"
            readOnly
            value={replyUrl}
            onFocus={(e) => e.currentTarget.select()}
          />

          <div className="sf-reply-actions">
            <a className="sf-link" href={replyUrl} target="_blank" rel="noreferrer">
              Open →
            </a>

            <button
              className="sf-btn"
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(replyUrl);
                  toasts.push("success", "Link remembered.");
                  setCopiedReply(true);
                  window.setTimeout(() => setCopiedReply(false), 1200);
                } catch {
                  toasts.push("warn", "Copy failed.");
                }
              }}
            >
              {copiedReply ? "Remembered" : "Remember"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
