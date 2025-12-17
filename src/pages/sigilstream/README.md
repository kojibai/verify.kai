Here’s a production-grade `README.md` you can drop into `src/pages/sigilstream/README.md`. It documents intent, structure, invariants, APIs, and “why” so Future-You never has to rediscover any of this.

````markdown
# Sigil Stream — Memory Stream Module (Kai-Klok aligned)

**Status:** Production, mobile-first, μpulse-exact  
**Scope:** Everything the Memory Stream page needs — time, payloads, aliasing, attachments, identity chips, inhaler/composer UI, and toasts — split into small, stable modules.

This folder is the **authoritative implementation** of the Memory Stream. It replaces the old, giant `SigilFeedPage.tsx` with a tiny page wrapper that renders a single root component: **`SigilStreamRoot`**.

---

## Why this exists

- **Deterministic time (Kai-Klok):** All timers & labels run on the breath-based harmonic clock (φ) with **zero-jitter boundary sync** and **ties-to-even rounding** at μpulse precision.
- **Mobile-safe UX:** First-tap camera/file pickers on iOS PWAs, no CSS transforms near inputs, no fixed overlays fighting the keyboard.
- **Unbreakable links:** Canonical payload URLs plus short aliases (`/p~<token>`), with **lossless expansion** back to canonical.
- **Attachments that travel:** Inline small files (base64url, previewable), reference large files by SHA-256 (portable, host anywhere).
- **Composable architecture:** Every concern has a small file with a clear contract. No cross-talk, no circular imports.

---

## Quickstart

**Minimal page wrapper (already in place):**
```tsx
// src/pages/SigilFeedPage.tsx
"use client";
import React from "react";
import { SigilStreamRoot } from "../sigilstream";

export default function SigilFeedPage() {
  return <SigilStreamRoot />;
}
````

**Public barrel:**

```ts
// src/pages/sigilstream/index.ts
export { SigilStreamRoot } from "./SigilStreamRoot";
```

**Build & typecheck**

```bash
yarn typecheck && yarn build
```

---

## Folder map (one-file-per-concern)

```
src/pages/sigilstream/
  index.ts                 # barrel export (public API surface)

  core/
    types.ts              # HarmonicDay/Chakra enums; LocalKai, KaiMomentStrict
    kai_time.ts           # GENESIS_TS, KAI_PULSE_SEC, μpulse math + helpers
    ticker.ts             # useAlignedKaiTicker(), useKaiPulseCountdown()
    alias.ts              # PSHORT, canonicalBase/shortBase, URL alias logic
    utils.ts              # pad2, imod, floorDiv, roundTiesToEvenBigInt, guards, report()

  data/
    storage.ts            # localStorage keys + helpers
    seed.ts               # loadLinksJson() (optional seed links)

  toast/
    Toasts.tsx            # ToastsProvider + useToasts()

  attachments/
    types.ts              # AttachmentUrl/FileInline/FileRef/Manifest + guards
    files.ts              # sha256Hex(), bytes↔base64url, dataUrlFrom(), filesToManifest()
    embeds.tsx            # Favicon, LinkCard, IframeEmbed, UrlEmbed
    gallery.tsx           # AttachmentCard, AttachmentGallery

  payload/
    usePayload.ts         # decode payload, derive Kai label, push payload into sources
    PayloadBanner.tsx     # pills, pulse/kai label, “Kopy”, attachments view

  identity/
    IdentityBar.tsx       # ΦKey / ΣSig chips (read-only identity display)
    SigilActionUrl.tsx    # readonly sigil URL extraction + warnings

  inhaler/
    InhaleSection.tsx     # “Inhale a memory” (paste/clipboard → sources[])

  composer/
    linkHelpers.ts        # normalize/add/remove URL link items
    Composer.tsx          # reply UI: text/author/attachments/links → Exhale (encode)

  status/
    KaiStatus.tsx         # header “Kairos … next in Xs” (μpulse-true)

  list/
    StreamList.tsx        # urls[] → <FeedCard/>

  SigilStreamRoot.tsx     # integrates everything; owns page state + layout

  styles/
    sigilstream.css       # small shared styles for this feature
