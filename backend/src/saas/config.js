import path from "node:path";

function boolFromEnv(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

export function loadSaasConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || "development";
  const seedDevAccounts = boolFromEnv(env.LABRAT_SEED_DEV_ACCOUNTS);
  const analysisWorkerEndpoint = env.LABRAT_ANALYSIS_WORKER_ENDPOINT || "";
  const analysisExecutorMode = String(
    env.LABRAT_ANALYSIS_EXECUTOR || (analysisWorkerEndpoint ? "worker" : "disabled"),
  ).trim().toLowerCase();
  const sessionSecret = env.SESSION_SECRET || (nodeEnv === "production" ? "" : "dev-only-labrat-session-secret");
  if (nodeEnv === "production" && !sessionSecret) {
    throw Object.assign(new Error("SESSION_SECRET is required in production."), {
      statusCode: 500,
      code: "unsafe_config",
    });
  }
  if (nodeEnv === "production" && seedDevAccounts) {
    throw Object.assign(new Error("LABRAT_SEED_DEV_ACCOUNTS cannot be enabled in production."), {
      statusCode: 500,
      code: "unsafe_config",
    });
  }

  return {
    nodeEnv,
    databaseUrl: env.DATABASE_URL || "",
    aiProvider: env.LABRAT_AI_PROVIDER || "anthropic",
    anthropicApiKey: env.ANTHROPIC_API_KEY || "",
    anthropicModel: env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
    analysisExecutorMode,
    analysisPythonCommand: env.LABRAT_ANALYSIS_PYTHON_COMMAND || "python",
    analysisWorkerEndpoint,
    analysisExecutorTimeoutMs: Math.min(
      Math.max(Number(env.LABRAT_ANALYSIS_TIMEOUT_MS) || 60_000, 1_000),
      300_000,
    ),
    sessionSecret,
    seedDevAccounts,
    sessionCookieName: env.LABRAT_SESSION_COOKIE || "labrat_session",
    sessionTtlMs: Number(env.LABRAT_SESSION_TTL_MS || 1000 * 60 * 60 * 24 * 14),
    fileStorageRoot: env.LABRAT_FILE_STORAGE_ROOT || path.resolve(process.cwd(), "backend", ".labrat-files"),
    secureCookies: nodeEnv === "production" || boolFromEnv(env.LABRAT_SECURE_COOKIES),
  };
}
