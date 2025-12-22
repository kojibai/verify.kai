// src/components/KaiVoh/StoryRecorder.tsx
"use client";

/**
 * StoryRecorder
 * v1.0 — Instagram/TikTok style story capture (tap/hold record, progress ring, mic toggle, camera flip, torch if supported)
 *
 * - No `any`. Strict types and guards.
 * - MediaRecorder + getUserMedia with mime-type negotiation (Safari/webm/h264 fallback).
 * - Hold to record OR tap to toggle.
 * - Max duration (default 15s). Progress ring + timer.
 * - Captures thumbnail PNG, computes SHA-256, returns File + meta via onCaptured.
 * - Torch support when available (back camera + capability).
 * - Graceful permission and support errors.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import "./styles/StoryRecorder.css";
import { kairosEpochNow } from "../../utils/kai_pulse";

export type CapturedStory = {
  blob: Blob;
  file: File;
  mimeType: string;
  durationMs: number;
  width: number;
  height: number;
  thumbnailDataUrl: string;
  sha256: string;
  createdAt: number; // Date.now()
};

type Facing = "user" | "environment";

type StoryRecorderProps = {
  isOpen: boolean;
  onClose: () => void;
  onCaptured: (story: CapturedStory) => void;
  maxDurationMs?: number; // default 15000
  preferredFacingMode?: Facing; // default "user"
};

const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4;codecs=h264,aac", // Safari iOS
  "video/mp4",
] as const;

const SUPPORTS_MEDIA_RECORDER = typeof window !== "undefined" && "MediaRecorder" in window;

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", buf);
  const u8 = new Uint8Array(h);
  let out = "";
  for (let i = 0; i < u8.length; i++) out += u8[i].toString(16).padStart(2, "0");
  return out;
}

function pickSupportedMime(): string | undefined {
  if (!SUPPORTS_MEDIA_RECORDER) return undefined;
  for (const cand of MIME_CANDIDATES) {
    if ((window as unknown as { MediaRecorder: typeof MediaRecorder }).MediaRecorder.isTypeSupported(cand)) {
      return cand;
    }
  }
  return undefined;
}

export default function StoryRecorder(props: StoryRecorderProps) {
  const {
    isOpen,
    onClose,
    onCaptured,
    maxDurationMs = 15_000,
    preferredFacingMode = "user",
  } = props;

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);

  const [facing, setFacing] = useState<Facing>(preferredFacingMode);
  const [muted, setMuted] = useState<boolean>(false);
  const [torch, setTorch] = useState<boolean>(false);
  const [torchSupported, setTorchSupported] = useState<boolean>(false);

  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0); // 0..1
  const [durationMs, setDurationMs] = useState<number>(0);

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTsRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  const supportedMime = useMemo(() => pickSupportedMime(), []);
function epochMsNow(): number {
  const p = typeof performance !== "undefined" ? performance : null;
  const origin = p && typeof p.timeOrigin === "number" ? p.timeOrigin : NaN;
  const now = p ? p.now() : NaN;
  const ms = origin + now;
  if (Number.isFinite(ms)) return Math.floor(ms);
  return Date.now();
}

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      setErr(null);
      setBusy(true);
      try {
        await initCamera();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to access camera.";
        setErr(msg);
      } finally {
        setBusy(false);
      }
    })();
    return () => {
      stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, facing, muted]);

  useEffect(() => {
    if (!isOpen) return;
    // Try torch capability (only back camera tends to have it)
    checkTorchCapability().catch(() => setTorchSupported(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, facing]);

  async function initCamera(): Promise<void> {
    stopAll();
    const constraints: MediaStreamConstraints = {
      audio: { echoCancellation: true, noiseSuppression: true },
      video: {
        facingMode: facing,
        width: { ideal: 1080 },
        height: { ideal: 1920 },
        frameRate: { ideal: 30, max: 60 },
      },
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.muted = true;
      await videoRef.current.play().catch(() => {
        /* autoplay may require interaction; UI covers record button */
      });
    }
    await applyTorchState(torch && torchSupported);
  }

  function stopAll() {
    stopRecording(true);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop();
    }
    streamRef.current = null;
    setTorch(false);
    setIsRecording(false);
    setProgress(0);
    setDurationMs(0);
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }

  async function checkTorchCapability(): Promise<void> {
    const stream = streamRef.current;
    if (!stream) {
      setTorchSupported(false);
      return;
    }
    const [videoTrack] = stream.getVideoTracks();
    if (!videoTrack) {
      setTorchSupported(false);
      return;
    }
    const caps = (videoTrack.getCapabilities?.() ?? {}) as unknown;
    const torchCap = typeof (caps as Record<string, unknown>).torch === "boolean"
      ? (caps as Record<string, unknown>).torch as boolean
      : false;
    setTorchSupported(Boolean(torchCap) && facing === "environment");
  }

  async function applyTorchState(enabled: boolean): Promise<void> {
    const stream = streamRef.current;
    if (!stream) return;
    const [videoTrack] = stream.getVideoTracks();
    if (!videoTrack || !videoTrack.applyConstraints) return;
    try {
      if (torchSupported && facing === "environment") {
        await videoTrack.applyConstraints({ advanced: [{ torch: enabled }] as unknown as MediaTrackConstraints[] });
      }
    } catch {
      // Ignore torch errors
    }
  }

  function handleFlipCamera() {
    setFacing((prev) => (prev === "user" ? "environment" : "user"));
  }

  function handleToggleMute() {
    setMuted((m) => !m);
  }

  async function handleToggleTorch() {
    if (!torchSupported) return;
    const next = !torch;
    setTorch(next);
    await applyTorchState(next);
  }

  function trackProgressLoop() {
    if (!isRecording) return;
    const elapsed = performance.now() - startTsRef.current;
    setDurationMs(elapsed);
    setProgress(Math.min(1, elapsed / maxDurationMs));
    if (elapsed >= maxDurationMs) {
      stopRecording(false);
      return;
    }
    rafRef.current = requestAnimationFrame(trackProgressLoop);
  }

  function startRecording() {
    if (!SUPPORTS_MEDIA_RECORDER) {
      setErr("MediaRecorder is not supported on this browser.");
      return;
    }
    if (isRecording) return;
    setErr(null);

    const stream = streamRef.current;
    if (!stream) {
      setErr("No camera stream.");
      return;
    }

    // Apply audio mute by disabling audio track
    for (const t of stream.getAudioTracks()) {
      t.enabled = !muted;
    }

    const mime = supportedMime ?? "";
    let rec: MediaRecorder;
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3_500_000 }) : new MediaRecorder(stream);
    } catch {
      rec = new MediaRecorder(stream);
    }

    recRef.current = rec;
    chunksRef.current = [];
    rec.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };
    rec.onstop = () => {
      void finalizeRecording();
    };

    rec.start(250); // small timeslice to reduce memory spikes
    setIsRecording(true);
    startTsRef.current = performance.now();
    rafRef.current = requestAnimationFrame(trackProgressLoop);
  }

  function stopRecording(cancel: boolean) {
    if (!isRecording) return;
    const r = recRef.current;
    if (!r) return;
    try {
      if (r.state !== "inactive") r.stop();
    } catch {
      /* ignore */
    }
    setIsRecording(false);
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (cancel) {
      chunksRef.current = [];
      setProgress(0);
      setDurationMs(0);
    }
  }

  async function finalizeRecording() {
    const chunks = chunksRef.current;
    chunksRef.current = [];
    if (!chunks.length) return;

    const dMs = Math.max(0, Math.min(maxDurationMs, performance.now() - startTsRef.current));
    const mimeType = recRef.current?.mimeType || supportedMime || "video/webm";

    const blob = new Blob(chunks, { type: mimeType });

    // ✅ createdAt must be epoch-ms number (File.lastModified expects number)
    const createdAt = epochMsNow();

    // ✅ Kai μpulses for deterministic Kai timestamping / naming
    const createdAtKaiMicro = kairosEpochNow(BigInt(createdAt));

    // Generate thumbnail
    const { width, height, thumbnailDataUrl } = await extractThumb(blob);

    // SHA-256
    const buf = await blob.arrayBuffer();
    const sha256 = await sha256Hex(buf);

    const fileName = `story_${createdAtKaiMicro.toString()}.${mimeType.includes("mp4") ? "mp4" : "webm"}`;
    const file = new File([blob], fileName, { type: mimeType, lastModified: createdAt });

    const captured: CapturedStory = {
      blob,
      file,
      mimeType,
      durationMs: dMs,
      width,
      height,
      thumbnailDataUrl,
      sha256,
      createdAt,
    };

    onCaptured(captured);
  }


  async function extractThumb(blob: Blob): Promise<{ width: number; height: number; thumbnailDataUrl: string }> {
    const url = URL.createObjectURL(blob);
    try {
      const v = document.createElement("video");
      v.src = url;
      v.muted = true;
      await v.play().catch(() => void 0);
      await new Promise<void>((resolve) => {
        const cleanup = () => {
          v.pause();
          v.currentTime = 0;
        };
        const onLoaded = () => {
          cleanup();
          resolve();
        };
        v.onloadeddata = onLoaded;
        // If onloadeddata doesn't fire quickly, wait a moment then try draw anyway
        setTimeout(onLoaded, 250);
      });
      const w = v.videoWidth || 1080;
      const h = v.videoHeight || 1920;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (ctx) {
        ctx.drawImage(v, 0, 0, w, h);
      }
      const dataUrl = c.toDataURL("image/png", 0.9);
      return { width: w, height: h, thumbnailDataUrl: dataUrl };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Gesture support: hold to record, release to stop; or tap toggle
  function handleRecordPointerDown() {
    if (!isRecording) startRecording();
  }
  function handleRecordPointerUp() {
    if (isRecording) stopRecording(false);
  }
  function handleRecordTap() {
    if (isRecording) stopRecording(false);
    else startRecording();
  }

  if (!isOpen) return null;

  return (
    <div className="story-rec-overlay" role="dialog" aria-modal="true" aria-label="Story recorder">
      <div className="story-rec-video-wrap">
        <video ref={videoRef} className={`story-rec-video ${facing === "user" ? "mirror" : ""}`} playsInline />
      </div>

      <div className="story-rec-topbar">
        <button
          type="button"
          className="story-btn top left"
          aria-label="Close"
          onClick={() => {
            stopAll();
            onClose();
          }}
        >
          ✕
        </button>

        <div className="story-top-center">
          <div className="story-timer mono">
            {formatMs(durationMs)} / {formatMs(maxDurationMs)}
          </div>
        </div>

        <div className="story-top-actions">
          <button
            type="button"
            className={`story-btn ${muted ? "active" : ""}`}
            aria-pressed={muted}
            aria-label={muted ? "Unmute microphone" : "Mute microphone"}
            onClick={handleToggleMute}
            title={muted ? "Unmute mic" : "Mute mic"}
          >
            {muted ? "🔇" : "🎙️"}
          </button>
          <button
            type="button"
            className={`story-btn ${facing === "environment" && torchSupported ? "" : "disabled"}`}
            disabled={!(facing === "environment" && torchSupported)}
            onClick={() => void handleToggleTorch()}
            aria-label="Toggle torch"
            title={torchSupported ? (torch ? "Torch on" : "Torch off") : "Torch not supported"}
          >
            {torch ? "🔦" : "💡"}
          </button>
          <button
            type="button"
            className="story-btn"
            aria-label="Flip camera"
            onClick={handleFlipCamera}
            title="Flip camera"
          >
            🔁
          </button>
        </div>
      </div>

      <div className="story-rec-bottombar">
        <div className="record-wrap">
          <button
            type="button"
            className={`record-btn ${isRecording ? "recording" : ""}`}
            aria-pressed={isRecording}
            aria-label={isRecording ? "Stop recording" : "Start recording"}
            onClick={handleRecordTap}
            onPointerDown={handleRecordPointerDown}
            onPointerUp={handleRecordPointerUp}
            onPointerLeave={handleRecordPointerUp}
          >
            <span
              className="progress-ring"
              style={{ background: `conic-gradient(currentColor ${progress * 360}deg, transparent 0)` }}
            />
            <span className="dot" />
          </button>
        </div>
        {err && <div className="story-rec-error">{err}</div>}
        {busy && <div className="story-rec-hint">Initializing camera…</div>}
      </div>
    </div>
  );
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = Math.floor(s / 60)
    .toString()
    .padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}