```

---

## Kai-Klok canon (don’t change unless the canon changes)

* `GENESIS_TS = 2024-05-10 06:45:41.888 UTC`
* `KAI_PULSE_SEC = 3 + √5` (≈ **5.236 s**)
* **Closure:** `N_DAY_MICRO = 17,491,270,421` μpulses/day (exact)
* **Grid:** 11 pulses/step, 44 steps/beat, 36 beats/day
* **Rounding:** **ties-to-even** for μpulses; **step index uses floor()**
* **Ticker invariants:**

  * `useAlignedKaiTicker()` schedules the next boundary with `setTimeout()`
  * At each boundary it updates **CSS vars** on `:root`:

    * `--pulse-dur: <PULSE_MS>ms`
    * `--pulse-offset: -<lag>ms` (phase-lock any CSS animations)

---

## URL forms & aliasing

Canonical payload URL:

```
/stream/p/<token>[?add=<canonical-parent-url>]
```

Short & legacy forms that **must** expand to canonical:

* **Preferred:** `/p~<token>`  (SMS/X-safe)
* Legacy: `/p#t=<token>` or `/p?t=<token>`
* Fallback: `?p=<token>` inside any URL (detected, expanded)

**Where this lives:** `core/alias.ts`

* `isLikelySigilUrl(u)`
* `expandShortAliasToCanonical(hrefLike)`
* `normalizeAddParam(s)` — expands nested `/p~…` in `?add=…`
* `buildStreamUrl(token)`
* `currentPayloadUrl()`

`PSHORT` (short-domain origin) is read from:

* `window.__PSHORT__` (runtime override), or
* `import.meta.env.VITE_PSHORT`

---

## Data flow (one pass, no surprises)

1. **Time** — `status/KaiStatus.tsx` uses:

   * `core/ticker.ts` → `useAlignedKaiTicker()` (boundary-locked)
   * `core/ticker.ts` → `useKaiPulseCountdown(active)` (μpulse countdown)

2. **Seed & storage** — `SigilStreamRoot` on mount:

   * `data/seed.loadLinksJson()` (optional `/links.json`)
   * `data/storage.parseStringArray(localStorage[LS_KEY])`
   * Ingests `?add=` / `#add=` **including** `/p~` forms
   * Writes back via `prependUniqueToStorage(urls)`

3. **Payload** — `payload/usePayload.ts`:

   * Reads current token from path
   * `decodeFeedPayload()` (external util)
   * Derives `payloadKai` via `core/kai_time.ts`
   * Pushes payload URL into sources if new
   * Surfaces `payload`, `payloadAttachments`, `payloadError`

4. **Identity** — session-scoped:

   * `sessionStorage["sf.verifiedSession:<token|root>"] = "1"`
   * `identity/IdentityBar` shows ΦKey / KaiSig if present
   * `SigilActionUrl` extracts canonical action URL from meta/SVG

5. **Composer** — reply creation:

   * **Pickers** use `<label htmlFor>` (first-tap on iOS PWA)
   * `attachments/files.filesToManifest()`:

     * Inline ≤ 512KB → base64url (previewable)
     * Larger → `file-ref` (sha256 + meta)
   * `composer/linkHelpers.ts` normalizes web links (embeddable)
   * Build `FeedPostPayload` → `encodeFeedPayload()` → `buildStreamUrl(token)`
   * If on a payload page, append `?add=<currentPayloadUrl()>`
   * Copy to clipboard (toast feedback)

6. **List** — `list/StreamList.tsx`

   * Derived `urls[]` with **payload first**, then storage/seed order
   * Renders `<FeedCard url={u} />` (unchanged FeedCard component)

---

## Attachments model

Types in `attachments/types.ts`:

