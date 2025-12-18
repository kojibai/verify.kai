import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(buildVersion),
  },
});
