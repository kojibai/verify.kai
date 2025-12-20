// src/pages/SigilPage/rotationBus.ts
import { useEffect, useState } from "react";
import { ROTATE_CH, rotationKey } from "./constants";
import { kaiNowMs } from "../../utils/kaiNow";
import type { RotationMsg } from "./constants";

/** Publish rotation token to LS + BroadcastChannel + DOM event */
export function publishRotation(keys: string[], token: string) {
  const uniq = Array.from(new Set(keys.map((k) => k.toLowerCase()).filter(Boolean)));
  uniq.forEach((canonical) => {
    try {
      localStorage.setItem(rotationKey(canonical), `${token}@${kaiNowMs()}`);
    } catch { /* noop */ }
    try {
      const bc = new BroadcastChannel(ROTATE_CH);
      bc.postMessage({ type: "rotated", canonical, token } as RotationMsg);
      bc.close();
    } catch { /* noop */ }
    try {
      window.dispatchEvent(new CustomEvent("sigil:transfer-rotated", { detail: { canonical, token } }));
    } catch { /* noop */ }
  });
}

/** Subscribe to rotation tokens touching any of the provided canonical keys */
export function useRotationListener(keys: string[]) {
  const depKey = JSON.stringify(Array.from(new Set(keys.map((k) => (k || "").toLowerCase()))));
  const [rotatedToken, setRotatedToken] = useState<string | null>(null);

  useEffect(() => {
    const uniq = JSON.parse(depKey) as string[];
    if (!uniq.length) return;

    const refreshFromLS = () => {
      let tok: string | null = null;
      try {
        for (const k of uniq) {
          const raw = localStorage.getItem(rotationKey(k));
          const val = raw ? String(raw).split("@")[0] : null;
          if (val) { tok = val; break; }
        }
      } catch { /* noop */ }
      setRotatedToken(tok);
    };
    refreshFromLS();

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(ROTATE_CH);
      bc.onmessage = (ev: MessageEvent<RotationMsg>) => {
        const m = ev.data;
        if (m?.type === "rotated") {
          const kn = (m.canonical || "").toLowerCase();
          if (uniq.includes(kn)) setRotatedToken(m.token || null);
        }
      };
    } catch { /* noop */ }

    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      for (const k of uniq) {
        if (e.key === rotationKey(k)) {
          refreshFromLS();
          break;
        }
      }
    };
    window.addEventListener("storage", onStorage, { passive: true });

    return () => {
      window.removeEventListener("storage", onStorage);
      if (bc && typeof bc.close === "function") { try { bc.close(); } catch { /* noop */ } }
    };
  }, [depKey]);

  return rotatedToken;
}
