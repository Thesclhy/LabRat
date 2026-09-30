import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { createQaBudget } from "../../research/qaBudget.js";
import { researchBoundary, answerWithReadLinks, validateCitedAnswer } from "../../research/citedAnswer.js";
import { QA_LIMITS } from "../../research/evidenceTools.js";
import type { AuthContext } from "../identity/identity.types.js";
import { ApiError } from "../platform/http/api-error.js";
import { V1_MODEL_PROVIDER, type V1ModelProvider } from "../platform/model/model-provider.js";
import { DocumentsService } from "./documents.service.js";
import { DocumentPageDto } from "./documents.dto.js";
import { ResearchEvidenceService } from "./research-evidence.service.js";
import { ResearchQuestionsRepository, type ResearchRequest } from "./research-questions.repository.js";
import { CreateResearchQuestionDto } from "./research-questions.dto.js";

export function questionSummary(request: ResearchRequest) {
  const { leaseToken: _token, leaseExpiresAt, requestHash: _hash, ...visible } = request;
  return { ...visible, createdAt: new Date(request.createdAt).toISOString(), updatedAt: new Date(request.updatedAt).toISOString(),
    status: request.status === "running" && Date.parse(leaseExpiresAt || "") <= Date.now() ? "interrupted" : request.status };
}

@Injectable()
export class ResearchQuestionsService implements OnModuleDestroy {
  private readonly jobs = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private starting = 0;
  private closing = false;
  private readonly logger = new Logger(ResearchQuestionsService.name);
  constructor(private readonly repository: ResearchQuestionsRepository, private readonly evidence: ResearchEvidenceService,
    private readonly documents: DocumentsService, @Inject(V1_MODEL_PROVIDER) private readonly provider: V1ModelProvider) {}

  async onModuleDestroy() {
    this.closing = true;
    const jobs = [...this.jobs.values()];
    for (const job of jobs) job.controller.abort();
    await Promise.allSettled(jobs.map((job) => job.done));
  }

  async create(auth: AuthContext, projectId: string, input: CreateResearchQuestionDto) {
    await this.evidence.authorize(auth, projectId);
    const { project } = await this.documents.authorize(auth, projectId);
    const question = input.question.trim();
    if (!question) throw new ApiError(400, "qa_question_empty", "Enter a question.");
    const sourceScope = input.sourceScope === "selected" || input.referenceDocuments?.length && /(?:仅|只)(?:根据|使用|参考|用)|\bonly\s+(?:use|using|from|based on)\b|\bbased\s+(?:only|solely)\s+on\b/i.test(question) ? "selected" : "project";
    const existing = await this.repository.byRequestKey(auth, projectId, input.requestKey);
    if (existing) {
      const saved = await this.repository.context(auth, projectId, existing.runId);
      const identities = (refs: any[] = []) => [...new Set(refs.map((ref) => `${ref.documentId}:${ref.versionId}`))].sort();
      if (existing.question !== question || JSON.stringify(identities(saved.referenceDocuments)) !== JSON.stringify(identities(input.referenceDocuments))
        || (saved.sourceScope || "project") !== sourceScope || (saved.selectedExperimentLabel || "") !== (input.selectedExperimentLabel || "")
        || JSON.stringify(saved.conversation || []) !== JSON.stringify(input.conversation || [])) {
        throw new ApiError(409, "qa_request_conflict", "This request key belongs to a different question.");
      }
      return { ...(await this.get(auth, projectId, existing.runId)), reused: true };
    }
    const references = await this.evidence.resolveReferences(auth, projectId, input.referenceDocuments || []);
    if (sourceScope === "selected" && !references.length) throw new ApiError(400, "qa_sources_required", "Select at least one reference for a sources-only question.");
    const context = { referenceDocuments: references, sourceScope,
      conversation: input.conversation || [], selectedExperimentLabel: input.selectedExperimentLabel || "" };
    const result = await this.repository.create(auth, project, input.requestKey, question, context);
    if (!result.reused) await this.start(auth, result.request);
    return { ...(await this.get(auth, projectId, result.request.runId)), reused: result.reused };
  }

