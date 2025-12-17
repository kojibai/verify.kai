// src/pages/sigilstream/attachments/embeds.tsx
"use client";

/* ─────────────────────────────────────────────────────────────
   Local helpers (URL parsing + file-type detection)
   ───────────────────────────────────────────────────────────── */

function extFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").pop() || "";
    const dot = last.lastIndexOf(".");
    return dot >= 0 ? last.slice(dot + 1).toLowerCase() : "";
  } catch {
    return "";
  }
}

function isImageExt(ext: string): boolean {
  return ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"].includes(ext);
}

function isVideoExt(ext: string): boolean {
  return ["mp4", "webm", "ogg", "ogv", "mov", "m4v"].includes(ext);
}

function isPdfExt(ext: string): boolean {
  return ext === "pdf";
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** Display helper: remove scheme, hide hash (often huge), trim trailing slash. */
function displayUrlNoScheme(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.host;
    let path = u.pathname || "";

    if (path === "/") path = "";
    if (path.endsWith("/") && path.length > 1) path = path.slice(0, -1);

    const qs = u.search || "";
    return `${host}${path}${qs}`;
  } catch {
    return raw.replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
  }
}

function ytIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.slice(1);
      return id || null;
    }
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;

      const parts = u.pathname.split("/").filter(Boolean);
      const idx = parts.indexOf("embed");
      if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    }
    return null;
  } catch {
    return null;
  }
}

function vimeoIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("vimeo.com")) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const idPart = parts.find((p) => /^\d+$/.test(p));
    return idPart || null;
  } catch {
    return null;
  }
}

function spotifyEmbedFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("spotify.com")) return null;

    if (
      u.pathname.startsWith("/track/") ||
      u.pathname.startsWith("/album/") ||
      u.pathname.startsWith("/playlist/")
    ) {
      return `https://open.spotify.com/embed${u.pathname}${u.search}`;
    }
    return null;
  } catch {
    return null;
  }
}

/* ─────────────────────────────────────────────────────────────
   Presentational pieces (CSS is driven entirely by classNames)
   ───────────────────────────────────────────────────────────── */

export function Favicon({ host }: { host: string }): React.JSX.Element {
  const src = `https://${host}/favicon.ico`;
  return (
    <img
      className="sf-favicon"
      src={src}
      alt=""
      width={16}
      height={16}
      loading="eager"
      decoding="async"
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
      }}
    />
  );
}

/** Shared “holy card” shell for ANY URL attachment. */
function EmbedCard(props: {
  url: string;
  title?: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  const { url, title, children } = props;

  const host = hostFromUrl(url);
  const label = (title && title.trim().length ? title.trim() : "") || displayUrlNoScheme(url);

  return (
    <div className="sf-att-card">
      <div className="sf-att-head">
        <a className="sf-att-head__hit" href={url} target="_blank" rel="noopener noreferrer" title={url}>
          {host ? <Favicon host={host} /> : <span className="sf-favicon sf-favicon--blank" aria-hidden="true" />}
          <div className="sf-att-head__text">
            <div className="sf-att-head__title">{label}</div>
          </div>

          <span className="sf-att-open" aria-hidden="true">
            ↗
          </span>
        </a>
      </div>

      {children ? <div className="sf-att-body">{children}</div> : null}
    </div>
  );
}

export function IframeEmbed({ src, title }: { src: string; title: string }): React.JSX.Element {
  return (
    <div className="sf-embed">
      <iframe
        className="sf-embed__frame"
        src={src}
        title={title}
        loading="eager"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
      />
    </div>
  );
}

/** Fallback card: single label (scheme-less), no duplicate URL text. */
export function LinkCard({ url, title }: { url: string; title?: string }): React.JSX.Element {
  return <EmbedCard url={url} title={title} />;
}

/**
 * UrlEmbed renders a smart preview:
 * - YouTube / Vimeo / Spotify → iframe player (inside EmbedCard)
 * - Direct image/video/pdf → inline media (inside EmbedCard)
 * - Otherwise → LinkCard (same EmbedCard)
 */
export function UrlEmbed({ url, title }: { url: string; title?: string }): React.JSX.Element {
  const yt = ytIdFromUrl(url);
  if (yt) {
    return (
      <EmbedCard url={url} title={title}>
        <IframeEmbed src={`https://www.youtube.com/embed/${yt}`} title={title || "YouTube"} />
      </EmbedCard>
    );
  }

  const vimeo = vimeoIdFromUrl(url);
  if (vimeo) {
    return (
      <EmbedCard url={url} title={title}>
        <IframeEmbed src={`https://player.vimeo.com/video/${vimeo}`} title={title || "Vimeo"} />
      </EmbedCard>
    );
  }

  const spot = spotifyEmbedFromUrl(url);
  if (spot) {
    return (
      <EmbedCard url={url} title={title}>
        <IframeEmbed src={spot} title={title || "Spotify"} />
      </EmbedCard>
    );
  }

  const ext = extFromUrl(url);

  if (isImageExt(ext)) {
    return (
      <EmbedCard url={url} title={title}>
        <div className="sf-media sf-media--image">
          <img className="sf-media__img" src={url} alt={title || "image"} loading="eager" decoding="async" />
        </div>
      </EmbedCard>
    );
  }

  if (isVideoExt(ext)) {
    return (
      <EmbedCard url={url} title={title}>
        <div className="sf-media sf-media--video">
          <video className="sf-media__video" src={url} controls playsInline preload="metadata" />
        </div>
      </EmbedCard>
    );
  }

  if (isPdfExt(ext)) {
    return (
      <EmbedCard url={url} title={title}>
        <div className="sf-embed sf-embed--doc">
          <iframe className="sf-embed__frame" src={url} title={title || "Document"} loading="eager" />
        </div>
      </EmbedCard>
    );
  }

  return <LinkCard url={url} title={title} />;
}
