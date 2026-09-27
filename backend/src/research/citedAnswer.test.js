import test from "node:test";
import assert from "node:assert/strict";
import { validateCitedAnswer, researchBoundary, researchQuestionRequest } from "./citedAnswer.js";
import { createQaBudget } from "./qaBudget.js";
import { documentCoverage, projectContextWindow, QA_LIMITS } from "./evidenceTools.js";
import { createAiGateway } from "../ai/gateway.js";

const doc = { id: "doc", kind: "document_passage", data: { text: "Use 80 C for dry samples only.", uncertain: false } };
const snapshot = { id: "snapshot", kind: "experiment_snapshot", data: { fields: [
  { displayName: "Temperature", value: 82, unit: "C" },
  { displayName: "Yield", value: 0.42, unit: "%", numericScale: "fraction" },
] } };
const answer = (claim) => ({ status: "answered", claims: [{ numericBindings: [], ...claim }], missingEvidence: [] });
const binding = { evidenceId: "snapshot", path: "/data/fields/0/value", value: 82, unit: "C", numericScale: null };

test("citations require this run's exact evidence and exact excerpts; no numeric invention or unit changes", () => {
  const base = { text: "Dry samples use 80 C.", citations: [{ evidenceId: "doc", quote: "80 C for dry samples only" }] };
  assert.equal(validateCitedAnswer(answer(base), [doc]).valid, true);
  for (const patch of [
    { text: "Dry samples use 90 C." }, { text: "温度为999。" }, { text: "Dry samples use 80 F." },
    { citations: [{ evidenceId: "never-read", quote: "80 C" }] }, { citations: [{ evidenceId: "doc", quote: "all wet samples" }] },
  ]) assert.equal(validateCitedAnswer(answer({ ...base, ...patch }), [doc]).valid, false, JSON.stringify(patch));
  assert.equal(validateCitedAnswer(answer(base), [{ ...doc, data: { ...doc.data, uncertain: true } }]).valid, false);
});

test("structured values bind exact paths, units and percentage scale without recalculation", () => {
  const base = { text: "Exp17 has accepted Temperature 82 C.", citations: [{ evidenceId: "snapshot", quote: "Temperature" }], numericBindings: [binding] };
  assert.equal(validateCitedAnswer(answer(base), [snapshot]).valid, true);
  for (const patch of [{ value: 83 }, { unit: "F" }, { path: "/data/fields/1/value" }, { numericScale: "fraction" }]) {
    assert.equal(validateCitedAnswer(answer({ ...base, numericBindings: [{ ...binding, ...patch }] }), [snapshot]).valid, false);
  }
  assert.equal(validateCitedAnswer(answer({ ...base, text: "The new mean is 81 C." }), [snapshot]).valid, false);
  const fraction = { text: "Stored Yield: 0.42 (numericScale fraction; unit %).", citations: [{ evidenceId: "snapshot", quote: "Yield" }],
    numericBindings: [{ evidenceId: "snapshot", path: "/data/fields/1/value", value: 0.42, unit: "%", numericScale: "fraction" }] };
  assert.equal(validateCitedAnswer(answer(fraction), [snapshot]).valid, true);
  assert.equal(validateCitedAnswer(answer({ ...fraction, text: "Yield is 42%." }), [snapshot]).valid, false);
  assert.equal(validateCitedAnswer(answer({ ...fraction, text: "Yield is 0.42%." }), [snapshot]).valid, false);
});

test("verified source locators and identifiers are distinct from scientific numbers", () => {
  const source = { ...doc, label: "protocol-17.pdf", locator: { page: 1, line: 2 }, version: { versionId: "document_version_17" } };
  const claim = { text: "protocol-17.pdf 第 1 页第 2 行记录 80 C。", citations: [{ evidenceId: "doc", quote: "Use 80 C for dry samples only." }] };
  assert.equal(validateCitedAnswer(answer(claim), [source]).valid, true);
  assert.equal(validateCitedAnswer(answer({ ...claim, text: "document_version_17 page 1 line 2 records 80 C." }), [source]).valid, true);
  assert.equal(validateCitedAnswer(answer({ ...claim, text: "protocol-17.pdf 第 80 页记录 80 C。" }), [source]).valid, false);
  assert.equal(validateCitedAnswer(answer({ ...claim, text: "protocol-17.pdf 第 1 页记录 1 C。" }), [source]).valid, false);
  assert.equal(validateCitedAnswer(answer({ ...claim, text: "document_version_17 records 17 C." }), [source]).valid, false);
  const numbered = { ...source, version: { versionNumber: 1 } };
  assert.equal(validateCitedAnswer(answer({ ...claim, text: "应用版本号 1 的记录为 80 C。" }), [numbered]).valid, true);
  assert.equal(validateCitedAnswer(answer({ ...claim, text: "应用版本号 2 的记录为 80 C。" }), [numbered]).valid, false);
  assert.equal(validateCitedAnswer(answer({ ...claim, text: "应用版本号 1 的记录为 1 C。" }), [numbered]).valid, false);
  const revision = { ...numbered, data: { text: "revision 2: Use 80 C for dry samples only." } };
  assert.equal(validateCitedAnswer(answer({ ...claim, text: "应用版本号 1 的文字为 revision 2，记录 80 C。" }), [revision]).valid, true);
  assert.equal(validateCitedAnswer(answer({ ...claim, text: "revision 3 records 80 C." }), [revision]).valid, false);
  assert.equal(validateCitedAnswer(answer({ ...claim, text: "revision 2 records 2 C." }), [revision]).valid, false);
  const raw = { id: "raw", kind: "workbook_raw", data: { cells: [{ rawValue: 80 }] } };
  const result = validateCitedAnswer(answer({ text: "Cell B2 stores 80.", citations: [{ evidenceId: "raw", quote: "80" }],
    numericBindings: [{ evidenceId: "raw", path: "/data/cells/0/value", value: 80, unit: null, numericScale: null }] }), [raw]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("/data/cells/0/rawValue")));
});

