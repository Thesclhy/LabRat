import { createAnalysisExecutor } from "../../../saas/analysisExecutor.js";
import type { V1Config } from "../config/v1-config.js";

export const V1_ANALYSIS_EXECUTOR = Symbol("V1_ANALYSIS_EXECUTOR");

export function createV1AnalysisExecutor(config: V1Config) {
  return createAnalysisExecutor({
    mode: config.analysisExecutorMode,
    nodeEnv: config.nodeEnv,
    pythonCommand: config.analysisPythonCommand,
    workerEndpoint: config.analysisWorkerEndpoint,
    timeoutMs: config.analysisExecutorTimeoutMs,
  });
}

export type V1AnalysisExecutor = ReturnType<typeof createV1AnalysisExecutor>;