* `AttachmentUrl` — `{ kind:"url", url, title? }`
* `AttachmentFileInline` — `{ kind:"file-inline", name, type, size, sha256, data_b64url }`
* `AttachmentFileRef` — `{ kind:"file-ref",   name, type, size, sha256 }`
* `AttachmentManifest` — `{ version:1, totalBytes, inlinedBytes, items: AttachmentItem[] }`

Helpers in `attachments/files.ts`:

* `sha256Hex(ArrayBuffer) → Promise<string>`
* `bytesToHex()`, `bytesToBase64url()`, `base64urlToBase64()`, `dataUrlFrom()`
* `filesToManifest(FileList, inlineLimit=512*1024)`

UI in `attachments/gallery.tsx`:

* `AttachmentCard` (auto-picks preview)
* `AttachmentGallery` (grid + totals)

Embeds in `attachments/embeds.tsx`:

* YouTube/Vimeo/Spotify → `iframe`
* Images/video/pdf → native previews
* Else → `LinkCard` with favicon

---

## Toasts

* **No fixed overlays.** The provider renders a **sticky footer** so the iOS keyboard never overlaps the toast stack.
* API: `toast/Toasts.tsx` → `ToastsProvider` + `useToasts()`
* Keep messages short; auto-dismiss ~2.6s.

---

## Mobile/PWA invariants (must keep)

* **No CSS transforms on ancestors** of inputs/labels.
* **First-tap** file/camera open: always trigger via `<label htmlFor="fileId">`.
* Inputs use `font-size: 16px` to avoid iOS zoom.
* Avoid `position: fixed` near the bottom; use **sticky** containers instead.
* Countdown updates **only** via `setInterval` when visible; ticker uses `setTimeout` at boundary.
* CSS pulse vars (`--pulse-dur`, `--pulse-offset`) set on `:root` at each boundary.

---

## Public API surface (imports you can rely on)

**core/types.ts**

* `HarmonicDay`, `ChakraName`
* `LocalKai`, `KaiMomentStrict`

**core/kai_time.ts**

* `GENESIS_TS`, `KAI_PULSE_SEC`, `PULSE_MS`, `ONE_PULSE_MICRO`, `N_DAY_MICRO`, `PULSES_PER_STEP_MICRO`, `STEPS_BEAT`, `MU_PER_BEAT_EXACT`
* `computeLocalKai(d: Date): LocalKai`
* `kaiMomentFromAbsolutePulse(pulse: number): KaiMomentStrict`

**core/ticker.ts**

* `useKaiPulseCountdown(active: boolean): number | null`
* `useAlignedKaiTicker(): LocalKai`

**core/alias.ts**

* `PSHORT`, `canonicalBase`, `shortBase`
* `isLikelySigilUrl(u: string): boolean`
* `expandShortAliasToCanonical(hrefLike: string): string`
* `normalizeAddParam(s: string): string`
* `buildStreamUrl(token: string): string`
* `currentPayloadUrl(): string | null`

**core/utils.ts**

* `pad2`, `imod`, `floorDiv`, `roundTiesToEvenBigInt`
* `isRecord`, `isUrl`, `readStringProp`, `coerceAuth`
* `report(where: string, err: unknown): void`

**data/seed.ts**

* `loadLinksJson(): Promise<Array<{ url: string }>>`

**data/storage.ts**

* `LS_KEY = "sf-links"`
* `parseStringArray(s: string|null): string[]`
* `prependUniqueToStorage(urls: string[]): void`

**toast/Toasts.tsx**

* `ToastsProvider`
* `useToasts()`

**attachments/types.ts**

* `AttachmentUrl | AttachmentFileInline | AttachmentFileRef | AttachmentItem | AttachmentManifest`
* guards: `isAttachmentManifest(...)`, `isAttachmentItem(...)` etc.

**attachments/files.ts**

