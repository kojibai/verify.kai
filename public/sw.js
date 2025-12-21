/* KAIKLOK SW — offline-first + route mapping for /s/* (sigil links)
   - Canonical service worker (legacy /service-worker.js removed to avoid conflicts)
   - Instant offline boot (app-shell)
   - Seeds known sigil links from /sigils-index.json (optional)
   - Lazily maps any visited route → shell so it re-opens offline next time
   - Stale-while-revalidate for assets; network-first (timeout) for JSON/API
   - Audio/video range support; fonts cached; CDNs handled
*/

// Update this version string manually to keep the app + cache versions in sync.
// The value is forwarded to the UI via the service worker "SW_ACTIVATED" message.
const APP_VERSION = "29.8.0"; // update on release
const VERSION = new URL(self.location.href).searchParams.get("v") || APP_VERSION; // derived from build
const PREFIX  = "PHINETWORK";
const PRECACHE = `${PREFIX}-precache-${VERSION}`;
const RUNTIME  = `${PREFIX}-runtime-${VERSION}`;
const ASSETCACHE = `${PREFIX}-assets-${VERSION}`;
const FONTCACHE  = `${PREFIX}-fonts-${VERSION}`;
const IMAGECACHE = `${PREFIX}-images-${VERSION}`;

const OFFLINE_URL = "/index.html";
const OFFLINE_FALLBACK = "/offline.html";

const MANIFEST_ASSETS = Array.isArray(self.__WB_MANIFEST)
  ? self.__WB_MANIFEST.map((entry) => entry.url)
  : [];

// Minimal shell (we also discover hashed bundles from index.html)
const CORE_SHELL = [
  "/",               // iOS needs both "/" and "/index.html"
  "/index.html",
  "/?source=pwa",    // if your manifest start_url includes this
  "/manifest.json",
  "/favicon.ico",
  "/logo.png",
  "/assets/logo.svg",
  "/assets/kai-icon.svg",
  "/assets/favicon.ico",
  OFFLINE_FALLBACK,
];

// Icons we want available immediately for install/badge/shortcut UX
const ICON_ASSETS = [
  "/logo-maskable.png",
  "/favicon-16x16.png",
  "/favicon-32x32.png",
  "/android-icon-36x36.png",
  "/android-icon-48x48.png",
  "/android-icon-72x72.png",
  "/android-icon-96x96.png",
  "/android-icon-144x144.png",
  "/android-icon-192x192.png",
  "/icons/128.png",
  "/icons/192.png",
  "/icons/256.png",
  "/icons/384.png",
  "/icons/512.png",
  "/shortcuts/klok.png",
  "/shortcuts/sigil.png",
  "/shortcuts/pulse.png",
];

const SIGIL_STREAM_ROUTES = [
  "/stream",
  "/stream/p",
  "/stream/c",
  "/feed",
  "/feed/p",
  "/p",
  "/p~",
];

const SHORTCUT_ROUTES = [
  "/",
  "/mint",
  "/voh",
  "/keystream",
  "/klock",
  "/klok",
  "/sigil/new",
  "/pulse",
  "/verify",
  "/verifier.html",
  ...SIGIL_STREAM_ROUTES,
];

// Assets required to keep verification + sigil flows alive while offline
const CRITICAL_OFFLINE_ASSETS = [
  "/sigil.wasm",
  "/sigil.zkey",
  "/sigil.artifacts.json",
  "/sigil.vkey.json",
  "/verification_key.json",
  "/verifier-core.js",
  "/verifier.inline.html",
  "/verifier.html",
  "/pdf-lib.min.js",
];

const PRECACHE_URLS = Array.from(new Set([
  ...CORE_SHELL,
  ...ICON_ASSETS,
  ...MANIFEST_ASSETS.filter((url) => url.includes("icon") || url.endsWith("manifest.json")),
]));
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif"];
const ASSET_EXTENSIONS = [".js", ".mjs", ".cjs", ".css", ".wasm", ".json", ".map"];
const SEED_SIGILS_INDEX = "/sigils-index.json"; // optional list of popular /s/<hash>?p=... routes
const sameOrigin = (url) => new URL(url, self.location.href).origin === self.location.origin;

