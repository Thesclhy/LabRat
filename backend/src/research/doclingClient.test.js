import test from "node:test";
import assert from "node:assert/strict";
import { createDoclingClient } from "./doclingClient.js";

test("Docling only accepts fixed local/internal origins and never follows redirects", async () => {
  for (const endpoint of ["https://external.example", "http://127.0.0.1.example", "http://user:secret@127.0.0.1", "http://127.0.0.1/private", "file:///tmp/document"]) {
    assert.throws(() => createDoclingClient({ endpoint, apiKey: "local-test-key" }), { code: "document_service_config" });
  }
  let called = false;
  const client = createDoclingClient({ endpoint: "http://127.0.0.1:5059", apiKey: "local-test-key",
    fetchImpl: async (url, options) => {
      called = true; assert.equal(options.redirect, "error"); assert.equal(options.headers["X-Api-Key"], "local-test-key");
      assert.equal(String(url), "http://127.0.0.1:5059/v1/status/poll/test-task?wait=2");
      return Response.json({ task_status: "success" });
    } });
  assert.equal(await client.status("test-task"), "success"); assert.equal(called, true);
  await assert.rejects(client.status("../other"), { code: "document_task_invalid" });
});

test("Docling bounds result streaming, distinguishes missing tasks and redacts upstream errors", async () => {
  for (const [response, code] of [[new Response("private server traceback", { status: 404 }), "document_task_missing"],
    [new Response("key=never-return-this", { status: 401 }), "document_service_config"],
    [new Response("{}", { headers: { "content-length": "999999999" } }), "document_index_limit"],
    [new Response("not json"), "document_docling_result_invalid"]]) {
    const client = createDoclingClient({ endpoint: "http://docling:5001", apiKey: "local-key", fetchImpl: async () => response });
    await assert.rejects(client.result("task"), (error) => error.code === code && !/traceback|never-return/.test(error.message));
  }
});
