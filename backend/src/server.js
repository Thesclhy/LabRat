import http from "node:http";
import { fileURLToPath } from "node:url";
import { sendJson } from "./http/json.js";
import { loadSaasConfig } from "./saas/config.js";
import { createSaasStore } from "./saas/store.js";
import { handleSaasRoutes } from "./saas/routes/saasRoutes.js";
import { createBackendModelProvider } from "./saas/backendModelProvider.js";
import {
  createAnalysisToolRegistry,
  createStoreBackedAnalysisHandlers,
} from "./saas/analysisToolRegistry.js";
import { createAnalysisExecutor } from "./saas/analysisExecutor.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;

export function createServer(options = {}) {
  const config = options.config || loadSaasConfig();
  const storePromise = options.store ? Promise.resolve(options.store) : createSaasStore(config);
  const modelProvider = options.modelProvider || createBackendModelProvider({ config });
  const analysisExecutor = options.analysisExecutor || createAnalysisExecutor({
    mode: config.analysisExecutorMode,
    nodeEnv: config.nodeEnv,
    pythonCommand: config.analysisPythonCommand,
    workerEndpoint: config.analysisWorkerEndpoint,
    timeoutMs: config.analysisExecutorTimeoutMs,
  });
  const analysisToolRegistryPromise = storePromise.then((store) => (
    options.analysisToolRegistry || createAnalysisToolRegistry({
      handlers: createStoreBackedAnalysisHandlers({ store }),
    })
  ));
  return http.createServer(async (req, res) => {
    try {
      const [store, analysisToolRegistry] = await Promise.all([
        storePromise,
        analysisToolRegistryPromise,
      ]);
      const saasContext = {
        config,
        store,
        modelProvider,
        analysisToolRegistry,
        analysisExecutor,
      };
      if (req.method === "GET" && req.url === "/health") {
        sendJson(res, 200, { ok: true, service: "labrat-backend" });
        return;
      }

      if (await handleSaasRoutes(req, res, saasContext)) return;

      sendJson(res, 404, {
        error: {
          code: "not_found",
          message: "Route not found.",
        },
      });
    } catch (error) {
      sendJson(res, error.statusCode || 500, {
        error: {
          code: error.code || "internal_error",
          message: error.message || "Request failed.",
        },
      });
    }
  });
}

export function startServer(options = {}) {
  const host = options.host || process.env.HOST || DEFAULT_HOST;
  const port = Number(options.port || process.env.PORT || DEFAULT_PORT);
  const server = createServer(options);
  server.listen(port, host, () => {
    console.log(`LabRat backend listening at http://${host}:${port}`);
  });
  return server;
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isCli) {
  startServer();
}
