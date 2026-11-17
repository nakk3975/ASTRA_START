import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig(({ mode }) => ({
  root: fileURLToPath(new URL(".", import.meta.url)),
  build: {
    outDir: mode === "review" ? "../../dist/review" : "../../dist/web",
    emptyOutDir: true,
  },
  server: { host: "0.0.0.0", allowedHosts: true },
}));
