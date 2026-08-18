import assert from "node:assert/strict";
import test from "node:test";

import { createAiGateway } from "./gateway.js";

const DEEPSEEK_CONFIG = {
  aiProvider: "deepseek",
  deepseekApiKey: "deepseek-secret",
  deepseekModel: "deepseek-v4-pro",
  deepseekBaseUrl: "https://api.deepseek.com",
  anthropicApiKey: "unselected-anthropic-secret",
};

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  };
}

test("DeepSeek structured requests use Chat Completions JSON mode without exposing credentials", async () => {
  const gateway = createAiGateway({
    config: DEEPSEEK_CONFIG,
    fetchImpl: async (url, request) => {
      assert.equal(url, "https://api.deepseek.com/chat/completions");
      assert.equal(request.headers.authorization, "Bearer deepseek-secret");
      assert.equal(JSON.stringify({ url, request }).includes("unselected-anthropic-secret"), false);
      const body = JSON.parse(request.body);
      assert.equal(body.model, "deepseek-v4-pro");
      assert.deepEqual(body.response_format, { type: "json_object" });
      assert.deepEqual(body.thinking, { type: "disabled" });
      assert.equal(body.reasoning_effort, undefined);
      assert.equal(body.messages[0].role, "system");
      assert.match(body.messages[0].content, /JSON Schema/);
      assert.equal(body.messages[1].role, "user");
      return jsonResponse({
        usage: { prompt_tokens: 12, completion_tokens: 4 },
        choices: [{
          finish_reason: "stop",
          message: { role: "assistant", content: JSON.stringify({ answer: "ready" }) },
        }],
      });
    },
    now: (() => {
      let value = 100;
      return () => {
        value += 5;
        return value;
      };
    })(),
  });

  assert.deepEqual(gateway.publicConfig(), {
    provider: "deepseek",
    model: "deepseek-v4-pro",
    configured: true,
  });
  const result = await gateway.requestStructured({
    system: "Return JSON.",
    payload: { question: "status" },
    outputSchema: {
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
      additionalProperties: false,
    },
    thinking: { enabled: false },
  });

  assert.equal(result.ok, true);
  assert.equal(result.answer, "ready");
  assert.deepEqual(result.metadata, {
    provider: "deepseek",
    model: "deepseek-v4-pro",
    latencyMs: 5,
    usage: { inputTokens: 12, outputTokens: 4 },
    stopReason: "stop",
  });
  assert.equal("apiKey" in gateway.publicConfig(), false);
});

