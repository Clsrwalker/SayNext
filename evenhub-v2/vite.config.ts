import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@evenrealities/even_hub_sdk": fileURLToPath(
        new URL(
          "./node_modules/@evenrealities/even_hub_sdk/dist/index.cjs",
          import.meta.url,
        ),
      ),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5174,
    proxy: {
      "/api/evenhub/v2/ws": {
        target: "ws://localhost:3000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
