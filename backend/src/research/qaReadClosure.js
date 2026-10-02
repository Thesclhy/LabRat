const finishInstruction = "The authorized reading stage is now closed to leave room for an answer within the shared resource budget. Return concise JSON in the required schema from the supplied actual read results. No additional tool calls are available. Explain any remaining evidence gaps instead of inventing facts. Search snippets and earlier assistant drafts are not evidence. For a choices question, list only reported candidates and stated caveats, without unrequested operating conditions or numeric performance. Copy names and abbreviations verbatim from the read windows: do not replace Latin letters with Greek letters or infer a prefix's meaning. Figure axis ticks are not measured values; do not infer a data point from extracted axis labels.";

function closeReadingConversation(request, provider) {
  const discovery = new Set(["search_project_documents", "find_experiments"]);
  const calls = new Map((request.messages || []).flatMap((message) => provider === "anthropic"
    ? (Array.isArray(message.content) ? message.content.filter((part) => part.type === "tool_use").map((part) => [part.id, part.name]) : [])
    : (message.tool_calls || []).map((call) => [call.id, call.function?.name])));
  const readResults = [];
  for (const message of request.messages || []) {
    const results = provider === "anthropic"
      ? (Array.isArray(message.content) ? message.content.filter((part) => part.type === "tool_result") : [])
      : message.role === "tool" ? [message] : [];
    for (const result of results) if (!discovery.has(calls.get(result.tool_use_id || result.tool_call_id))) {
      let value;
      try { value = JSON.parse(result.content); } catch { value = result.content; }
      readResults.push({ tool: calls.get(result.tool_use_id || result.tool_call_id) || null, result: value });
    }
  }
  request.messages = (request.messages || []).filter((message) => message.role === "system"
    || message.role === "user" && !(Array.isArray(message.content) && message.content.some((part) => part.type === "tool_result")));
  request.messages.push({ role: "user", content: JSON.stringify({ readingClosed: true, readResults }) });
}

function hasReadEvidence(request, provider) {
  const results = (request.messages || []).flatMap((message) => provider === "anthropic"
    ? (Array.isArray(message.content) ? message.content.filter((part) => part.type === "tool_result") : [])
    : message.role === "tool" ? [message] : []);
  return results.some((result) => {
    try {
      const value = JSON.parse(result.content);
      return Boolean(value?.evidence?.id || value?.contextEvidence?.some((item) => item?.id));
    } catch { return false; }
  });
}

export function closeQaReadingRequest(request, provider) {
  if (!["anthropic", "deepseek"].includes(provider) || !request.tools?.length || !hasReadEvidence(request, provider)) return false;
  if (provider === "anthropic") {
    if (typeof request.system !== "string") return false;
    request.system += `\n\n${finishInstruction}`;
    request.tool_choice = { type: "none" };
  } else {
    const system = request.messages.find((message) => message.role === "system");
    if (typeof system?.content !== "string") return false;
    system.content += `\n\n${finishInstruction}`;
    request.tool_choice = "none";
  }
  closeReadingConversation(request, provider);
  return true;
}
