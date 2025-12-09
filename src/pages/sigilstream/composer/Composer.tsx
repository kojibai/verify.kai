// src/pages/sigilstream/composer/Composer.tsx
"use client";

import React, {
  useCallback,
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
  currentPayloadUrl,
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
} from "../../../utils/feedPayload";

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
  // EXHALE (Create v3 Brotli Payload)
  // ────────────────────────────────────────────────────────────────

  const onGenerateReply = async (): Promise<void> => {
    if (replyBusy) return;
    setReplyBusy(true);

    try {
      const actionUrl = (sigilActionUrl || "").trim();
      if (!actionUrl || !isLikelySigilUrl(actionUrl)) {
        toasts.push("info", "No sigil URL detected; using fallback.");
      }

      /* Convert linkItems → v3 url attachments */
      const linkAsAttachments: PayloadAttachmentItem[] = linkItems.map((it) =>
        makeUrlAttachment({ url: it.url, title: it.title }),
      );

      /* Convert file attachments → v3 file attachments */
      const fileAsAttachments: PayloadAttachmentItem[] = composerAtt.items.map((it) => {
        if (it.kind === "file-ref") {
          return makeFileRefAttachment({
            sha256: it.sha256,
            name: it.name,
            type: it.type,
            size: it.size,
            url: undefined, // local selection; no remote URL here
          });
        }

        if (it.kind === "file-inline") {
          return makeInlineAttachment({
            name: it.name,
            type: it.type,
            size: it.size,
            data_b64url: it.data_b64url,
            thumbnail_b64: undefined, // keep deterministic; only include if your manifest defines it
          });
        }

        // If some other kind slips in, pass through structurally.
        return it as unknown as PayloadAttachmentItem;
      });

      const allAttachments: PayloadAttachmentItem[] = [
        ...linkAsAttachments,
        ...fileAsAttachments,
      ];

      const attachments =
        allAttachments.length > 0 ? makeAttachments(allAttachments) : undefined;

      const pulseNow = computeLocalKai(new Date()).pulse;

      const payloadObj: FeedPostPayload = makeBasePayload({
        url: actionUrl || canonicalBase().origin,
        pulse: pulseNow,
        caption: replyText.trim() || undefined,
        author: replyAuthor.trim() || undefined,
        source: "manual",
        sigilId: undefined,
        phiKey: composerPhiKey ?? undefined,
        kaiSignature: composerKaiSig ?? undefined,
        ts: Date.now(),
        attachments,
      });

      const token = await encodeFeedPayload(payloadObj);

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
      {/* Attach Section */}
      <div className="sf-reply-row">
        <label className="sf-label">Attach</label>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
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
              <div
                key={`${it.kind}:${i}`}
                className="sf-att-item"
                style={{ position: "relative" }}
              >
                <AttachmentCard item={it} />
                <button
                  className="sf-btn"
                  onClick={() => removeAttachmentAt(i)}
                  style={{ position: "absolute", top: 8, right: 8 }}
                  type="button"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Links */}
      <div className="sf-reply-row">
        <label className="sf-label">Add links</label>

        <div style={{ display: "flex", gap: "8px" }}>
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
                  className="sf-btn"
                  onClick={() => onRemoveLink(i)}
                  style={{ position: "absolute", top: 8, right: 8 }}
                  type="button"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Author */}
      <div className="sf-reply-row">
        <label className="sf-label">Author</label>
        <input
          className="sf-input"
          type="text"
          value={replyAuthor}
          onChange={(e) => setReplyAuthor(e.target.value)}
        />
      </div>

      {/* Memory */}
      <div className="sf-reply-row">
        <label className="sf-label">Memory</label>
        <textarea
          className="sf-textarea"
          rows={3}
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
        />
      </div>

      {/* Actions */}
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

      {/* Result */}
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
                  await navigator.clipboard.writeText(expandShortAliasToCanonical(replyUrl));
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
