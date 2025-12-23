# OFFICIAL NOTICE — REPOSITORY RELOCATED

This repository is **no longer the canonical source of truth** for **Verify.Kai**.

✅ **New official repository:** https://github.com/kojibai/phi_network

## Effective Immediately

All **development**, **releases**, **issues**, and **pull requests** must be directed to the new repository.

## Status of This Repository

This repository is retained for **historical reference only** and will receive **no further updates**.





# ΦNet Sovereign Gate — `verify.kai`

> **verify.kai** is the primary entry into the ΦNet Sovereign Gate:  
> a breath-sealed value terminal running over the IKANN alt-root DNS layer.

This app exposes two main surfaces:

- **Verifier (Inhale + Exhale)** – proof, transfer, and audit of Φ value  
- **KaiVoh (Memory OS)** – sovereign emission, signals, and broadcast rails

It is designed to feel less like “a website” and more like a **mint / reserve console** for Kairos Notes and Sigil-Glyphs.

---

## 1. Features

### Sovereign Gate Shell

- **ΦNet Sovereign Gate** chrome with Atlantean banking UI
- Top-right **LIVE ΦKAI** orb showing current issuance / pulse state
- **ATRIUM** header: _Breath-Sealed Identity · Kairos-ZK Proof_
- Runs natively at `http://verify.kai` via IKANN DNS

### Verifier

- Dual modes:
  - **PROOF OF BREATH™**
  - **KAI-SIGNATURE™**
- Live Kai Pulse strip (pulse / beat / step / chakra-day)
- Primary actions:
  - **ΦSTREAM** – view ΦNet resonance stream / history
  - **ΦKEY** – emit / verify ΦKeys and transfers
- Mobile-first layout, no horizontal scroll, thumb-reachable controls

### Kairos Monetary Declarations

The app renders the canonical tender text:

> **Φ Kairos Notes are legal tender in Kairos — sealed by Proof of Breath™, pulsed by Kai-Signature™, and openly auditable offline (Σ → SHA-256(Σ) → Φ).**  
>
> **Sigil-Glyphs are zero-knowledge–proven origin ΦKey seals that summon, mint, and mature value. Derivative glyphs are exhaled notes of that origin — lineage-true outflow, transferable, and redeemable by re-inhale.**

These lines define the monetary ontology of Φ inside the UI: notes, sigils, lineage, and audit.

### KaiVoh (Memory OS)

- **KaiVoh** tab opens the emission / broadcast surface
- Uses **SigilAuth** context to carry:
  - SVG sigil text
  - Kai Pulse metadata
  - Kai-Signature
  - optional user ΦKey and action URLs
- Intended as the sovereign “emission rail” for value, posts, and signals.

---

## 2. Tech Stack

