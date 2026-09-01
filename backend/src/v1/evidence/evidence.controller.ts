import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { CurrentAuth } from "../identity/current-auth.js";
import type { AuthContext } from "../identity/identity.types.js";
import {
  ConfirmWorkbookReviewRegionDto,
  CreateImportRunDto,
  CreateWorkbookReviewRegionDto,
  CreateWorkbookReviewSessionDto,
  DeleteWorkbookReviewRegionDto,
  DeleteWorkbookReviewSessionDto,
  IgnoreWorkbookReviewRegionDto,
  InterpretWorkbookReviewRegionDto,
  ReviseWorkbookReviewRegionDto,
  RetrieveEvidenceDto,
  SourceDocumentQueryDto,
  SourceDocumentRangeDto,
} from "./evidence.dto.js";
import { EvidenceService } from "./evidence.service.js";

@Controller("api/v1/projects/:projectId")
export class ProjectEvidenceController {
  constructor(private readonly evidenceService: EvidenceService) {}

  @Post("evidence/retrieve")
  @HttpCode(200)
  retrieveEvidence(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Body() body: RetrieveEvidenceDto,
  ) {
    return this.evidenceService.retrieveEvidence(auth, projectId, body);
  }

  @Get("files")
  async listFiles(@CurrentAuth() auth: AuthContext, @Param("projectId") projectId: string) {
    return { items: await this.evidenceService.listFiles(auth, projectId), nextCursor: null };
  }

  @Post("files")
  async uploadFile(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Headers("content-type") contentType: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.evidenceService.uploadFile(auth, projectId, contentType, request.body);
    reply.status(result.statusCode);
    const { statusCode: _statusCode, ...body } = result;
    return body;
  }

  @Get("import-runs")
  async listImportRuns(@CurrentAuth() auth: AuthContext, @Param("projectId") projectId: string) {
    return { items: await this.evidenceService.listImportRuns(auth, projectId), nextCursor: null };
  }

  @Post("import-runs")
  async createImportRun(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Body() body: CreateImportRunDto,
  ) {
    return { importRun: await this.evidenceService.createImportRun(auth, projectId, body) };
  }

  @Get("source-documents")
  async listSourceDocuments(@CurrentAuth() auth: AuthContext, @Param("projectId") projectId: string) {
    return { items: await this.evidenceService.listSourceDocuments(auth, projectId), nextCursor: null };
  }

  @Get("workbook-review-sessions")
  async listWorkbookReviewSessions(@CurrentAuth() auth: AuthContext, @Param("projectId") projectId: string) {
    return { items: await this.evidenceService.listWorkbookReviewSessions(auth, projectId), nextCursor: null };
  }

  @Post("workbook-review-sessions")
  createWorkbookReviewSession(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Body() body: CreateWorkbookReviewSessionDto,
  ) {
    return this.evidenceService.createWorkbookReviewSession(auth, projectId, body);
  }

  @Get("region-understandings")
  async listRegionUnderstandings(@CurrentAuth() auth: AuthContext, @Param("projectId") projectId: string) {
    return { items: await this.evidenceService.listRegionUnderstandings(auth, projectId), nextCursor: null };
  }
}

@Controller("api/v1/source-documents/:sourceDocumentId")
export class SourceDocumentEvidenceController {
  constructor(private readonly evidenceService: EvidenceService) {}

  @Get("regions")
  async listRegions(
    @CurrentAuth() auth: AuthContext,
    @Param("sourceDocumentId") sourceDocumentId: string,
  ) {
    const result = await this.evidenceService.listSourceDocumentRegions(auth, sourceDocumentId);
    return { ...result, nextCursor: null };
  }

  @Post("query")
  @HttpCode(200)
  query(
    @CurrentAuth() auth: AuthContext,
    @Param("sourceDocumentId") sourceDocumentId: string,
    @Body() body: SourceDocumentQueryDto,
  ) {
    return this.evidenceService.querySourceDocument(auth, sourceDocumentId, body);
  }

  @Post("range")
  @HttpCode(200)
  range(
    @CurrentAuth() auth: AuthContext,
    @Param("sourceDocumentId") sourceDocumentId: string,
    @Body() body: SourceDocumentRangeDto,
  ) {
    return this.evidenceService.readSourceDocumentRange(auth, sourceDocumentId, body);
  }
}

