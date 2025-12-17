// src/components/KaiVoh/BreathSealer.tsx
"use client";

/**
 * BreathSealer — Kairos breath-encoded sealing step
 * v3.1 — Stable Identity Signature + Pure Timer
 *
 * Fixes:
 * ✅ No performance.now() (React purity / compiler-safe)
 * ✅ kaiSignature is the SESSION identity signature (stable) — prevents Φ-Key mismatch
 * ✅ Optional kksNonce + userPhiKey included for embedding/audit (doesn't change identity)
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import blake from "blakejs";
import { fetchKai, type ChakraDay } from "../../utils/kai_pulse";
import type { ComposedPost } from "./PostComposer";
import "./styles/BreathSealer.css";

export interface SealedPost {
  pulse: number;
  /** Identity signature (stable across session) */
  kaiSignature: string;
  chakraDay: ChakraDay | null;
  post: ComposedPost;

  /** Optional extras consumed by SignatureEmbedder (safe additions) */
  userPhiKey?: string | null;
  kksNonce?: string | null;
}

interface BreathSealerProps {
  post: ComposedPost;
  /** MUST be the verified session identity signature (from login) */
  identityKaiSignature: string;
  /** Optional: pass the session Φ-Key so embed metadata can carry it */
  userPhiKey?: string | null;
  onSealComplete: (sealed: SealedPost) => void;
}

type BreathPhase = "idle" | "inhale" | "exhale" | "sealed";

const PULSE_MS = 5236; // φ-breath duration
const TICK_MS = 50;

function isChakraDay(v: unknown): v is ChakraDay {
  return (
    v === "root" ||
    v === "sacral" ||
    v === "solar" ||
    v === "heart" ||
    v === "throat" ||
    v === "thirdEye" ||
    v === "crown" ||
    v === "krown"
  );
}