test("Anthropic selection never sends the unselected DeepSeek key", async () => {
  const gateway = createAiGateway({
    config: {
      aiProvider: "anthropic",
      anthropicApiKey: "anthropic-secret",
      anthropicModel: "claude-test",
      deepseekApiKey: "unselected-deepseek-secret",
      deepseekModel: "deepseek-v4-pro",
    },
    fetchImpl: async (url, request) => {
      assert.equal(url, "https://api.anthropic.com/v1/messages");
      assert.equal(request.headers["x-api-key"], "anthropic-secret");
      assert.equal("authorization" in request.headers, false);
      assert.equal(JSON.stringify({ url, request }).includes("unselected-deepseek-secret"), false);
      return jsonResponse({
        usage: { input_tokens: 3, output_tokens: 2 },
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify({ answer: "ready" }) }],
      });
    },
  });

  const result = await gateway.requestStructured({
    system: "Return JSON.",
    payload: { question: "status" },
    outputSchema: {
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
      additionalProperties: false,
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(gateway.publicConfig(), {
    provider: "anthropic",
    model: "claude-test",
    configured: true,
  });
  assert.equal("apiKey" in gateway.publicConfig(), false);
});

test("DeepSeek thinking tool loops preserve reasoning only in transient request context", async () => {
  let requestCount = 0;
  const handlerInputs = [];
  const gateway = createAiGateway({
    config: DEEPSEEK_CONFIG,
    fetchImpl: async (_url, request) => {
      requestCount += 1;
      const body = JSON.parse(request.body);
      assert.deepEqual(body.thinking, { type: "enabled" });
      assert.equal(body.reasoning_effort, "high");
      assert.equal(body.tools[0].type, "function");
      assert.equal(body.tools[0].function.name, "inspect_source_range");
      if (requestCount === 1) {
        return jsonResponse({
          usage: { prompt_tokens: 20, completion_tokens: 5 },
          choices: [{
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              reasoning_content: "private transient reasoning",
              tool_calls: [{
                id: "call_1",
                type: "function",
                function: {
                  name: "inspect_source_range",
                  arguments: JSON.stringify({ range: "A1:B2" }),
                },
              }, {
                id: "call_2",
                type: "function",
                function: {
                  name: "inspect_source_range",
                  arguments: JSON.stringify({ range: "C1:D2" }),
                },
              }],
            },
          }],
        });
      }
      assert.equal(body.messages[2].reasoning_content, "private transient reasoning");
      assert.equal(body.messages[3].role, "tool");
      assert.equal(body.messages[3].tool_call_id, "call_1");
      assert.deepEqual(JSON.parse(body.messages[3].content), { range: "A1:B2" });
      assert.equal(body.messages[4].tool_call_id, "call_2");
      assert.deepEqual(JSON.parse(body.messages[4].content), { range: "C1:D2" });
      return jsonResponse({
        usage: { prompt_tokens: 30, completion_tokens: 6 },
        choices: [{
          finish_reason: "stop",
          message: { role: "assistant", content: JSON.stringify({ selected: true }) },
        }],
      });
    },
  });

  const result = await gateway.requestStructuredWithTools({
    system: "Inspect and return JSON.",
    payload: { request: "inspect" },
    outputSchema: {
      type: "object",
      properties: { selected: { type: "boolean" } },
      required: ["selected"],
      additionalProperties: false,
    },
    tools: [{
      name: "inspect_source_range",
      description: "Inspect a range.",
      input_schema: {
        type: "object",
        properties: { range: { type: "string" } },
        required: ["range"],
        additionalProperties: false,
      },
    }],
    toolHandlers: {
      inspect_source_range: async (input) => {
        handlerInputs.push(input);
        return { range: input.range };
      },
    },
    thinking: { enabled: true, effort: "high" },
  });

  assert.deepEqual(handlerInputs, [{ range: "A1:B2" }, { range: "C1:D2" }]);
  assert.equal(result.ok, true);
  assert.equal(result.selected, true);
  assert.equal(result.metadata.toolRounds, 1);
  assert.deepEqual(result.metadata.usage, { inputTokens: 50, outputTokens: 11 });
  assert.equal("reasoning_content" in result, false);
  assert.equal("reasoningContent" in result.metadata, false);
});

test("DeepSeek invalid tool arguments are returned to the model without calling the handler", async () => {
  let requestCount = 0;
  let handlerCalls = 0;
  const gateway = createAiGateway({
    config: DEEPSEEK_CONFIG,
    fetchImpl: async (_url, request) => {
      requestCount += 1;
      const body = JSON.parse(request.body);
      if (requestCount === 1) {
        return jsonResponse({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              reasoning_content: "check arguments",
              tool_calls: [{
                id: "call_bad",
                type: "function",
                function: { name: "inspect", arguments: "{}" },
              }],
            },
          }],
        });
      }
      const toolResult = JSON.parse(body.messages.at(-1).content);
      assert.equal(toolResult.error.code, "ai_tool_input_invalid");
      assert.match(toolResult.error.message, /required schema/);
      return jsonResponse({
        choices: [{
          finish_reason: "stop",
          message: { role: "assistant", content: JSON.stringify({ done: false }) },
        }],
      });
    },
  });

  const result = await gateway.requestStructuredWithTools({
    system: "Return JSON.",
    payload: {},
    outputSchema: {
      type: "object",
      properties: { done: { type: "boolean" } },
      required: ["done"],
      additionalProperties: false,
    },
    tools: [{
      name: "inspect",
      description: "Inspect.",
      input_schema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
    }],
    toolHandlers: {
      inspect: async () => {
        handlerCalls += 1;
        return {};
      },
    },
    thinking: { enabled: true, effort: "high" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.done, false);
  assert.equal(handlerCalls, 0);
});

