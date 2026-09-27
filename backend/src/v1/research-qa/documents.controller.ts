import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { CurrentAuth } from "../identity/current-auth.js";
import type { AuthContext } from "../identity/identity.types.js";
import { ArchiveDocumentDto, DocumentPageDto, EmptyDocumentDto, RegisterDocumentDto } from "./documents.dto.js";
import { DocumentsService } from "./documents.service.js";

@Controller("api/v1/projects/:projectId/context-documents")
export class ContextDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext, @Param("projectId") projectId: string, @Query() query: DocumentPageDto) {
    return this.documents.list(auth, projectId, query);
  }

  @Post()
  register(@CurrentAuth() auth: AuthContext, @Param("projectId") projectId: string, @Body() body: RegisterDocumentDto) {
    return this.documents.register(auth, projectId, body.fileObjectId);
  }

  @Get(":documentId")
  detail(@CurrentAuth() auth: AuthContext, @Param("projectId") projectId: string, @Param("documentId") id: string, @Query() query: DocumentPageDto) {
    return this.documents.detail(auth, projectId, id, query);
  }

  @Post(":documentId/archive") @HttpCode(200)
  archive(@CurrentAuth() auth: AuthContext, @Param("projectId") projectId: string, @Param("documentId") id: string, @Body() body: ArchiveDocumentDto) {
    return this.documents.archive(auth, projectId, id, body.expectedVersion);
  }
}

@Controller("api/v1/projects/:projectId/context-document-versions/:versionId")
export class ContextDocumentVersionsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  async version(@CurrentAuth() auth: AuthContext, @Param("projectId") projectId: string, @Param("versionId") id: string) {
    return { version: await this.documents.version(auth, projectId, id) };
  }

  @Post("retry") @HttpCode(200)
  retry(@CurrentAuth() auth: AuthContext, @Param("projectId") projectId: string, @Param("versionId") id: string, @Body() _body: EmptyDocumentDto) {
    return this.documents.retry(auth, projectId, id);
  }

  @Get("passages")
  passages(@CurrentAuth() auth: AuthContext, @Param("projectId") projectId: string, @Param("versionId") id: string, @Query() query: DocumentPageDto) {
    return this.documents.listPassages(auth, projectId, id, query);
  }

  @Get("passages/:passageId")
  passage(@CurrentAuth() auth: AuthContext, @Param("projectId") projectId: string, @Param("versionId") id: string, @Param("passageId") passage: string) {
    return this.documents.passage(auth, projectId, id, passage);
  }

  @Get("pages/:pageNumber")
  async page(@CurrentAuth() auth: AuthContext, @Param("projectId") projectId: string, @Param("versionId") id: string,
    @Param("pageNumber") pageNumber: string, @Res() response: FastifyReply) {
    const image = await this.documents.pageImage(auth, projectId, id, Number(pageNumber));
    return response.header("Cache-Control", "private, no-store").header("X-Content-Type-Options", "nosniff").type("image/png").send(image);
  }
}
