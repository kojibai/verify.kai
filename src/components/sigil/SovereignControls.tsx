import React, { useEffect, useMemo, useRef, useState } from "react";
import type { EmbeddedAttachment, ExpiryUnit, SigilPayload } from "../../types/sigil";
import { kaiNowMs } from "../../utils/kaiNow";

type Press = {
  onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
};

type Props = {
  isArchived: boolean;
  ownerVerified: boolean;

  /** Existing single-file handler; we call it for each file in a batch */
  onAttachFile: (file: File) => void | Promise<void>;

  /** Existing single attachment prop (kept for compatibility) */
  attachment: EmbeddedAttachment | null;

  /** Existing single payload attachment (kept for compatibility) */
  payloadAttachment?: EmbeddedAttachment | undefined;

  /** NEW (optional): list of attachments provided by parent after upload */
  attachments?: EmbeddedAttachment[] | undefined;

  /** NEW (optional): list of embedded payload attachments provided by parent */
  payloadAttachments?: EmbeddedAttachment[] | undefined;

  derivedOwnerPhiKey: string;
  derivedKaiSig: string;

  expiryUnit: ExpiryUnit;
  setExpiryUnit: (v: ExpiryUnit) => void;
  expiryAmount: number;
  setExpiryAmount: (n: number) => void;

  onSealPress: Press;

  payload: SigilPayload | null;
  localHash: string;
  isFutureSealed: boolean;
};

/* ─────────────────────────── Exact beat/step math (match EternalKlock) ─────────────────────────── */
const HARMONIC_DAY_PULSES_EXACT = 17_491.270421; // exact
const CHAKRA_BEATS_PER_DAY = 36;
const PULSES_PER_STEP = 11;                      // 11 breaths per step
const UPULSES = 1_000_000;                       // μpulses per pulse

function muPerBeat() {
  return Math.round(
    (HARMONIC_DAY_PULSES_EXACT / CHAKRA_BEATS_PER_DAY) * UPULSES
  );
}
function muPosInDayFromPulse(pulse: number) {
  return Math.round(
    (((pulse % HARMONIC_DAY_PULSES_EXACT) + HARMONIC_DAY_PULSES_EXACT) %
      HARMONIC_DAY_PULSES_EXACT) * UPULSES
  );
}
function exactBeatIndexFromPulse(pulse: number): number {
  const muBeat = muPerBeat();
  const muDay  = muPosInDayFromPulse(pulse);
  // 0..35 (clamped)
  const idx = Math.floor(muDay / muBeat);
  return Math.min(Math.max(idx, 0), CHAKRA_BEATS_PER_DAY - 1);
}
function exactStepIndexFromPulse(pulse: number, stepsPerBeat: number): number {
  const muBeat   = muPerBeat();
  const muStep   = PULSES_PER_STEP * UPULSES;
  const muInBeat = muPosInDayFromPulse(pulse) % muBeat;
  const idx = Math.floor(muInBeat / muStep);
  return Math.min(Math.max(idx, 0), Math.max(stepsPerBeat - 1, 0));
}

/* ───────────────── WebKit directory upload types (nonstandard, prefixed) ───────────────── */
type WebKitFileSystemEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath?: string;
};
type WebKitFileSystemFileEntry = WebKitFileSystemEntry & {
  isFile: true;
  file: (success: (file: File) => void, error?: (err: DOMException) => void) => void;
};
type WebKitFileSystemDirectoryReader = {
  readEntries: (
    success: (entries: WebKitFileSystemEntry[]) => void,
    error?: (err: DOMException) => void
  ) => void;
};
type WebKitFileSystemDirectoryEntry = WebKitFileSystemEntry & {
  isDirectory: true;
  createReader: () => WebKitFileSystemDirectoryReader;
};
type DataTransferItemWithDirectory = DataTransferItem & {
  webkitGetAsEntry?: () => WebKitFileSystemEntry | null;
};

function isWebKitFileEntry(e: WebKitFileSystemEntry): e is WebKitFileSystemFileEntry {
  return e.isFile === true;
}
function isWebKitDirectoryEntry(e: WebKitFileSystemEntry): e is WebKitFileSystemDirectoryEntry {
  return e.isDirectory === true;
}

