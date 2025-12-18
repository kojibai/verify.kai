import { useEffect } from "react";

function isLowPowerEnvironment(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;

  const nav = navigator as unknown as {
    deviceMemory?: number;
    hardwareConcurrency?: number;
  };

  const prefersReducedMotion =
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  const prefersReducedTransparency =
    window.matchMedia?.("(prefers-reduced-transparency: reduce)")?.matches ?? false;

  return (
    prefersReducedMotion ||
    prefersReducedTransparency ||
    (typeof nav.deviceMemory === "number" && nav.deviceMemory <= 4) ||
    (typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency <= 4)
  );
}

export function usePerfMode(): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const lowPower = isLowPowerEnvironment();

    if (lowPower) root.dataset.perf = "low";
    else delete root.dataset.perf;
  }, []);
}