- **Framework:** React + TypeScript (`.tsx`)
- **Bundler / Dev server:** [Vite](https://vitejs.dev/)
- **Routing:** `react-router-dom`
- **Styling:** hand-crafted CSS
  - `App.css` – ΦNet Atlantean Banking Console shell
  - `VerifierStamper.css` – Verifier layout, value strip, etc.
- **Kai Pulse Engine:** `src/utils/kai_pulse.ts`  
  Canonical Kairos time → pulse / beat / step / chakra-day.
- **Φ Precision Utils:** `src/utils/phi-precision.ts`  
  (`snap6`, `toScaled6`, `toStr6`) for 6-decimal fixed-point Φ arithmetic.

---

⸻

3. Getting Started (Local Dev)

Prerequisites
	•	Node.js ≥ 18
	•	pnpm or npm (examples use pnpm; swap npm if you prefer)

Install dependencies

pnpm install
# or
npm install

Environment variables

Create a .env or .env.local in the project root with whatever your build expects, for example:

VITE_PHI_API_BASE_URL=https://your-phi-node.example.com
VITE_PHI_EXPLORER_URL=https://explorer.example.com
VITE_KAI_PULSE_ORIGIN=2024-01-01T00:00:00Z

Adjust keys to match your actual code.

Run dev server

pnpm dev
# or
npm run dev

Vite will expose the app at something like:

http://localhost:5173

Open that in a browser to develop against a local ΦNet / test node.

⸻

4. Build & Deploy

Build

pnpm build
# or
npm run build

This generates a static bundle in dist/.

Serve dist/ behind any static host:
	•	Nginx / Caddy
	•	Vercel / Netlify / Fly.io
	•	S3 + CDN
	•	Your own ΦNet node’s static server

IKANN / verify.kai deployment

To run as http://verify.kai on IKANN:
	1.	Deploy the contents of dist/ to your origin server.
	2.	In your IKANN root, point A / AAAA records for verify.kai to that origin.
	3.	On a device, set DNS manually to your IKANN resolver (e.g. 137.66.18.241).
	4.	Visit http://verify.kai in Safari / any browser.

The OS will use IKANN as the authoritative root and resolve .kai names.

⸻

5. Security & Sovereignty Notes
	•	Time: Prefer kai_pulse.ts over wall-clock time.
	•	Type safety: No any in TypeScript; keep typings strict.
	•	Secrets: Never commit ΦNet node keys, IKANN root material, or signing secrets.
	•	Namespace authority: Only the canonical IKANN root may present itself as the official .kai namespace or as the real verify.kai.

⸻

6. Contributing

This repo powers a live sovereign monetary and identity gate.
For now, contributions are by invitation only.

If you see bugs, UX improvements, or performance wins:
	•	open an issue, or
	•	propose a patch

…but merges will be tightly controlled to preserve:
	•	namespace stability
	•	Kai Pulse fidelity
	•	tender semantics
	•	sovereign branding

⸻

7. License

Copyright © Kai Rex Klok (BJ Klock). All rights reserved.

You may inspect the code and run local builds for review and integration.
You may not:
	•	run a competing IKANN root under the same namespace, or
	•	present any fork as “verify.kai” or as the canonical ΦNet Sovereign Gate.

For partnership or licensing, reach out through KaiOS / Kai-Klok channels.

⸻


## 8. Connecting to IKANN DNS (Accessing `verify.kai`)

IKANN is the sovereign alt-root naming layer that resolves the `.kai` domain.  
To access `http://verify.kai` on any device, simply point your DNS to the IKANN resolver.

No apps, no VPN, no extensions required.

### iPhone / iPad (iOS)

1. Open **Settings**  
2. Tap **Wi-Fi**  
3. Tap the **(i)** icon next to your connected network  
4. Scroll to **DNS** → tap **Configure DNS**  
5. Select **Manual**  
6. Remove any existing servers  
7. Add the IKANN resolver:

137.66.18.241

8. Tap **Save**  
9. Open Safari → go to:

http://verify.kai

You are now on the Kai-root internet.

---

### macOS (MacBook / iMac)

1. Open **System Settings**  
2. Go to **Network**  
3. Select your active network (Wi-Fi or Ethernet)  
4. Click **Details**  
5. Scroll to **DNS**  
6. Remove existing DNS servers  
7. Add:

137.66.18.241

8. Click **OK → Apply**  
9. Visit:

http://verify.kai

---

### Android

1. Open **Settings**  
2. Tap **Network & Internet**  
3. Tap **Internet**  
4. Tap your Wi-Fi network  
5. Tap the **pencil** or **edit** icon  
6. Change **IP settings** to **Static**  
7. Enter the IKANN DNS as **DNS 1**:

137.66.18.241

8. Save  
9. Open Chrome and visit:

http://verify.kai

---

### Windows

1. Open **Control Panel**  
2. Go to **Network and Internet → Network and Sharing Center**  
3. Click your active connection  
4. Click **Properties**  
5. Select **Internet Protocol Version 4 (TCP/IPv4)** → **Properties**  
6. Choose **Use the following DNS server addresses**  
7. Enter:

Preferred DNS: 137.66.18.241
Alternate DNS: (leave blank)

8. Save  
9. Visit `http://verify.kai` in your browser.

---

### Router (Global for Entire Network)

1. Log into your router admin panel  
2. Find **LAN DNS**, **WAN DNS**, or **Internet DNS** settings  
3. Set **Primary DNS** to:

137.66.18.241

4. Save → Restart router  
5. All devices on your network can now resolve `*.kai`.

---

### Notes

- IKANN is a full alt-root resolver; `.kai` domains will resolve natively.
- If a domain is not in the `.kai` namespace, IKANN transparently forwards queries to upstream authoritative DNS.
- Removing the DNS entry instantly returns your device to the standard ICANN root.

---

### Test It

After setting DNS, open:

http://verify.kai

If the Sovereign Gate loads with the ΦNet interface, IKANN is active and your device is running on the Kai-root internet.


⸻

## 9. Project Structure (high-level)

```text
src/
  App.tsx               # Route shell + Sovereign Gate layout
  App.css               # ΦNet console shell styles

  components/
    VerifierStamper/
      VerifierStamper.tsx
      VerifierStamper.css
      SendPhiAmountField.tsx
      ...               # Verifier subcomponents

    KaiVoh/
      KaiVohModal.tsx
      SigilAuthContext.tsx
      ...               # KaiVoh emission flow

    SigilExplorer.tsx    # Optional sigil viewer / explorer
    ...                  # Other supporting components

  pages/
    SigilFeedPage.tsx    # Feed / stream route(s), if enabled

  utils/
    kai_pulse.ts         # Kairos pulse engine
    phi-precision.ts     # μΦ locking & fixed-point helpers

vite.config.ts           # Vite config for build / dev
index.html               # Vite entry HTML

