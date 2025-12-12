// src/utils/base64url.ts
"use client";

// base64 -> base64url (path safe)
export function toBase64Url(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// base64url -> base64 (for atob)
export function fromBase64Url(b64u: string): string {
  const b64 = b64u.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return b64 + pad;
}

// UTF-8 safe btoa/atob wrappers
function btoaUtf8(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}
function atobUtf8(b64: string): string {
  return decodeURIComponent(escape(atob(b64)));
}

export function encodeJsonToToken(obj: unknown): string {
  const json = JSON.stringify(obj);
  return toBase64Url(btoaUtf8(json));
}

export function decodeTokenToJson<T = unknown>(token: string): T {
  const json = atobUtf8(fromBase64Url(token));
  return JSON.parse(json) as T;
}