@Controller("api/v1/workbook-review-sessions/:sessionId")
export class WorkbookReviewEvidenceController {
  constructor(private readonly evidenceService: EvidenceService) {}

  @Get()
  getSession(@CurrentAuth() auth: AuthContext, @Param("sessionId") sessionId: string) {
    return this.evidenceService.getWorkbookReviewSession(auth, sessionId);
  }

  @Delete()
  @HttpCode(200)
  deleteSession(
    @CurrentAuth() auth: AuthContext,
    @Param("sessionId") sessionId: string,
    @Body() body: DeleteWorkbookReviewSessionDto,
  ) {
    return this.evidenceService.deleteWorkbookReviewSession(auth, sessionId, body);
  }

  @Get("regions")
  listRegions(@CurrentAuth() auth: AuthContext, @Param("sessionId") sessionId: string) {
    return this.evidenceService.listWorkbookReviewRegions(auth, sessionId);
  }

  @Post("regions")
  createRegion(
    @CurrentAuth() auth: AuthContext,
    @Param("sessionId") sessionId: string,
    @Body() body: CreateWorkbookReviewRegionDto,
  ) {
    return this.evidenceService.createWorkbookReviewRegion(auth, sessionId, body);
  }

  @Get("regions/:regionId")
  async getRegion(
    @CurrentAuth() auth: AuthContext,
    @Param("sessionId") sessionId: string,
    @Param("regionId") regionId: string,
  ) {
    return { region: await this.evidenceService.getWorkbookReviewRegion(auth, sessionId, regionId) };
  }

  @Delete("regions/:regionId")
  @HttpCode(200)
  async deleteRegion(
    @CurrentAuth() auth: AuthContext,
    @Param("sessionId") sessionId: string,
    @Param("regionId") regionId: string,
    @Body() body: DeleteWorkbookReviewRegionDto,
  ) {
    return { region: await this.evidenceService.deleteWorkbookReviewRegion(auth, sessionId, regionId, body) };
  }

  @Post("regions/:regionId/interpret")
  async interpretRegion(
    @CurrentAuth() auth: AuthContext,
    @Param("sessionId") sessionId: string,
    @Param("regionId") regionId: string,
    @Body() body: InterpretWorkbookReviewRegionDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.evidenceService.interpretWorkbookReviewRegion(auth, sessionId, regionId, body);
    reply.status(result.created ? 201 : 200);
    const { created: _created, ...response } = result;
    return response;
  }

  @Get("regions/:regionId/revisions")
  async listRevisions(
    @CurrentAuth() auth: AuthContext,
    @Param("sessionId") sessionId: string,
    @Param("regionId") regionId: string,
  ) {
    return {
      items: await this.evidenceService.listRegionUnderstandingRevisions(auth, sessionId, regionId),
      nextCursor: null,
    };
  }

  @Post("regions/:regionId/revisions")
  reviseRegion(
    @CurrentAuth() auth: AuthContext,
    @Param("sessionId") sessionId: string,
    @Param("regionId") regionId: string,
    @Body() body: ReviseWorkbookReviewRegionDto,
  ) {
    return this.evidenceService.reviseWorkbookReviewRegion(auth, sessionId, regionId, body);
  }

  @Post("regions/:regionId/confirm")
  @HttpCode(200)
  confirmRegion(
    @CurrentAuth() auth: AuthContext,
    @Param("sessionId") sessionId: string,
    @Param("regionId") regionId: string,
    @Body() body: ConfirmWorkbookReviewRegionDto,
  ) {
    return this.evidenceService.confirmWorkbookReviewRegion(auth, sessionId, regionId, body);
  }

  @Post("regions/:regionId/ignore")
  @HttpCode(200)
  async ignoreRegion(
    @CurrentAuth() auth: AuthContext,
    @Param("sessionId") sessionId: string,
    @Param("regionId") regionId: string,
    @Body() body: IgnoreWorkbookReviewRegionDto,
  ) {
    return { region: await this.evidenceService.ignoreWorkbookReviewRegion(auth, sessionId, regionId, body) };
  }
}
