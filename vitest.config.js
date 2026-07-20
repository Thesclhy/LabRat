import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  cacheDir: ".vitest",
  test: {
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{js,jsx}"],
    maxWorkers: 4,
    setupFiles: "./src/test/setupTests.js",
  },
});
