const countError = () => Object.assign(new Error("The configured provider's input size could not be checked."), { code: "qa_token_count_unavailable" });

// Calibrated against DeepSeek's published V4 tokenizer. Reserve punctuation,
// scientific identifiers and non-ASCII symbols separately, not bytes / 4.
export function estimateDeepSeekInput(request) {
  const text = JSON.stringify(request);
  let units = 0;
  for (const part of text.match(/[A-Za-z]+|[0-9]+|\s+|[^\x00-\x7F]|./gu) || []) {
    if (/^[A-Za-z]+$/.test(part)) units += Math.max(1, part.length * .3);
    else if (/^[0-9]+$/.test(part)) units += Math.ceil(part.length / 3);
    else if (/^\s+$/.test(part)) units += part.length * .15;
    else if (/\p{Script=Han}/u.test(part)) units += 1;
    else units += Buffer.byteLength(part) * .8;
  }
  return Math.ceil(units * 1.2) + 512;
}

export async function countQaInput({ provider, request, url, init, fetchImpl, signal }) {
  if (provider !== "anthropic") {
    // Direct budget users in deterministic tests have no configured transport.
    if (provider && (provider !== "deepseek" || !/^deepseek-(?:v4(?:-|$)|chat$|reasoner$)/.test(request.model || ""))) throw countError();
    return { method: "deepseek-v4-calibrated-characters-v1", estimatedInputTokens: estimateDeepSeekInput(request) };
  }
  if (String(url) !== "https://api.anthropic.com/v1/messages") throw countError();
  const fields = ["model", "system", "messages", "tools", "tool_choice", "thinking", "output_config", "cache_control"];
  const body = Object.fromEntries(fields.filter((key) => request[key] !== undefined).map((key) => [key, request[key]]));
  try {
    const signals = [signal, init?.signal, AbortSignal.timeout(8000)].filter(Boolean);
    const response = await fetchImpl("https://api.anthropic.com/v1/messages/count_tokens", {
      method: "POST", headers: init.headers, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.any(signals) });
    if (!response.ok) throw countError();
    const reader = response.body?.getReader();
    if (!reader) throw countError();
    const chunks = []; let bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 65536) { await reader.cancel(); throw countError(); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    const count = JSON.parse(Buffer.concat(chunks).toString("utf8")).input_tokens;
    if (!Number.isSafeInteger(count) || count < 0) throw countError();
    return { method: "anthropic-count-tokens", estimatedInputTokens: count };
  } catch { throw countError(); }
}

export function reportedQaUsage(body, provider) {
  const usage = body?.usage;
  const anthropic = provider === "anthropic" || !provider && usage?.input_tokens !== undefined;
  const input = anthropic ? usage?.input_tokens : usage?.prompt_tokens;
  const output = anthropic ? usage?.output_tokens : usage?.completion_tokens;
  const creation = anthropic ? usage?.cache_creation_input_tokens ?? 0 : 0;
  const read = anthropic ? usage?.cache_read_input_tokens ?? 0 : 0;
  if (![input, output, creation, read].every((value) => Number.isSafeInteger(value) && value >= 0)) return null;
  // DeepSeek prompt_tokens already includes cache hits and misses; Anthropic's
  // input_tokens excludes both cache fields. Reasoning is within output_tokens.
  return { input: input + creation + read, output };
}
