import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "./server.js";
import { loadSaasConfig } from "./saas/config.js";

let server;
let baseUrl;

before(async () => {
  server = createServer({
    config: loadSaasConfig({
      NODE_ENV: "test",
      LABRAT_AI_PROVIDER: "anthropic",
    }),
  });
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      baseUrl = `http://${address.address}:${address.port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test("GET /health returns service status", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "labrat-backend" });
});

test("legacy unscoped import and generic chart endpoints are removed", async () => {
  for (const pathname of [
    "/api/import/scan",
    "/api/import/normalize",
    "/api/import/semantic-map",
    "/api/charts/propose",
    "/api/charts/interpret",
  ]) {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 404, pathname);
  }
});
