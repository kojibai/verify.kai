// src/shortner/ShortUrlTool.tsx
"use client";

import * as React from "react";
import {
  kaiPhiShortenUrl,
  kaiPhiBuildShortUrl,
  type KaiPhiCodecOptions,
} from "./kaiPhiShort";

type Props = {
  /** The full long URL you want to shorten */
  url?: string;
  /** Route prefix for your redirect handler (you’ll wire this later). */
  routePrefix?: string; // default "/go/"
  /** Optional: force a base origin (useful if generating links for a different domain). */
  baseOrigin?: string;
  /** Codec behavior (compression/obfuscation/relative packing) */
  codec?: KaiPhiCodecOptions;
  /** Optional UI label */
  title?: string;
  className?: string;
};

export function ShortUrlTool({
  url,
  routePrefix = "/go/",
  baseOrigin,
  codec,
  title = "KaiΦ Deterministic Short Link",
  className,
}: Props): React.JSX.Element {
  const [input, setInput] = React.useState<string>(url ?? "");
  const [busy, setBusy] = React.useState<boolean>(false);
  const [code, setCode] = React.useState<string>("");
  const [shortUrl, setShortUrl] = React.useState<string>("");
  const [err, setErr] = React.useState<string>("");

  React.useEffect(() => {
    setInput(url ?? "");
  }, [url]);

  const run = React.useCallback(async (): Promise<void> => {
    setErr("");
    setCode("");
    setShortUrl("");

    const u = String(input ?? "").trim();
    if (!u) {
      setErr("Paste a URL first.");
      return;
    }

    setBusy(true);
    try {
      const c = await kaiPhiShortenUrl(u, codec);
      const s = kaiPhiBuildShortUrl(c, routePrefix, baseOrigin);
      setCode(c);
      setShortUrl(s);
    } catch (e: unknown) {
      setErr(getErrorMessage(e, "Failed to shorten."));
    } finally {
      setBusy(false);
    }
  }, [input, codec, routePrefix, baseOrigin]);

  const copy = React.useCallback(async (): Promise<void> => {
    if (!shortUrl) return;

    try {
      await navigator.clipboard.writeText(shortUrl);
      return;
    } catch {
      // fall through to legacy copy
    }

    // Fallback
    const ta = document.createElement("textarea");
    ta.value = shortUrl;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.left = "-1000px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }, [shortUrl]);

  return (
    <div className={className} style={{ display: "grid", gap: 10 }}>
      <div style={{ fontWeight: 700, opacity: 0.9 }}>{title}</div>

      <textarea
        value={input}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
        placeholder="Paste the full /stream/p/... URL here"
        rows={4}
        style={{
          width: "100%",
          padding: 12,
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.16)",
          background: "rgba(0,0,0,0.25)",
          color: "inherit",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 12,
        }}
      />

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.16)",
            background: busy ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.12)",
            color: "inherit",
            cursor: busy ? "not-allowed" : "pointer",
            fontWeight: 700,
          }}
        >
          {busy ? "Sealing…" : "Shorten"}
        </button>

        {shortUrl ? (
          <button
            type="button"
            onClick={() => void copy()}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.16)",
              background: "rgba(255,255,255,0.08)",
              color: "inherit",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            Copy
          </button>
        ) : null}

        {err ? <div style={{ color: "#ffb4b4" }}>{err}</div> : null}
      </div>

      {shortUrl ? (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ opacity: 0.85, fontSize: 12 }}>Short link:</div>
          <a
            href={shortUrl}
            style={{
              padding: 12,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.16)",
              background: "rgba(0,0,0,0.20)",
              color: "inherit",
              textDecoration: "none",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontSize: 12,
              overflowWrap: "anywhere",
            }}
          >
            {shortUrl}
          </a>

          <details style={{ opacity: 0.85 }}>
            <summary style={{ cursor: "pointer" }}>Code</summary>
            <div
              style={{
                marginTop: 8,
                padding: 12,
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.16)",
                background: "rgba(0,0,0,0.20)",
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                fontSize: 12,
                overflowWrap: "anywhere",
              }}
            >
              {code}
            </div>
          </details>
        </div>
      ) : null}
    </div>
  );
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message || fallback;
  if (typeof err === "string") return err || fallback;
  if (typeof err === "object" && err !== null) {
    const rec = err as Record<string, unknown>;
    const msg = rec["message"];
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return fallback;
}
