import { createContext, useContext } from "react";

export type ToastKind = "success" | "info" | "warn" | "error";
export type Toast = { id: number; kind: ToastKind; text: string };
export type ToastApi = { push: (kind: ToastKind, text: string) => void };

export const MAX_TOASTS = 3;
export const TTL_MS = 2600;

export const ToastCtx = createContext<ToastApi | null>(null);

export function useToasts(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToasts() must be used within <ToastsProvider/>");
  return ctx;
}
