// src/pages/sigilstream/SigilStreamRoot.tsx
"use client";

/**
 * SigilStreamRoot — Memory Stream Shell
 * v6.1 — /p~ alias + lineage bridge into Sigil Explorer
 *
 * - Accepts:
 *     • Canonical: /stream/p/<token>[?add=<parentUrl>]
 *     • Short alias: /p~<token>
 *     • Legacy:     /p#t=<token>, /p?t=<token>
 *
 * - Seeds list from:
 *     • /links.json (static seeds)
 *     • localStorage[LS_KEY] (recent inhaled links)
 *
 * - Lineage + Explorer bridge:
 *     • Any payload URL decoded from the path is registered via sigilRegistry.
 *     • Any inhaled URL (via ?add/#add or the Inhaler UI) is registered.
 *     • Explorer then reconstructs ancestry via resolveLineageBackwards.
 */

import React, { useEffect, useMemo, useState } from "react";
import "./styles/sigilstream.css";

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
import { coerceAuth, readStringProp, report } from "./core/utils";

/* Payload */
import { usePayload } from "./payload/usePayload";
import { PayloadBanner } from "./payload/PayloadBanner";

/* Identity */
import { IdentityBar } from "./identity/IdentityBar";
import { SigilActionUrl } from "./identity/SigilActionUrl";

/* Inhaler / Composer / Status / List */
import { InhaleSection } from "./inhaler/InhaleSection";
import { Composer } from "./composer/Composer";
import { KaiStatus } from "./status/KaiStatus";
import { StreamList } from "./list/StreamList";

/* External app hooks (existing app) */
import SigilLogin from "../../components/KaiVoh/SigilLogin";
import { useSigilAuth } from "../../components/KaiVoh/SigilAuthContext";

/* Existing util from app space (payload token extractor) */
import { extractPayloadToken } from "../../utils/feedPayload";

/* Explorer bridge: register any stream/sigil URL */
import { registerSigilUrl } from "../../utils/sigilRegistry";

/** Simple source shape */
type Source = { url: string };

export function SigilStreamRoot(): React.JSX.Element {
  // Providers at top-level so children may use toasts + sigil auth context.
  return (
    <ToastsProvider>
      <SigilAuthProvider>
        <SigilStreamInner />
      </SigilAuthProvider>
    </ToastsProvider>
  );
}

