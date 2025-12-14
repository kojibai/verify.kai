// src/lib/sigilRegistryClient.ts
export type ChakraDay =
  | "Root"
  | "Sacral"
  | "Solar Plexus"
  | "Heart"
  | "Throat"
  | "Third Eye"
  | "Crown"
  | "Krown";

export type SigilPayload = {
  pulse: number;
  beat: number;
  stepIndex: number;
  chakraDay?: ChakraDay | string;

  kaiSignature?: string | null;
  originUrl?: string | null;
  parentUrl?: string | null;

  userPhiKey?: string | null;
  phiKey?: string | null;
  phikey?: string | null;

  // compact aliases sometimes present
  u?: number;
  b?: number;
  s?: number;
  c?: string;
  d?: number;

  // optional transfer / claim fields
  canonicalHash?: string;
  parentHash?: string;
  transferNonce?: string;
  stepsPerBeat?: number;

  claim?: {
    steps: number;
    expireAtPulse: number;
    stepsPerBeat: number;
  };
  preview?: {
    unit: string;
    amountPhi?: string;
    amountUsd?: string;
    usdPerPhi?: number;
  };
};

export type RegistryRow = {
  url: string;
  payload: SigilPayload;

  pulse: number;
  beat: number;
  stepIndex: number;

  chakraDay?: string;
  kaiSignature?: string | null;
  originUrl?: string | null;
  parentUrl?: string | null;

  userPhiKey?: string | null;
  phiKey?: string | null;
  phikey?: string | null;

  id?: string | null;
};

export type SigilState = {
  spec: "KKS-1.0" | string;
  total_urls: number;
  latest: { pulse: number; beat: number; stepIndex: number };
  state_seal: string;
  registry: RegistryRow[];
};

export type InhaleResponse = {
  status: "ok" | "error";
  files_received: number;
  crystals_total: number;
  crystals_imported: number;
  crystals_failed: number;
  registry_urls: number;
  latest: { pulse: number; beat: number; stepIndex: number };
  errors: string[];
};

type Cached<T> = { etag: string; value: T; cachedAtPulse?: number };

const LS_KEY = "sigil_registry_state_v1";

function readCache(): Cached<SigilState> | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached<SigilState>;
    if (!parsed?.etag || !parsed?.value) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(etag: string, value: SigilState): void {
  const payload: Cached<SigilState> = { etag, value };
  localStorage.setItem(LS_KEY, JSON.stringify(payload));
}

export async function fetchSigilState(baseUrl: string): Promise<{
  state: SigilState;
  etag: string;
  fromCache: boolean;
}> {
  const cache = readCache();
  const res = await fetch(`${baseUrl}/state`, {
    method: "GET",
    headers: cache?.etag ? { "If-None-Match": cache.etag } : undefined,
  });

  if (res.status === 304 && cache) {
    return { state: cache.value, etag: cache.etag, fromCache: true };
  }

  if (!res.ok) {
    throw new Error(`State fetch failed: ${res.status} ${res.statusText}`);
  }

  const etag = res.headers.get("etag") ?? "";
  const state = (await res.json()) as SigilState;

  if (etag) writeCache(etag, state);
  return { state, etag, fromCache: false };
}

export async function fetchSeal(baseUrl: string): Promise<{
  seal: string;
  etag: string;
}> {
  const res = await fetch(`${baseUrl}/seal`, { method: "GET" });
  if (!res.ok) throw new Error(`Seal fetch failed: ${res.status}`);
  const etag = res.headers.get("etag") ?? "";
  const body = (await res.json()) as { seal: string };
  return { seal: body.seal, etag };
}

export async function inhaleKrystalFiles(
  baseUrl: string,
  files: File[],
): Promise<InhaleResponse> {
  const fd = new FormData();
  for (const f of files) fd.append("files", f, f.name);

  const res = await fetch(`${baseUrl}/inhale`, {
    method: "POST",
    body: fd,
  });

  if (!res.ok) throw new Error(`Inhale failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as InhaleResponse;
}
