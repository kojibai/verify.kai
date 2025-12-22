// src/components/KaiRealms/lib/gameFocus.ts
// Global game focus/pause bus so only one game runs at a time.
// Usage in a game:
//   const { paused, takeFocus } = useGameFocus("KaiMaze");
//   takeFocus() when the user starts playing (or on first input).
//   if (paused) skip game updates.

import { useCallback, useEffect, useRef, useState } from "react";
import { kairosEpochNow } from "../../../utils/kai_pulse";

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
  return typeof v === "object" && v !== null;
}

function coerceBigInt(v: unknown): bigint | null {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isFinite(v) && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === "string") {
    try {
      return BigInt(v);
    } catch {
      return null;
    }
  }
  return null;
}

export type GameFocusDetail = {
  id: string; // unique id of the component taking focus ("KaiMaze", "KaiKasino", ...)
  ts: bigint; // kairos epoch timestamp (bigint)
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
  const detail: GameFocusDetail = { id, ts: kairosEpochNow() };

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
      // ✅ avoid BigInt structured-clone issues across browsers
      bc.postMessage({ type: EVT, detail: { id: detail.id, ts: detail.ts.toString() } });
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


function normalizeDetail(raw: unknown): GameFocusDetail | null {
  if (!isRecord(raw)) return null;
  const id = raw.id;
  const ts = coerceBigInt(raw.ts);
  if (typeof id !== "string" || ts === null) return null;
  return { id, ts };
}

export function subscribeGameFocus(handler: (d: GameFocusDetail) => void): () => void {
  const onWin = (e: Event) => {
    const ev = e as CustomEvent<unknown>;
    const d = normalizeDetail(ev?.detail);
    if (d) handler(d);
  };

  if (hasWindow) {
    window.addEventListener(EVT, onWin);
  }

  const bc = getBC();
  const onBC = (msg: MessageEvent) => {
    const data = msg?.data;
    if (!isRecord(data)) return;
    if (data.type !== EVT) return;
    const d = normalizeDetail(data.detail);
    if (d) handler(d);
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
  const lastFocusRef = useRef<bigint>(0n);

  useEffect(() => {
    return subscribeGameFocus((d) => {
      setPaused(d.id !== gameId);
      lastFocusRef.current = d.ts;
    });
  }, [gameId]);

  const takeFocus = useCallback(() => {
    announceGameFocus(gameId);
    setPaused(false);
  }, [gameId]);

  return { paused, takeFocus };
}
