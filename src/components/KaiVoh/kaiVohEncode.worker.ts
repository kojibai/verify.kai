/// <reference lib="webworker" />

import { encodeTokenWithBudgets, type FeedPostPayload } from "../../utils/feedPayload";

type EncodeWorkerRequest = { id: string; payload: FeedPostPayload };

type EncodeWorkerResponse =
  | { id: string; ok: true; token: string; withinHard: boolean; ms: number }
  | { id: string; ok: false; error: string; ms: number };

const nowMs = (): number =>
  self.performance && typeof self.performance.now === "function" ? self.performance.now() : 0;

self.onmessage = async (ev: MessageEvent<EncodeWorkerRequest>) => {
  const t0 = nowMs();
  const { id, payload } = ev.data;

  try {
    const out = await encodeTokenWithBudgets(payload);
    const res: EncodeWorkerResponse = {
      id,
      ok: true,
      token: out.token,
      withinHard: out.withinHard,
      ms: nowMs() - t0,
    };
    self.postMessage(res);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const res: EncodeWorkerResponse = { id, ok: false, error: msg, ms: nowMs() - t0 };
    self.postMessage(res);
  }
};

export {};
