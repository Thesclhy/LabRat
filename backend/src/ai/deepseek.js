import { validateJsonSchema } from "./schemaValidation.js";
import { sanitizeProviderDetail } from "./providerDiagnostics.js";

const DEFAULT_BASE_URL = "https://api.deepseek.com";

function responseErrorDetail(response, apiKey) {
  return response.json()
    .then((body) => sanitizeProviderDetail(body?.error?.message || body?.message || "", [apiKey]))
    .catch(() => "");
}

function transportErrorDetail(error, apiKey) {
  const code = String(error?.cause?.code || error?.code || "").trim().slice(0, 80);
  const name = String(error?.name || "Error").trim().slice(0, 80);
  const message = String(error?.message || "").trim().replace(/\s+/g, " ").slice(0, 500);
  return sanitizeProviderDetail([name, code, message].filter(Boolean).join(": "), [apiKey]);
}

function warning(code, message, detail = "") {
  return {
    code,
    message,
    severity: "warning",
    ...(detail ? { detail } : {}),
  };
}

function endpointFor(baseUrl) {
  return `${String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "")}/chat/completions`;
}

function outputSystem(system, outputSchema) {
  if (!outputSchema) return system;
  return [
    system,
    "Return one JSON object only. It must match this JSON Schema exactly:",
    JSON.stringify(outputSchema),
  ].filter(Boolean).join("\n\n");
}

function requestBody({ config, system, prompt, maxTokens, outputSchema, tools, messages, thinking }) {
  const thinkingEnabled = thinking?.enabled === true;
  return {
    model: config.model,
    max_tokens: maxTokens,
    messages: messages || [
      { role: "system", content: outputSystem(system, outputSchema) },
      { role: "user", content: prompt },
    ],
    response_format: outputSchema ? { type: "json_object" } : undefined,
    thinking: { type: thinkingEnabled ? "enabled" : "disabled" },
    reasoning_effort: thinkingEnabled ? (thinking.effort || "high") : undefined,
    tools: tools?.length ? tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema || { type: "object", properties: {} },
      },
    })) : undefined,
  };
}

function usageFrom(body) {
  const usage = {
    inputTokens: Number(body?.usage?.prompt_tokens) || 0,
    outputTokens: Number(body?.usage?.completion_tokens) || 0,
  };
  if (body?.usage?.completion_tokens_details?.reasoning_tokens != null) {
    usage.reasoningTokens = Number(body.usage.completion_tokens_details.reasoning_tokens) || 0;
  }
  return usage;
}

function addUsage(target, source) {
  target.inputTokens += Number(source?.inputTokens) || 0;
  target.outputTokens += Number(source?.outputTokens) || 0;
  if (Object.hasOwn(source || {}, "reasoningTokens")) {
    target.reasoningTokens = (Number(target.reasoningTokens) || 0)
      + (Number(source?.reasoningTokens) || 0);
  }
}

