// src/shortner/index.tsx
"use client";

/**
 * Shortner Index Route
 * - If current path is /go/<code> → expands deterministically and redirects
 * - Otherwise renders the ShortUrlTool UI for generating a deterministic short link
 *
 * Drop this component wherever you want later (router or no-router).
 */

import * as React from "react";
import { ShortRedirect } from "./ShortRedirect";
import { ShortUrlTool } from "./ShortUrlTool";
import type { KaiPhiCodecOptions } from "./kaiPhiShort";

export type ShortnerIndexProps = {
  /** Redirect route prefix. Short links will be minted under this path. */
  routePrefix?: string; // default "/go/"
  /** Optional: force a base origin when generating short URLs */
  baseOrigin?: string;
  /** Codec behavior (compression/obfuscation/relative packing) */
  codec?: KaiPhiCodecOptions;
  /** Optional: prefill from query (?u=... or ?url=...) */
  prefillFromQuery?: boolean;
  /** Optional: direct prefill URL override */
  url?: string;
  className?: string;
};

export default function ShortnerIndex({
  routePrefix = "/go/",
  baseOrigin,
  codec,
  prefillFromQuery = true,
  url,
  className,
}: ShortnerIndexProps): React.JSX.Element {
  const [mode, setMode] = React.useState<"redirect" | "tool">("tool");
  const [prefill, setPrefill] = React.useState<string>(url ?? "");

  React.useEffect(() => {
    const prefix = normalizePrefix(routePrefix);
    const path = window.location.pathname || "/";

    if (path.startsWith(prefix) && path.length > prefix.length) {
      setMode("redirect");
      return;
    }

    setMode("tool");

    if (url) {
      setPrefill(url);
      return;
    }

    if (prefillFromQuery) {
      const q = new URLSearchParams(window.location.search);
      const u = (q.get("u") || q.get("url") || "").trim();
      if (u) setPrefill(u);
    }
  }, [routePrefix, prefillFromQuery, url]);

  if (mode === "redirect") {
    return (
      <ShortRedirect
        routePrefix={routePrefix}
        codec={codec}
        render={({ status, error }) => (
          <div
            className={className}
            style={{
              minHeight: "100dvh",
              display: "grid",
              placeItems: "center",
              padding: 16,
              textAlign: "center",
            }}
          >
            {status === "loading" ? (
              <div style={{ opacity: 0.9, fontWeight: 800 }}>Sealing redirect…</div>
            ) : (
              <div style={{ maxWidth: 720 }}>
                <div style={{ fontWeight: 900, fontSize: 18, color: "#ffb4b4" }}>
                  Short link failed
                </div>
                <div style={{ marginTop: 10, opacity: 0.9 }}>{error}</div>
              </div>
            )}
          </div>
        )}
      />
    );
  }

  return (
    <div
      className={className}
      style={{
        minHeight: "100dvh",
        padding: 16,
        display: "grid",
        alignContent: "start",
        gap: 14,
        maxWidth: 980,
        margin: "0 auto",
      }}
    >
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ fontWeight: 950, fontSize: 18, letterSpacing: 0.2 }}>
          KaiΦ Deterministic Shortner
        </div>
        <div style={{ opacity: 0.8, fontSize: 13 }}>
          Serverless. Cacheless. Exact round-trip. Short link redirects to the full URL.
        </div>
      </div>

      <ShortUrlTool
        url={prefill}
        routePrefix={routePrefix}
        baseOrigin={baseOrigin}
        codec={codec}
      />

      <details style={{ opacity: 0.85, fontSize: 12 }}>
        <summary style={{ cursor: "pointer" }}>How to use</summary>
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <div>
            1) Paste a full <code>/stream/p/...</code> URL → click <b>Shorten</b>.
          </div>
          <div>
            2) Share the minted link (it will look like <code>{normalizePrefix(routePrefix)}&lt;code&gt;</code>).
          </div>
          <div>
            3) When opened in a browser, it expands deterministically and redirects to the exact full URL.
          </div>
          <div style={{ opacity: 0.8 }}>
            Tip: you can prefill by opening this page with <code>?u=&lt;fullUrl&gt;</code>.
          </div>
        </div>
      </details>
    </div>
  );
}

function normalizePrefix(prefix: string): string {
  let p = (prefix || "/go/").trim();
  if (!p.startsWith("/")) p = `/${p}`;
  if (!p.endsWith("/")) p = `${p}/`;
  return p;
}

// Optional named exports (nice for later wiring)
export { ShortUrlTool } from "./ShortUrlTool";
export { ShortRedirect } from "./ShortRedirect";
