import type { KaiSigKksMetadata, VerificationResult } from "../types";

export function extractMetadataFromSvg(svgText: string): VerificationResult {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, "image/svg+xml");
    const metadataNode = doc.querySelector("svg > metadata");

    if (!metadataNode || !metadataNode.textContent) {
      return {
        status: "error",
        title: "No metadata found",
        message:
          "This SVG does not contain a <metadata> block at the root <svg> level.",
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(metadataNode.textContent.trim());
    } catch {
      return {
        status: "error",
        title: "Invalid JSON in metadata",
        message:
          "The <metadata> block exists but is not valid JSON. This sigil may be corrupted or not KKS-compliant.",
      };
    }

    const meta = parsed as Partial<KaiSigKksMetadata>;

    if (!meta.spec || !meta.kaiSignature || !meta.userPhiKey) {
      return {
        status: "warning",
        title: "Metadata incomplete",
        message:
          "Metadata JSON was found, but required Kai Signature fields are missing.",
        metadata: meta as KaiSigKksMetadata,
      };
    }

    return {
      status: "ok",
      title: "Kai Sigil metadata detected",
      message:
        "This SVG contains a Kai Signature metadata block. Cryptographic verification can be performed by a Kai-aware client.",
      metadata: meta as KaiSigKksMetadata,
    };
  } catch {
    return {
      status: "error",
      title: "Unable to parse SVG",
      message: "There was an error parsing this file as SVG.",
    };
  }
}