test("literal formulas, stored counts and timestamps do not authorize derived measurements", () => {
  const raw = { id: "raw", kind: "workbook_raw", data: { cells: [{ address: "G2", formula: "B2*2", rawValue: null, cacheMissing: true }] } };
  const formula = { text: 'G2 stores formula "B2*2" with a missing cache.', citations: [{ evidenceId: "raw", quote: "B2*2" }, { evidenceId: "raw", quote: '"cacheMissing":true' }] };
  assert.equal(validateCitedAnswer(answer(formula), [raw]).valid, true);
  assert.equal(validateCitedAnswer(answer({ ...formula, citations: [{ evidenceId: "raw", quote: '"formula":"B2*2"' }] }), [raw]).valid, true);
  assert.equal(validateCitedAnswer(answer({ ...formula, text: 'G2 stores formula "B2*2", which equals 160.' }), [raw]).valid, false);
  assert.equal(validateCitedAnswer(answer({ ...formula, citations: [{ evidenceId: "raw", quote: '"cacheMissing":false' }] }), [raw]).valid, false);
  const series = { id: "series", kind: "experiment_snapshot", data: { acceptedAt: "2026-08-23T12:00:00.000Z", seriesWindow: { pointCount: 121 } } };
  const count = { text: "The series contains 121 points; acceptedAt 2026-08-23T12:00:00.000Z.", citations: [{ evidenceId: "series", quote: "121" }, { evidenceId: "series", quote: "2026-08-23T12:00:00.000Z" }] };
  assert.equal(validateCitedAnswer(answer(count), [series]).valid, true);
  assert.equal(validateCitedAnswer(answer({ ...count, text: "The series contains 122 points." }), [series]).valid, false);
  assert.equal(validateCitedAnswer(answer({ ...count, text: "The series contains 121 points at 121 C." }), [series]).valid, false);
  assert.equal(validateCitedAnswer(answer({ ...count, text: "Accepted at 2026-08-24T12:00:00.000Z." }), [series]).valid, false);
  const conflict = { id: "conflict", kind: "document_passage", data: { text: "A: 80 C. B: 85 C." } };
  assert.equal(validateCitedAnswer(answer({ text: "A is 80 C, B is 85 C; difference 5 C.", citations: [{ evidenceId: "conflict", quote: conflict.data.text }] }), [conflict]).valid, false);
});

test("field identifiers and cell-header prose are not scientific numbers or false table locations", () => {
  const evidence = { id: "aux", kind: "experiment_snapshot", data: { fields: [{ columnId: "aux_23", displayName: "Auxiliary 23", value: 123, unit: "mg" }] } };
  const claim = { text: "columnId aux_23, displayName 'Auxiliary 23', stores 123 mg.", citations: [{ evidenceId: "aux", quote: "Auxiliary 23" }],
    numericBindings: [{ evidenceId: "aux", path: "/data/fields/0/value", value: 123, unit: "mg", numericScale: null }] };
  assert.equal(validateCitedAnswer(answer(claim), [evidence]).valid, true);
  assert.equal(validateCitedAnswer(answer({ ...claim, text: "columnId aux_234 stores 123 mg." }), [evidence]).valid, false);
  assert.equal(validateCitedAnswer(answer({ ...claim, text: "columnId aux_23 stores 23 mg." }), [evidence]).valid, false);
  const raw = { id: "raw", kind: "workbook_raw", data: { cells: [{ address: "B1", rawValue: "Temperature (C)" }, { address: "B2", rawValue: 80 }] } };
  const cell = { text: "B1 表头为 Temperature (C)，B2 原文为 80。", citations: [{ evidenceId: "raw", quote: "Temperature (C)" }],
    numericBindings: [{ evidenceId: "raw", path: "/data/cells/1/rawValue", value: 80, unit: null, numericScale: null }] };
  assert.equal(validateCitedAnswer(answer(cell), [raw]).valid, true);
  assert.equal(validateCitedAnswer(answer({ ...cell, text: "第 1 表中 B2 原文为 80。" }), [raw]).valid, false);
  const missing = validateCitedAnswer(answer({ ...cell, numericBindings: [] }), [raw]);
  assert.equal(missing.valid, false);
  assert.ok(missing.errors.some((error) => error.includes('/data/cells/1/rawValue') && error.includes('THIS claim')));
});