test("structured output is repaired once after malformed JSON or schema mismatch", async () => {
  for (const firstOutput of ["not-json", JSON.stringify({ answer: 3 })]) {
    let requestCount = 0;
    const gateway = createAiGateway({
      config: DEEPSEEK_CONFIG,
      fetchImpl: async (_url, request) => {
        requestCount += 1;
        const body = JSON.parse(request.body);
        if (requestCount === 1) {
          return jsonResponse({
            usage: { prompt_tokens: 5, completion_tokens: 2 },
            choices: [{
              finish_reason: "stop",
              message: { role: "assistant", content: firstOutput },
            }],
          });
        }
        assert.match(body.messages[1].content, /MODEL_OUTPUT_REPAIR/);
        return jsonResponse({
          usage: { prompt_tokens: 7, completion_tokens: 3 },
          choices: [{
            finish_reason: "stop",
            message: { role: "assistant", content: JSON.stringify({ answer: "fixed" }) },
          }],
        });
      },
    });

    const result = await gateway.requestStructured({
      system: "Return JSON.",
      payload: {},
      outputSchema: {
        type: "object",
        properties: { answer: { type: "string" } },
        required: ["answer"],
        additionalProperties: false,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.answer, "fixed");
    assert.equal(result.metadata.repairAttempts, 1);
    assert.deepEqual(result.metadata.usage, { inputTokens: 12, outputTokens: 5 });
    assert.equal(requestCount, 2);
  }
});

test("empty and truncated DeepSeek responses receive at most one repair request", async () => {
  for (const firstChoice of [
    { finish_reason: "stop", message: { role: "assistant", content: "" } },
    { finish_reason: "length", message: { role: "assistant", content: "{" } },
  ]) {
    let requestCount = 0;
    const gateway = createAiGateway({
      config: DEEPSEEK_CONFIG,
      fetchImpl: async () => {
        requestCount += 1;
        return jsonResponse({ choices: [requestCount === 1 ? firstChoice : firstChoice] });
      },
    });
    const result = await gateway.requestStructured({
      system: "Return JSON.",
      payload: {},
      outputSchema: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
    });

    assert.equal(result.ok, false);
    assert.equal(requestCount, 2);
    assert.equal(["ai_empty_response", "ai_output_truncated"].includes(result.warning.code), true);
  }
});

test("DeepSeek authentication failures are not retried and cancellation propagates", async () => {
  let requestCount = 0;
  const failedGateway = createAiGateway({
    config: DEEPSEEK_CONFIG,
    fetchImpl: async () => {
      requestCount += 1;
      return jsonResponse({ error: { message: "Invalid API key: sk-redacted" } }, { ok: false, status: 401 });
    },
  });
  const failed = await failedGateway.requestStructured({
    system: "Return JSON.",
    payload: {},
    outputSchema: { type: "object" },
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.warning.code, "ai_request_failed");
  assert.equal(failed.warning.detail.includes("sk-redacted"), false);
  assert.match(failed.warning.detail, /\[REDACTED\]/);
  assert.equal(requestCount, 1);

  const controller = new AbortController();
  const cancelledGateway = createAiGateway({
    config: DEEPSEEK_CONFIG,
    fetchImpl: async (_url, request) => {
      assert.equal(request.signal, controller.signal);
      throw new DOMException("cancelled", "AbortError");
    },
  });
  await assert.rejects(
    cancelledGateway.requestStructured({
      system: "Return JSON.",
      payload: {},
      outputSchema: { type: "object" },
      signal: controller.signal,
    }),
    { name: "AbortError" },
  );
});
