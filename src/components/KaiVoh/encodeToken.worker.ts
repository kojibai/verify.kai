/// <reference lib="webworker" />

import {
  encodeTokenWithBudgets,
  type FeedPostPayload,
} from "../../utils/feedPayload";

type EncodeWorkerRequest = {
  id: string;
  payload: FeedPostPayload;
};

type EncodeWorkerResponse =
  | { id: string; ok: true; token: string; withinHard: boolean; ms: number }
  | { id: string; ok: false; error: string; ms: number };

const now = (): number =>
  self.performance && typeof self.performance.now === "function"
    ? self.performance.now()
    : 0;

self.onmessage = (ev: MessageEvent<EncodeWorkerRequest>) => {
  const t0 = now();
  const data = ev.data;

  try {
    const out = encodeTokenWithBudgets(data.payload);
    const msg: EncodeWorkerResponse = {
      id: data.id,
      ok: true,
      token: out.token,
      withinHard: out.withinHard,
      ms: now() - t0,
    };
    self.postMessage(msg);
  } catch (e) {
    const msg: EncodeWorkerResponse = {
      id: data.id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      ms: now() - t0,
    };
    self.postMessage(msg);
  }
};