const withTimeout = (ms, promise) =>
  new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(v => { clearTimeout(id); resolve(v); },
                 e => { clearTimeout(id); reject(e); });
  });

async function safePut(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  } catch {}
}
function normalizeWarmUrl(rawUrl) {
  try {
    const url = new URL(rawUrl, self.location.origin);
    if (url.origin !== self.location.origin) return null;
    return url;
  } catch {
    return null;
  }
}

function cacheBucketFor(url) {
  const path = url.pathname.toLowerCase();

  if (IMAGE_EXTENSIONS.some((ext) => path.endsWith(ext))) return IMAGECACHE;
  if (ASSET_EXTENSIONS.some((ext) => path.endsWith(ext))) return ASSETCACHE;
  if (url.pathname === "/" || !path.split("/").pop()?.includes(".")) return PRECACHE;
  return RUNTIME;
}

async function warmUrls(urls, { mapShell = false } = {}) {
  const unique = Array.from(new Set(urls || []));
  if (!unique.length) return;

  const shell = mapShell
    ? await caches.match(OFFLINE_URL, { ignoreSearch: true }).catch(() => null)
    : null;

  await Promise.all(
    unique.map(async (raw) => {
      const url = normalizeWarmUrl(raw);
      if (!url) return;

      const cacheName = cacheBucketFor(url);
      const req = new Request(url.href, { cache: "reload" });

      try {
        const res = await fetch(req);
        if (!res || (!res.ok && res.type !== "opaque")) return;
        await safePut(cacheName, req, res);
        if (mapShell && shell && !url.pathname.split("/").pop()?.includes(".")) {
          await mapShellToRoute(url.href, shell);
        }
      } catch {}
    }),
  );
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req).then(async res => {
    await cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return cached || network || new Response("", { status: 504, statusText: "offline" });
}

async function networkFirst(req, cacheName, timeoutMs = 3500) {
  try {
    const res = await withTimeout(timeoutMs, fetch(req));
    await safePut(cacheName, req, res);
    return res;
  } catch {
    const cached = await caches.match(req, { ignoreSearch: true });
    return cached || new Response("", { status: 504, statusText: "offline" });
  }
}

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req, { ignoreSearch: true });
  if (cached) {
    updateFromNetwork(req, cacheName); // background revalidate
    return cached;
  }
  const net = await fetch(req).catch(() => null);
  if (net) await safePut(cacheName, req, net);
  return net || new Response("", { status: 504, statusText: "offline" });
}

async function updateFromNetwork(req, cacheName) {
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === "opaque")) await safePut(cacheName, req, res);
  } catch {}
}

async function precacheDiscoveredAssets() {
  try {
    const res = await fetch(new Request("/index.html", { cache: "reload" }));
    const html = await res.text();
    const assetUrls = new Set();

    // capture src/href for /assets/* and same-origin assets
    const re = /(src|href)\s*=\s*"(\/assets\/[^"#?]+(?:\?[^"]*)?)"/g;
    let m;
    while ((m = re.exec(html))) assetUrls.add(m[2]);

    // modulepreload hints
    const reMod = /rel="modulepreload"\s+href="(\/assets\/[^"#?]+(?:\?[^"]*)?)"/g;
    while ((m = reMod.exec(html))) assetUrls.add(m[1]);

    if (assetUrls.size) {
      const cache = await caches.open(ASSETCACHE);
      await cache.addAll([...assetUrls].map(u => new Request(u, { cache: "reload" })));
    }
  } catch {
    // runtime caching will cover assets on first run
  }
}

// Map an arbitrary route URL to the cached shell (so it matches by that exact URL later)
async function mapShellToRoute(routeUrl, shellResponse) {
  try {
    const cache = await caches.open(PRECACHE);
    await cache.put(new Request(routeUrl), shellResponse.clone());
  } catch {}
}

