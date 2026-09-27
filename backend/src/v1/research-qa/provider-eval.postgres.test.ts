import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createV1Application } from "../bootstrap.js";
import { seedAnalysisScenario } from "../testing/analysis-review-fixture.js";
import { applyTestMigrations, withTestSchema } from "../testing/postgres-test-database.js";
import { seedResearchCorpus, researchProjectId as projectId } from "./testing/research-qa-scenario.js";
import { ResearchQuestionsService } from "./research-questions.service.js";
import { ResearchEvidenceService } from "./research-evidence.service.js";
import { V1_MODEL_PROVIDER } from "../platform/model/model-provider.js";
import { RESEARCH_QA_CASES } from "../../research/testing/researchQaCorpus.js";
import { RESEARCH_QA_SUPPLEMENTAL_CASES } from "../../research/testing/researchQaSupplemental.js";
import { RESEARCH_QA_HOLDOUT_CASES } from "../../research/testing/researchQaHoldout.js";
import { researchQuestionRequest } from "../../research/citedAnswer.js";
import { QA_LIMITS } from "../../research/evidenceTools.js";

const enabled = process.env.LABRAT_RUN_RESEARCH_QA_EVAL === "1" && Boolean(process.env.LABRAT_TEST_DATABASE_URL);
describe.skipIf(!enabled)("real configured provider: synthetic cited Q&A corpus", () => {
  test("records each answer and supporting evidence for independent semantic review", async () => {
    await withTestSchema(process.env.LABRAT_TEST_DATABASE_URL!, async ({ databaseUrl }) => {
      await applyTestMigrations(databaseUrl); await seedAnalysisScenario(databaseUrl);
      const storage = await fs.mkdtemp(path.join(os.tmpdir(), "labrat-qa-provider-"));
      let app: NestFastifyApplication | undefined;
      const records: any[] = [];
      const selectedIds = process.env.LABRAT_QA_EVAL_IDS?.split(",").filter(Boolean);
      const supplemental = process.env.LABRAT_QA_EVAL_SUITE === "supplemental";
      const holdout = process.env.LABRAT_QA_EVAL_SUITE === "holdout";
      const cases = holdout ? RESEARCH_QA_HOLDOUT_CASES : supplemental ? RESEARCH_QA_SUPPLEMENTAL_CASES : RESEARCH_QA_CASES;
      const evaluation = holdout ? "holdout" : supplemental ? "supplemental" : selectedIds ? "development" : "acceptance";
      const reportFile = path.resolve("..", "doc", "qa", `research-qa-provider-${evaluation}.json`);
      const runsDirectory = path.resolve("..", "doc", "qa", "research-qa-provider-runs");
      await fs.mkdir(runsDirectory, { recursive: true });
      const runFile = path.join(runsDirectory, `${new Date().toISOString().replace(/[:.]/g, "-")}-${evaluation}.json`);
      const sourceFiles = ["src/research/citedAnswer.js", "src/research/evidenceTools.js", "src/research/qaBudget.js",
        "src/research/testing/researchQaCorpus.js", "src/research/testing/researchQaLabels.js", "src/research/testing/researchQaSupplemental.js", "src/research/testing/researchQaHoldout.js",
        "src/v1/research-qa/provider-eval.postgres.test.ts", "src/ai/gateway.js", "src/ai/deepseek.js",
        "src/v1/research-qa/research-evidence.service.ts", "src/v1/research-qa/research-evidence.repository.ts", "src/v1/research-qa/research-questions.service.ts"];
      const files = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [file, createHash("sha256").update(await fs.readFile(file)).digest("hex")])));
      const requestSettings = researchQuestionRequest({}, {});
      const repairSettings = researchQuestionRequest({ citationRepair: {} }, {});
      const execution = { startedAt: new Date().toISOString(), files, limits: QA_LIMITS, thinking: requestSettings.thinking,
        repairThinking: repairSettings.thinking, maxOutputTokens: requestSettings.maxTokens };
      const saveReport = async (report: unknown) => {
        const json = JSON.stringify({ ...(report as object), execution }, null, 2) + "\n";
        await fs.writeFile(runFile, json);
        await fs.writeFile(reportFile, json);
      };
      try {
        vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DATABASE_URL", databaseUrl); vi.stubEnv("LABRAT_FILE_STORAGE_ROOT", storage);
        app = await createV1Application({ logger: false });
        const config = app.get(V1_MODEL_PROVIDER).publicConfig();
        expect(config.configured, "Real provider credentials are required; substitution is forbidden.").toBe(true);
        const fixture = await seedResearchCorpus(app, databaseUrl);
        const questions = app.get(ResearchQuestionsService);
        const evidenceService = app.get(ResearchEvidenceService);
        const createSession = evidenceService.createSession.bind(evidenceService);
        let toolExecutions: any[] = [];
        let modelOutputs: any[] = [];
        const modelProvider = app.get(V1_MODEL_PROVIDER);
        const answerQuestion = modelProvider.answerResearchQuestion.bind(modelProvider);
        vi.spyOn(modelProvider, "answerResearchQuestion").mockImplementation(async (input: any, options: any) => {
          const output: any = { repairErrors: input.citationRepair?.errors || [], startedAt: new Date().toISOString() };
          modelOutputs.push(output);
          try { const result = await answerQuestion(input, options); output.result = result; return result; }
          finally { output.completedAt = new Date().toISOString(); }
        });
        vi.spyOn(evidenceService, "createSession").mockImplementation((...args) => {
          const session = createSession(...args), executions = toolExecutions;
          return { ...session, handlers: Object.fromEntries(Object.entries(session.handlers).map(([name, handler]) => [name, async (input: any) => {
            const execution: any = { tool: name, input, startedAt: new Date().toISOString() };
            executions.push(execution);
            try { const result = await handler(input); execution.result = result; return result; }
            catch (error: any) { execution.error = { code: error.code, message: error.message }; throw error; }
            finally { execution.completedAt = new Date().toISOString(); }
          }])) };
        });
        for (const item of cases.filter((question) => !selectedIds || selectedIds.includes(question.id))) {
          toolExecutions = [];
          modelOutputs = [];
          const started = Date.now();
          let response = await questions.create(fixture.auth, projectId, { requestKey: `eval-${item.id}-${Date.now()}`, question: item.question });
          while (["queued", "running"].includes(response.request.status) && Date.now() - started < 155_000) {
            await new Promise((resolve) => setTimeout(resolve, 300));
            response = await questions.get(fixture.auth, projectId, response.request.runId) as typeof response;
          }
          const evidence = [];
          for (const reference of response.artifact?.evidence || []) evidence.push((await questions.source(fixture.auth, projectId, response.request.runId, reference.id)).evidence);
          records.push({ ...item, request: response.request, artifact: response.artifact, evidence, toolExecutions, modelOutputs, elapsedMs: Date.now() - started,
            semanticReview: "pending_independent_review" });
          await saveReport({ schemaVersion: "labrat.researchQaEvaluation.v1", material: "synthetic only", provider: config,
            evaluation, completed: false, records });
          console.log(`Research Q&A ${item.id}: ${response.request.status} / ${response.artifact?.answer.status || response.request.failureCode} (${Date.now() - started} ms)`);
          if (["qa_provider_balance", "qa_provider_credentials", "ai_unavailable"].includes(response.request.failureCode || "")) {
            throw new Error(`Real-provider evaluation stopped: ${response.request.failureCode}. Restore the configured service before retrying.`);
          }
        }
        await saveReport({ schemaVersion: "labrat.researchQaEvaluation.v1", material: "synthetic only", provider: config,
          evaluation, completed: true, records });
        expect(records.every((item) => item.request.status === "completed"), records.map((item) => `${item.id}:${item.request.failureCode}`).join(", ")).toBe(true);
      } finally { await app?.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); await fs.rm(storage, { recursive: true, force: true }); }
    });
  }, RESEARCH_QA_CASES.length * 155_000 + 120_000);
});
