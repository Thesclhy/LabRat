import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentAuth } from "../identity/current-auth.js";
import type { AuthContext } from "../identity/identity.types.js";
import {
  CreateManuscriptDto,
  ManuscriptPageQueryDto,
  UpdateManuscriptDto,
} from "./manuscript.dto.js";
import { ManuscriptService } from "./manuscript.service.js";

@Controller("api/v1/projects/:projectId/manuscripts")
export class ProjectManuscriptController {
  constructor(private readonly manuscriptService: ManuscriptService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Query() query: ManuscriptPageQueryDto,
  ) {
    return this.manuscriptService.list(auth, projectId, query);
  }

  @Post()
  async create(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Body() body: CreateManuscriptDto,
  ) {
    return { manuscript: await this.manuscriptService.create(auth, projectId, body) };
  }
}

@Controller("api/v1/manuscripts/:manuscriptId")
export class ManuscriptController {
  constructor(private readonly manuscriptService: ManuscriptService) {}

  @Patch()
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param("manuscriptId") manuscriptId: string,
    @Body() body: UpdateManuscriptDto,
  ) {
    return { manuscript: await this.manuscriptService.update(auth, manuscriptId, body) };
  }
}