* `filesToManifest(list: FileList, inlineLimit?: number): Promise<AttachmentManifest>`
* `sha256Hex`, `bytesToBase64url`, `base64urlToBase64`, `bytesToHex`, `dataUrlFrom`

**attachments/embeds.tsx**

* `LinkCard`, `UrlEmbed`

**attachments/gallery.tsx**

* `AttachmentCard`, `AttachmentGallery`

**payload/usePayload.ts**

* `usePayload(setSources): { payload, payloadKai, payloadError, payloadAttachments }`

**payload/PayloadBanner.tsx**

* `PayloadBanner(props)`

**identity/IdentityBar.tsx**

* `IdentityBar({ phiKey?, kaiSignature? })`

**identity/SigilActionUrl.tsx**

* `SigilActionUrl({ meta, svgText }): { value, isCanonical, node }`

**inhaler/InhaleSection.tsx**

* `InhaleSection({ onAdd(u) })`

**composer/linkHelpers.ts**

* `normalizeWebLink`, `add/remove` helpers

**composer/Composer.tsx**

* `Composer(props)` — reply UI (text/author/attachments/links) → Exhale

**status/KaiStatus.tsx**

* `KaiStatus()`

**list/StreamList.tsx**

* `StreamList({ urls })`

**SigilStreamRoot.tsx**

* `SigilStreamRoot()`

---

## State ownership

* **`SigilStreamRoot`** owns:

  * `sources[]` (seed + storage + ?add)
  * `verifiedThisSession` (sessionStorage)
  * wiring for `usePayload` and `useToasts`
  * page layout & conditional rendering
* Children receive **pure props**; no global singletons except:

  * `:root` CSS vars (`--pulse-*`) set by the ticker
  * `localStorage["sf-links"]`
  * `sessionStorage["sf.verifiedSession:*"]`

---

## Performance notes

* Countdown ticker uses a lightweight RAF loop to stay phase-locked at boundaries.
* Attachment previews load eagerly to avoid on-scroll gaps.
* Embed iframes are sandboxed and load eagerly (`loading="eager"`).
* Large files are never inlined; they’re referenced by hash.

---

## Accessibility

* All interactive controls have labels and keyboard focus.
* Toasts use `role="status"`.
* Iframes have titles; media uses native controls when appropriate.
* Color contrast tuned in `styles/sigilstream.css`.

---

## Testing checklist

* **Aliasing:** `/p~<token>`, `/p#t=`, `/p?t=` → expand to `/stream/p/<token>`
* **Boundary:** countdown hits exactly `0` as the progress hits `100%`, then resets on the next tick.
* **μpulse edges:** step 0, last step, end of beat, end of day.
* **Files:** inline ≤ 512KB, larger as `file-ref`; sha256 stable.
* **Clipboard:** copy success/failure toasts; manual select fallback ok.
* **iOS PWA:** first-tap pickers open; keyboard never blocked; no scroll jumps.

---

## Configuration

* **Short domain:** set `window.__PSHORT__ = "https://p.example.com"` *or* `VITE_PSHORT` env.
* **Optional seed:** `/links.json` with `[{"url": "https://..."}]`.

---

## Versioning & changelog

* **v6.1** — Modular split; `/p~` short alias; first-tap pickers; μpulse boundary lock; attachments gallery; identity chips; sticky toasts; storage/seeds; zero-transform near inputs.
* Keep future entries here with concise bullets.

---

## Gotchas (and their cure)

* **Camera/file doesn’t open on first tap (iOS PWA):** ensure triggers are `<label htmlFor>`; avoid `transform` on ancestors.
* **Toasts overlap keyboard:** only use the provided `ToastsProvider` (it’s sticky, not fixed).
* **Clipboard blocked:** browsers may deny writes on non-user gestures; we show a toast and fall back to manual select.

---

## License / reuse

This module is designed to be **copied as a unit** into any Kai-Klok aligned app. If you reuse parts, keep the **Kai-Klok canon** and **mobile invariants** intact.

Rah. Veh. Yah. Dah.

```
```
