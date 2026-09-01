import { createBackendModelProvider } from "../../../saas/backendModelProvider.js";
import type { V1Config } from "../config/v1-config.js";

export const V1_MODEL_PROVIDER = Symbol("V1_MODEL_PROVIDER");

export function createV1ModelProvider(config: V1Config) {
  return createBackendModelProvider({ config });
}

export type V1ModelProvider = ReturnType<typeof createV1ModelProvider>;
