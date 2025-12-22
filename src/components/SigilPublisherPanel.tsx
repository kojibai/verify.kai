// src/components/SigilPublisherPanel.tsx
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useSigilSession } from "./session/useSigilSession";
import { getKaiNow } from "../kai/KaiNow";
import { withCapsuleInUrl, type Capsule } from "../utils/sigilCapsule";
import { sha256Hex } from "../utils/hash";
import { GENESIS_TS, PULSE_MS, STEPS_BEAT, kairosEpochNow } from "../utils/kai_pulse";
import "./SigilPublisherPanel.css";
import SealMomentModal from "./SealMomentModal";

/* ───────────────────────── timer handle types (browser) ───────────────────────── */
type TimeoutHandle = number;

/* ───────────────────────── helpers ───────────────────────── */

function short(s: string, head = 12, tail = 4): string {
  return s.length <= head + tail ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function extractTags(text: string): string[] {
  // allow letters, numbers, underscore, dash (unicode letters/digits via \p{L}\p{N})
  const rx = /#([\p{L}\p{N}_-]{1,48})/gu;
  const out = new Set<string>();
  let m: RegExpExecArray | null = rx.exec(text);
  while (m) {
    out.add(m[1]);
    m = rx.exec(text);
  }
  return [...out];
}

/* precise type guards (no any) */
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isString = (v: unknown): v is string => typeof v === "string";
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";

type Draft = {
  title: string;
  text: string;
  mediaLines: string; // 1 per line
  shareToLocalFeed: boolean;
  includeCanonicalHash: boolean;
};

const EMPTY_DRAFT: Draft = {
  title: "",
  text: "",
  mediaLines: "",
  shareToLocalFeed: true,
  includeCanonicalHash: true,
};

function isDraft(v: unknown): v is Draft {
  if (!isRecord(v)) return false;
  const { title, text, mediaLines, shareToLocalFeed, includeCanonicalHash } = v;
  return (
    isString(title) &&
    isString(text) &&
    isString(mediaLines) &&
    isBoolean(shareToLocalFeed) &&
    isBoolean(includeCanonicalHash)
  );
}

function useDraft(key: string, initial: Draft) {
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      return isDraft(parsed) ? parsed : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(key, JSON.stringify(draft));
      }
    } catch {
      /* non-fatal: ignore quota/private mode */
    }
  }, [key, draft]);

  const reset = useCallback(() => setDraft(initial), [initial]);
  return { draft, setDraft, reset };
}

type KaiMoment = {
  pulse: number;
  beat: number;
  stepIndex: number;
  stepPct: number;
  chakraDay: string;
};

/* ───────────────────────── Kai-boundary alignment ─────────────────────────
   We align scheduling to Genesis-based φ boundaries:
     boundary_n = GENESIS_TS + n * PULSE_MS
   and always schedule the next boundary from the current epochNowMs().
------------------------------------------------------------------------- */

const epochNowMs = (): number => {
  // kairosEpochNow may be bigint in your spec; Number() is safe for epoch ms (~1e12).
  return Number(kairosEpochNow());
};

const computeNextBoundary = (nowMs: number): number => {
  const elapsed = nowMs - GENESIS_TS;
  const periods = Math.ceil(elapsed / PULSE_MS);
  return GENESIS_TS + periods * PULSE_MS;
};

