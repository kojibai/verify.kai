import React from "react";
import type { VerificationResult } from "../types";

interface ResultCardProps {
  result: VerificationResult | null;
  isLoading: boolean;
}

const statusLabel: Record<VerificationResult["status"], string> = {
  ok: "Verified metadata",
  warning: "Metadata issue",
  error: "Verification error",
};

export const ResultCard: React.FC<ResultCardProps> = ({ result, isLoading }) => {
  if (isLoading) {
    return (
      <section className="result-card result-card--loading" aria-busy="true">
        <p className="result-subtitle">Analyzing sigil…</p>
      </section>
    );
  }

  if (!result) {
    return (
      <section className="result-card result-card--idle">
        <p className="result-subtitle">
          Drop a Kai Sigil SVG or paste a URL to inspect its embedded metadata.
        </p>
      </section>
    );
  }

  return (
    <section
      className={`result-card result-card--${result.status}`}
      aria-live="polite"
    >
      <h2 className="result-title">
        {statusLabel[result.status]} — {result.title}
      </h2>
      <p className="result-message">{result.message}</p>

      {result.metadata && (
        <div className="result-metadata">
          <h3>Embedded Kai Metadata</h3>
          <pre>{JSON.stringify(result.metadata, null, 2)}</pre>
        </div>
      )}
    </section>
  );
};