export default function BreathSealer({
  post,
  identityKaiSignature,
  userPhiKey,
  onSealComplete,
}: BreathSealerProps): React.ReactElement {
  const [breathPhase, setBreathPhase] = useState<BreathPhase>("idle");
  const [progress, setProgress] = useState(0); // 0 → 1 across inhale+exhale
  const [error, setError] = useState<string | null>(null);

  const timerRef = useRef<number | null>(null);
  const sealingRef = useRef(false);
  const elapsedRef = useRef(0);
  const mountedRef = useRef(true);

  const totalDuration = useMemo(() => PULSE_MS * 2, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current != null) window.clearInterval(timerRef.current);
    };
  }, []);

  const clearTimer = (): void => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startBreathCycle = (): void => {
    if (sealingRef.current) return;

    const sig = identityKaiSignature.trim();
    if (!sig) {
      setError("Missing identityKaiSignature (session signature). Please re-login.");
      setBreathPhase("idle");
      setProgress(0);
      return;
    }

    clearTimer();
    setError(null);
    setBreathPhase("inhale");
    setProgress(0);
    sealingRef.current = false;

    elapsedRef.current = 0;

    timerRef.current = window.setInterval(() => {
      // Pure timer: deterministic tick accumulator (no performance.now / Date.now)
      elapsedRef.current += TICK_MS;
      const elapsed = elapsedRef.current;

      if (elapsed < PULSE_MS) {
        setBreathPhase("inhale");
      } else if (elapsed < totalDuration) {
        setBreathPhase("exhale");
      } else {
        clearTimer();
        void sealNow();
        return;
      }

      const ratio = Math.min(elapsed / totalDuration, 1);
      setProgress(ratio);
    }, TICK_MS);
  };

  const sealNow = async (): Promise<void> => {
    if (sealingRef.current) return;
    sealingRef.current = true;

    try {
      const sig = identityKaiSignature.trim();
      if (!sig) throw new Error("Missing identityKaiSignature (session signature).");

      const kai = await fetchKai();
      const pulse = Number(kai.pulse ?? 0);

      const chakraDay: ChakraDay | null = isChakraDay(kai.chakraDay)
        ? kai.chakraDay
        : null;

      const fileName = post.file?.name ?? "unknown";
      // Nonce is per-file/per-pulse (audit / uniqueness) — NOT identity
      const kksNonce = blake.blake2bHex(`${fileName}-${pulse}`, undefined, 16);

      onSealComplete({
        pulse,
        kaiSignature: sig,          // ✅ identity signature (stable)
        chakraDay,
        post,
        userPhiKey: userPhiKey ?? null,
        kksNonce,
      });

      if (!mountedRef.current) return;
      setBreathPhase("sealed");
    } catch (e: unknown) {
      sealingRef.current = false;
      const msg =
        e instanceof Error
          ? e.message
          : "Failed to seal with live Kai pulse. Please try again.";
      if (!mountedRef.current) return;
      setError(msg);
      setBreathPhase("idle");
      setProgress(0);
    }
  };

  const phaseLabel: string = (() => {
    if (error) return "Error";
    switch (breathPhase) {
      case "idle":
        return "Ready to Breathe";
      case "inhale":
        return "Inhale";
      case "exhale":
        return "Exhale";
      case "sealed":
        return "Sealed in Kairos";
      default:
        return "Breath";
    }
  })();

  const inhalePercent = Math.round(Math.min(progress, 0.5) * 200);
  const exhalePercent = Math.round(Math.max(progress - 0.5, 0) * 200);

  const phaseText: string = (() => {
    if (error) return error;
    switch (breathPhase) {
      case "idle":
        return "Tap begin, inhale as the orb expands, exhale as it returns to stillness. We’ll seal at the end of your exhale.";
      case "inhale":
        return `Inhale slowly… ${inhalePercent}%`;
      case "exhale":
        return `Exhale and let go… ${50 + exhalePercent}% — sealing this breath into KaiOS.`;
      case "sealed":
        return "Sealed on a live Kai pulse. Advancing to embed…";
      default:
        return "";
    }
  })();

  const orbEmoji: string = (() => {
    if (error) return "⚠️";
    switch (breathPhase) {
      case "idle":
        return "🌬";
      case "inhale":
        return "🫁";
      case "exhale":
        return "🌀";
      case "sealed":
        return "✨";
      default:
        return "🌬";
    }
  })();

  const fileNameShort =
    post.file?.name && post.file.name.length > 40
      ? `${post.file.name.slice(0, 22)}…${post.file.name.slice(-12)}`
      : post.file?.name ?? "Unnamed glyph";

  return (
    <div className="kv-breath-root" data-phase={breathPhase} aria-live="polite">
      <div className="kv-breath-meta">
        <div className="kv-breath-meta-left">
          <span className="kv-breath-pill">Breath Seal • φ 5.236s</span>
          <span className="kv-breath-file" title={post.file?.name}>
            {fileNameShort}
          </span>
        </div>
        <div className="kv-breath-meta-right">
          <span className="kv-breath-tag">Live Kai Pulse</span>
        </div>
      </div>

      <div className="kv-breath-orb-row">
        <div className="kv-breath-orb" aria-label={`Breath phase: ${phaseLabel}`}>
          <div className="kv-breath-orb-inner">
            <span className="kv-breath-orb-emoji">{orbEmoji}</span>
          </div>
          <div
            className="kv-breath-orb-ring"
            style={
              {
                "--kv-breath-progress": progress,
              } as React.CSSProperties
            }
          />
        </div>

        <div className="kv-breath-status">
          <div className="kv-breath-status-row">
            <span className="kv-breath-status-label">{phaseLabel}</span>
            <span className="kv-breath-status-percent">{Math.round(progress * 100)}%</span>
          </div>
          <p className="kv-breath-status-text">{phaseText}</p>

          <div className="kv-breath-bars">
            <div className="kv-breath-bar">
              <span className="kv-breath-bar-label">Inhale</span>
              <div className="kv-breath-bar-track" aria-hidden="true">
                <div
                  className="kv-breath-bar-fill kv-breath-bar-fill--inhale"
                  style={{ width: `${inhalePercent}%` }}
                />
              </div>
            </div>

            <div className="kv-breath-bar">
              <span className="kv-breath-bar-label">Exhale</span>
              <div className="kv-breath-bar-track" aria-hidden="true">
                <div
                  className="kv-breath-bar-fill kv-breath-bar-fill--exhale"
                  style={{ width: `${exhalePercent}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="kv-breath-actions">
        {breathPhase === "idle" && !sealingRef.current && !error && (
          <button type="button" onClick={startBreathCycle} className="kv-breath-btn kv-breath-btn-primary">
            Begin Breath
          </button>
        )}

        {error && breathPhase === "idle" && (
          <button type="button" onClick={startBreathCycle} className="kv-breath-btn kv-breath-btn-warning">
            Retry Breath Seal
          </button>
        )}

        {breathPhase !== "idle" && breathPhase !== "sealed" && !error && (
          <button type="button" className="kv-breath-btn kv-breath-btn-ghost" disabled>
            Sealing on this exhale…
          </button>
        )}

        {breathPhase === "sealed" && (
          <div className="kv-breath-sealed-note">Sealed. The stream will remember this breath forever.</div>
        )}
      </div>
    </div>
  );
}