function useKaiTicker(): KaiMoment {
  const [now, setNow] = useState<KaiMoment>(() => getKaiNow());

  const timeoutRef = useRef<TimeoutHandle | null>(null);
  const targetBoundaryRef = useRef<number>(0);

  const clear = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const schedule = useCallback(() => {
    clear();

    // Seed boundary target from "now"
    const startNow = epochNowMs();
    targetBoundaryRef.current = computeNextBoundary(startNow);

    const fire = () => {
      const nowMs = epochNowMs();
      const nextBoundary = targetBoundaryRef.current;

      // If we haven't reached the target boundary yet, wait until we do.
      if (nowMs < nextBoundary) {
        timeoutRef.current = window.setTimeout(
          fire,
          Math.max(0, Math.round(nextBoundary - nowMs))
        );
        return;
      }

      // We are at/after boundary: advance boundary target by missed intervals.
      const missed = Math.floor((nowMs - nextBoundary) / PULSE_MS) + 1;
      targetBoundaryRef.current = nextBoundary + missed * PULSE_MS;

      // Tick state using your canonical Kai engine
      setNow(getKaiNow());

      // Schedule next boundary precisely
      const delay = Math.max(0, Math.round(targetBoundaryRef.current - nowMs));
      timeoutRef.current = window.setTimeout(fire, delay);
    };

    // Immediate sync (no UI lag), then schedule to the computed boundary
    timeoutRef.current = window.setTimeout(() => {
      setNow(getKaiNow());
      const nowMs = epochNowMs();
      const delay = Math.max(0, Math.round(targetBoundaryRef.current - nowMs));
      timeoutRef.current = window.setTimeout(fire, delay);
    }, 0);
  }, [clear]);

  useEffect(() => {
    schedule();

    const onVisOrFocus = () => {
      if (document.visibilityState === "visible") schedule();
    };

    document.addEventListener("visibilitychange", onVisOrFocus);
    window.addEventListener("focus", onVisOrFocus);

    return () => {
      document.removeEventListener("visibilitychange", onVisOrFocus);
      window.removeEventListener("focus", onVisOrFocus);
      clear();
    };
  }, [schedule, clear]);

  return now;
}

/* ───────────────────────── component ───────────────────────── */