/* ───────────────── Helpers ───────────────── */
type UploadStatus = "queued" | "uploading" | "done" | "error";
type UploadItem = {
  id: string;
  name: string;
  size: number;
  type: string;
  status: UploadStatus;
  error?: string;
};

function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

/** Extract files from a DataTransfer, including dropped folders (webkit entries). */
async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items || []);
  const supportsEntries = items.some(
    (it) => typeof (it as DataTransferItemWithDirectory).webkitGetAsEntry === "function"
  );

  if (!supportsEntries) {
    return Array.from(dt.files || []);
  }

  const rawEntries: Array<WebKitFileSystemEntry | null> = items.map(
    (it) => (it as DataTransferItemWithDirectory).webkitGetAsEntry?.() ?? null
  );
  const entries: WebKitFileSystemEntry[] = rawEntries.filter(
    (e): e is WebKitFileSystemEntry => e !== null
  );

  const out: File[] = [];

  async function walkEntry(entry: WebKitFileSystemEntry): Promise<void> {
    if (isWebKitFileEntry(entry)) {
      await new Promise<void>((resolve) => {
        entry.file(
          (file) => {
            out.push(file);
            resolve();
          },
          () => {
            resolve();
          }
        );
      });
    } else if (isWebKitDirectoryEntry(entry)) {
      const reader = entry.createReader();
      await new Promise<void>((resolve) => {
        const readAll = () => {
          reader.readEntries(
            async (batch) => {
              if (!batch.length) return resolve();
              // walk sequentially to avoid stack blow-ups on huge trees
              for (const e of batch) {
                // eslint-disable-next-line no-await-in-loop
                await walkEntry(e);
              }
              readAll();
            },
            () => {
              resolve();
            }
          );
        };
        readAll();
      });
    }
  }

  for (const e of entries) {
    // eslint-disable-next-line no-await-in-loop
    await walkEntry(e);
  }
  return out.length ? out : Array.from(dt.files || []);
}

/** Read fields from possibly-loose EmbeddedAttachment shapes (no `any`) */
function readAttachmentFields(
  a: EmbeddedAttachment,
  index: number
): { name: string; mime: string; sizeText: string } {
  const r = a as Record<string, unknown>;
  const name =
    (typeof r.name === "string" && r.name) ||
    (typeof r.filename === "string" && (r.filename as string)) ||
    `file-${index + 1}`;
  const mime =
    (typeof r.mime === "string" && (r.mime as string)) ||
    (typeof r.type === "string" && (r.type as string)) ||
    "";
  const sizeText =
    typeof r.size === "number" ? formatBytes(r.size as number) : "";
  return { name, mime, sizeText };
}

/** Input element that may support directory selection in WebKit */
type DirCapableInput = HTMLInputElement & {
  webkitdirectory?: boolean;
  directory?: boolean;
};

