import { Injectable } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { evidenceHash } from "../../research/evidenceTools.js";
import { makeId } from "../../saas/ids.js";
import { authorizeProjectTransaction } from "../authorization/authorized-store.js";
import type { AuthContext } from "../identity/identity.types.js";
import { DatabaseService, type V1Transaction } from "../platform/database/database.service.js";
import { assistantTasks as tasks, projects, contextDocuments, contextDocumentVersions, sourceDocuments,
  workbookReviewSessions, workbookReviewRegions } from "../platform/database/schema.js";
import { ApiError } from "../platform/http/api-error.js";
import { ResearchQuestionsRepository } from "./research-questions.repository.js";
import type { AttachTaskFileDto, CreateAssistantTaskDto } from "./assistant-tasks.dto.js";

type Task = typeof tasks.$inferSelect;
const now = () => new Date().toISOString();
const scope = (auth: AuthContext, project: string, id?: string) => and(eq(tasks.projectId, project), eq(tasks.actorUserId, auth.user.id), id ? eq(tasks.id, id) : undefined);
const missing = () => new ApiError(404, "assistant_task_not_found", "Task not found.");

@Injectable()
export class AssistantTasksRepository {
  constructor(private readonly database: DatabaseService, private readonly questions: ResearchQuestionsRepository) {}

