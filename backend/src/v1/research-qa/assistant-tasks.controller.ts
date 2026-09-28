import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { CurrentAuth } from "../identity/current-auth.js";
import type { AuthContext } from "../identity/identity.types.js";
import { ApiError } from "../platform/http/api-error.js";
import { EmptyDocumentDto } from "./documents.dto.js";
import { AssistantTaskPageDto, AttachTaskFileDto, CreateAssistantTaskDto } from "./assistant-tasks.dto.js";
import { AssistantTasksRepository } from "./assistant-tasks.repository.js";
import { ResearchQuestionsService } from "./research-questions.service.js";

@Controller("api/v1/projects/:projectId/assistant-tasks")
export class AssistantTasksController {
  constructor(private readonly tasks: AssistantTasksRepository, private readonly questions: ResearchQuestionsService) {}
  @Post() @HttpCode(201)
  create(@CurrentAuth() auth: AuthContext, @Param("projectId") project: string, @Body() body: CreateAssistantTaskDto) { return this.tasks.create(auth, project, body); }
  @Get()
  list(@CurrentAuth() auth: AuthContext, @Param("projectId") project: string, @Query() query: AssistantTaskPageDto) {
    if (query.cursor && (!/^\d{4}-\d\d-\d\dT[0-9:.]+Z\|[A-Za-z0-9_-]+$/.test(query.cursor) || !Number.isFinite(Date.parse(query.cursor.split("|")[0]!)))) throw new ApiError(400, "task_cursor_invalid", "Refresh the task list.");
    return this.tasks.list(auth, project, query.cursor, query.limit || 20);
  }
  @Get(":taskId")
  get(@CurrentAuth() auth: AuthContext, @Param("projectId") project: string, @Param("taskId") id: string) { return this.tasks.get(auth, project, id); }
  @Post(":taskId/attachments") @HttpCode(200)
  attach(@CurrentAuth() auth: AuthContext, @Param("projectId") project: string, @Param("taskId") id: string, @Body() body: AttachTaskFileDto) { return this.tasks.attach(auth, project, id, body); }
  @Post(":taskId/cancel") @HttpCode(200)
  cancel(@CurrentAuth() auth: AuthContext, @Param("projectId") project: string, @Param("taskId") id: string, @Body() _body: EmptyDocumentDto) { return this.tasks.cancel(auth, project, id); }
  @Post(":taskId/continue") @HttpCode(202)
  async continue(@CurrentAuth() auth: AuthContext, @Param("projectId") project: string, @Param("taskId") id: string, @Body() _body: EmptyDocumentDto) {
    const runId = await this.tasks.continue(auth, project, id);
    // Creation and task linkage committed together. A lost response reuses the run;
    // a process exit before starting leaves a visible queued request for retry.
    const saved = await this.questions.get(auth, project, runId);
    if (saved.request.status === "queued") {
      try { return await this.questions.retry(auth, project, runId); }
      catch (error: any) { if (error.statusCode !== 429) throw error; }
    }
    return saved;
  }
}
