// src/pages/sigilstream/attachments/gallery.tsx
"use client";

import type {
  AttachmentItem,
  AttachmentFileInline,
  AttachmentFileRef,
  AttachmentManifest,
} from "./types";
import { UrlEmbed } from "./embeds";
import { dataUrlFrom } from "./files";

/* ---------- tiny pretty-bytes helper ---------- */
function PrettyBytes({ n }: { n: number | undefined }): React.JSX.Element {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return <>—</>;

  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;

  const text =
    n >= GB
      ? `${(n / GB).toFixed(2)} GB`
      : n >= MB
      ? `${(n / MB).toFixed(2)} MB`
      : n >= KB
      ? `${(n / KB).toFixed(2)} KB`
      : `${Math.round(n)} B`;

  return <>{text}</>;
}

/* ---------- Inline file preview cards ---------- */
function InlineFileCard({ it }: { it: AttachmentFileInline }): React.JSX.Element {
  const mime = it.type || "application/octet-stream";
  const dataUrl = dataUrlFrom(it.data_b64url, mime);
  const safeName = it.name || "file";

  if (mime.startsWith("image/")) {
    return (
      <div className="sf-media sf-media--image">
        <img src={dataUrl} alt={safeName} loading="eager" decoding="async" />
        <div className="sf-file-meta">
          <span>{safeName}</span>
          <span>
            <PrettyBytes n={it.size} />
          </span>
        </div>
        <a className="sf-file-dl" href={dataUrl} download={safeName}>
          Download
        </a>
      </div>
    );
  }

  if (mime.startsWith("video/")) {
    return (
      <div className="sf-media sf-media--video">
        <video src={dataUrl} controls playsInline preload="metadata" />
        <div className="sf-file-meta">
          <span>{safeName}</span>
          <span>
            <PrettyBytes n={it.size} />
          </span>
        </div>
        <a className="sf-file-dl" href={dataUrl} download={safeName}>
          Download
        </a>
      </div>
    );
  }

  if (mime.startsWith("audio/")) {
    return (
      <div className="sf-media sf-media--audio">
        <audio src={dataUrl} controls preload="metadata" />
        <div className="sf-file-meta">
          <span>{safeName}</span>
          <span>
            <PrettyBytes n={it.size} />
          </span>
        </div>
        <a className="sf-file-dl" href={dataUrl} download={safeName}>
          Download
        </a>
      </div>
    );
  }

  // Text-like preview
  const isTextLike =
    mime.startsWith("text/") ||
    ["application/json", "application/xml", "application/svg+xml"].includes(mime);

  let previewText: string | null = null;
  if (isTextLike) {
    try {
      const raw = atob(it.data_b64url.replace(/-/g, "+").replace(/_/g, "/"));
      previewText = raw.slice(0, 1200);
    } catch {
      previewText = null;
    }
  }

  return (
    <div className="sf-file">
      <div className="sf-file-head">
        <div className="sf-file-name">{it.relPath || safeName}</div>
        <div className="sf-file-size">
          <PrettyBytes n={it.size} />
        </div>
      </div>

      {previewText && (
        <pre className="sf-file-pre" aria-label={`${safeName} preview`}>
          {previewText}
          {previewText.length >= 1200 ? "\n… (truncated preview)" : ""}
        </pre>
      )}

      <div className="sf-file-foot">
        <code className="sf-hash mono">sha256:{it.sha256}</code>
        <a className="sf-file-dl" href={dataUrl} download={safeName}>
          Download
        </a>
      </div>
    </div>
  );
}

function FileRefCard({ it }: { it: AttachmentFileRef }): React.JSX.Element {
  const safeName = it.name || "file";

  return (
    <div className="sf-fileref">
      <div className="sf-file-head">
        <div className="sf-file-name">{it.relPath || safeName}</div>
        <div className="sf-file-size">
          <PrettyBytes n={it.size} />
        </div>
      </div>

      <div className="sf-file-foot">
        <div className="sf-file-type">{it.type || "application/octet-stream"}</div>
        <code className="sf-hash mono">sha256:{it.sha256}</code>
      </div>

      <div className="sf-note">
        Large file not inlined. Host by hash anywhere and add the public URL as an attachment link.
      </div>
    </div>
  );
}

/* ---------- Public components ---------- */
export function AttachmentCard({ item }: { item: AttachmentItem }): React.JSX.Element {
  if (item.kind === "url") {
    return <UrlEmbed url={item.url} title={item.title} />;
  }
  if (item.kind === "file-inline") {
    return <InlineFileCard it={item} />;
  }
  return <FileRefCard it={item} />;
}

export function AttachmentGallery({
  manifest,
}: {
  manifest: AttachmentManifest;
}): React.JSX.Element | null {
  if (!manifest.items.length) return null;

  return (
    <section className="sf-attachments" aria-labelledby="sf-att-title">
      <h3 id="sf-att-title" className="sf-att-title">
        Attachments
      </h3>

      <div className="sf-att-grid">
        {manifest.items.map((it, i) => (
          <div className="sf-att-item" key={i}>
            <AttachmentCard item={it} />
          </div>
        ))}
      </div>

      <div className="sf-att-foot">
        <span>
          Total:{" "}
          <strong>
            <PrettyBytes n={manifest.totalBytes} />
          </strong>
        </span>

        {typeof manifest.inlinedBytes === "number" && manifest.inlinedBytes > 0 && (
          <span>
            {" "}
            • Inlined:{" "}
            <strong>
              <PrettyBytes n={manifest.inlinedBytes} />
            </strong>
          </span>
        )}
      </div>
    </section>
  );
}