  private async authorize(tx: V1Transaction, auth: AuthContext, projectId: string, write = false) {
    const [project] = await tx.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.status, "active"))).limit(1);
    if (!project) throw missing();
    await this.questions.authorize(tx, auth, project);
    if (write) await authorizeProjectTransaction({ db: tx } as unknown as DatabaseService, auth, project, "propose");
    return project;
  }

  private async locked(tx: V1Transaction, auth: AuthContext, projectId: string, id: string) {
    const [task] = await tx.select().from(tasks).where(scope(auth, projectId, id)).for("update");
    if (!task) throw missing();
    return task;
  }

  private async reference(tx: V1Transaction, projectId: string, ref: Record<string, any>) {
    const [row] = await tx.select({ document: contextDocuments, version: contextDocumentVersions }).from(contextDocuments)
      .innerJoin(contextDocumentVersions, and(eq(contextDocumentVersions.documentId, contextDocuments.id), eq(contextDocumentVersions.projectId, projectId)))
      .where(and(eq(contextDocuments.projectId, projectId), eq(contextDocuments.id, ref.documentId),
        eq(contextDocuments.status, "active"), eq(contextDocumentVersions.id, ref.versionId))).limit(1);
    return row;
  }

  private async readiness(tx: V1Transaction, task: Task) {
    const files = [];
    for (const file of task.attachments) {
      let state = "needs_upload";
      if (file.kind === "workbook" && file.workbookReviewSessionId) {
        const [session] = await tx.select().from(workbookReviewSessions).where(and(eq(workbookReviewSessions.projectId, task.projectId),
          eq(workbookReviewSessions.id, file.workbookReviewSessionId), eq(workbookReviewSessions.sourceDocumentId, file.sourceDocumentId))).limit(1);
        const [source] = await tx.select().from(sourceDocuments).where(and(eq(sourceDocuments.projectId, task.projectId), eq(sourceDocuments.id, file.sourceDocumentId))).limit(1);
        const [region] = await tx.select({ id: workbookReviewRegions.id }).from(workbookReviewRegions).where(and(
          eq(workbookReviewRegions.projectId, task.projectId), eq(workbookReviewRegions.workbookReviewSessionId, file.workbookReviewSessionId),
          eq(workbookReviewRegions.sourceDocumentId, file.sourceDocumentId), eq(workbookReviewRegions.disposition, "active"),
          eq(workbookReviewRegions.reviewStatus, "accepted"), sql`${workbookReviewRegions.acceptedRevisionId} = ${workbookReviewRegions.currentRevisionId}`)).limit(1);
        state = !session || session.status === "deleted" || !source || source.status !== "indexed" ? "unavailable" : region ? "ready" : "needs_review";
      } else if (file.kind === "reference" && file.versionId) {
        const ref = await this.reference(tx, task.projectId, file);
        state = !ref ? "unavailable" : ["ready", "partial"].includes(ref.version.status) ? "ready"
          : ["pending", "processing"].includes(ref.version.status) ? "processing" : "unavailable";
      }
      files.push({ ...file, state });
    }
    let referencesReady = true;
    for (const ref of task.context.referenceDocuments || []) {
      const row = await this.reference(tx, task.projectId, ref);
      if (!row || !["ready", "partial"].includes(row.version.status)) referencesReady = false;
    }
    return { attachments: files, ready: referencesReady && files.every((file) => file.state === "ready"), referencesReady };
  }

  private async summary(tx: V1Transaction, task: Task) {
    const { requestHash: _hash, ...visible } = task;
    return { ...visible, createdAt: new Date(task.createdAt).toISOString(), updatedAt: new Date(task.updatedAt).toISOString(), ...await this.readiness(tx, task) };
  }

  async create(auth: AuthContext, projectId: string, input: CreateAssistantTaskDto) {
    const question = input.question.trim();
    if (!question) throw new ApiError(400, "qa_question_empty", "Enter a question.");
    if (!input.attachments.some((file) => file.kind === "workbook")) throw new ApiError(400, "task_workbook_required", "This task requires an Excel workbook.");
    if ((input.referenceDocuments?.length || 0) + input.attachments.filter((file) => file.kind === "reference").length > 8)
      throw new ApiError(400, "task_reference_limit", "Use up to eight references.");
    const context = { referenceDocuments: (input.referenceDocuments || []).map(({ documentId, versionId }) => ({ documentId, versionId })),
      conversation: (input.conversation || []).map(({ role, text }) => ({ role, text })),
      selectedExperimentLabel: input.selectedExperimentLabel || "", sourceScope: input.sourceScope || "project" };
    const manifest = input.attachments.map(({ name, kind }) => ({ name, kind }));
    const requestHash = evidenceHash({ question, context, attachments: manifest });
    return this.database.db.transaction(async (tx) => {
      const project = await this.authorize(tx, auth, projectId, true);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${JSON.stringify(["assistant-task", projectId, auth.user.id])}))`);
      const [existing] = await tx.select().from(tasks).where(and(scope(auth, projectId), eq(tasks.requestKey, input.requestKey))).limit(1);
      if (existing) {
        if (existing.requestHash !== requestHash) throw new ApiError(409, "assistant_task_conflict", "This task key belongs to a different question.");
        return this.summary(tx, existing);
      }
      for (const ref of context.referenceDocuments) if (!await this.reference(tx, projectId, ref)) throw new ApiError(400, "qa_reference_unavailable", "A selected reference is unavailable.");
      const [counts] = await tx.select({ count: sql<number>`count(*)::int` }).from(tasks).where(and(scope(auth, projectId), eq(tasks.status, "waiting")));
      if ((counts?.count || 0) >= 100) throw new ApiError(429, "assistant_task_limit", "Finish or dismiss a pending task before creating another.");
      const [task] = await tx.insert(tasks).values({ id: makeId("ask_task"), labId: project.labId, projectId, actorUserId: auth.user.id,
        requestKey: input.requestKey, requestHash, question, context, attachments: manifest, createdAt: now(), updatedAt: now() }).returning();
      return this.summary(tx, task!);
    });
  }

  async list(auth: AuthContext, projectId: string, cursor: string | undefined, limit: number) {
    return this.database.db.transaction(async (tx) => {
      await this.authorize(tx, auth, projectId);
      const [date, id] = cursor?.split("|") || [];
      const rows = await tx.select().from(tasks).where(and(scope(auth, projectId), eq(tasks.status, "waiting"),
        date && id ? sql`(${tasks.createdAt},${tasks.id}) < (${date}::timestamptz,${id})` : undefined))
        .orderBy(desc(tasks.createdAt), desc(tasks.id)).limit(limit + 1);
      const items = [];
      for (const row of rows.slice(0, limit)) items.push(await this.summary(tx, row));
      const last = items.at(-1);
      return { items, nextCursor: rows.length > limit && last ? `${last.createdAt}|${last.id}` : null };
    });
  }

  async get(auth: AuthContext, projectId: string, id: string) {
    return this.database.db.transaction(async (tx) => {
      await this.authorize(tx, auth, projectId);
      const [task] = await tx.select().from(tasks).where(scope(auth, projectId, id)).limit(1);
      if (!task) throw missing();
      return this.summary(tx, task);
    });
  }

  async attach(auth: AuthContext, projectId: string, id: string, input: AttachTaskFileDto) {
    return this.database.db.transaction(async (tx) => {
      await this.authorize(tx, auth, projectId, true);
      const task = await this.locked(tx, auth, projectId, id), current = task.attachments[input.index];
      if (!current) throw new ApiError(400, "task_attachment_index", "Choose a task file.");
      if (task.status !== "waiting") throw new ApiError(409, "assistant_task_closed", "This task has already been continued or dismissed.");
      let resolved;
      if (current.kind === "workbook" && input.workbookReviewSessionId && !input.documentId && !input.versionId) {
        const [session] = await tx.select().from(workbookReviewSessions).where(and(eq(workbookReviewSessions.projectId, projectId), eq(workbookReviewSessions.id, input.workbookReviewSessionId))).limit(1);
        const [source] = session ? await tx.select().from(sourceDocuments).where(and(eq(sourceDocuments.projectId, projectId), eq(sourceDocuments.id, session.sourceDocumentId))).limit(1) : [];
        if (!session || session.status === "deleted" || !source || source.status !== "indexed") throw new ApiError(400, "task_source_unavailable", "Choose an available workbook in this project.");
        resolved = { name: current.name, kind: current.kind, workbookReviewSessionId: session.id, sourceDocumentId: source.id,
          workbookName: String(source.metadata.workbookName || current.name) };
      } else if (current.kind === "reference" && input.documentId && input.versionId && !input.workbookReviewSessionId) {
        const row = await this.reference(tx, projectId, input);
        if (!row) throw new ApiError(400, "qa_reference_unavailable", "Choose an available reference in this project.");
        resolved = { name: current.name, kind: current.kind, documentId: row.document.id, versionId: row.version.id,
          label: row.document.originalName, versionNumber: row.version.versionNumber };
      } else throw new ApiError(400, "task_attachment_type", "The attachment must match the task file type.");
      if (current.sourceDocumentId || current.versionId) {
        if (["sourceDocumentId", "workbookReviewSessionId", "documentId", "versionId"].some((key) => current[key] !== (resolved as Record<string, any>)[key]))
          throw new ApiError(409, "task_attachment_conflict", "This file was already attached. Refresh the task.");
        return this.summary(tx, task);
      }
      const attachments = task.attachments.map((file, index) => index === input.index ? resolved : file);
      const [updated] = await tx.update(tasks).set({ attachments, updatedAt: now() }).where(eq(tasks.id, id)).returning();
      return this.summary(tx, updated!);
    });
  }

  async cancel(auth: AuthContext, projectId: string, id: string) {
    return this.database.db.transaction(async (tx) => {
      await this.authorize(tx, auth, projectId);
      const task = await this.locked(tx, auth, projectId, id);
      if (task.status === "submitted") throw new ApiError(409, "assistant_task_submitted", "The question has already started. Open it to manage the request.");
      const [updated] = await tx.update(tasks).set({ status: "cancelled", updatedAt: now() }).where(eq(tasks.id, id)).returning();
      return this.summary(tx, updated!);
    });
  }

  async continue(auth: AuthContext, projectId: string, id: string) {
    return this.database.db.transaction(async (tx) => {
      const project = await this.authorize(tx, auth, projectId);
      const task = await this.locked(tx, auth, projectId, id);
      if (task.status === "cancelled") throw new ApiError(409, "assistant_task_closed", "This task was dismissed.");
      if (task.runId) return task.runId;
      if (!(await this.readiness(tx, task)).ready) throw new ApiError(409, "assistant_task_not_ready", "Complete the uploads and confirm a current region in each workbook before continuing.");
      const references = [...task.context.referenceDocuments, ...task.attachments.filter((file) => file.kind === "reference")];
      const resolved: Array<{ documentId: string; versionId: string; label: string; versionNumber: number }> = [];
      for (const ref of references) {
        const row = (await this.reference(tx, projectId, ref))!;
        if (!resolved.some((item) => item.versionId === row.version.id)) resolved.push({ documentId: row.document.id, versionId: row.version.id, label: row.document.originalName, versionNumber: row.version.versionNumber });
      }
      const sourceScope = task.context.sourceScope === "selected" || resolved.length && /(?:仅|只)(?:根据|使用|参考|用)|\bonly\s+(?:use|using|from|based on)\b/i.test(task.question) ? "selected" : "project";
      if (sourceScope === "selected" && !resolved.length) throw new ApiError(400, "qa_sources_required", "Select at least one reference for a sources-only question.");
      const workbooks = task.attachments.filter((file) => file.kind === "workbook");
      const question = task.question + `\nUse the confirmed regions of: ${workbooks.map((file) => `${file.workbookName} [sourceDocumentId: ${file.sourceDocumentId}]`).join(", ")}.`;
      const { request } = await this.questions.createInTransaction(tx, auth, project, `task-${task.id}`, question,
        { ...task.context, referenceDocuments: resolved, sourceScope });
      await tx.update(tasks).set({ status: "submitted", runId: request.runId, updatedAt: now() }).where(eq(tasks.id, id));
      return request.runId;
    });
  }
}