  async list(auth: AuthContext, projectId: string, query: DocumentPageDto) {
    await this.evidence.authorize(auth, projectId);
    const limit = query.limit || 20;
    if (query.cursor && !/^\d{4}-\d\d-\d\dT[0-9:.]+Z\|[A-Za-z0-9_-]+$/.test(query.cursor)) throw new ApiError(400, "qa_cursor_invalid", "Refresh the question list.");
    const rows = await this.repository.list(auth, projectId, query.cursor, limit);
    const items = rows.slice(0, limit).map(questionSummary), last = items.at(-1);
    return { items, nextCursor: rows.length > limit && last ? `${last.createdAt}|${last.runId}` : null };
  }

  async get(auth: AuthContext, projectId: string, runId: string) {
    await this.evidence.authorize(auth, projectId);
    const request = await this.repository.get(auth, projectId, runId);
    if (!request) throw new ApiError(404, "qa_not_found", "Question not found.");
    const answer = await this.repository.answer(auth, projectId, runId);
    const artifact = answer ? { ...answer, evidence: answer.evidence.map(({ data: _data, ...reference }) => reference) } : null;
    await this.evidence.authorize(auth, projectId);
    const context = await this.repository.context(auth, projectId, runId);
    return { request: { ...questionSummary(request), referenceDocuments: context.referenceDocuments || [], sourceScope: context.sourceScope || "project" }, artifact };
  }

  async source(auth: AuthContext, projectId: string, runId: string, evidenceId: string) {
    await this.get(auth, projectId, runId);
    const answer = await this.repository.answer(auth, projectId, runId);
    const evidence = answer?.evidence.find((item) => item.id === evidenceId);
    if (!evidence) throw new ApiError(404, "evidence_not_found", "Evidence not found.");
    await this.evidence.authorize(auth, projectId);
    return { evidence, capturedAt: answer!.createdAt };
  }

  async retry(auth: AuthContext, projectId: string, runId: string) {
    await this.get(auth, projectId, runId);
    const request = await this.repository.get(auth, projectId, runId);
    await this.start(auth, request!);
    return this.get(auth, projectId, runId);
  }

  async cancel(auth: AuthContext, projectId: string, runId: string) {
    await this.get(auth, projectId, runId);
    const request = await this.repository.get(auth, projectId, runId);
    await this.repository.cancel(auth, request!);
    this.jobs.get(runId)?.controller.abort();
    return this.get(auth, projectId, runId);
  }

  private async start(auth: AuthContext, request: ResearchRequest) {
    if (this.jobs.has(request.runId) || ["completed", "cancelled"].includes(request.status)) return;
    if (this.closing || this.jobs.size + this.starting >= 4) throw new ApiError(429, "qa_busy", "Q&A is busy. This saved question can be retried shortly.");
    this.starting += 1;
    let claimed;
    try { claimed = await this.repository.claim(auth, request); }
    finally { this.starting -= 1; }
    if (!claimed) return;
    const controller = new AbortController();
    const done = this.process(auth, claimed, controller)
      .catch(() => this.logger.error("Question state could not be saved; its lease will expire for explicit recovery."))
      .finally(() => this.jobs.delete(request.runId));
    this.jobs.set(request.runId, { controller, done });
  }

