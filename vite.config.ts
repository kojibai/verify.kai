import { promises as fs } from "node:fs";
import path from "node:path";

import react from "@vitejs/plugin-react";
import type { ManifestOptions, PluginOption } from "vite";
import { defineConfig } from "vite";
import manifest from "./public/manifest.json" assert { type: "json" };
import { version as packageVersion } from "./package.json";

const commitSha =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.VITE_GIT_SHA ||
  process.env.GITHUB_SHA ||
  process.env.COMMIT_REF ||
  "";

const buildVersion = commitSha
  ? `${packageVersion}+${commitSha.slice(0, 7)}`
  : packageVersion;

const PWA_STATIC_ASSETS = ["offline.html", "manifest.json", "favicon.ico"];

const createPwaAssetInjector = (): PluginOption => {
  let outDir = "dist";
  let resolvedRoot = process.cwd();
  let precacheEntries: Array<{ url: string }> = [];

  return {
    name: "kairos-pwa-asset-injector",
    apply: "build",
    configResolved(config) {
      resolvedRoot = config.root;
      outDir = config.build.outDir;
    },
    generateBundle(_options, bundle) {
      const urls = Object.values(bundle)
        .filter((asset) => asset.type === "asset" || asset.type === "chunk")
        .filter((asset) => !asset.fileName.endsWith(".map"))
        .map((asset) => ({ url: `/${asset.fileName}` }));

      // Keep unique URLs only
      const seen = new Set<string>();
      precacheEntries = urls.filter(({ url }) => {
        if (seen.has(url)) return false;
        seen.add(url);
        return true;
      });
    },
    async closeBundle() {
      const distDir = path.resolve(resolvedRoot, outDir);
      const swPath = path.join(distDir, "sw.js");

      const extras: Array<{ url: string }> = [];
      await Promise.all(
        PWA_STATIC_ASSETS.map(async (file) => {
          try {
            await fs.access(path.join(distDir, file));
            extras.push({ url: `/${file}` });
          } catch {
            // optional assets; ignore when missing
          }
        })
      );

      const manifestPayload = JSON.stringify([...precacheEntries, ...extras], null, 2);
      const injection = `self.__WB_MANIFEST = ${manifestPayload};\n`;

      try {
        const swSource = await fs.readFile(swPath, "utf8");
        const updated = swSource.includes("self.__WB_MANIFEST =")
          ? swSource.replace(/self.__WB_MANIFEST\s*=\s*[^;]+;/, injection.trimEnd())
          : swSource.replace("// public/service-worker.js", `// public/service-worker.js\n${injection}`);

        await fs.writeFile(swPath, updated);
      } catch (error) {
        this.warn(`PWA manifest injection skipped: ${(error as Error).message}`);
      }
    },
  };
};

const pwaManifest = manifest as ManifestOptions;

// https://vite.dev/config/
export default defineConfig({
  appType: "spa",
  base: "/",
  plugins: [react(), createPwaAssetInjector()],
  build: {
    outDir: "dist",
    assetsInlineLimit: 0, // keep assets as files so they can be precached
    rollupOptions: {
      output: {
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(buildVersion),
    "import.meta.env.VITE_PWA_MANIFEST": JSON.stringify(pwaManifest),
  },
});
