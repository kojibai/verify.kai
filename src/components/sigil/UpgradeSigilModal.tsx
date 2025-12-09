// src/components/sigil/UpgradeSigilModal.tsx
import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
  } from "react";
  import type { SigilPayload } from "../../types/sigil";
  import { validateSvgForVerifier } from "../../utils/svgMeta";
  import {
    ETERNAL_STEPS_PER_BEAT as STEPS_PER_BEAT,
    stepIndexFromPulse,
    getKaiPulseEternalInt, // ⬅️ imported
  } from "../../SovereignSolar";
  import { breathsToPulses } from "../../utils/kaiMath"; // ⬅️ imported
  import "./UpgradeSigilModal.css";
  
  /** Props */
  type UpgradeSigilModalProps = {
    open: boolean;
    onClose: () => void;
  
    /** Legacy (route) hash that brought us here (lowercased preferred) */
    legacyHash: string;
  
    /** Target modern hash (usually localHash from KaiSigil.onReady) */
    modernHash?: string | null;
  
    /** Current page payload (the moment we’re looking at) */
    currentPayload: SigilPayload | null;
  
    /**
     * Optional: Provide to let the modal generate a modern transfer link.
     * Should return a URL (string) or null on failure.
     * Typical impl can be the `shareTransferLink` from SigilPage.
     */
    onGenerateLink?: (meta: SigilPayload, forcedToken?: string) => Promise<string | null>;
  
    /** Optional: notify parent that a valid legacy SVG has been verified */
    onVerified?: (uploaded: SigilPayload) => void;
  };
  
  /* ───────────────────────── helpers ───────────────────────── */
  
  function useEscapeToClose(open: boolean, onClose: () => void) {
    useEffect(() => {
      if (!open) return;
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") onClose();
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose]);
  }
  
  function useScrollLock(lock: boolean) {
    useEffect(() => {
      if (!lock) return;
      const prevHtml = document.documentElement.style.overflow;
      const prevBody = document.body.style.overflow;
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
      return () => {
        document.documentElement.style.overflow = prevHtml;
        document.body.style.overflow = prevBody;
      };
    }, [lock]);
  }
  
  // add this helper type near your hooks
type AnyRef<T extends HTMLElement> =
| React.RefObject<T | null>
| React.MutableRefObject<T | null>;

