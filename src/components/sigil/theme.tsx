// src/components/sigil/theme.ts
export const CHAKRA_THEME = {
  Root: {
    hue: 0,
    accent: "#CC3F3F", // Darker red — grounding, blood, Earth core
  },
  Sacral: {
    hue: 24,
    accent: "#E86428", // Embodied fire, creative flow, womb of life
  },
  "Solar Plexus": {
    hue: 48,
    accent: "#E6B844", // Solar will, lion fire, sacred radiance
  },
  Heart: {
    hue: 140,
    accent: "#2CCB99", // Living emerald, breath of coherence
  },
  Throat: {
    hue: 190,
    accent: "#00D5AA", // Aqua truth, harmonic expression
  },
  "Third Eye": {
    hue: 260,
    accent: "#6B4AC0", // Violet indigo, deep inner vision
  },
  Crown: {
    hue: 300,
    accent: "#C25AA4", // Amethyst gate, spiral of return
  },
} as const;


export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1);

export default { CHAKRA_THEME, isIOS };
