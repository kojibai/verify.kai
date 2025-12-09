// src/pages/SigilExplorer.tsx
// v3.6 — Holographic Frost edition ✨
// - Matches SealMomentModal colorway (Atlantean Priest-King Holographic Frost)
// - Ultra-responsive, zero overflow, glassy/frosted, refined
// - BroadcastChannel + storage sync + resilient ancestry reconstruction
// - A11y-first: roles, aria labels, keyboard flow, focus styles
// - Branch layout: non-overlapping, two-row node layout, mobile-safe
// - Kai-time ordering: MOST RECENT first (highest pulse at the top)
// - Branch priority: latest Kai moment + node count (bigger trees float higher)
// - Φ display: per-pulse total Φ sent (if any), shown on each node row
// - Node toggle: reveals per-glyph Memory Stream details, even for leaf nodes
// - Detail panel: stacked, mobile-first, page remains scrollable when open

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  extractPayloadFromUrl,
  resolveLineageBackwards,
  getOriginUrl,
} from "../utils/sigilUrl";
import type { SigilSharePayloadLoose } from "../utils/sigilUrl";
import "./SigilExplorer.css";

/* ─────────────────────────────────────────────────────────────────────
   Global typings for the optional hook the modal will call
────────────────────────────────────────────────────────────────────── */
declare global {
  interface Window {
    __SIGIL__?: {
      registerSigilUrl?: (url: string) => void;
      registerSend?: (rec: unknown) => void;
    };
  }
}

/* ─────────────────────────────────────────────────────────────────────
 *  Types
 *  ───────────────────────────────────────────────────────────────────── */
export type SigilNode = {
  url: string;
  payload: SigilSharePayloadLoose;
  children: SigilNode[];
};

type Registry = Map<string, SigilSharePayloadLoose>; // key: absolute URL

type BranchSummary = {
  root: SigilNode;
  nodeCount: number;
  latest: SigilSharePayloadLoose;
};

type DetailEntry = {
  label: string;
  value: string;
};

/* ─────────────────────────────────────────────────────────────────────
 *  Constants / Utilities
 *  ───────────────────────────────────────────────────────────────────── */
const REGISTRY_LS_KEY = "kai:sigils:v1"; // explorer’s persisted URL list
const MODAL_FALLBACK_LS_KEY = "sigil:urls"; // modal’s fallback URL list
const BC_NAME = "kai-sigil-registry";

const hasWindow = typeof window !== "undefined";
const canStorage = hasWindow && typeof window.localStorage !== "undefined";

/** Make an absolute, normalized URL (stable key). */
function canonicalizeUrl(url: string): string {
  try {
    return new URL(
      url,
      hasWindow ? window.location.origin : "https://example.invalid",
    ).toString();
  } catch {
    return url;
  }
}

/** Attempt to parse hash from a /s/:hash URL (for display only). */
function parseHashFromUrl(url: string): string | undefined {
  try {
    const u = new URL(
      url,
      hasWindow ? window.location.origin : "https://example.invalid",
    );
    const m = u.pathname.match(/\/s\/([^/]+)/u);
    return m?.[1] ? decodeURIComponent(m[1]) : undefined;
  } catch {
    return undefined;
  }
}

/** Human shortener for long strings. */
function short(s?: string, n = 10): string {
  if (!s) return "—";
  if (s.length <= n * 2 + 3) return s;
  return `${s.slice(0, n)}…${s.slice(-n)}`;
}

/** Safe compare by pulse/beat/step; ascending (earlier first). */
function byKaiTime(a: SigilSharePayloadLoose, b: SigilSharePayloadLoose): number {
  if ((a.pulse ?? 0) !== (b.pulse ?? 0)) return (a.pulse ?? 0) - (b.pulse ?? 0);
  if ((a.beat ?? 0) !== (b.beat ?? 0)) return (a.beat ?? 0) - (b.beat ?? 0);
  return (a.stepIndex ?? 0) - (b.stepIndex ?? 0);
}

