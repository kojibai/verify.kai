// src/pages/sigilstream/inhaler/InhaleSection.tsx
"use client";

import { useCallback, useState } from "react";
import type React from "react";
import { isUrl } from "../core/utils";
import { useToasts } from "../data/toast/toast";


/**
 * Normalize a free-form string into an https URL we accept for inhaling.
 * - Accepts kai:// or sigil:// → coerced to https://
 * - Accepts full http(s) URLs
 * - Accepts bare domains like example.com (prepends https://)
 */
function normalizeForInhale(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  // Custom schemes → https://
  const schemeCoerced = s.replace(/^(kai|sigil):\/\//i, "https://");

  try {
    if (isUrl(schemeCoerced)) return schemeCoerced;
    // Bare domain (with optional path)
    if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(schemeCoerced)) {
      return `https://${schemeCoerced}`;
    }
  } catch {
    /* ignore */
  }
  return null;
}

type Props = {
  /** Called with a normalized URL once successfully inhaled */
  onAdd: (url: string) => void;
  /** Optional: placeholder text for the input */
  placeholder?: string;
  /** Optional: label text (defaults to “Inhale a memory”) */
  title?: string;
};

export function InhaleSection({
  onAdd,
  placeholder = "Paste any message (https://… or domain.tld)",
  title = "Inhale a memory",
}: Props): React.JSX.Element {
  const toasts = useToasts();
  const [value, setValue] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const handleInhale = useCallback(
    (raw: string) => {
      setErr(null);
      const normalized = normalizeForInhale(raw);
      if (!normalized) {
        setErr("Enter a valid URL (https://… or domain.tld).");
        return;
      }
      onAdd(normalized);
      setValue("");
      toasts.push("success", "Link inhaled.");
    },
    [onAdd, toasts],
  );

  const grabFromClipboard = useCallback(async () => {
    setErr(null);
    try {
      const text = await navigator.clipboard.readText();
      const s = text.trim();
      if (!s) {
        setErr("Clipboard is empty.");
        return;
      }
      const normalized = normalizeForInhale(s);
      if (!normalized) {
        setErr("Clipboard does not contain a valid link.");
        return;
      }
      setValue(normalized);
      handleInhale(normalized);
    } catch {
      // Clipboard API might be blocked by permissions or context
      setErr("Clipboard read is not permitted.");
    }
  }, [handleInhale]);

  return (
    <section className="sf-inhaler" aria-labelledby="inhaler-title" style={{ marginTop: "1rem" }}>
      <h2 id="inhaler-title" className="sf-reply-title">
        {title}
      </h2>
      <div className="sf-reply-row" style={{ display: "grid", gap: ".5rem" }}>
        <input
          className="sf-input"
          type="url"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="url"
          enterKeyHint="go"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleInhale(value);
            }
          }}
        />
        <div className="sf-reply-actions" style={{ gap: ".5rem", display: "flex", flexWrap: "wrap" }}>
          <button className="sf-btn" onClick={() => handleInhale(value)}>
            Inhale
          </button>
          <button className="sf-btn sf-btn--ghost" onClick={grabFromClipboard}>
            Inhale from Klipboard
          </button>
        </div>
        {err && (
          <div className="sf-error" role="alert">
            {err}
          </div>
        )}
      </div>
    </section>
  );
}

export default InhaleSection;