export default function SovereignControls({
  isArchived,
  ownerVerified,

  onAttachFile,
  attachment,
  payloadAttachment,

  attachments,
  payloadAttachments,

  derivedOwnerPhiKey,
  derivedKaiSig,

  expiryUnit,
  setExpiryUnit,
  expiryAmount,
  setExpiryAmount,

  onSealPress,

  payload,
  localHash,
  isFutureSealed,
}: Props) {
  /* ──────────────────────────────────────────────────────────────
     One-time CSS injection (mobile-first, safe-area aware)
  ─────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const id = "sovereign-controls-overlay-css";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      /* Overlay input sits above the visible CTA to maximize iOS reliability */
      .file-cta-wrap{ position:relative; display:inline-flex; align-items:stretch; }
      .file-cta-wrap > .file-cta{ position:relative; z-index:1; }

      .file-cta-wrap > .file-input-overlay[type="file"]{
        display:block !important;
        position:absolute !important;
        inset:0 !important;
        width:100% !important; height:100% !important;
        opacity:0.001 !important;
        z-index:2147483647 !important;
        pointer-events:auto !important;
        -webkit-tap-highlight-color:transparent !important;
        -webkit-user-select:none !important;
        user-select:none !important;
        touch-action:manipulation !important;
        visibility:visible !important;
        border:0; background:transparent;
        appearance:none; -webkit-appearance:none;
      }
      .file-cta-wrap[data-disabled="true"] > .file-input-overlay[type="file"]{
        pointer-events:none !important;
      }

      /* Dropzone */
      .dropzone{
        border:1px dashed rgba(255,255,255,0.18);
        border-radius:12px;
        padding:12px;
        transition:border-color .12s ease, background .12s ease;
        background: color-mix(in oklab, var(--panel-bg, rgba(255,255,255,.02)) 100%, transparent);
      }
      .dropzone[data-over="true"]{
        border-color: color-mix(in oklab, var(--crystal-accent, #00ffd0) 65%, rgba(255,255,255,0.4));
        background: color-mix(in oklab, var(--crystal-accent, #00ffd0) 10%, transparent);
      }

      /* Tap feedback */
      .pressable{ transition: transform .06s ease, filter .06s ease; }
      .pressable[data-pressed="true"]{ transform: translateY(1px) scale(0.995); filter: brightness(0.98); }

      /* Mobile-friendly sizing */
      .btn-primary, .btn-ghost, select, input[type="text"]{
        min-height: 48px; font-size: 16px;
      }
      .btn-primary--xl{ min-height: 56px; font-size: 17px; font-weight: 800; }

      /* Expiry grid */
      .expiry-grid{
        display:grid;
        grid-template-columns: auto 1fr auto auto;
        gap: 8px;
        align-items:center;
      }
      @media (max-width: 480px){
        .expiry-grid{ gap: 6px; }
      }

      /* Upload list */
      .upload-list { display: grid; gap: 8px; margin-top: 8px; }
      .upload-item {
        display:grid; grid-template-columns: 1fr auto; gap:8px; align-items:center;
        padding:8px 10px; border:1px solid rgba(255,255,255,.10); border-radius:10px;
        background: linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.02));
      }
      .upload-meta { display:flex; gap:8px; align-items:center; min-width: 0; }
      .upload-name { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .upload-size { opacity:.85; font-variant-numeric: tabular-nums; }
      .upload-status { display:flex; align-items:center; gap:6px; white-space:nowrap; }
      .upload-status .spinner {
        width:16px; height:16px; border-radius:50%;
        border:2px solid rgba(255,255,255,.25);
        border-top-color: var(--crystal-accent, #00ffd0);
        animation: ovm-spin .7s linear infinite;
      }
      .upload-status .ok {
        width:16px; height:16px; border-radius:50%; display:grid; place-items:center;
        background: color-mix(in oklab, var(--crystal-accent, #00ffd0) 65%, transparent);
        box-shadow: 0 0 0 1px rgba(255,255,255,.25) inset;
      }
      .upload-status .err {
        width:16px; height:16px; border-radius:50%; display:grid; place-items:center;
        background: #c62828; box-shadow: 0 0 0 1px rgba(255,255,255,.25) inset;
      }
      .progress {
        grid-column: 1 / -1; height:4px; border-radius:3px; overflow:hidden;
        background: rgba(255,255,255,.08);
      }
      .progress > i {
        display:block; height:100%;
        background: linear-gradient(90deg, rgba(255,255,255,.35), var(--crystal-accent, #00ffd0));
        width: 40%;
        animation: indet 1.2s ease-in-out infinite;
      }
      @keyframes indet {
        0% { transform: translateX(-60%); }
        50% { transform: translateX(40%); }
        100% { transform: translateX(140%); }
      }
      @keyframes ovm-spin { to { transform: rotate(360deg); } }

      /* Meta rows wrap nicely on small screens */
      .sp-meta-row{
        display:flex; gap:10px; align-items:center; flex-wrap:wrap;
      }
      .mono-wrap{
        overflow-wrap:anywhere; word-break:break-word;
      }

      /* Section padding respects safe-area */
      .sp-sovereign--bottom{
        padding-bottom: max(16px, env(safe-area-inset-bottom));
      }
    `;
    document.head.appendChild(style);
  }, []);

  const attachInputRef = useRef<HTMLInputElement>(null);
  const [pressed, setPressed] = useState<null | "attach" | "seal" | "decrease" | "increase">(null);
  const [over, setOver] = useState(false);

  // Apply multiple + directory picking on the overlay input (no `any`)
  useEffect(() => {
    const el = attachInputRef.current as DirCapableInput | null;
    if (!el) return;
    el.multiple = true;
    if ("webkitdirectory" in el) el.webkitdirectory = true;
    if ("directory" in el) el.directory = true;
    el.setAttribute("webkitdirectory", "");
    el.setAttribute("directory", "");
  }, []);

  const [uploads, setUploads] = useState<UploadItem[]>([]);

  const sealDisabled = useMemo(
    () => !payload || !localHash || isFutureSealed || isArchived,
    [payload, localHash, isFutureSealed, isArchived]
  );

  const sealTitle = useMemo(() => {
    if (isArchived) return "Archived link — a new transfer link has already been issued";
    if (!localHash) return "Glyph hash not ready yet";
    if (isFutureSealed) return "Opens after the moment—claim unlocks then";
    return "Seal";
  }, [isArchived, isFutureSealed, localHash]);

  const setRippleXY = (evt: React.PointerEvent | React.MouseEvent, host: HTMLElement | null) => {
    if (!host) return;
    const r = host.getBoundingClientRect();
    const x = ("clientX" in evt ? evt.clientX : 0) - r.left;
    const y = ("clientY" in evt ? evt.clientY : 0) - r.top;
    host.style.setProperty("--x", `${x}px`);
    host.style.setProperty("--y", `${y}px`);
  };

  /* ─────────────── Upload orchestration ─────────────── */
  function addToQueue(files: File[]) {
    const items: UploadItem[] = files.map((f, i) => ({
      id: `${kaiNowMs()}-${i}-${f.name}-${f.size}`,
      name: f.name,
      size: f.size,
      type: f.type || "application/octet-stream",
      status: "queued",
    }));
    setUploads((prev) => [...prev, ...items]);

    // Kick off uploads (concurrent but simple)
    items.forEach((item, idx) => {
      const file = files[idx];
      void runUpload(item.id, file);
    });
  }

  async function runUpload(id: string, file: File) {
    setUploads((u) => u.map((it) => (it.id === id ? { ...it, status: "uploading" } : it)));
    try {
      const maybe = onAttachFile(file);
      if (maybe && typeof (maybe as Promise<void>).then === "function") {
        await maybe;
      }
      setUploads((u) => u.map((it) => (it.id === id ? { ...it, status: "done" } : it)));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setUploads((u) =>
        u.map((it) => (it.id === id ? { ...it, status: "error", error: message } : it))
      );
    }
  }

  async function handleFilesPicked(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    addToQueue(files);
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    const files = await filesFromDataTransfer(e.dataTransfer);
    if (files.length) addToQueue(files);
  }

  /* Compose read-only attachment lists from props (support both single & plural) */
  const attachedFromParent: EmbeddedAttachment[] = useMemo(() => {
    const arr: EmbeddedAttachment[] = [];
    if (Array.isArray(attachments)) arr.push(...attachments);
    if (attachment) arr.push(attachment);
    return arr;
  }, [attachments, attachment]);

  const embeddedFromPayload: EmbeddedAttachment[] = useMemo(() => {
    const arr: EmbeddedAttachment[] = [];
    if (Array.isArray(payloadAttachments)) arr.push(...payloadAttachments);
    if (payloadAttachment) arr.push(payloadAttachment);
    return arr;
  }, [payloadAttachments, payloadAttachment]);

  /* ─────────────── Exact derived beat/step from payload pulse (zero-based display) ─────────────── */
useMemo(() => {
    const stepsPerBeat = Math.max(1, payload?.stepsPerBeat ?? 44);
    const p = payload?.pulse ?? 0;
    return {
      derivedBeatIdx: exactBeatIndexFromPulse(p),
      derivedStepIdx: exactStepIndexFromPulse(p, stepsPerBeat),
      derivedStepsPerBeat: stepsPerBeat,
    };
  }, [payload?.pulse, payload?.stepsPerBeat]);

  return (
    <section className="sp-sovereign sp-sovereign--bottom" aria-label="Sovereign Controls">
      {/* ─────────────── Attachment panel ─────────────── */}
      {ownerVerified && (
        <div className="sp-panel" role="group" aria-labelledby="attach-title">
          <h3 id="attach-title">Attach Files / Folders</h3>

     

          <div className="sp-field">
            <label className="lbl">Attachments</label>

            <div
              className="dropzone"
              data-over={over || undefined}
              onDrop={handleDrop}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDragEnter={() => setOver(true)}
              onDragLeave={() => setOver(false)}
            >
              <div
                className="file-cta-wrap"
                data-disabled={isArchived ? "true" : undefined}
                onClick={(e) => {
                  setPressed("attach");
                  setRippleXY(e, e.currentTarget);
                }}
              >
                <button
                  type="button"
                  className="btn-primary btn-primary--xl file-cta pressable"
                  data-pressed={pressed === "attach"}
                  title={isArchived ? "Archived — cannot attach" : "Inhale files or a folder"}
                  tabIndex={-1}
                  aria-disabled={isArchived ? "true" : undefined}
                >
                  Inhale Files / Folder
                </button>

                {/* MULTIPLE + FOLDER (via webkitdirectory) */}
                <input
                  ref={attachInputRef}
                  id="attach-file-overlay"
                  className="file-input-overlay"
                  type="file"
                  disabled={isArchived}
                  multiple
                  onChange={(e) => {
                    void handleFilesPicked(e.currentTarget.files);
                    // allow re-selecting the same set
                    e.currentTarget.value = "";
                  }}
                />
              </div>

              {/* Upload queue (live feedback) */}
              {uploads.length > 0 && (
                <div className="upload-list" role="status" aria-live="polite">
                  {uploads.map((u) => (
                    <div className="upload-item" key={u.id}>
                      <div className="upload-meta">
                        <div className="upload-name" title={u.name}>{u.name}</div>
                        <div className="upload-size">{formatBytes(u.size)}</div>
                      </div>
                      <div className="upload-status">
                        {u.status === "uploading" && (
                          <>
                            <span className="spinner" aria-hidden="true" />
                            <span>Inhaling…</span>
                          </>
                        )}
                        {u.status === "queued" && <span>Queued…</span>}
                        {u.status === "done" && (
                          <>
                            <span className="ok" aria-hidden="true">
                              <svg width="12" height="12" viewBox="0 0 24 24">
                                <path
                                  fill="currentColor"
                                  d="M9.5 16.17L5.33 12l-1.41 1.41l5.58 5.58L20.5 7.99L19.09 6.58z"
                                />
                              </svg>
                            </span>
                            <span>Inhaled</span>
                          </>
                        )}
                        {u.status === "error" && (
                          <>
                            <span className="err" aria-hidden="true">!</span>
                            <span>Failed</span>
                          </>
                        )}
                      </div>
                      {(u.status === "uploading" || u.status === "queued") && (
                        <div className="progress" aria-hidden="true">
                          <i />
                        </div>
                      )}
                      {u.status === "error" && u.error && (
                        <div className="mono-wrap" style={{ gridColumn: "1 / -1", opacity: 0.9 }}>
                          {u.error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Show attachments confirmed by parent (post-upload) */}
          {attachedFromParent.length > 0 && (
            <div className="sp-meta-row">
              <span className="lbl">Attached</span>
              <span className="mono mono-wrap">
                {attachedFromParent
                  .map((a, i) => {
                    const f = readAttachmentFields(a, i);
                    return `${f.name}${f.mime ? ` (${f.mime}` : ""}${
                      f.sizeText ? `${f.mime ? ", " : " ("}${f.sizeText}` : ""
                    }${f.mime || f.sizeText ? ")" : ""}`;
                  })
                  .join("; ")}
              </span>
            </div>
          )}

          {/* Embedded-in-payload display (if any and not overridden by new local) */}
          {embeddedFromPayload.length > 0 && attachedFromParent.length === 0 && (
            <div className="sp-meta-row">
              <span className="lbl">Embedded</span>
              <span className="mono mono-wrap">
                {embeddedFromPayload
                  .map((a, i) => {
                    const f = readAttachmentFields(a, i);
                    return `${f.name}${f.mime ? ` (${f.mime}` : ""}${
                      f.sizeText ? `${f.mime ? ", " : " ("}${f.sizeText}` : ""
                    }${f.mime || f.sizeText ? ")" : ""}`;
                  })
                  .join("; ")}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ─────────────── Ownership & Expiry panel ─────────────── */}
      {ownerVerified && (
        <div className="sp-panel" role="group" aria-labelledby="own-exp-title">
          <h3 id="own-exp-title">Add Derivative Stewardship &amp; Expiry</h3>

          <div className="sp-field">
            <label className="lbl">New Owner PhiKey</label>
            <output
              className="mono mono-wrap"
              aria-live="polite"
              title={derivedOwnerPhiKey || "Will be derived at seal"}
            >
              {derivedOwnerPhiKey || "— will be derived at seal —"}
            </output>
          </div>

          <div className="sp-field">
            <label className="lbl">Kai Signature</label>
            <output
              className="mono mono-wrap"
              aria-live="polite"
              title={derivedKaiSig || "Will be derived at seal"}
            >
              {derivedKaiSig || "— will be derived at seal —"}
            </output>
          </div>

          <div className="sp-field">
            <label className="lbl" htmlFor="expiryAmount">Expiry</label>
            <div className="expiry-grid">
              <button
                type="button"
                className="btn-ghost pressable"
                aria-label="Decrease amount"
                data-pressed={pressed === "decrease"}
                onClick={() => {
                  setPressed("decrease");
                  setExpiryAmount(Math.max(0, Math.floor((expiryAmount ?? 0) - 1)));
                }}
              >
                −
              </button>

              <input
                id="expiryAmount"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={String(expiryAmount ?? 0)}
                onChange={(e) => {
                  const digits = e.currentTarget.value.replace(/[^\d]/g, "");
                  const n = digits === "" ? 0 : parseInt(digits, 10);
                  setExpiryAmount(Number.isFinite(n) ? Math.max(0, n) : 0);
                }}
                onBlur={(e) => {
                  const digits = e.currentTarget.value.replace(/[^\d]/g, "");
                  const n = digits === "" ? 0 : parseInt(digits, 10);
                  setExpiryAmount(Number.isFinite(n) ? Math.max(0, n) : 0);
                }}
                enterKeyHint="done"
                aria-describedby="expiry-help"
                style={{ minHeight: 48, fontSize: 16 }}
              />

              <button
                type="button"
                className="btn-ghost pressable"
                aria-label="Increase amount"
                data-pressed={pressed === "increase"}
                onClick={() => {
                  setPressed("increase");
                  setExpiryAmount(Math.max(0, Math.floor((expiryAmount ?? 0) + 1)));
                }}
              >
                +
              </button>

              <select
                aria-label="Expiry Unit"
                value={expiryUnit}
                onChange={(e) => setExpiryUnit(e.target.value as ExpiryUnit)}
                style={{ minHeight: 48 }}
              >
                <option value="breaths">breaths (pulses)</option>
                <option value="steps">steps</option>
              </select>
            </div>

            <small id="expiry-help" className="sp-fine">
              Number of {expiryUnit === "steps" ? "steps" : "breaths"} before eternal seal.
            </small>
          </div>

          <div className="sp-actions">
            <button
              type="button"
              className="btn-primary pressable"
              data-pressed={pressed === "seal"}
              disabled={sealDisabled}
              aria-disabled={sealDisabled}
              title={sealTitle}
              onPointerUp={onSealPress?.onPointerUp}
              onClick={(e) => {
                setPressed("seal");
                onSealPress?.onClick?.(e);
              }}
            >
              Seal
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
