import { getLiveKaiPulse } from "./kai_pulse";

// 📐 Harmonic Constants
export const PHI = (1 + Math.sqrt(5)) / 2; // ≈ 1.6180339887
export const KAI_PULSE_SECONDS = (3 + Math.sqrt(5)) * 1000;

// 🕰️ Kairos Time Structure
export const BREATHS_PER_STEP = 11;
export const STEPS_PER_BEAT = 44;
export const BEATS_PER_DAY = 36;
export const DAYS_PER_WEEK = 6;
export const WEEKS_PER_MONTH = 7;
export const MONTHS_PER_YEAR = 8;

export const DAYS_PER_MONTH = DAYS_PER_WEEK * WEEKS_PER_MONTH; // 42
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR; // 336

// 🔁 Harmonic Time Units (Seconds)
export const STEP_SECONDS = BREATHS_PER_STEP * KAI_PULSE_SECONDS;         // 57.5822
export const BEAT_SECONDS = STEPS_PER_BEAT * STEP_SECONDS;                // 2533.6180
export const DAY_SECONDS = BEATS_PER_DAY * BEAT_SECONDS;                  // 91210.2471
export const YEAR_SECONDS = DAYS_PER_YEAR * DAY_SECONDS;                  // 30,646,643.04

// 🔂 Pulses
export const PULSES_PER_DAY = BREATHS_PER_STEP * STEPS_PER_BEAT * BEATS_PER_DAY; // 17424

// 📅 Genesis Pulse (Epoch Origin)
export const GENESIS_PULSE_UNIX = Date.UTC(2024, 4, 10, 6, 45, 41, 888); // May 10, 2024 06:45:41:888 UTC

// 🌀 Logarithmic Phi Epochs — Breath-based Time Layers
export function getPhiEpochs(count: number = 9): number[] {
  const epochs: number[] = [];
  for (let i = 0; i < count; i++) {
    epochs.push(KAI_PULSE_SECONDS * Math.pow(PHI, i));
  }
  return epochs;
}

// 📅 Calculate Kairos Day
export function calculateKairosDay(): number {
  const kaiPulses = getLiveKaiPulse();
  const day = Math.floor(kaiPulses / PULSES_PER_DAY);
  return day;
}

// 🜂 Sigil from Spiral Ark Harmonic Pattern
export function generateSigilFromNumber(n: number): string {
  const codes = ["🜂", "🜁", "🜃", "🜄", "☉", "☿", "♄", "♃", "♇"];
  return codes[n % codes.length];
}

// 🧬 Dynamic SVG Sigil Generator for Today
export function getTodaySigilSvg(): string {
  const day = calculateKairosDay();
  const sigil = generateSigilFromNumber(day);

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <rect fill="black" width="100%" height="100%"/>
    <text x="50%" y="50%" fill="white" font-size="80" text-anchor="middle" dominant-baseline="middle">
      ${sigil}
    </text>
  </svg>
  `;
}
