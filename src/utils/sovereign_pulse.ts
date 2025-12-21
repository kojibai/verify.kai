// src/utils/sovereign_pulse.ts
// Deterministic Kai pulse source (no Chronos/Date usage).
// - Breath-aligned oscillator uses only a monotonic performance origin.
// - Optional pulse overrides via env/localStorage ensure identical output on every device.

const BREATH_MS_FLOAT = (3 + Math.sqrt(5)) * 1000;
export const PULSE_MS = Math.round(BREATH_MS_FLOAT);
export const MICRO_PER_PULSE = 1_000_000n;

const OVERRIDE_KEY = "kai.override_pulse";
const BASE_KEY = "kai.base_pulse";

const hasPerformance = typeof performance !== "undefined";
const bootPerfMs = hasPerformance ? performance.now() : 0;

const readNumber = (raw: unknown): number | null => {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  return Number.isFinite(n) ? n : null;
};

const readEnv = (name: string): number | null => {
  // eslint-disable-next-line no-undef
  if (typeof import.meta === "object" && (import.meta as any).env) {
    // eslint-disable-next-line no-undef
    return readNumber((import.meta as any).env[name]);
  }
  return null;
};

const readStoredPulse = (key: string): number | null => {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(key);
    return readNumber(raw);
  } catch {
    return null;
  }
};

let overridePulse = readEnv("VITE_KAI_SOVEREIGN_PULSE") ?? readStoredPulse(OVERRIDE_KEY);
const basePulse =
  overridePulse ??
  readEnv("VITE_KAI_BASE_PULSE") ??
  readStoredPulse(BASE_KEY) ??
  0;

const baseMicro = BigInt(Math.trunc(basePulse)) * MICRO_PER_PULSE;

const elapsedMs = () => (hasPerformance ? Math.max(0, performance.now() - bootPerfMs) : 0);

const microFromElapsed = (ms: number): bigint => {
  if (ms <= 0) return 0n;
  // micro-pulses progressed since boot: (ms / PULSE_MS) * 1e6
  const micro = Math.floor((ms * 1_000_000) / PULSE_MS);
  return micro <= 0 ? 0n : BigInt(micro);
};

export function setSovereignPulseOverride(pulse: number) {
  if (!Number.isFinite(pulse)) return;
  overridePulse = Math.trunc(pulse);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(OVERRIDE_KEY, String(overridePulse));
    }
  } catch {
    // ignore storage failures; deterministic state still stays in memory
  }
}

export function sovereignMicroPulseNow(): bigint {
  if (overridePulse != null) return BigInt(Math.trunc(overridePulse)) * MICRO_PER_PULSE;
  return baseMicro + microFromElapsed(elapsedMs());
}

export function sovereignPulseNow(): number {
  const micro = sovereignMicroPulseNow();
  return Math.trunc(Number(micro / MICRO_PER_PULSE));
}

export function sovereignPulseFloat(): number {
  return Number(sovereignMicroPulseNow()) / Number(MICRO_PER_PULSE);
}

export function msUntilNextSovereignPulse(pulseNow?: number): number {
  if (overridePulse != null) return PULSE_MS;
  const p = Number.isFinite(pulseNow) ? pulseNow! : sovereignPulseFloat();
  const frac = p - Math.floor(p);
  const rem = (1 - frac) * PULSE_MS;
  return rem <= 0 ? PULSE_MS : rem;
}

