import test from "node:test";
import assert from "node:assert/strict";
import { answerWithReadLinks, validateCitedAnswer, researchBoundary, researchQuestionRequest, modelDocumentEvidence } from "./citedAnswer.js";
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

test("answer checks accept identifiers and paraphrases without inspecting numbers or units", () => {
  for (const text of ['RQ-001 uses 80 C for thirty minutes.', '编号 RQ-002：温度八十度。', 'A source says 90 F.']) {
    // Even inaccurate prose is structurally valid. Semantic correctness is tested separately.
    const result = validateCitedAnswer({ status: 'answered', claims: [{ text,
      citations: [{ evidenceId: 'doc' }] }], missingEvidence: [] }, [doc]);
    assert.equal(result.valid, true);
  }
  const uncertain = { ...doc, data: { ...doc.data, uncertain: true } };
  assert.equal(validateCitedAnswer(answer({text:'OCR may say 80 C.',citations:[{evidenceId:'doc',quote:'paraphrase'}]}), [uncertain]).valid,true);
});

test("structured reads no longer require model-generated numerical bindings", () => {
  const result = validateCitedAnswer({status:'answered',claims:[{text:'Stored Temperature: 82 C.',
    citations:[{evidenceId:'snapshot'}]}],missingEvidence:[]}, [snapshot]);
  assert.equal(result.valid,true);
  assert.equal(validateCitedAnswer(answer({text:'The saved scale is fraction.',citations:[]}), []).valid,true);
});

test("only this run's read IDs become links; duplicate links and legacy generated excerpts are removed", () => {
  const candidate=answer({text:'A source statement.',citations:[{evidenceId:'doc',quote:'invented excerpt'},
    {evidenceId:'never-read'}, {evidenceId:'doc'}],numericBindings:[binding]});
  const before=structuredClone(candidate);
  const checked=validateCitedAnswer(candidate,[doc]);
  assert.equal(checked.shapeValid,true); assert.equal(checked.valid,false);
  assert.deepEqual(checked.unknownEvidenceIds,['never-read']);
  const saved=answerWithReadLinks(candidate,[doc]);
  assert.deepEqual(saved.claims,[{text:'A source statement.',citations:[{evidenceId:'doc'}]}]);
  assert.match(saved.limitations[0],/omitted/); assert.equal(saved.provenanceVersion,2);
  assert.deepEqual(candidate,before);
});

test("unknown links may be omitted but malformed output remains invalid", () => {
  const candidate={status:'answered',claims:[{text:'Source summary.',citations:[{evidenceId:'unknown'}]}],missingEvidence:[]};
  assert.deepEqual(answerWithReadLinks(candidate,[]).claims[0].citations,[]);
  for(const bad of [{...candidate,claims:'broken'}, {...candidate,claims:[]},
    {...candidate,claims:[{text:'Missing citations array'}]}, {...candidate,claims:[{text:'',citations:[]}]}]) {
    assert.equal(validateCitedAnswer(bad,[]).shapeValid,false);
    assert.throws(()=>answerWithReadLinks(bad,[]),{code:'qa_output_invalid'});
  }
});

test("new calculations route to review while explicit do-not-calculate read requests remain Q&A", () => {
  assert.equal(researchBoundary("Calculate the mean and publish it"), "needs_analysis");
  assert.equal(researchBoundary("Convert 82 C to F"), "needs_analysis");
  assert.equal(researchBoundary("诊断实验失败并推荐温度"), "out_of_scope");
  assert.equal(researchBoundary("Read existing values. Do not calculate the difference."), null);
  assert.equal(researchBoundary("Read cached formulas, without calculating new results."), null);
  assert.equal(researchBoundary("Read the reported mean temperature"), null);
  assert.equal(researchBoundary("Explain how the paper calculated yield"), null);
  assert.equal(researchBoundary("文献是如何计算产率的？"), null);
  assert.equal(researchBoundary("Read the values and calculate the mean"), "needs_analysis");
  assert.equal(researchBoundary("Read the method then compute the mean"), "needs_analysis");
  assert.equal(researchBoundary("读取数据，然后计算平均值"), "needs_analysis");
});

test("citation repair reuses authorized evidence in a tool-free provider request", async () => {
  let requests = 0, toolCalls = 0;
  const corrected = answer({ text: "Dry samples use 80 C.", citations: [{ evidenceId: "doc", quote: "Use 80 C for dry samples only." }] });
  const budget = createQaBudget();
  const gateway = createAiGateway({ config: { aiProvider: "deepseek", deepseekApiKey: "synthetic-key", deepseekModel: "deepseek-v4-pro" },
    fetchImpl: async (_url, options) => {
      requests += 1;
      const request = JSON.parse(options.body);
      assert.equal(request.tools, undefined);
      assert.equal(request.thinking.type, "disabled");
      assert.deepEqual(JSON.parse(request.messages[1].content).citationRepair.readEvidence, JSON.parse(JSON.stringify([modelDocumentEvidence(doc)])));
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
    fetchImpl: async (url) => { if (url.endsWith('/count_tokens')) return Response.json({ input_tokens: 20 });
      count += 1; return Response.json({ content: [{ type: "text", text: "not JSON" }], usage: { input_tokens: 20, output_tokens: 5 } }); } });
  await gateway.requestStructured({ system: "test", payload: {}, outputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] }, budget });
  assert.equal(count, 1); assert.equal(budget.stats().requests, 1); assert.equal(budget.stats().failure, "qa_request_limit");
  assert.ok(checkpoints.some((item) => item.reservedTokens > 0)); assert.equal(checkpoints.at(-1).reservedTokens, 0);
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

test('selected-only questions expose only their authorized document tools', () => {
  const request=researchQuestionRequest({selectedContext:{sourceScope:'selected'}},{});
  assert.deepEqual(request.tools.map(tool=>tool.name),['search_project_documents','read_document_passage','read_document_page']);
  assert.ok(researchQuestionRequest({selectedContext:{sourceScope:'project'}},{}).tools.some(tool=>tool.name==='find_experiments'));
  assert.deepEqual(researchQuestionRequest({citationRepair:{},selectedContext:{sourceScope:'selected'}},{}).tools,[]);
});

test('document model payload keeps text and continuation while server evidence and repair remain pinned', async () => {
  const saved = { id: 'page-1-window-2', kind: 'document_page', label: 'Original.pdf',
    version: { versionId: 'v1', contentHash: 'hash' }, locator: { page: 1, start: 4000, end: 4035, rectangles: [{ left: .2 }] },
    data: { text: '催化剂 ZnO −12.5 °C 🔬', uncertain: true },
    coverage: { scope: 'page_window', nextCursor: 4035, status: 'needs_review', raw: 'private audit' }, warnings: ['ocr_check_original'] };
  const before = structuredClone(saved);
  const request = researchQuestionRequest({}, { toolHandlers: { read_document_page: async () => ({ evidence: saved }) } });
  const { evidence } = await request.toolHandlers.read_document_page({});
  assert.deepEqual(evidence, modelDocumentEvidence(saved)); assert.equal(evidence.text, saved.data.text);
  assert.equal(evidence.nextCursor, 4035); assert.equal(evidence.id, saved.id);
  for (const forbidden of ['rectangles', 'contentHash', 'private audit', 'scope', 'Original.pdf']) assert.ok(!JSON.stringify(evidence).includes(forbidden));
  assert.deepEqual(saved, before);
  const repair = researchQuestionRequest({ citationRepair: { readEvidence: [saved] } }, {});
  assert.deepEqual(repair.payload.citationRepair.readEvidence, [evidence]);
});
