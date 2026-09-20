import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@ui": path.resolve(dir, "../ui") },
  },
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
  test: { include: ["tests/**/*.test.ts"] },
});