// Seed mapping from a JSON index of routes (e.g., popular /s/<hash>?p=...)
async function seedSigilRoutes(shellResponse) {
  try {
    const res = await fetch(new Request(SEED_SIGILS_INDEX, { cache: "reload" }));
    if (!res.ok) return;
    const list = await res.json();
    if (!Array.isArray(list)) return;
    const cache = await caches.open(PRECACHE);
    await Promise.all(
      list.map(async (u) => {
        try {
          await cache.put(new Request(u), shellResponse.clone());
        } catch {}
      })
    );
  } catch {
    // optional seeding; safe to skip if file missing
  }
}

// --- Range request support (audio/video) ---
async function handleRangeRequest(event) {
  const req = event.request;
  const range = req.headers.get("range");
  if (!range) return null;

  let res = await caches.match(req, { ignoreSearch: true });
  if (!res) {
    res = await fetch(req).catch(() => null);
    if (res && res.ok) await safePut(RUNTIME, req, res);
  }
  if (!res || !res.ok) return null;

  const buf = await res.arrayBuffer();
  const size = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = Number(m?.[1]);
  let end = Number(m?.[2]);
  if (isNaN(start)) start = 0;
  if (isNaN(end) || end === 0) end = size - 1;
  start = Math.min(start, size - 1);
  end = Math.min(end, size - 1);

  const chunk = buf.slice(start, end + 1);
  return new Response(chunk, {
    status: 206,
    headers: {
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": String(chunk.byteLength),
      "Content-Type": res.headers.get("Content-Type") || "application/octet-stream",
    },
  });
}

// --- Lifecycle ---
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE);
    const precacheRequests = PRECACHE_URLS.map((u) => new Request(u, { cache: "reload" }));

    // Precache the shell & some basic assets, but allow partial success
    await Promise.allSettled(
      precacheRequests.map(async (req) => {
        try {
          const res = await fetch(req);
          if (res && (res.ok || res.type === "opaque")) await cache.put(req, res.clone());
        } catch {}
      }),
    );

    // Discover & precache hashed bundles
    await precacheDiscoveredAssets();

    // Map the shell to known dynamic routes (seed list)
    // Fetch a fresh shell to map (ensure correct headers)
    let shell = await cache.match(OFFLINE_URL, { ignoreSearch: true });
    if (!shell) {
      try {
        shell = await fetch(OFFLINE_URL);
        if (shell && (shell.ok || shell.type === "opaque")) {
          await cache.put(new Request(OFFLINE_URL), shell.clone());
        }
      } catch {}
    }
    if (shell) {
      // Pre-map shell to known shortcuts so they are instant + offline
      await Promise.all(SHORTCUT_ROUTES.map((route) => mapShellToRoute(route, shell)));
      // Seed popular /s/... routes if you provide /sigils-index.json
      await seedSigilRoutes(shell);
    }

    // Make sure the offline fallback is cached so navigations stay friendly
    const offlineCached = await cache.match(OFFLINE_FALLBACK, { ignoreSearch: true });
    if (!offlineCached) {
      try { await cache.add(new Request(OFFLINE_FALLBACK, { cache: "reload" })); } catch {}
    }
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => ![PRECACHE, RUNTIME, ASSETCACHE, FONTCACHE, IMAGECACHE].includes(k))
      .map(k => caches.delete(k)));
    if ("navigationPreload" in self.registration) {
      try { await self.registration.navigationPreload.enable(); } catch {}
    }

    let claimed = false;
    try {
      await warmUrls(CRITICAL_OFFLINE_ASSETS, { mapShell: true });
    } catch {}

    try {
      await self.clients.claim();
      claimed = true;
    } catch {}

    try {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      clients.forEach((client) => client.postMessage({ type: "SW_ACTIVATED", version: VERSION, claimed }));
    } catch {}

    try {
      console.info("Kai service worker activated", { version: VERSION, claimed });
    } catch {}
  })());
});