/** Φ formatter — 6dp, trimmed. */
function formatPhi(value: number): string {
  const fixed = value.toFixed(6);
  return fixed.replace(/0+$/u, "").replace(/\.$/u, "");
}

/* ─────────────────────────────────────────────────────────────────────
 *  Global, in-memory registry + helpers
 *  (no backend, can persist to localStorage, and sync via BroadcastChannel)
 *  ───────────────────────────────────────────────────────────────────── */
const memoryRegistry: Registry = new Map();
const channel =
  hasWindow && "BroadcastChannel" in window
    ? new BroadcastChannel(BC_NAME)
    : null;

/** Extract Φ sent from a payload (best-effort, tolerant to different field names). */
function getPhiFromPayload(payload: SigilSharePayloadLoose): number | undefined {
  const record = payload as unknown as Record<string, unknown>;
  const candidates = [
    "phiSent",
    "sentPhi",
    "phi_amount",
    "amountPhi",
    "phi",
    "phiValue",
    "phi_amount_sent",
  ];

  for (const key of candidates) {
    const v = record[key];
    if (typeof v === "number") {
      if (!Number.isFinite(v)) continue;
      if (Math.abs(v) < 1e-12) continue;
      return v;
    }
    if (typeof v === "string") {
      const n = Number(v);
      if (!Number.isNaN(n) && Math.abs(n) >= 1e-12) {
        return n;
      }
    }
  }

  return undefined;
}

/** Sum of all Φ sent from a given pulse across the registry. */
function getPhiSentForPulse(pulse?: number): number | undefined {
  if (pulse == null) return undefined;

  let total = 0;
  let seen = false;

  for (const [, payload] of memoryRegistry) {
    if (payload.pulse === pulse) {
      const amt = getPhiFromPayload(payload);
      if (amt !== undefined) {
        total += amt;
        seen = true;
      }
    }
  }

  return seen ? total : undefined;
}

/** Load persisted URLs (if any) into memory registry. Includes modal fallback list. */
function hydrateRegistryFromStorage(): void {
  if (!canStorage) return;

  const ingestList = (raw: string | null) => {
    if (!raw) return;
    try {
      const urls: string[] = JSON.parse(raw);
      urls.forEach((u) => {
        const url = canonicalizeUrl(u);
        const payload = extractPayloadFromUrl(url);
        if (payload) memoryRegistry.set(url, payload);
      });
    } catch {
      /* ignore bad entries */
    }
  };

  ingestList(localStorage.getItem(REGISTRY_LS_KEY));
  ingestList(localStorage.getItem(MODAL_FALLBACK_LS_KEY));
}

/** Persist memory registry to localStorage (Explorer’s canonical key). */
function persistRegistryToStorage(): void {
  if (!canStorage) return;
  const urls = Array.from(memoryRegistry.keys());
  localStorage.setItem(REGISTRY_LS_KEY, JSON.stringify(urls));
}

/** Add a single URL (and optionally its ancestry chain) to the registry. */
function addUrl(url: string, includeAncestry = true, broadcast = true): boolean {
  const abs = canonicalizeUrl(url);
  const payload = extractPayloadFromUrl(abs);
  if (!payload) return false;

  let changed = false;

  // Include ancestry chain (child → parent → ... → origin)
  if (includeAncestry) {
    const chain = resolveLineageBackwards(abs);
    for (const link of chain) {
      const p = extractPayloadFromUrl(link);
      const key = canonicalizeUrl(link);
      if (p && !memoryRegistry.has(key)) {
        memoryRegistry.set(key, p);
        changed = true;
      }
    }
  }

  if (!memoryRegistry.has(abs)) {
    memoryRegistry.set(abs, payload);
    changed = true;
  }

  if (changed) {
    persistRegistryToStorage();
    if (channel && broadcast) {
      channel.postMessage({ type: "sigil:add", url: abs });
    }
  }
  return changed;
}

