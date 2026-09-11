import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { CurrentAuth } from "../identity/current-auth.js";
import type { AuthContext } from "../identity/identity.types.js";
import {
  ApplyReusableChartTemplateDto,
  CreateChartStyleProfileDto,
  CreateChartStyleProfileVersionDto,
  CreateReusableChartTemplateDto,
  CreateReusableChartTemplateVersionDto,
  ReusableChartPageQueryDto,
} from "./reusable-charts.dto.js";
import { ReusableChartsService } from "./reusable-charts.service.js";

function requestMeta(request: FastifyRequest) {
  return {
    ipAddress: request.ip || null,
    userAgent: String(request.headers["user-agent"] || "") || null,
  };
}

function respondWithStatus(reply: FastifyReply, result: Record<string, any>) {
  reply.status(Number(result.statusCode) || 200);
  const { statusCode: _statusCode, ...body } = result;
  return body;
}

@Controller("api/v1/projects/:projectId")
export class ProjectReusableChartsController {
  constructor(private readonly service: ReusableChartsService) {}

  @Get("chart-style-profiles")
  listStyleProfiles(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Query() query: ReusableChartPageQueryDto,
  ) {
    return this.service.listStyleProfiles(auth, projectId, query);
  }

  @Post("chart-style-profiles")
  createStyleProfile(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Body() body: CreateChartStyleProfileDto,
    @Req() request: FastifyRequest,
  ) {
    return this.service.createStyleProfile(auth, projectId, body, requestMeta(request));
  }

  @Get("reusable-chart-templates")
  listTemplates(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Query() query: ReusableChartPageQueryDto,
  ) {
    return this.service.listTemplates(auth, projectId, query);
  }

  @Post("reusable-chart-templates")
  createTemplate(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Body() body: CreateReusableChartTemplateDto,
    @Req() request: FastifyRequest,
  ) {
    return this.service.createTemplate(auth, projectId, body, requestMeta(request));
  }
}

@Controller("api/v1/chart-style-profiles/:chartStyleProfileId")
export class ChartStyleProfileController {
  constructor(private readonly service: ReusableChartsService) {}

  @Get()
  detail(@CurrentAuth() auth: AuthContext, @Param("chartStyleProfileId") profileId: string) {
    return this.service.styleProfileDetail(auth, profileId);
  }

  @Post("versions")
  createVersion(
    @CurrentAuth() auth: AuthContext,
    @Param("chartStyleProfileId") profileId: string,
    @Body() body: CreateChartStyleProfileVersionDto,
    @Req() request: FastifyRequest,
  ) {
    return this.service.createStyleProfileVersion(auth, profileId, body, requestMeta(request));
  }

  @Post("archive")
  @HttpCode(200)
  archive(
    @CurrentAuth() auth: AuthContext,
    @Param("chartStyleProfileId") profileId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.service.archiveStyleProfile(auth, profileId, requestMeta(request));
  }
}

@Controller("api/v1/reusable-chart-templates/:reusableChartTemplateId")
export class ReusableChartTemplateController {
  constructor(private readonly service: ReusableChartsService) {}

  @Get()
  detail(@CurrentAuth() auth: AuthContext, @Param("reusableChartTemplateId") templateId: string) {
    return this.service.templateDetail(auth, templateId);
  }

  @Post("versions")
  createVersion(
    @CurrentAuth() auth: AuthContext,
    @Param("reusableChartTemplateId") templateId: string,
    @Body() body: CreateReusableChartTemplateVersionDto,
    @Req() request: FastifyRequest,
  ) {
    return this.service.createTemplateVersion(auth, templateId, body, requestMeta(request));
  }

  @Post("archive")
  @HttpCode(200)
  archive(
    @CurrentAuth() auth: AuthContext,
    @Param("reusableChartTemplateId") templateId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.service.archiveTemplate(auth, templateId, requestMeta(request));
  }
}

@Controller("api/v1/chart-specs/:chartSpecId")
export class ChartTemplateEligibilityController {
  constructor(private readonly service: ReusableChartsService) {}

  @Get("template-eligibility")
  eligibility(@CurrentAuth() auth: AuthContext, @Param("chartSpecId") chartSpecId: string) {
    return this.service.eligibility(auth, chartSpecId);
  }
}

@Controller("api/v1/reusable-chart-template-versions/:templateVersionId")
export class ReusableChartTemplateVersionController {
  constructor(private readonly service: ReusableChartsService) {}

  @Post("applications")
  async apply(
    @CurrentAuth() auth: AuthContext,
    @Param("templateVersionId") templateVersionId: string,
    @Body() body: ApplyReusableChartTemplateDto,
    @Headers("idempotency-key") key: string | string[] | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return respondWithStatus(
      reply,
      await this.service.applyTemplate(auth, templateVersionId, body, key, requestMeta(request)),
    );
  }
}