// Allow app to trigger immediate takeover
self.addEventListener("message", (event) => {
  const { data } = event;
  if (data === "SKIP_WAITING" || data?.type === "SKIP_WAITING") self.skipWaiting();
  if (data?.type === "WARM_URLS" && Array.isArray(data.urls)) {
    event.waitUntil(warmUrls(data.urls, { mapShell: Boolean(data.mapShell) }));
  }
});

// --- Fetch routing ---
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Non-GET passthrough (let app handle offline queue if needed)
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Range requests (audio/video scrubbing)
  if (req.headers.has("range")) {
    event.respondWith((async () => {
      const ranged = await handleRangeRequest(event);
      if (ranged) return ranged;
      try { return await fetch(req); } catch { return new Response("", { status: 504 }); }
    })());
    return;
  }

  // Navigations → serve app shell; also map this exact URL → shell for future offline opens
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      // Try navigation preload
      try {
        const preload = ("navigationPreload" in self.registration) ? await event.preloadResponse : null;
        if (preload) {
          // Update shell cache and map to this route
          await safePut(PRECACHE, new Request(OFFLINE_URL), preload.clone());
          await mapShellToRoute(req.url, preload);
          return preload;
        }
      } catch {}

      // Use cached shell
      const cachedShell = await caches.match(OFFLINE_URL, { ignoreSearch: true });
      if (cachedShell) {
        // Lazy map: store the shell under this exact navigation URL for future cold offline opens
        event.waitUntil(mapShellToRoute(req.url, cachedShell));
        // Revalidate the canonical shell in background
        event.waitUntil(updateFromNetwork(OFFLINE_URL, PRECACHE));
        return cachedShell;
      }

      // Last resort: network
      try {
        const net = await fetch(OFFLINE_URL);
        await safePut(PRECACHE, new Request(OFFLINE_URL), net.clone());
        await mapShellToRoute(req.url, net);
        return net;
      } catch {
        const cachedFallback = await caches.match(OFFLINE_FALLBACK, { ignoreSearch: true });
        if (cachedFallback) return cachedFallback;
        return new Response(
          "<!doctype html><meta charset=utf-8><title>Offline</title><h1>Offline</h1><p>Open once online to cache the app shell.</p>",
          { headers: { "Content-Type": "text/html" }, status: 503 }
        );
      }
    })());
    return;
  }

  // Static assets → SWR
  if (sameOrigin(req.url) && (
      url.pathname.startsWith("/assets/") ||
      req.destination === "script" ||
      req.destination === "style" ||
      req.destination === "worker"
    )) {
    event.respondWith(staleWhileRevalidate(req, ASSETCACHE));
    return;
  }

  // Fonts → cache-first
  if (req.destination === "font" || url.hostname.includes("fonts.gstatic.com")) {
    event.respondWith(cacheFirst(req, FONTCACHE));
    return;
  }

  // Google Fonts CSS → SWR
  if (url.hostname.includes("fonts.googleapis.com")) {
    event.respondWith(staleWhileRevalidate(req, ASSETCACHE));
    return;
  }

  // Images → SWR
  if (req.destination === "image") {
    event.respondWith(staleWhileRevalidate(req, IMAGECACHE));
    return;
  }

  // JSON/API GET → network-first with timeout, fallback to cache
  const expectsJSON = req.headers.get("accept")?.includes("application/json")
    || url.pathname.startsWith("/api/")
    || url.pathname.endsWith(".json");
  if (expectsJSON) {
    event.respondWith(networkFirst(req, RUNTIME, 3500));
    return;
  }

  // Same-origin everything else → network-first (fresh when available), fallback to cache
  if (sameOrigin(req.url)) {
    event.respondWith(networkFirst(req, RUNTIME, 3500));
    return;
  }

  // Cross-origin (CDNs etc.) → SWR
  event.respondWith(staleWhileRevalidate(req, RUNTIME));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/att/") && event.request.method === "GET") {
    event.respondWith((async () => {
      const cache = await caches.open("sigil-attachments-v1");
      const hit = await cache.match(event.request);
      if (hit) return hit;
      // Optional: deny network to keep these cache-only
      return new Response("Not Found", { status: 404 });
    })());
  }
});
