// src/pages/sigilstream/composer/Composer.tsx
"use client";

import React, {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChangeEvent } from "react"; // ✅ type-only import
import { useToasts } from "../data/toast/toast";

import { computeLocalKai } from "../core/kai_time";
import {
  buildStreamUrl,
  canonicalBase,
  currentPayloadUrl,
  expandShortAliasToCanonical,
  isLikelySigilUrl,
} from "../core/alias";
import { coerceAuth, readStringProp } from "../core/utils";
import { AttachmentCard } from "../attachments/gallery";
import type {
  AttachmentItem,
  AttachmentManifest,
  AttachmentUrl,
} from "../attachments/types";
import { filesToManifest } from "../attachments/files";
import { normalizeWebLink, addLinkItem, removeLinkItem } from "./linkHelpers";
import { SigilActionUrl } from "../identity/SigilActionUrl";
import { encodeFeedPayload, type FeedPostPayload } from "../../../utils/feedPayload";

type ComposerProps = {
  meta: Record<string, unknown> | null;
  svgText: string | null;
  onUseDifferentKey?: () => void;
  inlineLimitBytes?: number;
};

export function Composer({
  meta,
  svgText,
  onUseDifferentKey,
  inlineLimitBytes = 512 * 1024,
}: ComposerProps): React.JSX.Element {
  const toasts = useToasts();

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

  const { value: sigilActionUrl, } = SigilActionUrl({
    meta: safeMeta,
    svgText: safeSvgText,
  });

  const [replyText, setReplyText] = useState("");
  const [replyAuthor, setReplyAuthor] = useState("");
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

  // --------------------- Attachments ---------------------
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
        console.warn("[Composer] onPickFiles:", err);
        toasts.push("error", "Attach failed.");
      }
    },
    [inlineLimitBytes, toasts],
  );

  const removeAttachmentAt = (idx: number): void => {
    setComposerAtt((prev) => {
      const nextItems = [...prev.items];
      const removed = nextItems.splice(idx, 1)[0];
      let total = prev.totalBytes;
      let inlined = prev.inlinedBytes;

      if (removed && "size" in removed) total -= removed.size;
      if (removed && removed.kind === "file-inline")
        inlined -= (removed as AttachmentItem & { size: number }).size;

      return {
        version: 1,
        totalBytes: Math.max(0, total),
        inlinedBytes: Math.max(0, inlined),
        items: nextItems,
      };
    });
  };

  // ------------------------ Links ------------------------
  const onAddLink = (raw: string): void => {
    const normalized = normalizeWebLink(raw);
    if (!normalized) {
      toasts.push("warn", "Invalid URL. Use https://example.com or a bare domain.");
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

  // -------------------- Exhale (seal) --------------------
  const onGenerateReply = async (): Promise<void> => {
    if (replyBusy) return;
    setReplyBusy(true);
    try {
      const actionUrl = (sigilActionUrl || "").trim();
      if (!actionUrl || !isLikelySigilUrl(actionUrl))
        toasts.push("info", "No canonical sigil URL detected; using fallback.");

      const linkAsAttachments: AttachmentItem[] = linkItems.map((it) => ({
        kind: "url",
        url: it.url,
        ...(it.title ? { title: it.title } : {}),
      }));

      const combinedItems: AttachmentItem[] = [
        ...linkAsAttachments,
        ...composerAtt.items,
      ];

      const combinedAttachments: AttachmentManifest | undefined =
        combinedItems.length
          ? {
              version: 1,
              totalBytes: composerAtt.totalBytes,
              inlinedBytes: composerAtt.inlinedBytes,
              items: combinedItems,
            }
          : undefined;

      const pulseNow = computeLocalKai(new Date()).pulse;

      const payloadObj: FeedPostPayload = {
        v: 1,
        url: actionUrl || canonicalBase().origin,
        pulse: pulseNow,
        caption: replyText.trim() || undefined,
        author: replyAuthor.trim() || undefined,
        source: "manual",
        phiKey: composerPhiKey ?? undefined,
        kaiSignature: composerKaiSig ?? undefined,
        ts: Date.now(),
        ...(combinedAttachments ? { attachments: combinedAttachments } : {}),
      };

      const token = encodeFeedPayload(payloadObj);
      let share = buildStreamUrl(token);
      const parent = currentPayloadUrl();
      if (parent) {
        const u = new URL(share);
        u.searchParams.append("add", parent);
        share = u.toString();
      }

      await navigator.clipboard.writeText(share);
      toasts.push("success", "Link kopied. Kai-sealed.");
      setReplyUrl(share);
    } catch (err) {
      console.warn("[Composer] onGenerateReply:", err);
      toasts.push("error", "Could not seal reply.");
    } finally {
      setReplyBusy(false);
    }
  };

  // ---------------------- Render ----------------------
  return (
    <section className="sf-reply" aria-labelledby="reply-title">
      



      <div className="sf-reply-row">
        <label className="sf-label">Attach</label>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <label className="sf-btn" htmlFor={cameraInputId}>Record Memory</label>
          <label className="sf-btn sf-btn--ghost" htmlFor={attachInputId}>Inhale files</label>
        </div>
        <input id={cameraInputId} ref={cameraInputRef} type="file"
          accept="image/*,video/*" capture="environment" multiple onChange={onPickFiles}
          style={{ position: "absolute", opacity: 0, pointerEvents: "none" }} />
        <input id={attachInputId} ref={attachInputRef} type="file"
          accept="image/*,video/*,audio/*,application/pdf,text/plain,application/json,application/xml,application/svg+xml"
          multiple onChange={onPickFiles}
          style={{ position: "absolute", opacity: 0, pointerEvents: "none" }} />

        {composerAtt.items.length > 0 && (
          <div className="sf-att-grid">
            {composerAtt.items.map((it, i) => (
              <div key={i} className="sf-att-item" style={{ position: "relative" }}>
                <AttachmentCard item={it} />
                <button className="sf-btn" onClick={() => removeAttachmentAt(i)}
                  style={{ position: "absolute", top: 8, right: 8 }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="sf-reply-row">
        <label className="sf-label">Add links</label>
        <div style={{ display: "flex", gap: "8px" }}>
          <input className="sf-input" type="url"
            placeholder="https://example.com"
            value={linkField}
            onChange={(e) => setLinkField(e.target.value)} />
          <button className="sf-btn" onClick={() => onAddLink(linkField)}>Add</button>
        </div>
        {linkItems.length > 0 && (
          <div className="sf-att-grid">
            {linkItems.map((it, i) => (
              <div key={i} className="sf-att-item" style={{ position: "relative" }}>
                <AttachmentCard item={it as AttachmentItem} />
                <button className="sf-btn" onClick={() => onRemoveLink(i)}
                  style={{ position: "absolute", top: 8, right: 8 }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="sf-reply-row">
        <label className="sf-label">Author</label>
        <input className="sf-input" type="text"
          value={replyAuthor}
          onChange={(e) => setReplyAuthor(e.target.value)} />
      </div>

      <div className="sf-reply-row">
        <label className="sf-label">Memory</label>
        <textarea className="sf-textarea" rows={3}
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)} />
      </div>

      <div className="sf-reply-actions">
        <button className="sf-btn" onClick={() => void onGenerateReply()} disabled={replyBusy}>
          {replyBusy ? "Sealing…" : "Exhale Reply"}
        </button>
        {onUseDifferentKey && (
          <button className="sf-btn sf-btn--ghost" onClick={onUseDifferentKey}>
            Use a different ΦKey
          </button>
        )}
      </div>

      {replyUrl && (
        <div className="sf-reply-result">
          <label className="sf-label">Share this link</label>
          <input className="sf-input" readOnly value={replyUrl}
            onFocus={(e) => e.currentTarget.select()} />
          <div className="sf-reply-actions">
            <a className="sf-link" href={replyUrl} target="_blank" rel="noreferrer">
              Open →
            </a>
            <button
              className="sf-btn"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    expandShortAliasToCanonical(replyUrl),
                  );
                  toasts.push("success", "Link kopied.");
                  setCopiedReply(true);
                  setTimeout(() => setCopiedReply(false), 1200);
                } catch {
                  toasts.push("warn", "Copy failed.");
                }
              }}
            >
              {copiedReply ? "Kopied" : "Kopy"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
