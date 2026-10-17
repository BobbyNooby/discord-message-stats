import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

// The dev server proxies the API so `pnpm dev` talks to the real backend on one
// origin — the same shape as production, where FastAPI serves this build.
export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000", "/auth": "http://127.0.0.1:8000" },
  },
  build: { outDir: "dist", sourcemap: true },
  test: {
    // Parallel agent runs share this machine; the default 5s turned real
    // passes into timeouts while four of them ran together.
    testTimeout: 15000,
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
