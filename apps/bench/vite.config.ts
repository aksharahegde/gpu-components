import { defineConfig } from "vite";
import path from "node:path";

// Serves browser/index.html for the Playwright harness. `server.fs.allow` is widened to the repo
// root because the WebGPU renderer imports `registry/timeline/*` directly (outside this package).
export default defineConfig({
  root: path.resolve(__dirname, "browser"),
  server: {
    fs: { allow: [path.resolve(__dirname, "../..")] },
  },
});