async function sendRequest({ config, fetchImpl, body, signal }) {
  const response = await fetchImpl(endpointFor(config.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const detail = await responseErrorDetail(response, config.apiKey);
    return {
      ok: false,
      warning: warning(
        "ai_request_failed",
        `Model provider request failed with HTTP ${response.status}.`,
        detail,
      ),
    };
  }
  const responseBody = await response.json();
  const choice = Array.isArray(responseBody?.choices) ? responseBody.choices[0] : null;
  if (!choice?.message) {
    return {
      ok: false,
      warning: warning("ai_invalid_response", "Model provider returned an invalid response envelope."),
    };
  }
  return {
    ok: true,
    body: responseBody,
    choice,
    usage: usageFrom(responseBody),
  };
}

export async function requestDeepSeekJson({
  system,
  prompt,
  maxTokens = 1200,
  outputSchema = null,
  thinking = { enabled: false },
  config,
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  if (typeof fetchImpl !== "function") {
    return { ok: false, warning: warning("ai_fetch_unavailable", "Server fetch is unavailable.") };
  }
  try {
    const response = await sendRequest({
      config,
      fetchImpl,
      body: requestBody({ config, system, prompt, maxTokens, outputSchema, thinking }),
      signal,
    });
    if (!response.ok) return response;
    const { choice } = response;
    if (choice.finish_reason === "length") {
      return {
        ok: false,
        warning: warning("ai_output_truncated", "Model provider output reached the token limit."),
        usage: response.usage,
        stopReason: choice.finish_reason,
      };
    }
    const text = String(choice.message.content || "").trim();
    if (!text) {
      return {
        ok: false,
        warning: warning("ai_empty_response", "Model provider returned no proposal text."),
        usage: response.usage,
        stopReason: choice.finish_reason || null,
      };
    }
    return {
      ok: true,
      text,
      usage: response.usage,
      stopReason: choice.finish_reason || null,
    };
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return {
      ok: false,
      warning: warning("ai_request_failed", "Model provider request failed.", transportErrorDetail(error, config?.apiKey)),
    };
  }
}

export async function requestDeepSeekJsonWithTools({
  system,
  prompt,
  tools = [],
  toolHandlers = {},
  maxTokens = 2400,
  maxToolRounds = 12,
  outputSchema = null,
  thinking = { enabled: true, effort: "high" },
  config,
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  if (typeof fetchImpl !== "function") {
    return { ok: false, warning: warning("ai_fetch_unavailable", "Server fetch is unavailable.") };
  }
  const messages = [
    { role: "system", content: outputSystem(system, outputSchema) },
    { role: "user", content: prompt },
  ];
  const usage = { inputTokens: 0, outputTokens: 0 };
  const toolDefinitions = new Map(tools.map((tool) => [tool.name, tool]));
  try {
    for (let round = 0; round <= maxToolRounds; round += 1) {
      const response = await sendRequest({
        config,
        fetchImpl,
        body: requestBody({ config, maxTokens, outputSchema, tools, messages, thinking }),
        signal,
      });
      if (!response.ok) return { ...response, usage, toolRounds: round };
      addUsage(usage, response.usage);
      const { choice } = response;
      if (choice.finish_reason === "length") {
        return {
          ok: false,
          warning: warning("ai_output_truncated", "Model provider output reached the token limit."),
          usage,
          stopReason: choice.finish_reason,
          toolRounds: round,
        };
      }
      const message = choice.message;
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (!toolCalls.length) {
        const text = String(message.content || "").trim();
        if (!text) {
          return {
            ok: false,
            warning: warning("ai_empty_response", "Model provider returned no proposal text."),
            usage,
            stopReason: choice.finish_reason || null,
            toolRounds: round,
          };
        }
        return {
          ok: true,
          text,
          usage,
          stopReason: choice.finish_reason || null,
          toolRounds: round,
        };
      }
      if (round >= maxToolRounds) {
        return {
          ok: false,
          warning: warning("ai_tool_round_limit", "Model provider exceeded the allowed inspection rounds."),
          usage,
          stopReason: choice.finish_reason || null,
          toolRounds: round,
        };
      }

      const assistantMessage = {
        role: "assistant",
        content: message.content ?? null,
        tool_calls: toolCalls,
      };
      if (typeof message.reasoning_content === "string") {
        assistantMessage.reasoning_content = message.reasoning_content;
      }
      messages.push(assistantMessage);

      for (const toolCall of toolCalls) {
        const toolCallId = String(toolCall?.id || "").trim();
        const toolName = String(toolCall?.function?.name || "").trim();
        if (!toolCallId || !toolName) {
          return {
            ok: false,
            warning: warning("ai_invalid_tool_call", "Model provider returned an invalid tool call."),
          };
        }
        let result;
        try {
          const definition = toolDefinitions.get(toolName);
          const handler = toolHandlers[toolName];
          if (!definition || typeof handler !== "function") {
            throw Object.assign(new Error(`Tool ${toolName} is unavailable.`), { code: "ai_tool_unavailable" });
          }
          let input;
          try {
            input = JSON.parse(String(toolCall.function.arguments || "{}"));
          } catch {
            throw Object.assign(new Error(`Tool ${toolName} returned invalid JSON arguments.`), {
              code: "ai_tool_input_invalid",
            });
          }
          const validation = validateJsonSchema(definition.input_schema, input);
          if (!validation.valid) {
            throw Object.assign(new Error(`Tool ${toolName} arguments did not match the required schema.`), {
              code: "ai_tool_input_invalid",
              details: { errors: validation.errors },
            });
          }
          result = await handler(input);
        } catch (error) {
          result = {
            error: {
              code: error?.code || "ai_tool_failed",
              message: error?.message || "Read-only inspection failed.",
              details: error?.details || null,
            },
          };
        }
        messages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: JSON.stringify(result ?? null),
        });
      }
    }
    return {
      ok: false,
      warning: warning("ai_tool_round_limit", "Model provider exceeded the allowed inspection rounds."),
      usage,
      toolRounds: maxToolRounds,
    };
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return {
      ok: false,
      warning: warning("ai_request_failed", "Model provider request failed.", transportErrorDetail(error, config?.apiKey)),
    };
  }
}
