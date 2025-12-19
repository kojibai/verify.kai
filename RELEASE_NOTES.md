# Release Notes — v29.3.9 (2025-12-19)

## Navigation & Loading
- Introduced an Atlantean Kai splash veil to cover first paint and navigation gaps on stream, feed, sigil, and token routes—phi-only badge, sr-only narration, and safe-area aware gradients keep the gateway immersive without touching the chrome views. This veil now respects a first-load gate and only renders where it belongs.
- Tuned the splash to breathe on a φ cadence (61.8% inhale) with circle-only aura, dual rings, and phi.svg glow; timers now use `requestAnimationFrame` and tighter fallbacks so the veil releases immediately after the next paint instead of lingering.

## Memory Stream & Kai-Klok Layout
- Centered the Kai-Klok popover across memory stream canvases, clamping the dial to safe-area insets and keeping the clock shell within the viewport on both the status popover and the main Klock stage.

## KaiVoh Stability (Android/WebView)
- Hardened the KaiVoh glass panels with GPU-friendly transforms, backface hiding, and will-change hints; added backdrop-filter fallbacks and coarse-pointer overrides so Android/WebView clients keep a stable, blur-consistent UI without flicker.

## Sigil Page Smoothness
- Eliminated Sigil page flicker by switching style injection and scroll class toggles to layout effects and locking text-size adjustment to 100%, preventing viewport zoom/resizing spasms on navigation.