/* ─────────────────────────────────────────────────────────────────────
 *  Tree building (pure, derived from registry)
 *  ───────────────────────────────────────────────────────────────────── */

/** Children: sorted by Kai time, MOST RECENT first (descending). */
function childrenOf(url: string, reg: Registry): string[] {
  const out: string[] = [];
  for (const [u, p] of reg) {
    if (p.parentUrl && canonicalizeUrl(p.parentUrl) === canonicalizeUrl(url)) {
      out.push(u);
    }
  }
  // sort by Kai timing for coherent branches — DESCENDING (most recent first)
  out.sort((a, b) => byKaiTime(reg.get(b)!, reg.get(a)!));
  return out;
}

function buildTree(
  rootUrl: string,
  reg: Registry,
  seen = new Set<string>(),
): SigilNode | null {
  const url = canonicalizeUrl(rootUrl);
  const payload = reg.get(url);
  if (!payload) return null;

  if (seen.has(url)) {
    // Break cycles defensively
    return { url, payload, children: [] };
  }
  seen.add(url);

  const kids = childrenOf(url, reg)
    .map((child) => buildTree(child, reg, seen))
    .filter(Boolean) as SigilNode[];

  return { url, payload, children: kids };
}

/** Compute branch size and latest Kai moment in that branch. */
function summarizeBranch(
  root: SigilNode,
): { nodeCount: number; latest: SigilSharePayloadLoose } {
  let nodeCount = 0;
  let latest = root.payload;

  const walk = (node: SigilNode) => {
    nodeCount += 1;
    if (byKaiTime(node.payload, latest) > 0) {
      latest = node.payload;
    }
    node.children.forEach(walk);
  };

  walk(root);
  return { nodeCount, latest };
}

/** Build a forest grouped by origin (each origin becomes a root).
 *  If origin itself is missing from the registry, we promote the earliest
 *  (by Kai timing) entry in that group as the root.
 *
 *  Forest ordering:
 *    1) Most recent latest Kai moment in branch (desc).
 *    2) Larger branch (more nodes) ranks higher.
 *    3) Fallback: root Kai time (desc).
 */
function buildForest(reg: Registry): SigilNode[] {
  const groups = new Map<string, string[]>(); // originUrl -> [urls]
  for (const [url, payload] of reg) {
    const origin = payload.originUrl
      ? canonicalizeUrl(payload.originUrl)
      : getOriginUrl(url) ?? url;
    if (!groups.has(origin)) groups.set(origin, []);
    groups.get(origin)!.push(url);
  }

  const decorated: BranchSummary[] = [];

  for (const origin of groups.keys()) {
    const node = buildTree(origin, reg);
    if (node) {
      const summary = summarizeBranch(node);
      decorated.push({
        root: node,
        nodeCount: summary.nodeCount,
        latest: summary.latest,
      });
    } else {
      // Origin missing: pick earliest by Kai-time within this group as synthetic root
      const urls = groups.get(origin)!;
      urls.sort((a, b) => byKaiTime(reg.get(a)!, reg.get(b)!)); // ascending: earliest first
      const syntheticRootUrl = urls[0];
      const synthetic = buildTree(syntheticRootUrl, reg);
      if (synthetic) {
        const summary = summarizeBranch(synthetic);
        decorated.push({
          root: synthetic,
          nodeCount: summary.nodeCount,
          latest: summary.latest,
        });
      }
    }
  }

  // Sort forest by:
  // 1) Latest Kai time in branch (most recent first)
  // 2) Node count (bigger branches float higher)
  // 3) Root Kai time (desc) as tie-breaker
  decorated.sort((a, b) => {
    const timeCmp = byKaiTime(b.latest, a.latest);
    if (timeCmp !== 0) return timeCmp;

    if (b.nodeCount !== a.nodeCount) return b.nodeCount - a.nodeCount;

    return byKaiTime(b.root.payload, a.root.payload);
  });

  return decorated.map((d) => d.root);
}

