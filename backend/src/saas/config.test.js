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