export default function SigilPublisherPanel(props: { appGlyphUrl?: string }) {
  const { appGlyphUrl } = props;
  const { session } = useSigilSession();
  const moment = useKaiTicker();

  // Modal state + minted info
  const [minted, setMinted] = useState<string>("");
  const [mintHash, setMintHash] = useState<string>("");
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [isMinting, setIsMinting] = useState(false);
  const [status, setStatus] = useState<string>("");
  const statusRef = useRef<HTMLDivElement | null>(null);

  const titleId = useId();
  const textId = useId();
  const mediaId = useId();
  const shareId = useId();
  const canonId = useId();

  // Prefer session.appId; else derive from provided URL or current location.
  const appId = useMemo(() => {
    if (session?.appId) return session.appId;
    try {
      const base =
        appGlyphUrl ??
        (typeof window !== "undefined" ? window.location.href : "https://example.org/");
      const u = new URL(base);
      const parts = u.pathname.split("/").filter(Boolean);
      return parts[0] === "s" && parts.length >= 2 ? parts[1] : "";
    } catch {
      return "";
    }
  }, [session?.appId, appGlyphUrl]);

  // Draft state per (appId + userPhiKey) scope
  const draftKey = useMemo(() => {
    const user = session?.userPhiKey ?? "anon";
    return `sigil:draft:${appId}:${user}`;
  }, [appId, session?.userPhiKey]);

  const { draft, setDraft, reset } = useDraft(draftKey, EMPTY_DRAFT);

  const tags = useMemo(() => extractTags(draft.text), [draft.text]);

  const mediaList = useMemo(
    () =>
      draft.mediaLines
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && isValidHttpUrl(s))
        .slice(0, 6),
    [draft.mediaLines]
  );

  const charCount = draft.text.trim().length;
  const titleCount = draft.title.trim().length;

  const canMint =
    !!session &&
    charCount > 0 &&
    charCount <= 4000 &&
    titleCount <= 140 &&
    appId.length > 0;

  const setLiveStatus = useCallback((msg: string) => {
    setStatus(msg);
    if (statusRef.current) statusRef.current.textContent = msg;
  }, []);

  // SAFE onChange handlers
  const onTitleChange = useCallback(
    (ev: React.ChangeEvent<HTMLInputElement>) => {
      const v = ev.currentTarget.value;
      setDraft((d) => ({ ...d, title: v }));
    },
    [setDraft]
  );

  const onTextChange = useCallback(
    (ev: React.ChangeEvent<HTMLTextAreaElement>) => {
      const v = ev.currentTarget.value;
      setDraft((d) => ({ ...d, text: v }));
    },
    [setDraft]
  );

  const onMediaChange = useCallback(
    (ev: React.ChangeEvent<HTMLTextAreaElement>) => {
      const v = ev.currentTarget.value;
      setDraft((d) => ({ ...d, mediaLines: v }));
    },
    [setDraft]
  );

  const onShareChange = useCallback(
    (ev: React.ChangeEvent<HTMLInputElement>) => {
      const checked = ev.currentTarget.checked;
      setDraft((d) => ({ ...d, shareToLocalFeed: checked }));
    },
    [setDraft]
  );

  const onCanonChange = useCallback(
    (ev: React.ChangeEvent<HTMLInputElement>) => {
      const checked = ev.currentTarget.checked;
      setDraft((d) => ({ ...d, includeCanonicalHash: checked }));
    },
    [setDraft]
  );

  const onMint = useCallback(async () => {
    if (!session) {
      alert("Login with your user glyph first.");
      return;
    }
    if (!canMint) {
      alert("Please write something first.");
      return;
    }
    if (session.expiresAtPulse && moment.pulse > session.expiresAtPulse) {
      alert("Login glyph expired (pulse window). Re-mint login.");
      return;
    }

    setIsMinting(true);
    setLiveStatus("Sealing capsule…");

    try {
      const kind = "post" as const;

      const nonce =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID().slice(0, 8)
          : Math.random().toString(36).slice(2, 10);

      const basis = `${appId}|${session.userPhiKey}|${moment.pulse}|${moment.beat}|${moment.stepIndex}|${kind}|${nonce}`;
      const compositeId = (await sha256Hex(basis)).slice(0, 16);

      const media =
        mediaList.length > 0
          ? mediaList.map((url) => ({ kind: "url" as const, url }))
          : undefined;

      const iso = new Date(epochNowMs()).toISOString();

      const capsule: Capsule = {
        v: 1,
        kind,
        appId,
        userId: session.userPhiKey,
        pulse: moment.pulse,
        beat: moment.beat,
        stepIndex: moment.stepIndex,
        userPhiKey: session.userPhiKey,
        kaiSignature: session.kaiSignature,
        post: {
          title: draft.title.trim() || undefined,
          text: draft.text.trim(),
          tags: tags.length ? tags : undefined,
          media,
        },
        nonce,
        timestamp: iso,
        ...(draft.includeCanonicalHash ? { canonicalHash: appId } : {}),
      };

      const path = `/s/${appId}/${session.userPhiKey}/${moment.pulse}/${moment.beat}/${moment.stepIndex}/${kind}/${compositeId}`;
      const url = withCapsuleInUrl(path, capsule);

      // Persist to local feed pool for immediate viewer pickup
      if (draft.shareToLocalFeed) {
        try {
          const key = "sigil:feed:sources";
          const raw = (typeof localStorage !== "undefined" && localStorage.getItem(key)) || "[]";
          const prev = JSON.parse(raw) as unknown;

          const prevArr: string[] = Array.isArray(prev)
            ? prev.filter((x): x is string => typeof x === "string")
            : [];

          const next = Array.from(new Set([url, ...prevArr]));

          if (typeof localStorage !== "undefined") {
            localStorage.setItem(key, JSON.stringify(next));
          }
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("sigil:published", { detail: { url } }));
          }
        } catch (e: unknown) {
          // eslint-disable-next-line no-console
          console.warn(
            "Local feed cache/broadcast failed:",
            e instanceof Error ? e.message : String(e)
          );
        }
      }

      // OPEN THE MODAL with the minted URL + hash
      setMinted(url);
      setMintHash(compositeId);
      setIsModalOpen(true);

      setLiveStatus("Minted ✓");
      // reset text but keep toggles for flow
      setDraft((d) => ({ ...d, text: "", mediaLines: "" }));
    } catch (e: unknown) {
      setLiveStatus(`Mint failed: ${e instanceof Error ? e.message : String(e)}`);
      // eslint-disable-next-line no-console
      console.error(e);
    } finally {
      setIsMinting(false);
      window.setTimeout(() => setLiveStatus(""), 1400);
    }
  }, [
    session,
    canMint,
    appId,
    moment.pulse,
    moment.beat,
    moment.stepIndex,
    mediaList,
    draft.title,
    draft.text,
    draft.shareToLocalFeed,
    draft.includeCanonicalHash,
    setDraft,
    setLiveStatus,
    tags,
  ]);

  // Keyboard: Cmd/Ctrl + Enter => Mint
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canMint) {
        e.preventDefault();
        void onMint();
      }
    },
    [canMint, onMint]
  );

  // Export for modal “download”
  const downloadMintInfo = useCallback(() => {
    if (!minted) return;

    const iso = new Date(epochNowMs()).toISOString();

    const payload = {
      url: minted,
      hash: mintHash,
      appId,
      pulse: moment.pulse,
      beat: moment.beat,
      stepIndex: moment.stepIndex,
      title: draft.title.trim() || undefined,
      text: draft.text.trim() || undefined,
      tags: tags.length ? tags : undefined,
      media: mediaList,
      timestamp: iso,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    const blobUrl = URL.createObjectURL(blob);

    a.href = blobUrl;
    a.download = `sigil-mint-${mintHash || "post"}.json`;

    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(blobUrl);
  }, [
    minted,
    mintHash,
    appId,
    moment.pulse,
    moment.beat,
    moment.stepIndex,
    draft.title,
    draft.text,
    tags,
    mediaList,
  ]);

  /* ───────────────────────── UI ───────────────────────── */

  const pulsePct = useMemo(
    () => (STEPS_BEAT > 1 ? (moment.stepIndex / (STEPS_BEAT - 1)) * 100 : 0),
    [moment.stepIndex]
  );

  const disabledReason = useMemo(() => {
    if (!session) return "Login with your glyph to mint.";
    if (!appId) return "Missing app glyph context.";
    if (!draft.text.trim()) return "Write something first.";
    if (session.expiresAtPulse && moment.pulse > session.expiresAtPulse) return "Session expired; re-login.";
    return "";
  }, [session, appId, draft.text, moment.pulse]);

  return (
    <>
      <section className="publisher ks-panel" data-beat={moment.beat}>
        <header className="ks-head">
          <div className="ks-head-left">
            <h3 className="ks-title">Publish to Glyph Stream (Coming SOON!)</h3>
            <p className="ks-meta">
              App: <span className="mono">{short(appId)}</span>
              {session ? (
                <>
                  {" "}
                  • User: <span className="mono">{short(session.userPhiKey)}</span>
                </>
              ) : null}
            </p>
          </div>

          <div className="ks-head-right">
            <div
              className="ks-pulse"
              role="img"
              aria-label={`Pulse ${moment.pulse}, Beat ${moment.beat}, Step ${moment.stepIndex}, Chakra ${moment.chakraDay}`}
              title={`Pulse ${moment.pulse} • Beat ${moment.beat} • Step ${moment.stepIndex} • ${moment.chakraDay}`}
            >
              <div className="ks-pulse-bar">
                <div className="ks-pulse-fill" style={{ width: `${pulsePct.toFixed(1)}%` }} />
              </div>
              <div className="ks-pulse-meta">
                <span>u{moment.pulse}</span>
                <span>b{moment.beat}</span>
                <span>s{moment.stepIndex}</span>
                <span className="ks-chakra">{moment.chakraDay}</span>
              </div>
            </div>
          </div>
        </header>

        <div className="ks-form">
          <div className="ks-row">
            <label htmlFor={titleId} className="ks-label">
              Title <span className="ks-optional">(optional)</span>
            </label>
            <input
              id={titleId}
              className="ks-input"
              type="text"
              value={draft.title}
              onChange={onTitleChange}
              onKeyDown={onKeyDown}
              maxLength={140}
              placeholder="A crisp resonance headline…"
              aria-describedby={`${titleId}-count`}
            />
            <div id={`${titleId}-count`} className="ks-count">
              {titleCount}/140
            </div>
          </div>

          <div className="ks-row">
            <label htmlFor={textId} className="ks-label">
              Post
            </label>
            <textarea
              id={textId}
              className="ks-textarea"
              rows={5}
              value={draft.text}
              onChange={onTextChange}
              onKeyDown={onKeyDown}
              maxLength={4000}
              placeholder="Breathe once, then write…  (#tags supported)"
              aria-describedby={`${textId}-count`}
            />
            <div id={`${textId}-count`} className="ks-count">
              {charCount}/4000
            </div>
          </div>

          <div className="ks-row">
            <label htmlFor={mediaId} className="ks-label">
              Media URLs <span className="ks-optional">(optional)</span>
            </label>
            <textarea
              id={mediaId}
              className="ks-textarea mono"
              rows={2}
              value={draft.mediaLines}
              onChange={onMediaChange}
              onKeyDown={onKeyDown}
              placeholder="https://… (one per line, up to 6)"
            />
            {mediaList.length > 0 && (
              <div className="ks-media-preview">
                {mediaList.map((u) => (
                  <a key={u} className="ks-chip" href={u} target="_blank" rel="noreferrer" title={u}>
                    {new URL(u).host}
                  </a>
                ))}
              </div>
            )}
          </div>

          <div className="ks-row ks-options">
            <label className="ks-check">
              <input
                id={shareId}
                type="checkbox"
                checked={draft.shareToLocalFeed}
                onChange={onShareChange}
              />
              <span>Mirror to local feed pool</span>
            </label>

            <label className="ks-check">
              <input
                id={canonId}
                type="checkbox"
                checked={draft.includeCanonicalHash}
                onChange={onCanonChange}
              />
              <span>Embed canonicalHash for sanity</span>
            </label>

            {tags.length > 0 && (
              <div className="ks-tags">
                {tags.map((t) => (
                  <span key={t} className="ks-tag">
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="ks-actions">
            <button
              type="button"
              className="ks-btn primary"
              onClick={onMint}
              disabled={!canMint || isMinting}
              title={disabledReason}
            >
              {isMinting ? "Minting…" : "Mint Post Glyph"}
              <span className="ks-kbd">
                ⌘/Ctrl <span className="plus">+</span> Enter
              </span>
            </button>

            <button
              type="button"
              className="ks-btn ghost"
              onClick={reset}
              disabled={isMinting || (!draft.title && !draft.text && !draft.mediaLines)}
              title="Clear draft"
            >
              Clear Draft
            </button>

            {minted && (
              <>
                <a className="ks-btn" href={minted} target="_blank" rel="noreferrer">
                  Open
                </a>
                <button
                  type="button"
                  className="ks-btn"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(minted);
                      setLiveStatus("URL copied");
                      window.setTimeout(() => setLiveStatus(""), 1000);
                    } catch (e: unknown) {
                      // eslint-disable-next-line no-console
                      console.warn("Remember failed:", e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  Remember
                </button>
              </>
            )}
          </div>

          <div className="ks-status" role="status" aria-live="polite" ref={statusRef}>
            {status}
          </div>

          {minted && (
            <div className="ks-minted mono" data-testid="minted-url">
              {minted}
            </div>
          )}
        </div>
      </section>

      {/* ── Modal pops automatically after a successful mint ── */}
      <SealMomentModal
        open={isModalOpen}
        url={minted}
        hash={mintHash}
        onClose={() => setIsModalOpen(false)}
        onDownloadZip={downloadMintInfo}
      />
    </>
  );
}
