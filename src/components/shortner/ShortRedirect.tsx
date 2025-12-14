// src/shortner/ShortRedirect.tsx
"use client";

import * as React from "react";
import { kaiPhiExpandCode, type KaiPhiCodecOptions } from "./kaiPhiShort";

type RedirectState = { status: "loading" | "error"; error?: string };

type Props = {
  /**
   * If you’re not using a router yet, you can pass the code directly.
   * If omitted, it will parse from the URL path: /go/<code>
   */
  code?: string;
  /** If parsing from path, what prefix should we strip? */
  routePrefix?: string; // default "/go/"
  codec?: KaiPhiCodecOptions;
  /** Optional: render something while redirecting */
  render?: (state: RedirectState) => React.ReactNode;
};

export function ShortRedirect({
  code,
  routePrefix = "/go/",
  codec,
  render,
}: Props): React.JSX.Element {
  const [err, setErr] = React.useState<string>("");

  React.useEffect(() => {
    let alive = true;

    const run = async (): Promise<void> => {
      try {
        const c = String(code ?? parseCodeFromPath(routePrefix)).trim();
        if (!c) throw new Error("Missing short code.");

        const fullUrl = await kaiPhiExpandCode(c, codec);

        // Redirect (replace avoids back-button loops)
        window.location.replace(fullUrl);
      } catch (e: unknown) {
        if (!alive) return;
        setErr(getErrorMessage(e, "Redirect failed."));
      }
    };

    void run();

    return () => {
      alive = false;
    };
  }, [code, routePrefix, codec]);

  if (render) {
    return <>{render({ status: err ? "error" : "loading", error: err || undefined })}</>;
  }

  return (
    <div style={{ padding: 16, opacity: 0.9 }}>
      {!err ? (
        <div>Redirecting…</div>
      ) : (
        <div style={{ color: "#ffb4b4" }}>
          <div style={{ fontWeight: 800 }}>Short link failed</div>
          <div style={{ marginTop: 8 }}>{err}</div>
        </div>
      )}
    </div>
  );
}

function parseCodeFromPath(routePrefix: string): string {
  const prefix = normalizePrefix(routePrefix);
  const path = window.location.pathname || "/";
  if (!path.startsWith(prefix)) return "";

  // "/go/<code>" → "<code>"
  const rest = path.slice(prefix.length);
  return rest.replace(/^\/+/, "");
}

function normalizePrefix(routePrefix: string): string {
  let p = String(routePrefix || "/go/").trim();
  if (!p.startsWith("/")) p = `/${p}`;
  if (!p.endsWith("/")) p = `${p}/`;
  return p;
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
