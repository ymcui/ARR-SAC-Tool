import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "http://127.0.0.1:8000/"
      }
    },
    globals: true,
    setupFiles: "./vitest.setup.ts"
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  }
});
