import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/mobile/",
  plugins: [react()],
  resolve: {
    alias: {
      "@mobile-contract": fileURLToPath(
        new URL("../shared/mobile-contract/src/index.ts", import.meta.url)
      ),
      "@mobile-client": fileURLToPath(
        new URL("../shared/mobile-client/src/index.ts", import.meta.url)
      ),
    },
  },
  build: {
    outDir: fileURLToPath(new URL("../gateway/dist/mobile", import.meta.url)),
    emptyOutDir: false,
    sourcemap: true,
  },
});
