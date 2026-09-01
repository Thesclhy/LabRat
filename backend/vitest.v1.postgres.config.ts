import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/v1/**/*.postgres.test.ts"],
    globals: false,
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
