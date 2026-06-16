import path from "node:path";

function boolFromEnv(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

export function loadSaasConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || "development";
  const seedDevAccounts = boolFromEnv(env.LABRAT_SEED_DEV_ACCOUNTS);
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
    sessionSecret,
    seedDevAccounts,
    sessionCookieName: env.LABRAT_SESSION_COOKIE || "labrat_session",
    sessionTtlMs: Number(env.LABRAT_SESSION_TTL_MS || 1000 * 60 * 60 * 24 * 14),
    fileStorageRoot: env.LABRAT_FILE_STORAGE_ROOT || path.resolve(process.cwd(), "backend", ".labrat-files"),
    secureCookies: nodeEnv === "production" || boolFromEnv(env.LABRAT_SECURE_COOKIES),
  };
}