  private async process(auth: AuthContext, request: ResearchRequest, controller: AbortController) {
    let timedOut = false;
    const remainingMs = Math.max(0, QA_LIMITS.deadlineMs - (Number(request.usage.elapsedMs) || 0));
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, remainingMs);
    let session: ReturnType<ResearchEvidenceService["createSession"]> | undefined;
    const budget = (createQaBudget as any)({ signal: controller.signal, previous: request.usage,
      checkpoint: (usage: Record<string, any>) => this.repository.checkpoint(auth, request, usage) });
    const provider = this.provider.publicConfig();
    let providerFailure: Record<string, any> | null = null;
    const stats = () => ({ ...budget.stats(), provider: provider.provider, model: provider.model,
      attempt: request.attempt, visibleToolCalls: (Number(request.usage.visibleToolCalls) || 0) + (session?.trace.length || 0),
      ...(providerFailure ? { providerFailure } : {}) });
    try {
      const context = await this.repository.context(auth, request.projectId, request.runId);
      session = this.evidence.createSession(auth, request.projectId, controller.signal, context);
      budget.check(); await session.check();
      const boundary = researchBoundary(request.question);
      let answer: Record<string, any>;
      if (boundary) {
        answer = { status: boundary, claims: [], missingEvidence: [], limitations: [], route: "review_boundary" };
      } else {
        let generated: any;
        let errors: string[] = [];
        for (let repair = 0; repair <= 1; repair += 1) {
          generated = await (this.provider.answerResearchQuestion as any)({ question: request.question, selectedContext: context,
            ...(repair ? { citationRepair: { errors, previous: { status: generated.status, claims: generated.claims,
              missingEvidence: generated.missingEvidence }, readEvidence: session.registry.values() } } : {}) },
            { toolHandlers: repair ? {} : session.handlers, signal: controller.signal, budget });
          budget.check(); await session.check();
          if (!generated?.ok) {
            if (!repair && ["ai_empty_response", "ai_output_truncated", "ai_invalid_response"].includes(generated?.warning?.code)) {
              errors = [`${generated.warning.code}: Return a complete concise answer in the required JSON schema using the already-read evidence. Do not restart retrieval.`];
              continue;
            }
            const httpStatus = Number(String(generated?.warning?.message || "").match(/HTTP (\d{3})/)?.[1]) || null;
            providerFailure = { code: generated?.warning?.code || "qa_provider_failed", httpStatus };
            const code = httpStatus === 402 ? "qa_provider_balance" : httpStatus === 429 ? "qa_provider_rate_limit"
              : httpStatus === 401 || httpStatus === 403 ? "qa_provider_credentials" : generated?.warning?.code || "qa_provider_failed";
            throw new ApiError(502, code, "The provider could not complete this question.");
          }
          const candidate = { status: generated.status, claims: generated.claims, missingEvidence: generated.missingEvidence };
          const validation = validateCitedAnswer(candidate, session.registry.values());
          if (validation.valid || repair && validation.shapeValid) {
            answer = answerWithReadLinks(candidate, session.registry.values()); break;
          }
          errors = validation.errors;
          if (repair) throw new ApiError(422, "qa_output_invalid", "The answer format could not be completed.");
        }
        answer = answer!;
        const selected = session.registry.values();
        answer.limitations = [...new Set([...(answer.limitations || []), ...selected.flatMap((item: any) => [
          ...(item.warnings || []).map((warning: any) => typeof warning === "string" ? warning : warning.message || warning.code),
          ...(item.coverage?.status === "partial" ? ["This source is only partially readable; unread portions are not evidence."] : []),
          ...(item.data?.uncertain ? ["OCR text is uncertain. Inspect the original page before relying on it."] : []),
          ...(Object.entries(item.coverage || {}).some(([key, value]) => key.startsWith("next") && (Array.isArray(value) ? value.length > 0 : value != null))
            ? ["Only the listed windows were read; additional records remain available."] : []),
        ]).filter(Boolean)])].slice(0, 24);
      }
      await session.check(); budget.check();
      await this.repository.finish(auth, request, answer, session.registry.values(), session.trace, stats());
    } catch (error: any) {
      const code = this.closing ? "qa_interrupted" : timedOut ? "qa_timeout" : String(error.code || "qa_failed").slice(0, 100);
      if (!this.closing && !timedOut && !controller.signal.aborted && session
        && ["qa_token_limit", "qa_tool_limit", "qa_request_limit", "ai_tool_round_limit"].includes(code)) {
        // Resource exhaustion is an incomplete read, never proof that a fact is absent.
        // Recheck authority/cancellation; do not restart the exhausted model budget.
        try {
          await session.check();
          await this.repository.finish(auth, request, { status: "insufficient_evidence", claims: [],
            provenanceVersion: 2, route: "read_limit", limitations: [],
            missingEvidence: ["The reading limit was reached before an answer could be completed. This does not establish that the requested information is absent. Narrow the question or select a source to continue."] },
          session.registry.values(), session.trace, stats());
        } catch (failure: any) {
          await this.repository.fail(request, String(failure.code || "qa_failed").slice(0, 100), stats());
        }
      } else await this.repository.fail(request, code, stats());
    } finally { clearTimeout(timeout); }
  }
}
