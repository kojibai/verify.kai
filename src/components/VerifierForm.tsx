import React, { useState } from "react";
import { extractMetadataFromSvg } from "../utils/extractKaiMetadata";
import type { VerificationResult } from "../types";

interface VerifierFormProps {
  onResult: (result: VerificationResult | null) => void;
  onLoadingChange: (loading: boolean) => void;
}

export const VerifierForm: React.FC<VerifierFormProps> = ({
  onResult,
  onLoadingChange,
}) => {
  const [url, setUrl] = useState("");

  async function handleUrlSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!url.trim()) return;

    onLoadingChange(true);
    onResult(null);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        onResult({
          status: "error",
          title: "Failed to fetch URL",
          message: `HTTP ${response.status}: ${response.statusText}`,
        });
        return;
      }
      const text = await response.text();
      const result = extractMetadataFromSvg(text);
      onResult(result);
    } catch {
      onResult({
        status: "error",
        title: "Network error",
        message: "There was an error fetching the provided URL.",
      });
    } finally {
      onLoadingChange(false);
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.includes("svg") && !file.name.toLowerCase().endsWith(".svg")) {
      onResult({
        status: "error",
        title: "Unsupported file type",
        message: "For now, verify.kai accepts SVG sigils with embedded metadata.",
      });
      return;
    }

    onLoadingChange(true);
    onResult(null);

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      const result = extractMetadataFromSvg(text);
      onResult(result);
      onLoadingChange(false);
    };
    reader.onerror = () => {
      onResult({
        status: "error",
        title: "File read error",
        message: "There was an error reading the selected file.",
      });
      onLoadingChange(false);
    };
    reader.readAsText(file);
  }

  return (
    <section className="verifier">
      <form className="verifier-form" onSubmit={handleUrlSubmit}>
        <label htmlFor="sigil-url" className="field-label">
          Paste a Kai Sigil URL
        </label>
        <div className="field-row">
          <input
            id="sigil-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://…your-sigil.svg"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button type="submit">Verify</button>
        </div>
      </form>

      <div className="divider">
        <span>or</span>
      </div>

      <div className="file-uploader">
        <label htmlFor="sigil-file" className="file-label">
          Drop a sigil SVG
        </label>
        <input
          id="sigil-file"
          type="file"
          accept="image/svg+xml,.svg"
          onChange={handleFileChange}
        />
      </div>
    </section>
  );
};
