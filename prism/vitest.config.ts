import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environmentMatchGlobs: [
      ["src/test/ui.test.tsx", "jsdom"],
      ["src/test/*.ui.test.tsx", "jsdom"]
    ],
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