/* ─────────────────────────────────────────────────────────────────────
 *  Memory Stream detail extraction for each node
 *  ───────────────────────────────────────────────────────────────────── */

function buildDetailEntries(node: SigilNode): DetailEntry[] {
  const record = node.payload as unknown as Record<string, unknown>;
  const entries: DetailEntry[] = [];
  const usedKeys = new Set<string>();

  const phiSelf = getPhiFromPayload(node.payload);
  if (phiSelf !== undefined) {
    entries.push({
      label: "This glyph Φ",
      value: `${formatPhi(phiSelf)} Φ`,
    });
  }

  const addFromKey = (key: string, label: string) => {
    const v = record[key];
    if (typeof v === "string" && v.trim().length > 0 && !usedKeys.has(key)) {
      entries.push({ label, value: v.trim() });
      usedKeys.add(key);
    }
  };

  // Core identity
  addFromKey("userPhiKey", "PhiKey");
  addFromKey("phiKey", "PhiKey");
  addFromKey("phikey", "PhiKey");
  addFromKey("kaiSignature", "Kai Signature");

  // Parent / origin URLs
  const parentRaw = record.parentUrl;
  if (typeof parentRaw === "string" && parentRaw.length > 0) {
    entries.push({
      label: "Parent URL",
      value: canonicalizeUrl(parentRaw),
    });
    usedKeys.add("parentUrl");
  }

  const originRaw = record.originUrl;
  if (typeof originRaw === "string" && originRaw.length > 0) {
    entries.push({
      label: "Origin URL",
      value: canonicalizeUrl(originRaw),
    });
    usedKeys.add("originUrl");
  }

  // Basic label / description
  const labelCandidate =
    record.label ??
    record.title ??
    record.type ??
    record.note ??
    record.description;

  if (typeof labelCandidate === "string" && labelCandidate.trim().length > 0) {
    entries.push({
      label: "Label / Type",
      value: labelCandidate.trim(),
    });
  }

  // Explicit memory / stream URLs
  const memoryKeys = [
    "memoryUrl",
    "memory_url",
    "streamUrl",
    "stream_url",
    "feedUrl",
    "feed_url",
    "stream",
  ];
  for (const key of memoryKeys) {
    const v = record[key];
    if (
      typeof v === "string" &&
      v.trim().length > 0 &&
      !usedKeys.has(key)
    ) {
      entries.push({
        label: key,
        value: v.trim(),
      });
      usedKeys.add(key);
    }
  }

  // Any extra fields that smell like memory / stream / feed
  for (const [key, value] of Object.entries(record)) {
    if (entries.length >= 10) break;
    if (usedKeys.has(key)) continue;
    if (value == null) continue;

    const lower = key.toLowerCase();
    const looksLikeStream =
      lower.includes("stream") ||
      lower.includes("memory") ||
      lower.includes("feed");
    if (!looksLikeStream) continue;

    if (typeof value === "string" && value.trim().length === 0) continue;

    const printable =
      typeof value === "string" ? value.trim() : JSON.stringify(value);

    entries.push({ label: key, value: printable });
  }

  return entries;
}

/* ─────────────────────────────────────────────────────────────────────
 *  Scoped inline styles placeholder (external CSS does the heavy lifting)
 *  ───────────────────────────────────────────────────────────────────── */
const Styles: React.FC = () => <style>{``}</style>;

/* ─────────────────────────────────────────────────────────────────────
 *  UI Components
 *  ───────────────────────────────────────────────────────────────────── */
