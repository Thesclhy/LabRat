import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/v1/**/*.test.ts"],
    exclude: ["src/v1/**/*.postgres.test.ts"],
    globals: false,
    pool: "forks",
    maxWorkers: 4,
    testTimeout: 30_000,
  },
});
