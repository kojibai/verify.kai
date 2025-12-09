// src/components/session/sessionTypes.ts

export interface ConnectedAccounts {
  x?: string;
  ig?: string;
  tiktok?: string;
  threads?: string;
  [key: string]: string | undefined;
}

export interface PostEntry {
  pulse: number;
  platform: string;
  link: string;
}

export interface SessionData {
  phiKey: string;
  kaiSignature: string;
  pulse: number;
  chakraDay?: string;
  connectedAccounts: ConnectedAccounts;
  postLedger: PostEntry[];
}

export interface SessionContextType {
  session: SessionData | null;
  setSession: (data: SessionData) => void;
  clearSession: () => void;
}