function KaiStamp({ p }: { p: SigilSharePayloadLoose }) {
  return (
    <span
      className="k-stamp"
      title={`pulse ${p.pulse} • beat ${p.beat} • step ${p.stepIndex}`}
    >
      <span className="k-pill">pulse {p.pulse}</span>
      <span className="k-dot">•</span>
      <span className="k-pill">beat {p.beat}</span>
      <span className="k-dot">•</span>
      <span className="k-pill">step {p.stepIndex}</span>
    </span>
  );
}

function SigilTreeNode({ node }: { node: SigilNode }) {
  // default CLOSED; only opens when toggle is clicked
  const [open, setOpen] = useState(false);
  const hash = parseHashFromUrl(node.url);
  const sig = node.payload.kaiSignature;
  const chakraDay = node.payload.chakraDay;
  const phiSentFromPulse = getPhiSentForPulse(node.payload.pulse);
  const detailEntries = buildDetailEntries(node);

  return (
    <div className="node">
      <div className="node-row">
        <div className="node-main">
          <button
            className="twirl"
            aria-label={open ? "Collapse branch" : "Expand branch"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            title={open ? "Collapse" : "Expand"}
            type="button"
          >
            <span className={`tw ${open ? "open" : ""}`} />
          </button>

          <a
            className="node-link"
            href={node.url}
            target="_blank"
            rel="noopener noreferrer"
            title={node.url}
          >
            <span style={{ opacity: 0.9 }}>
              {short(sig ?? hash ?? "glyph", 12)}
            </span>
          </a>
        </div>

        <div className="node-meta">
          <KaiStamp p={node.payload} />
          {chakraDay && (
            <span className="chakra" title={chakraDay}>
              {chakraDay}
            </span>
          )}
          {phiSentFromPulse !== undefined && (
            <span
              className="phi-pill"
              title={`Total Φ sent from pulse ${node.payload.pulse}`}
            >
              Φ sent: {formatPhi(phiSentFromPulse)}Φ
            </span>
          )}
          <button
            className="node-copy"
            aria-label="Copy URL"
            onClick={() => navigator.clipboard.writeText(node.url)}
            title="Copy URL"
            type="button"
          >
            ⧉
          </button>
        </div>
      </div>

      {open && (
        <div className="node-children">
          {/* Detail panel: mobile-first, stacked, not taking over viewport,
              page still scrolls via outer .explorer-scroll */}
          <div className="node-detail">
            {detailEntries.length === 0 ? (
              <div className="node-detail-empty">
                No additional memory fields recorded on this glyph.
              </div>
            ) : (
              <div className="node-detail-grid">
                {detailEntries.map((entry) => (
                  <React.Fragment key={entry.label}>
                    <div className="detail-label">{entry.label}</div>
                    <div className="detail-value" title={entry.value}>
                      {entry.value}
                    </div>
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>

          {/* Children remain vertically stacked; outer scroll container
              still handles page scroll even when this is open */}
          {node.children.map((c) => (
            <SigilTreeNode key={c.url} node={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function OriginPanel({ root }: { root: SigilNode }) {
  const count = useMemo(() => {
    let n = 0;
    const walk = (s: SigilNode) => {
      n += 1;
      s.children.forEach(walk);
    };
    walk(root);
    return n;
  }, [root]);

  const originHash = parseHashFromUrl(root.url);
  const originSig = root.payload.kaiSignature;

  return (
    <section className="origin" aria-label="Sigil origin branch">
      <header className="origin-head">
        <div className="o-meta">
          <span className="o-title">Origin</span>
          <a
            className="o-link"
            href={root.url}
            target="_blank"
            rel="noopener noreferrer"
            title={root.url}
          >
            {short(originSig ?? originHash ?? "origin", 14)}
          </a>
        </div>
        <div className="o-right">
          <KaiStamp p={root.payload} />
          <span className="o-count" title="Total glyphs in this lineage">
            {count} nodes
          </span>
          <button
            className="o-copy"
            onClick={() => navigator.clipboard.writeText(root.url)}
            title="Copy origin URL"
            type="button"
          >
            Remember Origin
          </button>
        </div>
      </header>

      <div className="origin-body">
        {root.children.length === 0 ? (
          <div className="kx-empty">No branches yet. The tree begins here.</div>
        ) : (
          <div className="tree">
            {root.children.map((c) => (
              <SigilTreeNode key={c.url} node={c} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ExplorerToolbar({
  onAdd,
  onImport,
  onExport,
  total,
  lastAdded,
}: {
  onAdd: (u: string) => void;
  onImport: (f: File) => void;
  onExport: () => void;
  total: number;
  lastAdded?: string;
}) {
  const [input, setInput] = useState("");

  return (
    <div className="kx-toolbar" role="region" aria-label="Explorer toolbar">
      <div className="kx-toolbar-inner">
        <div className="kx-brand">
          <div className="kx-glyph" aria-hidden />
          <div className="kx-title">
            <h1>
              KAIROS <span>Keystream</span>
            </h1>
            <div className="kx-tagline">
              Sovereign Lineage • No DB • Pure Φ
            </div>
          </div>
        </div>

        <div className="kx-controls">
          <form
            className="kx-add-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!input.trim()) return;
              onAdd(input.trim());
              setInput("");
            }}
          >
            <input
              className="kx-input"
              placeholder="Inhale a sigil (or memory)…"
              spellCheck={false}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              aria-label="Sigil URL"
            />
            <button className="kx-button" type="submit">
              Inhale
            </button>
          </form>

          <div className="kx-io" role="group" aria-label="Import and export">
            <label className="kx-import" title="Import a JSON list of URLs">
              <input
                type="file"
                accept="application/json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onImport(f);
                }}
                aria-label="Import JSON"
              />
              Inhale
            </label>
            <button
              className="kx-export"
              onClick={onExport}
              aria-label="Export registry to JSON"
              type="button"
            >
              Exhale
            </button>
          </div>

          <div className="kx-stats" aria-live="polite">
            <span className="kx-pill" title="Total URLs in registry">
              {total} URLs
            </span>
            {lastAdded && (
              <span className="kx-pill subtle" title={lastAdded}>
                Last: {short(lastAdded, 8)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Main Page
 *  ───────────────────────────────────────────────────────────────────── */
const SigilExplorer: React.FC = () => {
  const [, force] = useState(0);
  const [forest, setForest] = useState<SigilNode[]>([]);
  const [lastAdded, setLastAdded] = useState<string | undefined>(undefined);
  const unmounted = useRef(false);

  /** Rebuild derived forest + light re-render. */
  const refresh = () => {
    if (unmounted.current) return;
    const f = buildForest(memoryRegistry);
    setForest(f);
    force((v) => v + 1);
  };

  // Initial hydrate, global hook, event listeners
  useEffect(() => {
    hydrateRegistryFromStorage();

    // Seed with current URL if it looks like a sigil
    if (hasWindow && window.location.search.includes("p=")) {
      addUrl(window.location.href, true, false);
      setLastAdded(canonicalizeUrl(window.location.href));
    }

    // (1) Expose the global hook that the modal will call
    const prev = window.__SIGIL__?.registerSigilUrl;
    if (!window.__SIGIL__) window.__SIGIL__ = {};
    window.__SIGIL__.registerSigilUrl = (u: string) => {
      if (addUrl(u, true, true)) {
        setLastAdded(canonicalizeUrl(u));
        refresh();
      }
    };

    // (2) Listen for the modal’s fallback DOM event
    const onUrlRegistered = (e: Event) => {
      const anyEvent = e as CustomEvent<{ url: string }>;
      const u = anyEvent?.detail?.url;
      if (typeof u === "string" && u.length) {
        if (addUrl(u, true, true)) {
          setLastAdded(canonicalizeUrl(u));
          refresh();
        }
      }
    };
    window.addEventListener(
      "sigil:url-registered",
      onUrlRegistered as EventListener,
    );

    // (3) Back-compat: still listen for sigil:minted if other parts dispatch it
    const onMint = (e: Event) => {
      const anyEvent = e as CustomEvent<{ url: string }>;
      if (anyEvent?.detail?.url) {
        if (addUrl(anyEvent.detail.url, true, true)) {
          setLastAdded(canonicalizeUrl(anyEvent.detail.url));
          refresh();
        }
      }
    };
    window.addEventListener("sigil:minted", onMint as EventListener);

    // (4) Cross-tab sync via BroadcastChannel
    let onMsg: ((ev: MessageEvent) => void) | undefined;
    if (channel) {
      onMsg = (ev: MessageEvent) => {
        if (ev.data?.type === "sigil:add" && typeof ev.data.url === "string") {
          if (addUrl(ev.data.url, true, false)) {
            setLastAdded(canonicalizeUrl(ev.data.url));
            refresh();
          }
        }
      };
      channel.addEventListener("message", onMsg);
    }

    // (5) Also watch storage updates to the modal’s fallback list
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === MODAL_FALLBACK_LS_KEY && ev.newValue) {
        try {
          const urls: string[] = JSON.parse(ev.newValue);
          let changed = false;
          for (const u of urls) {
            if (addUrl(u, true, false)) changed = true;
          }
          if (changed) {
            setLastAdded(undefined);
            persistRegistryToStorage();
            refresh();
          }
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      // restore previous hook (if any)
      if (window.__SIGIL__) window.__SIGIL__.registerSigilUrl = prev;
      window.removeEventListener(
        "sigil:url-registered",
        onUrlRegistered as EventListener,
      );
      window.removeEventListener("sigil:minted", onMint as EventListener);
      window.removeEventListener("storage", onStorage);
      if (channel && onMsg) channel.removeEventListener("message", onMsg);
      unmounted.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refresh();
    return () => {
      unmounted.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastAdded]);

  // Handlers
  const handleAdd = (url: string) => {
    const changed = addUrl(url, true, true);
    if (changed) {
      setLastAdded(canonicalizeUrl(url));
      refresh();
    }
  };

  const handleImport = async (file: File) => {
    try {
      const text = await file.text();
      const urls = JSON.parse(text) as string[];
      let n = 0;
      for (const u of urls) {
        if (addUrl(u, true, false)) n++;
      }
      if (n > 0) {
        setLastAdded(undefined);
        persistRegistryToStorage();
        refresh();
      }
    } catch {
      // ignore
    }
  };

  const handleExport = () => {
    const data = JSON.stringify(Array.from(memoryRegistry.keys()), null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sigils.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="sigil-explorer">
      <Styles />

      <ExplorerToolbar
        onAdd={handleAdd}
        onImport={handleImport}
        onExport={handleExport}
        total={memoryRegistry.size}
        lastAdded={lastAdded}
      />

      {/* Scroll viewport so content never gets cut off, even with details open */}
      <div
        className="explorer-scroll"
        role="region"
        aria-label="Kairos Sigil-Glyph Explorer Content"
      >
        <div className="explorer-inner">
          {forest.length === 0 ? (
            <div className="kx-empty">
              <p>No sigils in your keystream yet.</p>
              <ol>
                <li>Import your keystream data.</li>
                <li>Seal a moment — auto-registered here.</li>
                <li>
                  Inhale any sigil-glyph or memory URL above — for realignment of its
                  lineage instantly.
                </li>
              </ol>
            </div>
          ) : (
            <div className="forest">
              {forest.map((root) => (
                <OriginPanel key={root.url} root={root} />
              ))}
            </div>
          )}

          <footer className="kx-footer" aria-label="About">
            <div className="row">
              <span>Determinate • Stateless • Kairos-remembered</span>
              <span className="dot">•</span>
              <span>No DB. No Server. Pure Φ.</span>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
};

export default SigilExplorer;
