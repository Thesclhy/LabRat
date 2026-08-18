import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSaasConfig } from "./config.js";

const anthropicEnv = (overrides = {}) => ({
  LABRAT_AI_PROVIDER: "anthropic",
  ...overrides,
});

test("loadSaasConfig rejects missing production session secret", () => {
  assert.throws(
    () => loadSaasConfig(anthropicEnv({ NODE_ENV: "production" })),
    /SESSION_SECRET is required/,
  );
});

test("loadSaasConfig rejects production dev seed accounts", () => {
  assert.throws(
    () => loadSaasConfig(anthropicEnv({
      NODE_ENV: "production",
      SESSION_SECRET: "prod-secret",
      LABRAT_SEED_DEV_ACCOUNTS: "true",
    })),
    /cannot be enabled in production/,
  );
});

test("loadSaasConfig enables explicit development seed accounts", () => {
  const config = loadSaasConfig(anthropicEnv({
    NODE_ENV: "test",
    SESSION_SECRET: "test-secret",
    LABRAT_SEED_DEV_ACCOUNTS: "true",
  }));

  assert.equal(config.seedDevAccounts, true);
  assert.equal(config.sessionSecret, "test-secret");
});

test("loadSaasConfig keeps provider credentials on the backend", () => {
  const config = loadSaasConfig(anthropicEnv({
    NODE_ENV: "test",
    SESSION_SECRET: "test-secret",
    ANTHROPIC_API_KEY: "server-only-secret",
    ANTHROPIC_MODEL: "claude-test",
  }));

  assert.equal(config.aiProvider, "anthropic");
  assert.equal(config.anthropicApiKey, "server-only-secret");
  assert.equal(config.anthropicModel, "claude-test");
});

test("loadSaasConfig selects DeepSeek with backend-only configuration", () => {
  const config = loadSaasConfig({
    NODE_ENV: "test",
    SESSION_SECRET: "test-secret",
    LABRAT_AI_PROVIDER: "deepseek",
    DEEPSEEK_API_KEY: "deepseek-secret",
    DEEPSEEK_MODEL: "deepseek-v4-pro",
    DEEPSEEK_BASE_URL: "https://api.deepseek.com/",
  });

  assert.equal(config.aiProvider, "deepseek");
  assert.equal(config.deepseekApiKey, "deepseek-secret");
  assert.equal(config.deepseekModel, "deepseek-v4-pro");
  assert.equal(config.deepseekBaseUrl, "https://api.deepseek.com");
});

test("loadSaasConfig rejects invalid DeepSeek base URLs", () => {
  assert.throws(
    () => loadSaasConfig({
      NODE_ENV: "test",
      LABRAT_AI_PROVIDER: "deepseek",
      DEEPSEEK_BASE_URL: "http://api.deepseek.com",
    }),
    /valid HTTPS URL/,
  );
});

test("loadSaasConfig requires a supported explicit provider in every environment", () => {
  assert.throws(
    () => loadSaasConfig({ NODE_ENV: "test" }),
    /LABRAT_AI_PROVIDER is required/,
  );
  assert.throws(
    () => loadSaasConfig({ NODE_ENV: "development", LABRAT_AI_PROVIDER: "unsupported" }),
    /Unsupported LABRAT_AI_PROVIDER/,
  );
});

test("loadSaasConfig allows an unconfigured selected provider outside production", () => {
  const anthropic = loadSaasConfig(anthropicEnv({ NODE_ENV: "development" }));
  const deepseek = loadSaasConfig({
    NODE_ENV: "test",
    LABRAT_AI_PROVIDER: "deepseek",
  });

  assert.equal(anthropic.anthropicApiKey, "");
  assert.equal(deepseek.deepseekApiKey, "");
});

test("loadSaasConfig requires the selected production provider key", () => {
  assert.throws(
    () => loadSaasConfig({
      NODE_ENV: "production",
      SESSION_SECRET: "prod-secret",
      LABRAT_AI_PROVIDER: "deepseek",
    }),
    /API key is required.*deepseek/,
  );
  assert.throws(
    () => loadSaasConfig(anthropicEnv({
      NODE_ENV: "production",
      SESSION_SECRET: "prod-secret",
    })),
    /API key is required.*anthropic/,
  );
});

test("analysis execution defaults to disabled and only auto-selects a configured worker", () => {
  const disabled = loadSaasConfig(anthropicEnv({
    NODE_ENV: "production",
    SESSION_SECRET: "prod-secret",
    ANTHROPIC_API_KEY: "prod-provider-secret",
  }));
  const worker = loadSaasConfig(anthropicEnv({
    NODE_ENV: "production",
    SESSION_SECRET: "prod-secret",
    ANTHROPIC_API_KEY: "prod-provider-secret",
    LABRAT_ANALYSIS_WORKER_ENDPOINT: "https://worker.example.test/analyze",
  }));

  assert.equal(disabled.analysisExecutorMode, "disabled");
  assert.equal(worker.analysisExecutorMode, "worker");
  assert.equal(worker.analysisWorkerEndpoint, "https://worker.example.test/analyze");
});

test("analysis executor limits and local command remain backend-only configuration", () => {
  const config = loadSaasConfig(anthropicEnv({
    NODE_ENV: "test",
    SESSION_SECRET: "test-secret",
    LABRAT_ANALYSIS_EXECUTOR: "local",
    LABRAT_ANALYSIS_PYTHON_COMMAND: "python-test",
    LABRAT_ANALYSIS_TIMEOUT_MS: "12345",
  }));

  assert.equal(config.analysisExecutorMode, "local");
  assert.equal(config.analysisPythonCommand, "python-test");
  assert.equal(config.analysisExecutorTimeoutMs, 12345);
});
