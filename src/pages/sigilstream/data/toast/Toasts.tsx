import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAX_TOASTS, TTL_MS, ToastCtx } from "./toast";
import type { Toast, ToastApi, ToastKind } from "./toast";

export function ToastsProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [items, setItems] = useState<Toast[]>([]);
  const timersRef = useRef<Map<number, number>>(new Map()); // ✅ number ids
  const nextIdRef = useRef<number>(1);

  const clearTimer = useCallback((id: number) => {
    const handle = timersRef.current.get(id);
    if (typeof handle === "number") {
      window.clearTimeout(handle);
      timersRef.current.delete(id);
    }
  }, []);

  const remove = useCallback(
    (id: number) => {
      clearTimer(id);
      setItems((prev) => prev.filter((t) => t.id !== id));
    },
    [clearTimer],
  );

  const push = useCallback(
    (kind: ToastKind, text: string) => {
      const id = nextIdRef.current++;
      setItems((prev) => {
        const nextAll: Toast[] = [{ id, kind, text }, ...prev];
        const next: Toast[] = nextAll.slice(0, MAX_TOASTS);
        const evicted: Toast[] = nextAll.slice(MAX_TOASTS);
        for (const t of evicted) clearTimer(t.id);
        return next;
      });

      const handle = window.setTimeout(() => remove(id), TTL_MS);
      timersRef.current.set(id, handle);
    },
    [clearTimer, remove],
  );

  const api = useMemo<ToastApi>(() => ({ push }), [push]);

  useEffect(() => {
    return () => {
      for (const h of timersRef.current.values()) window.clearTimeout(h);
      timersRef.current.clear();
    };
  }, []);

  const bgFor = (kind: ToastKind): string => {
    switch (kind) {
      case "success":
        return "rgba(16,28,22,.88)";
      case "warn":
        return "rgba(28,24,12,.88)";
      case "error":
        return "rgba(36,16,16,.88)";
      case "info":
      default:
        return "rgba(12,18,28,.88)";
    }
  };

  return (
    <ToastCtx.Provider value={api}>
      {children}

      <div
        aria-live="polite"
        aria-atomic="false"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "8px 12px",
          display: "grid",
          gap: 8,
          zIndex: 1000,
          pointerEvents: "none",
        }}
      >
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            style={{
              pointerEvents: "auto",
              marginInline: "auto",
              maxWidth: "min(720px, 100%)",
              width: "100%",
              background: bgFor(t.kind),
              border: "1px solid rgba(255,255,255,.12)",
              borderRadius: 12,
              padding: "10px 12px",
              color: "rgb(236,241,251)",
              boxShadow: "0 8px 28px rgba(0,0,0,.35)",
              backdropFilter: "blur(6px)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export default ToastsProvider;
