import * as React from "react";
import { kaiNowMs } from "../utils/kaiNow";

export const ROTATE_CH = "sigil-xfer-v1";
export const rotationKey = (h: string) => `sigil:rotated:${h}`;

type RotationMsg = { type: "rotated"; canonical: string; token: string };

const noop = () => { /* intentionally empty */ };

/** Fire-and-forget publisher (used after rotate/seal). */
export function publishRotation(keys: string[], token: string) {
  const uniq = Array.from(new Set(keys.map(k => k.toLowerCase()).filter(Boolean)));
  uniq.forEach((canonical) => {
    try {
      localStorage.setItem(rotationKey(canonical), `${token}@${kaiNowMs()}`);
    } catch {
      noop();
    }
    try {
      const bc = new BroadcastChannel(ROTATE_CH);
      bc.postMessage({ type: "rotated", canonical, token } as RotationMsg);
      bc.close();
    } catch {
      noop();
    }
    try {
      window.dispatchEvent(new CustomEvent("sigil:transfer-rotated", { detail: { canonical, token } }));
    } catch {
      noop();
    }
  });
}

/** Subscribe to rotation for any of the candidate canonicals; returns the latest token or null. */
export function useRotationToken(candidates: string[]) {
  const [rotatedToken, setRotatedToken] = React.useState<string | null>(null);

  // Normalize & dedupe candidates once; keeps the effect deps simple and static-checkable.
  const keys = React.useMemo(
    () =>
      Array.from(
        new Set((candidates || []).map((s) => (s || "").toLowerCase()).filter(Boolean))
      ),
    [candidates]
  );

  React.useEffect(() => {
    if (!keys.length) return;

    const refreshFromLS = () => {
      let tok: string | null = null;
      try {
        for (const k of keys) {
          const raw = localStorage.getItem(rotationKey(k));
          const val = raw ? String(raw).split("@")[0] : null;
          if (val) {
            tok = val;
            break;
          }
        }
      } catch {
        noop();
      }
      setRotatedToken(tok);
    };
    refreshFromLS();

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(ROTATE_CH);
      bc.onmessage = (ev: MessageEvent<RotationMsg>) => {
        const m = ev.data;
        if (m?.type === "rotated" && keys.includes((m.canonical || "").toLowerCase())) {
          setRotatedToken(m.token || null);
        }
      };
    } catch {
      noop();
    }

    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      for (const k of keys) {
        if (e.key === rotationKey(k)) {
          refreshFromLS();
          break;
        }
      }
    };
    window.addEventListener("storage", onStorage, { passive: true });

    return () => {
      window.removeEventListener("storage", onStorage);
      try {
        bc?.close?.();
      } catch {
        noop();
      }
    };
  }, [keys]);

  return rotatedToken;
}
