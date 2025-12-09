// src/components/KaiRealms/GamePortal.tsx
"use client";

import "./styles/GamePortal.css";   // component-specific polish (Atlantean Glass)
import "./styles/KaiRealms.css"; 
import React, {
  useCallback,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { parseSigilGlyph, type GlyphData } from "./GlyphUtils";

/** Props */
type Props = {
  onEnter: (data: GlyphData) => void;
};

/** Accept only SVG sigils */
const ACCEPT = ".svg,image/svg+xml";

/** Atlantean Glass — Minimal: ONLY the “Drop your Kai Sigil” gate */
const GamePortal: React.FC<Props> = ({ onEnter }) => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const titleId = useId(); // for SR-only heading
  const hintId = useId();
  const errorId = useId();

  const resetField = (): void => {
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleProcess = useCallback(
    async (file: File) => {
      setError(null);
      setFileName(file.name);
      setLoading(true);
      try {
        const typeOk =
          file.type === "image/svg+xml" ||
          file.name.toLowerCase().endsWith(".svg");
        if (!typeOk) throw new Error("Please upload a valid Kai Sigil (.svg).");

        const glyph = await parseSigilGlyph(file);
        onEnter(glyph);
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Invalid glyph or missing metadata.";
        setError(msg);
      } finally {
        setLoading(false);
        resetField();
      }
    },
    [onEnter]
  );

  const onPick = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await handleProcess(file);
    },
    [handleProcess]
  );

  const onDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      await handleProcess(file);
    },
    [handleProcess]
  );

  const onDragOver = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!dragActive) setDragActive(true);
  };

  const onDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragActive(false);
  };

  const triggerPicker = (): void => inputRef.current?.click();

  const onKeyActivate = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      triggerPicker();
    }
  };

  return (
    <section
      className="portal-card glass-omni"
      aria-labelledby={titleId}
      aria-describedby={hintId}
    >
      {/* Sacred rings + phi grid */}
      <div className="breath-ring breath-ring--outer" aria-hidden />
      <div className="breath-ring breath-ring--inner" aria-hidden />
      <div className="phi-grid" aria-hidden />

      {/* SR-only title for accessibility (no visual header/orbs) */}
      <h1 id={titleId} className="sr-only">
        Drop your Kai Sigil
      </h1>

      {/* body (dropzone ONLY) */}
      <div className="portal-body">
        <div
          className={`dropzone ${dragActive ? "dropzone--active" : ""} ${
            loading ? "dropzone--busy" : ""
          }`}
          role="button"
          tabIndex={0}
          onKeyDown={onKeyActivate}
          onClick={triggerPicker}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          aria-busy={loading}
          aria-describedby={`${hintId}${error ? ` ${errorId}` : ""}`}
        >
          {/* breathing ornament */}
          <div className="dropzone-ornament" aria-hidden>
            <div className="ornament-ring ornament-ring--outer" />
            <div className="ornament-ring ornament-ring--inner" />
            <div className="ornament-core" />
          </div>

          <div className="dropzone-icon" aria-hidden>
            <svg width="44" height="44" viewBox="0 0 44 44">
              <defs>
                <linearGradient id="dzG" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#00ffd0" />
                  <stop offset="100%" stopColor="#8a2be2" />
                </linearGradient>
              </defs>
              <circle cx="22" cy="22" r="20" fill="none" stroke="url(#dzG)" strokeWidth="1.5" />
              <path
                d="M22 12 L22 30 M14 20 L22 12 L30 20"
                stroke="url(#dzG)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </div>

          <div className="dropzone-text">
            <div className="dz-title">Inhale your Kai Sigil</div>
            <div id={hintId} className="dz-hint">
              Breath-minted <strong>Φkey</strong> only. Drag & drop.
            </div>

            {fileName && !loading && !error ? (
              <div className="dz-file">Selected: {fileName}</div>
            ) : null}

            {loading ? (
              <div className="dz-progress">
                <div className="dz-spinner" />
                <span>Verifying…</span>
              </div>
            ) : null}
          </div>

          {/* Hidden input */}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            onChange={onPick}
            tabIndex={-1}
            aria-hidden
            className="dz-input"
          />
        </div>

        {/* Error */}
        {error ? (
          <div id={errorId} className="portal-error" role="alert" aria-live="polite">
            {error}
          </div>
        ) : null}

        {/* Fine print */}
        <p className="portal-note">
          Your sigil is verified by breath. No drift. Only truth.
        </p>
      </div>

      {/* no footer, no header orbs, no center wheel */}
      <span className="sr-only">Kai Realms sigil gate ready.</span>
    </section>
  );
};

export default GamePortal;
