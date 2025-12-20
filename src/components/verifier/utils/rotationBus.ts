// src/components/verifier/utils/rotationBus.ts
/* ────────────────────────────────────────────────────────────────
   rotationBus.ts
   • Broadcast that a sigil head just rotated / minted new link
   • Lets other tabs / listeners react (invalidate QR, etc.)
   • Uses localStorage, BroadcastChannel, and window CustomEvent
────────────────────────────────────────────────────────────────── */

import { logError } from "./log";
import { kaiNowMs } from "../../../utils/kaiNow";

export const ROTATE_CH = "sigil-xfer-v1";

export type RotationMsg = {
  type: "rotated";
  canonical: string;
  token: string;
};

/** localStorage key builder */
export const rotationKey = (h: string): string =>
  `sigil:rotated:${h}`;

/**
 * publishRotation:
 * - keys: canonical parent hashes we just rotated
 * - token: new nonce / access token
 */
export function publishRotation(
  keys: string[],
  token: string
): void {
  const uniq = Array.from(
    new Set(
      (keys ?? [])
        .map((k) => String(k || "").toLowerCase())
        .filter((v) => v.length > 0)
    )
  );

  for (const canonical of uniq) {
    // localStorage
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(
          rotationKey(canonical),
          `${token}@${kaiNowMs()}`
        );
      }
    } catch (err) {
      logError("publishRotation.localStorage", err);
    }

    // BroadcastChannel
    try {
      const bc = new BroadcastChannel(ROTATE_CH);
      const msg: RotationMsg = {
        type: "rotated",
        canonical,
        token,
      };
      bc.postMessage(msg);
      bc.close();
    } catch (err) {
      logError("publishRotation.bc", err);
    }

    // CustomEvent
    try {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("sigil:transfer-rotated", {
            detail: { canonical, token },
          })
        );
      }
    } catch (err) {
      logError("publishRotation.dispatch", err);
    }
  }
}