test("new calculations route to review while explicit do-not-calculate read requests remain Q&A", () => {
  assert.equal(researchBoundary("Calculate the mean and publish it"), "needs_analysis");
  assert.equal(researchBoundary("Convert 82 C to F"), "needs_analysis");
  assert.equal(researchBoundary("诊断实验失败并推荐温度"), "out_of_scope");
  assert.equal(researchBoundary("Read existing values. Do not calculate the difference."), null);
  assert.equal(researchBoundary("Read cached formulas, without calculating new results."), null);
});

test("citation repair reuses authorized evidence in a tool-free provider request", async () => {
  let requests = 0, toolCalls = 0;
  const corrected = answer({ text: "Dry samples use 80 C.", citations: [{ evidenceId: "doc", quote: "Use 80 C for dry samples only." }] });
  const budget = createQaBudget();
  const gateway = createAiGateway({ config: { aiProvider: "deepseek", deepseekApiKey: "synthetic-key", deepseekModel: "synthetic" },
    fetchImpl: async (_url, options) => {
      requests += 1;
      const request = JSON.parse(options.body);
      assert.equal(request.tools, undefined);
      assert.equal(request.thinking.type, "disabled");
      assert.deepEqual(JSON.parse(request.messages[1].content).citationRepair.readEvidence, [doc]);
      return Response.json({ choices: [{ message: { content: JSON.stringify(corrected) }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 60 } });
    } });
  const result = await gateway.requestStructuredWithTools(researchQuestionRequest({ question: "What is the documented temperature?",
    citationRepair: { errors: ["invalid citation"], readEvidence: [doc] } },
    { budget, toolHandlers: { get_project_context: () => { toolCalls += 1; throw new Error("Unexpected reread"); } } }));
  assert.equal(result.ok, true); assert.equal(requests, 1); assert.equal(toolCalls, 0);
  assert.equal(validateCitedAnswer(corrected, [doc]).valid, true);
  assert.equal(budget.stats().requests, 1);
});

test("Q&A format failures return to its service without a hidden second retrieval loop", async () => {
  for (const content of ["not JSON", ""]) {
    let requests = 0;
    const gateway = createAiGateway({ config: { aiProvider: "deepseek", deepseekApiKey: "synthetic-key", deepseekModel: "synthetic" },
      fetchImpl: async () => {
        requests += 1;
        return Response.json({ choices: [{ message: { content }, finish_reason: content ? "stop" : "length" }], usage: { prompt_tokens: 100, completion_tokens: 60 } });
      } });
    const result = await gateway.requestStructuredWithTools(researchQuestionRequest({ question: "Read a stored value." }, {}));
    assert.equal(result.ok, false);
    assert.equal(requests, 1);
    assert.equal(result.metadata.attemptCount, 1);
    assert.equal(result.warning.code, content ? "ai_invalid_response" : "ai_output_truncated");
  }
});

test("identical tool windows are compacted only after rechecking the authorized reader", async () => {
  let reads = 0, authorized = true, value = 80;
  const settings = researchQuestionRequest({}, { toolHandlers: { read_workbook_source: async () => {
    reads += 1;
    if (!authorized) throw new Error("access revoked");
    return { evidence: { id: `raw-${value}`, data: { cells: [{ rawValue: value }] } } };
  } } });
  const first = await settings.toolHandlers.read_workbook_source({});
  const again = await settings.toolHandlers.read_workbook_source({});
  assert.equal(reads, 2); assert.equal(again.alreadyRead, true);
  assert.deepEqual(again.evidenceIds, [first.evidence.id]); assert.equal(again.evidence, undefined);
  value = 82;
  assert.equal((await settings.toolHandlers.read_workbook_source({})).evidence.data.cells[0].rawValue, 82);
  authorized = false;
  await assert.rejects(settings.toolHandlers.read_workbook_source({}), /access revoked/);
  assert.equal(reads, 4);
});

test("one shared budget bounds gateway repairs, tools and unknown-billing recovery", async () => {
  let count = 0; const checkpoints = [];
  const budget = createQaBudget({ limits: { ...QA_LIMITS, requests: 1 }, checkpoint: async (usage) => checkpoints.push(usage) });
  const gateway = createAiGateway({ config: { aiProvider: "anthropic", anthropicApiKey: "synthetic-key", anthropicModel: "synthetic" },
    fetchImpl: async () => { count += 1; return Response.json({ content: [{ type: "text", text: "not JSON" }], usage: { input_tokens: 20, output_tokens: 5 } }); } });
  await gateway.requestStructured({ system: "test", payload: {}, outputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] }, budget });
  assert.equal(count, 1); assert.equal(budget.stats().requests, 1); assert.equal(budget.stats().failure, "qa_request_limit");
  assert.ok(checkpoints[0].reservedTokens > 0); assert.equal(checkpoints[1].reservedTokens, 0);
  const unknown = createQaBudget();
  await unknown.wrapFetch(async () => Response.json({}, { status: 502 }))("https://invalid.example", { body: "{}" });
  assert.equal(unknown.stats().unknownUsageRequests, 1); assert.ok(unknown.stats().reservedTokens > 0);
  const tooling = createQaBudget({ limits: { ...QA_LIMITS, toolCalls: 1 } });
  await assert.rejects(() => tooling.wrapFetch(async () => Response.json({ content: [{ type: "tool_use" }, { type: "tool_use" }] }))("https://invalid.example", { body: "{}" }), { code: "qa_tool_limit" });
  const cancelled = new AbortController(); cancelled.abort();
  assert.throws(() => createQaBudget({ signal: cancelled.signal }).check(), { code: "qa_cancelled" });
  const unavailable = createQaBudget();
  await assert.rejects(unavailable.wrapFetch(async () => { throw new Error("connection lost"); })("https://invalid.example", { body: "{}" }));
  assert.equal(unavailable.stats().unknownUsageRequests, 1);
  assert.ok(unavailable.stats().reservedTokens > 0);
  const invalidCache = createQaBudget();
  await invalidCache.wrapFetch(async () => Response.json({ usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: -100 } }))("https://invalid.example", { body: "{}" });
  assert.equal(invalidCache.stats().unknownUsageRequests, 1);
  assert.ok(invalidCache.stats().reservedTokens > 0);
});

