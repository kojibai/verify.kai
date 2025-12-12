// src/pages/PShort.tsx
"use client";

import React, { useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

function stripEdgePunct(s: string): string {
  let t = s.trim();
  t = t.replace(/[)\].,;:!?]+$/g, "");
  t = t.replace(/^[([{"'`]+/g, "");
  return t.trim();
}

function normalizeToken(raw: string): string {
  let t = stripEdgePunct(raw);

  // decode %xx if present
  if (/%[0-9A-Fa-f]{2}/.test(t)) {
    try {
      t = decodeURIComponent(t);
    } catch {
      /* ignore */
    }
  }

  // spaces back to + (some transports)
  if (t.includes(" ")) t = t.replaceAll(" ", "+");

  // base64 -> base64url
  t = t.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
  return stripEdgePunct(t);
}

export default function PShort(): React.JSX.Element {
  const nav = useNavigate();
  const loc = useLocation();
  const params = useParams();

  useEffect(() => {
    // 1) token from /p~<head>/<tail...>
    const head = typeof params.token === "string" ? params.token : "";
    const tail = typeof params["*"] === "string" ? params["*"] : "";
    const joined = head && tail ? `${head}/${tail}` : head || tail;

    // 2) also accept query/hash variants as fallback
    const search = new URLSearchParams(loc.search);
    const hash = new URLSearchParams(
      loc.hash.startsWith("#") ? loc.hash.slice(1) : loc.hash,
    );

    const q =
      search.get("t") ||
      search.get("p") ||
      search.get("token") ||
      hash.get("t") ||
      hash.get("p") ||
      hash.get("token") ||
      "";

    const raw = joined || q;
    if (!raw) return;

    const safe = normalizeToken(raw);

    // Redirect into the canonical SMS-safe alias
    nav(`/p~${safe}`, { replace: true });
  }, [nav, loc.search, loc.hash, params]);

  return (
    <div className="notfound" role="region" aria-label="Redirecting">
      <div className="notfound__title">Redirecting…</div>
      <div className="notfound__hint">Normalizing payload token.</div>
    </div>
  );
}
