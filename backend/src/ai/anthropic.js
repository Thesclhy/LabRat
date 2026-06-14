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

export async function requestAnthropicJson({ system, prompt, maxTokens = 1200, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = anthropicConfig(env);
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
      }),
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
    return { ok: true, text };
  } catch {
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