test("retry retains elapsed time and checkpoints include the active interval", async () => {
  let time = 1000;
  const checkpoints = [];
  const budget = createQaBudget({ now: () => time, previous: { elapsedMs: 119_000, requests: 2 },
    checkpoint: async (usage) => checkpoints.push(usage) });
  time += 200;
  await budget.wrapFetch(async () => { time += 300; return Response.json({ usage: { input_tokens: 10, output_tokens: 4 } }); })(
    "https://invalid.example", { body: "{}" });
  assert.equal(checkpoints[0].elapsedMs, 119_200);
  assert.equal(checkpoints[1].elapsedMs, 119_500);
  assert.equal(checkpoints[1].lastActiveAt, 1500);
  assert.equal(budget.stats().requests, 3);
  time += 500;
  assert.throws(() => budget.check(), { code: "qa_timeout" });
});

test("a single document passage includes bounded coverage without hiding unread pages", () => {
  const coverage = Array.from({ length: 200 }, (_, index) => ({ page: index + 1, status: index === 199 ? "failed" : "ready",
    method: "ocr", warnings: index === 50 ? ["ocr_uncertain_text_check_original"] : [], ocr: { confidence: 95, languages: ["eng", "chi_sim"] } }));
  const summary = documentCoverage({ coverage }, { page: 51 });
  assert.deepEqual(summary.statusCounts, { ready: 199, failed: 1 });
  assert.equal(summary.warningParts, 1);
  assert.equal(summary.location.page, 51);
  assert.equal(summary.parts, 200);
  assert.ok(Buffer.byteLength(JSON.stringify(summary)) < 1000);
});

test("long multilingual project context can be continued without silently losing fields", () => {
  const context = { id: "project", name: "项目", description: "", projectProfile: { researchGoal: "催化剂".repeat(4000), methods: "Dry samples only.", tags: ["dry", "catalyst"] } };
  const first = projectContextWindow(context);
  assert.equal(first.coverage.complete, false);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) < QA_LIMITS.toolBytes);
  const next = first.coverage.next.find((item) => item.field === "projectProfile.researchGoal");
  assert.ok(next.cursor > 0);
  const second = projectContextWindow(context, next);
  assert.equal(second.data.projectProfile.researchGoal, context.projectProfile.researchGoal.slice(next.cursor, next.cursor + 4000));
  const methods = projectContextWindow(context, { field: "projectProfile.methods", cursor: 0 });
  assert.equal(methods.data.projectProfile.methods, "Dry samples only.");
  assert.equal(methods.coverage.complete, true);
});
