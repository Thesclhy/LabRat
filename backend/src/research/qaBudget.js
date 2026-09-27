import { QA_LIMITS } from "./evidenceTools.js";

export function createQaBudget({ signal, now = Date.now, limits = QA_LIMITS, previous = {}, checkpoint = async () => {} } = {}) {
  const started = now();
  const usage = { requests: 0, toolRounds: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0,
    unknownUsageRequests: 0, reservedTokens: 0, elapsedMs: 0, knownCost: null, ...previous };
  const elapsedBefore = Math.max(0, Number(previous.elapsedMs) || 0);
  let failure = null;
  const stats = () => ({ ...usage, elapsedMs: elapsedBefore + now() - started, lastActiveAt: now(), failure });
  const fail = (code) => { failure = code; throw Object.assign(new Error("Q&A reached a resource limit."), { code }); };
  const check = () => {
    if (failure) fail(failure);
    if (signal?.aborted) fail("qa_cancelled");
    if (elapsedBefore + now() - started >= limits.deadlineMs) fail("qa_timeout");
  };
  return {
    check,
    stats,
    wrapFetch(fetchImpl) {
      return async (...args) => {
        check();
        if (usage.requests >= limits.requests) fail("qa_request_limit");
        const requestText = String(args[1]?.body || "");
        const request = JSON.parse(requestText || "{}");
        // UTF-8 bytes plus framing is a conservative input-token reservation;
        // release it for actual reported usage only after the response arrives.
        const reservation = Buffer.byteLength(requestText) + 2048 + Number(request.max_tokens || 0);
        if (usage.inputTokens + usage.outputTokens + usage.reservedTokens + reservation > limits.tokens) fail("qa_token_limit");
        usage.requests += 1; usage.reservedTokens += reservation; usage.unknownUsageRequests += 1;
        await checkpoint(stats());
        const response = await fetchImpl(...args);
        let body;
        try { body = await response.clone().json(); } catch { body = null; }
        const input = body?.usage?.input_tokens ?? body?.usage?.prompt_tokens;
        const output = body?.usage?.output_tokens ?? body?.usage?.completion_tokens;
        const cacheCreation = body?.usage?.cache_creation_input_tokens ?? 0;
        const cacheRead = body?.usage?.cache_read_input_tokens ?? 0;
        if ([input, output, cacheCreation, cacheRead].every((value) => Number.isSafeInteger(value) && value >= 0)) {
          usage.reservedTokens -= reservation; usage.inputTokens += input; usage.outputTokens += output;
          usage.inputTokens += cacheCreation + cacheRead; usage.unknownUsageRequests -= 1;
        }
        const calls = Array.isArray(body?.content) ? body.content.filter((item) => item?.type === "tool_use").length
          : body?.choices?.[0]?.message?.tool_calls?.length || 0;
        if (calls) { usage.toolRounds += 1; usage.toolCalls += calls; }
        await checkpoint(stats());
        if (usage.toolRounds > limits.toolRounds || usage.toolCalls > limits.toolCalls) fail("qa_tool_limit");
        if (usage.inputTokens + usage.outputTokens + usage.reservedTokens > limits.tokens) fail("qa_token_limit");
        check();
        return response;
      };
    },
  };
}