// replace your hook signature with this generic version
function useFocusTrap<T extends HTMLElement>(
active: boolean,
containerRef: AnyRef<T>
) {
useEffect(() => {
  if (!active) return;
  const container = containerRef.current;
  if (!container) return;

  const FOCUSABLE =
    'a[href], button:not([disabled]), textarea, input, select, summary, [tabindex]:not([tabindex="-1"])';

  const firstFocus = () => {
    const el =
      container.querySelector<HTMLElement>(".close-btn") ||
      container.querySelector<HTMLElement>(".btn.primary") ||
      container.querySelector<HTMLElement>(FOCUSABLE);
    el?.focus();
  };

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const nodes = Array.from(
      container.querySelectorAll<HTMLElement>(FOCUSABLE)
    ).filter((n) => n.offsetParent !== null || n === document.activeElement);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const prevActive = document.activeElement as HTMLElement | null;
  firstFocus();
  container.addEventListener("keydown", handleKeydown);
  return () => {
    container.removeEventListener("keydown", handleKeydown);
    prevActive?.focus?.();
  };
}, [active, containerRef]);
}

  /** Same-moment check (pulse/beat/stepIndex + chakraDay) */
  function sameMoment(a: SigilPayload, b: SigilPayload): boolean {
    const stepsA: number = (a.stepsPerBeat ?? STEPS_PER_BEAT) as number;
    const stepsB: number = (b.stepsPerBeat ?? STEPS_PER_BEAT) as number;
    const idxA = stepIndexFromPulse(a.pulse, stepsA);
    const idxB = stepIndexFromPulse(b.pulse, stepsB);
    return (
      a.pulse === b.pulse &&
      a.beat === b.beat &&
      idxA === idxB &&
      a.chakraDay === b.chakraDay
    );
  }
  
  /** tiny ripple helper for buttons (writes --x/--y for CSS) */
  function useRipple() {
    return useCallback((e: React.PointerEvent<HTMLElement>) => {
      const t = e.currentTarget as HTMLElement;
      const rect = t.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      t.style.setProperty("--x", `${x}px`);
      t.style.setProperty("--y", `${y}px`);
    }, []);
  }
  
  /* ───────────────────────── component ───────────────────────── */
  
  const UPGRADE_BREATHS = 11; // claim window for the modern link
  
  export default function UpgradeSigilModal({
    open,
    onClose,
    legacyHash,
    modernHash,
    currentPayload,
    onGenerateLink,
    onVerified,
  }: UpgradeSigilModalProps) {
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<"idle" | "verifying" | "ok" | "bad" | "warn">("idle");
    const [msg, setMsg] = useState<string>("Upload your SVG Φkey to verify stewardship.");
    const [uploaded, setUploaded] = useState<SigilPayload | null>(null);
    const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
  
    useEscapeToClose(open, onClose);
    useScrollLock(open);
    useFocusTrap(open, dialogRef);
  
    useEffect(() => {
      if (!open) {
        // reset when closing
        setBusy(false);
        setStatus("idle");
        setMsg("Upload your SVG Φkey to verify stewardship.");
        setUploaded(null);
        setGeneratedUrl(null);
      }
    }, [open]);
  
    const legacy = (legacyHash || "").toLowerCase();
    const modern = (modernHash || "").toLowerCase();
  
    const readyToUpgrade = useMemo(
      () => status === "ok" && !!uploaded && !!modern,
      [status, uploaded, modern]
    );
  
    const handleFiles = useCallback(
      async (files?: FileList | null) => {
        const file = files?.[0];
        if (!file) return;
        setBusy(true);
        setStatus("verifying");
        setMsg("Verifying uploaded SVG…");
        setGeneratedUrl(null);
  
        try {
          const txt = await file.text();
          const { ok, errors, payload } = validateSvgForVerifier(txt);
          if (!ok || !payload) {
            setStatus("bad");
            setMsg(errors[0] || "Invalid SVG.");
            setUploaded(null);
            setBusy(false);
            return;
          }
          if (!currentPayload) {
            setStatus("bad");
            setMsg("No active sigil payload on this page.");
            setUploaded(null);
            setBusy(false);
            return;
          }
          if (!sameMoment(currentPayload, payload)) {
            setStatus("bad");
            setMsg("This SVG isn’t the same sealed moment.");
            setUploaded(null);
            setBusy(false);
            return;
          }
  
          const svgCanon = (payload.canonicalHash || "").toLowerCase();
          if (!svgCanon) {
            setStatus("bad");
            setMsg("No canonicalHash found in SVG metadata.");
            setUploaded(null);
            setBusy(false);
            return;
          }
  
          if (svgCanon !== legacy) {
            if (modern && svgCanon === modern) {
              setStatus("warn");
              setMsg("This Φkey is already on the modern hash — no upgrade needed.");
              setUploaded(payload);
              onVerified?.(payload);
              setBusy(false);
              return;
            }
            setStatus("bad");
            setMsg("SVG canonicalHash doesn’t match this legacy link.");
            setUploaded(null);
            setBusy(false);
            return;
          }
  
          // Success: authentic legacy Φkey for this moment
          setStatus("ok");
          setMsg("Stewardship verified (legacy SVG). You can upgrade this key.");
          setUploaded(payload);
          onVerified?.(payload);
        } catch {
          setStatus("bad");
          setMsg("Couldn’t read that SVG file.");
          setUploaded(null);
        } finally {
          setBusy(false);
        }
      },
      [currentPayload, legacy, modern, onVerified]
    );
  
    const onClickDrop = useCallback(() => {
      fileInputRef.current?.click();
    }, []);
  
    const onDrop = useCallback(
      (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        void handleFiles(e.dataTransfer?.files);
      },
      [handleFiles]
    );
  
    const onPaste = useCallback(
      (e: React.ClipboardEvent<HTMLDivElement>) => {
        const items = e.clipboardData?.files;
        if (items && items.length) void handleFiles(items);
      },
      [handleFiles]
    );
  
    // Grant 11 breaths from NOW on the modern link
    const generateLink = useCallback(async () => {
      if (!uploaded || !modern || !onGenerateLink) return;
      setBusy(true);
      setMsg("Creating modern transfer link…");
  
      try {
        const nowPulse = getKaiPulseEternalInt(new Date());
        const extraPulses = breathsToPulses(UPGRADE_BREATHS);
  
        // Build a meta copy for the modern link with a fresh claim window.
        // This does NOT affect canonical Σ/Φ — expiry isn’t part of Σ.
        const meta: SigilPayload = {
          ...uploaded,
          canonicalHash: modern,
          expiresAtPulse: nowPulse + extraPulses,
          claimExtendUnit: "breaths",
          claimExtendAmount: UPGRADE_BREATHS,
          // @ts-expect-error: UI-only marker, not present in SigilPayload type
          upgradedFromLegacy: true,
        };
  
        // SigilPage.shareTransferLink will mint a fresh transferNonce for us.
        const url = await onGenerateLink(meta);
  
        if (url) {
          setGeneratedUrl(url);
          setStatus("ok");
          setMsg(`Modern transfer link ready. Claim window extended for ${UPGRADE_BREATHS} breaths.`);
        } else {
          setGeneratedUrl(null);
          setStatus("bad");
          setMsg("Couldn’t create a modern link.");
        }
      } catch {
        setGeneratedUrl(null);
        setStatus("bad");
        setMsg("Error generating modern link.");
      } finally {
        setBusy(false);
      }
    }, [uploaded, modern, onGenerateLink]);
  
    const copy = useCallback(async (txt: string) => {
      try {
        await navigator.clipboard.writeText(txt);
        setMsg("Link copied to clipboard.");
      } catch {
        setMsg("Copy failed.");
      }
    }, []);
  
    const ripple = useRipple();
  
    if (!open) return null;
  
    const statusMod =
      status === "ok" ? "ok" : status === "bad" ? "bad" : status === "warn" ? "warn" : "checking";
  
    const stepIdx = uploaded
      ? stepIndexFromPulse(uploaded.pulse, (uploaded.stepsPerBeat ?? STEPS_PER_BEAT) as number)
      : null;
  
    return (
      <div
        className="upgrade-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upgrade-title"
        aria-describedby="upgrade-desc"
        onClick={onClose}
      >
        <div
          ref={dialogRef}
          className="upgrade-dialog"
          onClick={(e) => e.stopPropagation()}
          aria-busy={busy ? "true" : "false"}
          data-status={statusMod}
        >
          <header className="upgrade-head">
            <h3 id="upgrade-title" className="upgrade-title">
              Upgrade Sigil (Legacy → Modern)
            </h3>
            <button
              className="upgrade-close"
              onClick={onClose}
              aria-label="Close upgrade modal"
              onPointerDown={ripple}
            >
              ✕
            </button>
          </header>
  
          <div className="upgrade-body">
            <p id="upgrade-desc" className={`upgrade-badge upgrade-badge--${statusMod}`} aria-live="polite">
              {busy ? "Working…" : msg}
            </p>
  
            <div className="upgrade-row upgrade-kv">
              <b>Legacy hash</b><div className="mono mono-wrap">{legacy || "—"}</div>
              <b>Modern hash</b><div className="mono mono-wrap">{modern || "—"}</div>
              <b>Owner Φkey</b><div className="mono mono-wrap">{uploaded?.userPhiKey || "—"}</div>
              <b>Moment</b>
              <div>
                {uploaded
                  ? `Pulse ${uploaded.pulse.toLocaleString()} • Beat ${uploaded.beat}/36 • Step ${((stepIdx ?? 0) + 1)}/${uploaded.stepsPerBeat ?? STEPS_PER_BEAT} • ${uploaded.chakraDay}`
                  : "—"}
              </div>
            </div>
  
            <div
              className="upgrade-drop"
              tabIndex={0}
              role="button"
              onClick={onClickDrop}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClickDrop(); } }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
              onDrop={onDrop}
              onPaste={onPaste}
              aria-label="Upload your legacy SVG Φkey"
            >
              <div className="upgrade-drop__title">
                Drop your <b>SVG Φkey</b> here, click to choose, or paste from clipboard.
              </div>
              <div className="upgrade-drop__sub">
                We’ll verify it’s the same sealed moment and matches this legacy link.
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".svg,image/svg+xml"
                className="upgrade-file sr-only"
                onChange={(e) => void handleFiles(e.target.files)}
              />
            </div>
  
            {generatedUrl && (
              <div className="upgrade-urlbox">
                <div className="upgrade-urlbox__head"><b>Modern transfer link</b></div>
                <div className="mono mono-wrap">{generatedUrl}</div>
                <div className="upgrade-actions" style={{ justifyContent: "flex-start" }}>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => copy(generatedUrl)}
                    onPointerDown={ripple}
                  >
                    Remember link
                  </button>
                  <a
                    href={generatedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="upgrade-cta"
                    onPointerDown={ripple}
                  >
                    Open link
                  </a>
                </div>
              </div>
            )}
  
            <div className="upgrade-actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={onClose}
                onPointerDown={ripple}
              >
                Close
              </button>
              <button
                type="button"
                className="upgrade-cta"
                onClick={generateLink}
                onPointerDown={ripple}
                disabled={!readyToUpgrade || !onGenerateLink || busy}
                aria-busy={busy ? "true" : "false"}
                data-busy={busy ? "true" : "false"}
                title={readyToUpgrade ? "Create a modern transfer link" : "Verify a legacy SVG first"}
              >
                Create modern transfer link
              </button>
            </div>
  
            {/* a11y live region for subtle updates */}
            <div className="sr-only" aria-live="polite" aria-atomic="true">
              {busy ? "Working…" : msg}
            </div>
          </div>
        </div>
      </div>
    );
  }
  