export {};

declare global {
  interface Window {
    __SIGIL__?: {
      registerSigilUrl?: (url: string) => void;
      registerSend?: (rec: unknown) => void;
    };
  }
}
