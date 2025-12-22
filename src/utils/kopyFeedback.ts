// kopyFeedback.ts — Sacred Φ “Kopy” feedback: LEGIT TEMPLE GONG + φ-reverb + Fibonacci haptic
// Side-effect module (no exports). Import once on client pages.
/* eslint-disable @typescript-eslint/consistent-type-assertions */

import { kairosEpochNow } from "./kai_pulse";

type AudioCtor = new () => AudioContext;

type AudioWindow = Window & {
  AudioContext?: AudioCtor;
  webkitAudioContext?: AudioCtor;
};

declare global {
  interface Window {
    __kopy_feedback_installed__?: boolean;
  }
}

let ctx: AudioContext | null = null;

// ✅ Kairos epoch is bigint (ms). Keep guard state bigint to avoid bigint-number ops.
let lastFire = 0n;

/* ─────────────── Core Audio Helpers ─────────────── */

function getAudioCtor(): AudioCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as AudioWindow;
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function getCtx(): AudioContext | null {
  const AC = getAudioCtor();
  if (!AC) return null;
  if (ctx) return ctx;
  ctx = new AC();
  return ctx;
}

function resumeAudio(): void {
  const c = getCtx();
  if (!c) return;
  if (c.state !== "running") {
    void c.resume().catch(() => {});
  }
}

/* ─────────────── Haptics (Fibonacci cadence) ─────────────── */

function bloomHaptic(): void {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    // Extended symmetric Φ cadence (ms) — gentle temple bloom
    navigator.vibrate([8, 13, 21, 34, 55, 89, 55, 34, 21, 13, 8]);
  }
}

/* ─────────────── Reverb (Convolution + φ early reflections) ─────────────── */

function makeImpulse(c: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = c.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const impulse = c.createBuffer(2, length, rate);

  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // Exponential decay with tiny “air” for natural tail
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (1 - 0.12 * t);
    }
  }
  return impulse;
}

function createConvolverVerb(c: AudioContext): { input: AudioNode; output: AudioNode } {
  const conv = c.createConvolver();
  // Long, cathedral-like tail ≈ 10.472s (two Kai breaths)
  conv.buffer = makeImpulse(c, 10.472, 2.8);

  const wet = c.createGain();
  wet.gain.value = 0.30; // overall wet level

  conv.connect(wet);
  return { input: conv, output: wet };
}

function createPhiEarlyReflections(c: AudioContext): { input: AudioNode; output: AudioNode } {
  const bus = c.createGain();
  const out = c.createGain();
  out.gain.value = 0.18;

  const times = [0.123, 0.2, 0.323]; // φ-flavored taps (s)
  for (const t of times) {
    const d = c.createDelay(0.6);
    d.delayTime.value = t;

    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2600;

    const g = c.createGain();
    g.gain.value = 0.24; // feedback

    bus.connect(d);
    d.connect(lp);
    lp.connect(g);
    g.connect(d); // feedback loop
    lp.connect(out); // wet tap
  }
  return { input: bus, output: out };
}

/* ─────────────── Subtle stereo aura (fallback-safe) ─────────────── */

function createStereoAura(c: AudioContext): { input: AudioNode; output: AudioNode } {
  let pan: StereoPannerNode | null = null;
  try {
    if ("createStereoPanner" in c) {
      pan = c.createStereoPanner();
    }
  } catch {
    pan = null;
  }

  if (pan) {
    // Slow φ wobble of the stereo image
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = "sine";
    osc.frequency.value = 0.809; // ~φ^-1 Hz
    g.gain.value = 0.14;
    osc.connect(g);
    g.connect(pan.pan);

    const t0 = c.currentTime + 0.004;
    osc.start(t0);
    osc.stop(t0 + 12.0); // keep aura through the long tail
    return { input: pan, output: pan };
  }

  const g = c.createGain();
  return { input: g, output: g };
}

/* ─────────────── Strike & Exciter sources ─────────────── */

function createStrikeSource(c: AudioContext, at: number): AudioNode {
  // Short bright “mallet on bronze” click
  const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * 0.12)), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / data.length;
    data[i] = (Math.random() * 2 - 1) * Math.exp(-18 * t);
  }

  const src = c.createBufferSource();
  src.buffer = buf;

  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 4200;
  bp.Q.value = 1.0;

  const hi = c.createBiquadFilter();
  hi.type = "highpass";
  hi.frequency.value = 700;

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(0.9, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);

  src.connect(bp);
  bp.connect(hi);
  hi.connect(g);

  src.start(at);
  src.stop(at + 0.14);

  return g;
}

