import http from "node:http";
import { fileURLToPath } from "node:url";
import { sendJson } from "./http/json.js";
import { handleChartRoutes } from "./charts/routes/chartRoutes.js";
import { handleImportRoutes } from "./import/routes/importRoutes.js";
import { loadSaasConfig } from "./saas/config.js";
import { createSaasStore } from "./saas/store.js";
import { handleSaasRoutes } from "./saas/routes/saasRoutes.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;

export function createServer(options = {}) {
  const config = options.config || loadSaasConfig();
  const storePromise = options.store ? Promise.resolve(options.store) : createSaasStore(config);
  return http.createServer(async (req, res) => {
    try {
      const store = await storePromise;
      const saasContext = { config, store };
      if (req.method === "GET" && req.url === "/health") {
        sendJson(res, 200, { ok: true, service: "labrat-backend" });
        return;
      }

      if (await handleSaasRoutes(req, res, saasContext)) return;
      if (await handleImportRoutes(req, res)) return;
      if (await handleChartRoutes(req, res)) return;

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
