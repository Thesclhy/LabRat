import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { CurrentAuth } from "../identity/current-auth.js";
import type { AuthContext } from "../identity/identity.types.js";
import { DocumentPageDto, EmptyDocumentDto } from "./documents.dto.js";
import { CreateResearchQuestionDto } from "./research-questions.dto.js";
import { ResearchQuestionsService } from "./research-questions.service.js";

@Controller("api/v1/projects/:projectId/research-questions")
export class ResearchQuestionsController {
  constructor(private readonly questions: ResearchQuestionsService) {}
  @Post() @HttpCode(202)
  create(@CurrentAuth() auth: AuthContext, @Param("projectId") project: string, @Body() body: CreateResearchQuestionDto) {
    return this.questions.create(auth, project, body);
  }
  @Get()
  list(@CurrentAuth() auth: AuthContext, @Param("projectId") project: string, @Query() query: DocumentPageDto) {
    return this.questions.list(auth, project, query);
  }
  @Get(":runId")
  get(@CurrentAuth() auth: AuthContext, @Param("projectId") project: string, @Param("runId") id: string) {
    return this.questions.get(auth, project, id);
  }
  @Post(":runId/cancel") @HttpCode(200)
  cancel(@CurrentAuth() auth: AuthContext, @Param("projectId") project: string, @Param("runId") id: string, @Body() _body: EmptyDocumentDto) {
    return this.questions.cancel(auth, project, id);
  }
  @Post(":runId/retry") @HttpCode(202)
  retry(@CurrentAuth() auth: AuthContext, @Param("projectId") project: string, @Param("runId") id: string, @Body() _body: EmptyDocumentDto) {
    return this.questions.retry(auth, project, id);
  }
  @Get(":runId/evidence/:evidenceId")
  source(@CurrentAuth() auth: AuthContext, @Param("projectId") project: string, @Param("runId") id: string,
    @Param("evidenceId") evidence: string, @Res({ passthrough: true }) response: FastifyReply) {
    response.header("Cache-Control", "private, no-store").header("X-Content-Type-Options", "nosniff");
    return this.questions.source(auth, project, id, evidence);
  }
}