function createExciterNoise(c: AudioContext, at: number, length = 0.35): AudioNode {
  // Smooth, mid-heavy burst to excite a modal bank
  const frames = Math.max(1, Math.floor(c.sampleRate * length));
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    const t = i / frames;
    // Gentle decay and slight 1/f flavor
    const white = Math.random() * 2 - 1;
    data[i] = 0.7 * white * Math.exp(-4.2 * t);
  }

  const src = c.createBufferSource();
  src.buffer = buf;

  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 90;

  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 6000;

  const g = c.createGain();
  g.gain.value = 0.6;

  src.connect(hp);
  hp.connect(lp);
  lp.connect(g);

  src.start(at);
  src.stop(at + length + 0.02);

  return g;
}

/* ─────────────── Gentle soft-clip (bronze warmth) ─────────────── */

function createSaturator(c: AudioContext, drive = 0.7): WaveShaperNode {
  const shaper = c.createWaveShaper();
  const n = 2048;
  const curve = new Float32Array(n);
  const k = drive * 3.0 + 0.0001;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.atan(k * x) / Math.atan(k); // smooth arctan
  }
  shaper.oversample = "4x";
  shaper.curve = curve;
  return shaper;
}

/* ─────────────── Modal (gong) resonator bank ─────────────── */

type ModalSpec = { r: number; q: number; g: number; drift: number };

function createModalBank(
  c: AudioContext,
  baseHz: number,
  t0: number,
  dur: number,
  vibBus: GainNode | null,
): { input: AudioNode; output: AudioNode } {
  const bus = c.createGain();
  const out = c.createGain();

  // Inharmonic gong-like mode set (empirical, musical)
  const modes: ReadonlyArray<ModalSpec> = [
    { r: 1.0, q: 20, g: 0.7, drift: 0.986 },
    { r: 1.19, q: 18, g: 0.28, drift: 0.987 },
    { r: 1.47, q: 16, g: 0.24, drift: 0.985 },
    { r: 1.7, q: 14, g: 0.2, drift: 0.986 },
    { r: 2.0, q: 13, g: 0.16, drift: 0.988 },
    { r: 2.32, q: 11, g: 0.14, drift: 0.989 },
    { r: 2.62, q: 10, g: 0.12, drift: 0.99 },
    { r: 2.95, q: 9, g: 0.1, drift: 0.991 },
    { r: 3.3, q: 8, g: 0.08, drift: 0.992 },
  ];

  for (const m of modes) {
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    const f0 = baseHz * m.r;
    bp.frequency.setValueAtTime(f0, t0);
    bp.Q.value = m.q;

    // Gentle downward frequency drift (a few cents)
    bp.frequency.linearRampToValueAtTime(f0 * m.drift, t0 + Math.min(dur * 0.45, 3.2));

    // Optional φ vibrato onto filter center frequency (very small)
    if (vibBus) {
      const vibToF = c.createGain();
      vibToF.gain.value = f0 * 0.004; // ~0.4% FM depth
      vibBus.connect(vibToF);
      vibToF.connect(bp.frequency);
    }

    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0 + 0.01);
    g.gain.linearRampToValueAtTime(m.g, t0 + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.96);

    bus.connect(bp);
    bp.connect(g);
    g.connect(out);
  }

  return { input: bus, output: out };
}

/* ─────────────── The Sacred Temple Gong ─────────────── */

