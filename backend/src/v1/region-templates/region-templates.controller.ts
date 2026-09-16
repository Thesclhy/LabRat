import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from "@nestjs/common";
import { CurrentAuth } from "../identity/current-auth.js";
import type { AuthContext } from "../identity/identity.types.js";
import { ApplyRegionTemplateDto, ConfirmRegionBatchDto, CreateRegionTemplateDto,
  MatchRegionTemplateDto, TemplateListQueryDto, TemplateRegionDto } from "./region-templates.dto.js";
import { RegionTemplatesService } from "./region-templates.service.js";

@Controller("api/v1/projects/:projectId")
export class ProjectRegionTemplatesController {
  constructor(private readonly service: RegionTemplatesService) {}
  @Get("region-extraction-templates")
  list(@CurrentAuth() auth: AuthContext, @Param("projectId") id: string, @Query() query: TemplateListQueryDto) {
    return this.service.list(auth, id, query);
  }
  @Post("region-extraction-templates")
  create(@CurrentAuth() auth: AuthContext, @Param("projectId") id: string, @Body() input: CreateRegionTemplateDto) {
    return this.service.save(auth, id, input);
  }
  @Post("workbook-review-regions/confirm-batch") @HttpCode(200)
  confirm(@CurrentAuth() auth: AuthContext, @Param("projectId") id: string, @Body() input: ConfirmRegionBatchDto) {
    return this.service.confirmBatch(auth, id, input);
  }
}

@Controller("api/v1/region-extraction-templates/:templateId")
export class RegionTemplatesController {
  constructor(private readonly service: RegionTemplatesService) {}
  @Get()
  get(@CurrentAuth() auth: AuthContext, @Param("templateId") id: string) { return this.service.get(auth, id); }
  @Post("versions")
  version(@CurrentAuth() auth: AuthContext, @Param("templateId") id: string, @Body() input: TemplateRegionDto) {
    return this.service.save(auth, "", input, id);
  }
  @Post("archive") @HttpCode(200)
  archive(@CurrentAuth() auth: AuthContext, @Param("templateId") id: string) { return this.service.archive(auth, id); }
}

@Controller("api/v1/region-extraction-template-versions/:versionId")
export class RegionTemplateVersionsController {
  constructor(private readonly service: RegionTemplatesService) {}
  @Post("matches") @HttpCode(200)
  matches(@CurrentAuth() auth: AuthContext, @Param("versionId") id: string, @Body() input: MatchRegionTemplateDto) {
    return this.service.matches(auth, id, input);
  }
  @Post("apply") @HttpCode(200)
  apply(@CurrentAuth() auth: AuthContext, @Param("versionId") id: string, @Body() input: ApplyRegionTemplateDto,
    @Headers("idempotency-key") key: string | undefined) { return this.service.apply(auth, id, input, key); }
}
