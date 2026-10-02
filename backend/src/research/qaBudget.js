import { QA_LIMITS } from "./evidenceTools.js";
import { countQaInput, reportedQaUsage } from "./qaTokenCount.js";

export function createQaBudget({ signal, now = Date.now, limits = QA_LIMITS, previous = {}, checkpoint = async () => {} } = {}) {
  const started = now();
  const usage = { requests: 0, toolRounds: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0,
    unknownUsageRequests: 0, reservedTokens: 0, elapsedMs: 0, knownCost: null, countRequests: 0, ...previous,
    measurements: [...(previous.measurements || [])].slice(0, limits.requests) };
  const elapsedBefore = Math.max(0, Number(previous.elapsedMs) || 0);
  let failure = null;
  const stats = () => ({ ...usage, measurements: usage.measurements.map((item) => ({ ...item })),
    elapsedMs: elapsedBefore + now() - started, lastActiveAt: now(), failure });
  const fail = (code) => { failure = code; throw Object.assign(new Error("Q&A reached a resource limit."), { code }); };
  const check = () => {
    if (failure) fail(failure);
    if (signal?.aborted) fail("qa_cancelled");
    if (elapsedBefore + now() - started >= limits.deadlineMs) fail("qa_timeout");
  };
  return {
    check,
    stats,
    wrapFetch(fetchImpl, { provider } = {}) {
      return async (...args) => {
        check();
        if (usage.requests >= limits.requests) fail("qa_request_limit");
        const requestText = String(args[1]?.body || "");
        const request = JSON.parse(requestText || "{}");
        const outputReservation = Number(request.max_tokens || 0);
        if (!Number.isSafeInteger(outputReservation) || outputReservation < 0) fail("qa_token_count_unavailable");
        if (usage.inputTokens + usage.outputTokens + usage.reservedTokens + outputReservation > limits.tokens) fail("qa_token_limit");
        if (provider === "anthropic") {
          if (usage.countRequests >= limits.requests * 2) fail("qa_request_limit");
          usage.countRequests += 1; await checkpoint(stats());
        }
        let counted;
        const countStarted = now();
        try { counted = await countQaInput({ provider, request, url: args[0], init: args[1], fetchImpl, signal }); }
        catch { check(); fail("qa_token_count_unavailable"); }
        check();
        if (usage.requests >= limits.requests) fail("qa_request_limit");
        // The count endpoint itself is an estimate; keep a framing/safety margin.
        const inputReservation = counted.method === "anthropic-count-tokens"
          ? Math.ceil(counted.estimatedInputTokens * 1.05) + 256 : counted.estimatedInputTokens;
        const reservation = inputReservation + outputReservation;
        if (usage.inputTokens + usage.outputTokens + usage.reservedTokens + reservation > limits.tokens) fail("qa_token_limit");
        const measurement = { method: counted.method, provider: provider || "unconfigured", model: request.model || null,
          estimatedInputTokens: counted.estimatedInputTokens, inputReservation, outputReservation,
          requestBytes: Buffer.byteLength(requestText), countMs: now() - countStarted,
          actualInputTokens: null, actualOutputTokens: null };
        usage.measurements.push(measurement);
        usage.requests += 1; usage.reservedTokens += reservation; usage.unknownUsageRequests += 1;
        await checkpoint(stats());
        const response = await fetchImpl(...args);
        let body;
        try { body = await response.clone().json(); } catch { body = null; }
        const actual = reportedQaUsage(body, provider);
        if (actual) {
          usage.reservedTokens -= reservation; usage.inputTokens += actual.input; usage.outputTokens += actual.output;
          measurement.actualInputTokens = actual.input; measurement.actualOutputTokens = actual.output;
          usage.unknownUsageRequests -= 1;
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
