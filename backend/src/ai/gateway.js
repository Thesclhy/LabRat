import {
  requestAnthropicJson,
  requestAnthropicJsonWithTools,
} from "./anthropic.js";
import {
  requestDeepSeekJson,
  requestDeepSeekJsonWithTools,
} from "./deepseek.js";
import { validateJsonSchema } from "./schemaValidation.js";

const SUPPORTED_PROVIDERS = new Set(["anthropic", "deepseek"]);
const REPAIRABLE_WARNING_CODES = new Set(["ai_empty_response", "ai_output_truncated"]);

function parseJsonObject(value) {
  const raw = String(value || "").trim();
  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const parsed = JSON.parse(unfenced);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function unavailableWarning(code = "ai_unavailable", message = "Backend model provider is not configured.", detail = "") {
  return {
    code,
    message,
    severity: "warning",
    ...(detail ? { detail } : {}),
  };
}

function providerSettings(config) {
  const provider = String(config.aiProvider || "").trim().toLowerCase();
  if (provider === "deepseek") {
    return {
      provider,
      apiKey: config.deepseekApiKey || "",
      model: config.deepseekModel || "deepseek-v4-pro",
      baseUrl: config.deepseekBaseUrl || "https://api.deepseek.com",
    };
  }
  if (provider === "anthropic") {
    return {
      provider,
      apiKey: config.anthropicApiKey || "",
      model: config.anthropicModel || "claude-sonnet-4-5",
    };
  }
  return { provider, apiKey: "", model: "" };
}

function addUsage(target, usage) {
  target.inputTokens += Number(usage?.inputTokens) || 0;
  target.outputTokens += Number(usage?.outputTokens) || 0;
}

function repairPrompt(prompt, previousText, errors) {
  return [
    prompt,
    "MODEL_OUTPUT_REPAIR:",
    JSON.stringify({
      instruction: "Return a corrected JSON object only. Keep the same evidence, tool permissions, and scientific meaning.",
      validationErrors: errors.slice(0, 8),
      previousOutput: String(previousText || "").slice(0, 8000),
    }),
  ].join("\n\n");
}

export function createAiGateway({ config = {}, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const settings = providerSettings(config);
  const selectedAdapter = settings.provider === "anthropic"
    ? { requestJson: requestAnthropicJson, requestJsonWithTools: requestAnthropicJsonWithTools }
    : settings.provider === "deepseek"
      ? { requestJson: requestDeepSeekJson, requestJsonWithTools: requestDeepSeekJsonWithTools }
      : null;

  const publicConfig = () => ({
    provider: settings.provider,
    model: settings.model,
    configured: SUPPORTED_PROVIDERS.has(settings.provider) && Boolean(settings.apiKey),
  });

  const invoke = async ({ withTools, ...request }) => {
    if (!selectedAdapter) return {
      ok: false,
      warning: unavailableWarning(
        "ai_provider_unsupported",
        `Unsupported backend model provider ${settings.provider}.`,
      ),
    };
    const requestFn = withTools
      ? selectedAdapter.requestJsonWithTools
      : selectedAdapter.requestJson;
    return requestFn({ ...request, config: settings, fetchImpl });
  };

  const requestStructuredInternal = async ({
    withTools = false,
    system,
    payload,
    maxTokens = 1200,
    outputSchema = null,
    tools = [],
    toolHandlers = {},
    maxToolRounds = 12,
    thinking = { enabled: false },
    signal,
  }) => {
    if (!SUPPORTED_PROVIDERS.has(settings.provider)) {
      return {
        ok: false,
        warning: unavailableWarning(
          "ai_provider_unsupported",
          `Unsupported backend model provider ${settings.provider}.`,
        ),
      };
    }
    if (!settings.apiKey) return { ok: false, warning: unavailableWarning() };

    const startedAt = now();
    const usage = { inputTokens: 0, outputTokens: 0 };
    let totalToolRounds = 0;
    let prompt = JSON.stringify(payload);
    let repairAttempts = 0;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await invoke({
        withTools,
        system,
        prompt,
        maxTokens,
        outputSchema,
        tools,
        toolHandlers,
        maxToolRounds,
        thinking,
        signal,
      });
      addUsage(usage, response.usage);
      totalToolRounds += Number(response.toolRounds) || 0;

      if (!response.ok) {
        if (attempt === 0 && REPAIRABLE_WARNING_CODES.has(response.warning?.code)) {
          repairAttempts = 1;
          prompt = repairPrompt(prompt, "", [response.warning.message]);
          continue;
        }
        return response;
      }

      const parsed = parseJsonObject(response.text);
      const validation = parsed
        ? validateJsonSchema(outputSchema, parsed)
        : { valid: false, errors: ["/ response was not a JSON object"] };
      if (validation.valid) {
        return {
          ok: true,
          ...parsed,
          metadata: {
            provider: settings.provider,
            model: settings.model,
            latencyMs: Math.max(0, now() - startedAt),
            usage,
            ...(withTools ? { toolRounds: totalToolRounds } : {}),
            ...(response.stopReason ? { stopReason: response.stopReason } : {}),
            ...(repairAttempts ? { repairAttempts } : {}),
          },
        };
      }

      if (attempt === 0) {
        repairAttempts = 1;
        prompt = repairPrompt(prompt, response.text, validation.errors);
        continue;
      }
      return {
        ok: false,
        warning: unavailableWarning(
          "ai_invalid_response",
          "Backend model returned invalid structured JSON.",
          validation.errors.join("; ").slice(0, 1000),
        ),
      };
    }

    return {
      ok: false,
      warning: unavailableWarning("ai_invalid_response", "Backend model returned invalid structured JSON."),
    };
  };

  return {
    publicConfig,
    requestStructured(request) {
      return requestStructuredInternal({ ...request, withTools: false });
    },
    requestStructuredWithTools(request) {
      return requestStructuredInternal({ ...request, withTools: true });
    },
  };
}
