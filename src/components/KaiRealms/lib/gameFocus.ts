// src/components/KaiRealms/lib/gameFocus.ts
// Global game focus/pause bus so only one game runs at a time.
// Usage in a game:
//   const { paused, takeFocus } = useGameFocus("KaiMaze");
//   takeFocus() when the user starts playing (or on first input).
//   if (paused) skip game updates.

import { useCallback, useEffect, useRef, useState } from "react";
import { kaiNowMs } from "../../../utils/kaiNow";

export type GameFocusDetail = {
  id: string; // unique id of the component taking focus ("KaiMaze", "KaiKasino", ...)
  ts: number; // timestamp
};

const EVT = "kai:game:focus";
const hasWindow = typeof window !== "undefined";

function warn(msg: string, err?: unknown): void {
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.warn(`[gameFocus] ${msg}`, err);
  }
}

function getBC(): BroadcastChannel | null {
  if (!hasWindow || typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel("kai-realms-game-focus");
  } catch (err) {
    warn("BroadcastChannel unavailable", err);
    return null;
  }
}

export function announceGameFocus(id: string): void {
  const detail: GameFocusDetail = { id, ts: kaiNowMs() };

  if (hasWindow) {
    try {
      window.dispatchEvent(new CustomEvent<GameFocusDetail>(EVT, { detail }));
    } catch (err) {
      warn("window.dispatchEvent failed", err);
    }
  }

  const bc = getBC();
  if (bc) {
    try {
      bc.postMessage({ type: EVT, detail });
    } catch (err) {
      warn("BroadcastChannel postMessage failed", err);
    } finally {
      try {
        bc.close();
      } catch (err) {
        warn("BroadcastChannel close failed", err);
      }
    }
  }
}

export function subscribeGameFocus(
  handler: (d: GameFocusDetail) => void
): () => void {
  const onWin = (e: Event) => {
    const ev = e as CustomEvent<GameFocusDetail>;
    if (ev?.detail) handler(ev.detail);
  };

  if (hasWindow) {
    window.addEventListener(EVT, onWin);
  }

  const bc = getBC();
  const onBC = (msg: MessageEvent) => {
    const data = msg?.data;
    if (data?.type === EVT && data.detail) {
      handler(data.detail as GameFocusDetail);
    }
  };
  if (bc) {
    try {
      bc.addEventListener("message", onBC);
    } catch (err) {
      warn("BroadcastChannel addEventListener failed", err);
    }
  }

  return () => {
    if (hasWindow) {
      window.removeEventListener(EVT, onWin);
    }
    if (bc) {
      try {
        bc.removeEventListener("message", onBC);
      } catch (err) {
        warn("BroadcastChannel removeEventListener failed", err);
      } finally {
        try {
          bc.close();
        } catch (err) {
          warn("BroadcastChannel close failed", err);
        }
      }
    }
  };
}

export function useGameFocus(gameId: string) {
  const [paused, setPaused] = useState<boolean>(false);
  const lastFocusRef = useRef<number>(0);

  useEffect(() => {
    return subscribeGameFocus((d) => {
      setPaused(d.id !== gameId);
      lastFocusRef.current = d.ts;
    });
  }, [gameId]);

  // Call when the game becomes active / user interacts
  const takeFocus = useCallback(() => {
    announceGameFocus(gameId);
    setPaused(false);
  }, [gameId]);

  return { paused, takeFocus };
}
