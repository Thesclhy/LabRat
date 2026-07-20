import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSaasConfig } from "./config.js";

test("loadSaasConfig rejects missing production session secret", () => {
  assert.throws(
    () => loadSaasConfig({ NODE_ENV: "production" }),
    /SESSION_SECRET is required/,
  );
});

test("loadSaasConfig rejects production dev seed accounts", () => {
  assert.throws(
    () => loadSaasConfig({ NODE_ENV: "production", SESSION_SECRET: "prod-secret", LABRAT_SEED_DEV_ACCOUNTS: "true" }),
    /cannot be enabled in production/,
  );
});

test("loadSaasConfig enables explicit development seed accounts", () => {
  const config = loadSaasConfig({
    NODE_ENV: "test",
    SESSION_SECRET: "test-secret",
    LABRAT_SEED_DEV_ACCOUNTS: "true",
  });

  assert.equal(config.seedDevAccounts, true);
  assert.equal(config.sessionSecret, "test-secret");
});

test("loadSaasConfig keeps provider credentials on the backend", () => {
  const config = loadSaasConfig({
    NODE_ENV: "test",
    SESSION_SECRET: "test-secret",
    ANTHROPIC_API_KEY: "server-only-secret",
    ANTHROPIC_MODEL: "claude-test",
  });

  assert.equal(config.aiProvider, "anthropic");
  assert.equal(config.anthropicApiKey, "server-only-secret");
  assert.equal(config.anthropicModel, "claude-test");
});

test("analysis execution defaults to disabled and only auto-selects a configured worker", () => {
  const disabled = loadSaasConfig({
    NODE_ENV: "production",
    SESSION_SECRET: "prod-secret",
  });
  const worker = loadSaasConfig({
    NODE_ENV: "production",
    SESSION_SECRET: "prod-secret",
    LABRAT_ANALYSIS_WORKER_ENDPOINT: "https://worker.example.test/analyze",
  });

  assert.equal(disabled.analysisExecutorMode, "disabled");
  assert.equal(worker.analysisExecutorMode, "worker");
  assert.equal(worker.analysisWorkerEndpoint, "https://worker.example.test/analyze");
});

test("analysis executor limits and local command remain backend-only configuration", () => {
  const config = loadSaasConfig({
    NODE_ENV: "test",
    SESSION_SECRET: "test-secret",
    LABRAT_ANALYSIS_EXECUTOR: "local",
    LABRAT_ANALYSIS_PYTHON_COMMAND: "python-test",
    LABRAT_ANALYSIS_TIMEOUT_MS: "12345",
  });

  assert.equal(config.analysisExecutorMode, "local");
  assert.equal(config.analysisPythonCommand, "python-test");
  assert.equal(config.analysisExecutorTimeoutMs, 12345);
});
