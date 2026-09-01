import { loadSaasConfig } from "../../../saas/config.js";

export const V1_CONFIG = Symbol("V1_CONFIG");

export interface V1Config {
  nodeEnv: string;
  databaseUrl: string;
  sessionCookieName: string;
  sessionTtlMs: number;
  secureCookies: boolean;
  aiProvider: "anthropic" | "deepseek";
  anthropicApiKey: string;
  anthropicModel: string;
  deepseekApiKey: string;
  deepseekModel: string;
  deepseekBaseUrl: string;
  analysisExecutorMode: string;
  analysisPythonCommand: string;
  analysisWorkerEndpoint: string;
  analysisExecutorTimeoutMs: number;
  fileStorageRoot: string;
}

export function loadV1Config(): V1Config {
  const config = loadSaasConfig() as V1Config;
  if (config.nodeEnv !== "test" && !config.databaseUrl) {
    throw Object.assign(new Error("DATABASE_URL is required for the v1 backend."), {
      statusCode: 500,
      code: "unsafe_config",
    });
  }
  return config;
}