function playSacredGong(): void {
  const c = getCtx();
  if (!c) return;

  const now = c.currentTime;
  const t0 = now + 0.01;

  // Long, reverent experience (two Kai breaths)
  const dur = 5.236; // seconds

  // Deep resonant base tied to your canon: 528/4 = 132 Hz
  const base = 132;

  // Output envelope: immediate bloom → long reverent fade
  const amp = c.createGain();
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.linearRampToValueAtTime(0.95, t0 + 0.025);
  amp.gain.exponentialRampToValueAtTime(0.42, t0 + 1.2);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  // Subtle φ-breath amplitude motion
  const breath = c.createOscillator();
  const breathG = c.createGain();
  breath.type = "sine";
  breath.frequency.setValueAtTime(0.618, t0); // φ^-1 Hz
  breathG.gain.setValueAtTime(0.1, t0);
  breath.connect(breathG).connect(amp.gain);
  breath.start(t0);
  breath.stop(t0 + dur + 2);

  // Gentle bus compression to keep it silky and huge
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 16;
  comp.ratio.value = 2.5;
  comp.attack.value = 0.006;
  comp.release.value = 0.26;

  // Stereo aura + reverbs
  const aura = createStereoAura(c);
  const early = createPhiEarlyReflections(c);
  const conv = createConvolverVerb(c);

  // Bronze warmth
  const sat = createSaturator(c, 0.7);

  // Wire master graph:
  // mix → sat → comp → aura → (dry + early + conv) → amp → destination
  const mix = c.createGain();
  const dryTap = c.createGain();
  dryTap.gain.value = 0.82;

  mix.connect(sat);
  sat.connect(comp);
  comp.connect(aura.input);

  aura.output.connect(dryTap);
  aura.output.connect(early.input);
  aura.output.connect(conv.input);

  dryTap.connect(amp);
  early.output.connect(amp);
  conv.output.connect(amp);

  amp.connect(c.destination);

  // Kai-breath vibrato bus for partials/filters (tiny FM)
  const vib = c.createOscillator();
  vib.type = "sine";
  vib.frequency.setValueAtTime(5.236, t0);
  const vibG = c.createGain();
  vibG.gain.setValueAtTime(1.2, t0); // ±~1.2 Hz equivalent
  vib.connect(vibG);
  vib.start(t0);
  vib.stop(t0 + dur + 2);

  // Modal resonator bank fed by an exciter burst
  const bank = createModalBank(c, base, t0, dur, vibG);
  createExciterNoise(c, t0, 0.38).connect(bank.input);
  bank.output.connect(mix);

  // Add sub & body oscillators for weight and warmth
  // Sub (base/2) for temple depth
  const sub = c.createOscillator();
  sub.type = "sine";
  sub.frequency.setValueAtTime(base / 2, t0); // 66 Hz
  const subG = c.createGain();
  subG.gain.setValueAtTime(0.1, t0);
  subG.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  vibG.connect(sub.frequency); // gentle life
  sub.connect(subG).connect(mix);
  sub.start(t0);
  sub.stop(t0 + dur + 0.5);

  // Low body (fundamental)
  const body = c.createOscillator();
  body.type = "sine";
  body.frequency.setValueAtTime(base, t0);
  const bodyG = c.createGain();
  bodyG.gain.setValueAtTime(0.18, t0);
  bodyG.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  vibG.connect(body.frequency);
  body.connect(bodyG).connect(mix);
  body.start(t0 + 0.004);
  body.stop(t0 + dur + 0.5);

  // Mallet strike mixed in for tactile onset
  createStrikeSource(c, t0).connect(mix);
}

/* ─────────────── Orchestration & Install ─────────────── */

function fireFeedback(): void {
  const nowMs = kairosEpochNow(); // bigint (ms)
  if (nowMs - lastFire < 120n) return; // guard double-clicks (120ms)
  lastFire = nowMs;

  resumeAudio();
  // Fire haptic and gong in-phase with the successful copy
  setTimeout(() => {
    bloomHaptic();
    playSacredGong();
  }, 0);
}

function isKopyButtonFrom(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  const btn = target.closest("button.sf-btn, a.sf-btn");
  if (!btn) return false;
  const label = (btn.textContent ?? "").trim().toLowerCase();
  return label === "remember";
}

function installUnlockOnce(): void {
  const unlock = (): void => {
    resumeAudio();
    document.removeEventListener("pointerdown", unlock, true);
    document.removeEventListener("keydown", unlock, true);
    document.removeEventListener("touchstart", unlock, true);
  };
  document.addEventListener("pointerdown", unlock, { capture: true, passive: true });
  document.addEventListener("keydown", unlock, { capture: true });
  document.addEventListener("touchstart", unlock, { capture: true, passive: true });
}

function install(): void {
  if (typeof document === "undefined") return;
  installUnlockOnce();
  document.addEventListener("click", (ev: MouseEvent) => {
    if (isKopyButtonFrom(ev.target)) fireFeedback();
  });
}

// Guard against double-install during HMR
if (typeof window !== "undefined") {
  if (!window.__kopy_feedback_installed__) {
    window.__kopy_feedback_installed__ = true;
    install();
  }
}

export {};