/** Inner component that consumes Toasts + SigilAuth context */
function SigilStreamInner(): React.JSX.Element {
  const toasts = useToasts();

  /** ---------- Sources list (seed + storage + ?add ingestion) ---------- */
  const [sources, setSources] = useState<Source[]>([]);

  // Seed from /links.json and localStorage
  useEffect(() => {
    (async () => {
      try {
        const seed = await loadLinksJson();
        const stored = parseStringArray(
          typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null,
        );

        const merged: Source[] = [...stored.map((u) => ({ url: u })), ...seed];
        const seen = new Set<string>();
        const unique = merged.filter(({ url }) =>
          seen.has(url) ? false : (seen.add(url), true),
        );

        setSources(unique);

        // Bridge: make sure Explorer knows about all seeded/stored URLs.
        for (const { url } of unique) {
          registerSigilUrl(url);
        }
      } catch (e) {
        report("initial seed load", e);
      }
    })().catch((e) => report("initial seed load outer", e));
  }, []);

  // Ingest ?add= and #add= (supports /p~ legacy normalization)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const search = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(
        window.location.hash.startsWith("#")
          ? window.location.hash.slice(1)
          : window.location.hash,
      );
      const addsRaw = [...search.getAll("add"), ...hash.getAll("add")];
      const adds = addsRaw.map(normalizeAddParam).filter(Boolean);
      if (adds.length === 0) return;

      setSources((prev) => {
        const seen = new Set(prev.map((s) => s.url));
        const fresh = adds.filter((u) => !seen.has(u));
        if (fresh.length) {
          prependUniqueToStorage(fresh);

          for (const u of fresh) {
            registerSigilUrl(u);
          }

          return [...fresh.map((u) => ({ url: u })), ...prev];
        }
        return prev;
      });
    } catch (e) {
      report("add ingestion", e);
    }
  }, []);

  /** ---------- Payload (decoded from path token) ---------- */
  const { payload, payloadKai, payloadError, payloadAttachments } = usePayload(
    setSources,
  );

  // Bridge: any payload URL (canonical or alias) should be registered.
  useEffect(() => {
    if (payload && typeof payload.url === "string" && payload.url.length) {
      registerSigilUrl(payload.url);
    }
  }, [payload]);

  // Derived list: show payload first if present
  const urls: string[] = useMemo(() => {
    if (!payload) return sources.map((s) => s.url);
    const rest = sources.filter((s) => s.url !== payload.url).map((s) => s.url);
    return [payload.url, ...rest];
  }, [sources, payload]);

  /** ---------- Verified session flag (per-thread) ---------- */
  const sessionKey = useMemo(() => {
    if (typeof window === "undefined") return "sf.verifiedSession:root";
    const token = extractPayloadToken(window.location.pathname) || "root";
    return `sf.verifiedSession:${token}`;
  }, []);

  const [verifiedThisSession, setVerifiedThisSession] = useState<boolean>(() => {
    try {
      return (
        typeof window !== "undefined" &&
        sessionStorage.getItem(sessionKey) === "1"
      );
    } catch (e) {
      report("sessionStorage.getItem", e);
      return false;
    }
  });

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

  const composerMeta = useMemo(
    () => (verifiedThisSession ? authLike.meta : null),
    [verifiedThisSession, authLike.meta],
  );
  const composerSvgText = useMemo(
    () => (verifiedThisSession ? authLike.svgText : null),
    [verifiedThisSession, authLike.svgText],
  );

  // Chips
  const composerPhiKey = useMemo(
    () => (composerMeta ? readStringProp(composerMeta, "userPhiKey") : undefined),
    [composerMeta],
  );
  const composerKaiSig = useMemo(
    () =>
      composerMeta ? readStringProp(composerMeta, "kaiSignature") : undefined,
    [composerMeta],
  );

  /** ---------- Inhaler: add a link to list (with LS persistence + Explorer) ---------- */
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

  /** ---------- Render ---------- */
  const sigilBlock =
    verifiedThisSession && (composerMeta || composerSvgText)
      ? SigilActionUrl({ meta: composerMeta, svgText: composerSvgText || "" })
      : null;

  return (
    <main
      className="sf"
      style={{
        maxWidth: "100vw",
        overflowX: "clip",
        paddingInline:
          "max(var(--space-2, 13px), env(safe-area-inset-left, 0px))",
      }}
    >
      <header className="sf-head" role="region" aria-labelledby="glyph-stream-title">
        <h1 id="glyph-stream-title" style={{ wordBreak: "break-word" }}>
          Memory Stream
        </h1>

        <KaiStatus />

        {payload ? (
          <PayloadBanner
            payload={payload}
            payloadKai={payloadKai ?? null}
            payloadAttachments={payloadAttachments ?? null}
            payloadError={null}
          />
        ) : payloadError ? (
          <div className="sf-error" role="alert">
            {payloadError}
          </div>
        ) : (
          <p
            className="sf-sub"
            style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
          >
            Open a payload link at <code>/stream/p/&lt;token&gt;</code>. Replies are
            Kai-sealed and thread via <code>?add=</code>. Short alias accepted:{" "}
            <code>/p~&lt;token&gt;</code> (and legacy <code>/p#t=</code>,{" "}
            <code>/p?t=</code>).
          </p>
        )}

        {!payload && (
          <section
            className="sf-inhaler"
            aria-labelledby="inhaler-title"
            style={{ marginTop: "1rem" }}
          >
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
              <Composer
                meta={composerMeta}
                svgText={composerSvgText}
                onUseDifferentKey={onResetVerified}
              />
            )}
          </section>
        )}
      </header>

      <section className="sf-list">
        {urls.length === 0 ? (
          <div className="sf-empty">
            No items yet. Paste a link above or open a{" "}
            <code>/stream/p/&lt;payload&gt;</code> link and reply to start a thread.
          </div>
        ) : (
          <StreamList urls={urls} />
        )}
      </section>
    </main>
  );
}

export default SigilStreamRoot;
