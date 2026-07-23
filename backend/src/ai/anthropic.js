export function anthropicConfig(env = process.env) {
  return {
    apiKey: env.ANTHROPIC_API_KEY || "",
    model: env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
  };
}

export function aiUnavailableWarning() {
  return {
    code: "ai_unavailable",
    message: "Server-side Anthropic configuration is not available; deterministic proposals were returned.",
    severity: "warning",
  };
}

export async function requestAnthropicJson({
  system,
  prompt,
  maxTokens = 1200,
  outputSchema = null,
  env = process.env,
  config: explicitConfig = null,
  fetchImpl = globalThis.fetch,
  signal = undefined,
} = {}) {
  const config = explicitConfig || anthropicConfig(env);
  if (!config.apiKey) {
    return { ok: false, warning: aiUnavailableWarning() };
  }
  if (typeof fetchImpl !== "function") {
    return {
      ok: false,
      warning: {
        code: "ai_fetch_unavailable",
        message: "Server fetch is unavailable; deterministic proposals were returned.",
        severity: "warning",
      },
    };
  }

  try {
    const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: prompt }],
        output_config: outputSchema ? {
          format: {
            type: "json_schema",
            schema: outputSchema,
          },
        } : undefined,
      }),
      signal,
    });
    if (!response.ok) {
      return {
        ok: false,
        warning: {
          code: "ai_request_failed",
          message: `Anthropic request failed with HTTP ${response.status}; deterministic proposals were returned.`,
          severity: "warning",
        },
      };
    }
    const body = await response.json();
    if (body.stop_reason === "max_tokens") {
      return {
        ok: false,
        warning: {
          code: "ai_output_truncated",
          message: "Anthropic output reached the token limit; retry with a smaller region or a shorter interpretation.",
          severity: "warning",
        },
      };
    }
    const text = (body.content || []).map((item) => item?.text || "").join("\n").trim();
    if (!text) {
      return {
        ok: false,
        warning: {
          code: "ai_empty_response",
          message: "Anthropic returned no proposal text; deterministic proposals were returned.",
          severity: "warning",
        },
      };
    }
    return {
      ok: true,
      text,
      usage: {
        inputTokens: Number(body.usage?.input_tokens) || 0,
        outputTokens: Number(body.usage?.output_tokens) || 0,
      },
      stopReason: body.stop_reason || null,
    };
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return {
      ok: false,
      warning: {
        code: "ai_request_failed",
        message: "Anthropic request failed; deterministic proposals were returned.",
        severity: "warning",
      },
    };
  }
}

export async function requestAnthropicJsonWithTools({
  system,
  prompt,
  tools = [],
  toolHandlers = {},
  maxTokens = 2400,
  maxToolRounds = 12,
  outputSchema = null,
  env = process.env,
  config: explicitConfig = null,
  fetchImpl = globalThis.fetch,
  signal = undefined,
} = {}) {
  const config = explicitConfig || anthropicConfig(env);
  if (!config.apiKey) return { ok: false, warning: aiUnavailableWarning() };
  if (typeof fetchImpl !== "function") {
    return {
      ok: false,
      warning: {
        code: "ai_fetch_unavailable",
        message: "Server fetch is unavailable; deterministic proposals were returned.",
        severity: "warning",
      },
    };
  }
  const messages = [{ role: "user", content: prompt }];
  const usage = { inputTokens: 0, outputTokens: 0 };
  try {
    for (let round = 0; round <= maxToolRounds; round += 1) {
      const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: maxTokens,
          system,
          messages,
          tools: tools.length ? tools : undefined,
          output_config: outputSchema ? {
            format: { type: "json_schema", schema: outputSchema },
          } : undefined,
        }),
        signal,
      });
      if (!response.ok) {
        return {
          ok: false,
          warning: {
            code: "ai_request_failed",
            message: `Anthropic request failed with HTTP ${response.status}; deterministic proposals were returned.`,
            severity: "warning",
          },
        };
      }
      const body = await response.json();
      usage.inputTokens += Number(body.usage?.input_tokens) || 0;
      usage.outputTokens += Number(body.usage?.output_tokens) || 0;
      if (body.stop_reason === "max_tokens") {
        return {
          ok: false,
          warning: {
            code: "ai_output_truncated",
            message: "Anthropic output reached the token limit.",
            severity: "warning",
          },
        };
      }
      const content = Array.isArray(body.content) ? body.content : [];
      const toolUses = content.filter((item) => item?.type === "tool_use");
      if (!toolUses.length) {
        const text = content.map((item) => item?.text || "").join("\n").trim();
        if (!text) {
          return {
            ok: false,
            warning: {
              code: "ai_empty_response",
              message: "Anthropic returned no proposal text.",
              severity: "warning",
            },
          };
        }
        return {
          ok: true,
          text,
          usage,
          stopReason: body.stop_reason || null,
          toolRounds: round,
        };
      }
      if (round >= maxToolRounds) {
        return {
          ok: false,
          warning: {
            code: "ai_tool_round_limit",
            message: "Anthropic exceeded the allowed number of read-only inspection rounds.",
            severity: "warning",
          },
        };
      }
      messages.push({ role: "assistant", content });
      const toolResults = [];
      for (const toolUse of toolUses) {
        const handler = toolHandlers[toolUse.name];
        let result;
        let isError = false;
        try {
          if (typeof handler !== "function") {
            throw new Error(`Tool ${toolUse.name} is unavailable.`);
          }
          result = await handler(toolUse.input || {});
        } catch (error) {
          isError = true;
          result = {
            error: {
              code: error?.code || "ai_tool_failed",
              message: error?.message || "Read-only inspection failed.",
              details: error?.details || null,
            },
          };
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
          ...(isError ? { is_error: true } : {}),
        });
      }
      messages.push({ role: "user", content: toolResults });
    }
    return {
      ok: false,
      warning: {
        code: "ai_tool_round_limit",
        message: "Anthropic exceeded the allowed number of read-only inspection rounds.",
        severity: "warning",
      },
    };
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return {
      ok: false,
      warning: {
        code: "ai_request_failed",
        message: "Anthropic request failed; deterministic proposals were returned.",
        severity: "warning",
      },
    };
  }
}
