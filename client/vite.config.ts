import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  base: "/sixfront/",
  resolve: {
    alias: {
      "@sixfront/shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
