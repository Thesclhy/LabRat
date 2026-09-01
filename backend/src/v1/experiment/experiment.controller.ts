import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { CurrentAuth } from "../identity/current-auth.js";
import type { AuthContext } from "../identity/identity.types.js";
import {
  CreateBrowserViewDto,
  CreateExperimentCustomColumnDto,
  ExperimentAnnotationDto,
  ExperimentBrowserQueryDto,
  ProjectBrowserConfigDto,
  SaveExperimentCustomValueDto,
  UpdateBrowserViewDto,
  UpdateExperimentCustomColumnDto,
} from "./experiment.dto.js";
import { ExperimentService } from "./experiment.service.js";

@Controller("api/v1/projects/:projectId")
export class ExperimentController {
  constructor(private readonly experimentService: ExperimentService) {}

  @Get("data-plans")
  async listDataPlans(@CurrentAuth() auth: AuthContext, @Param("projectId") projectId: string) {
    return { items: await this.experimentService.listDataPlans(auth, projectId), nextCursor: null };
  }

  @Get("data-snapshots")
  async listDataSnapshots(@CurrentAuth() auth: AuthContext, @Param("projectId") projectId: string) {
    return { items: await this.experimentService.listDataSnapshots(auth, projectId), nextCursor: null };
  }

  @Get("experiment-browser")
  getBrowser(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Query() query: ExperimentBrowserQueryDto,
  ) {
    return this.experimentService.getBrowser(auth, projectId, query);
  }

  @Get("experiments/:experimentId")
  getExperiment(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Param("experimentId") experimentId: string,
  ) {
    return this.experimentService.getExperiment(auth, projectId, experimentId);
  }

  @Get("experiment-annotations")
  async listAnnotations(@CurrentAuth() auth: AuthContext, @Param("projectId") projectId: string) {
    return { items: await this.experimentService.listAnnotations(auth, projectId), nextCursor: null };
  }

  @Put("experiments/:experimentId/annotation")
  async saveAnnotation(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Param("experimentId") experimentId: string,
    @Body() body: ExperimentAnnotationDto,
  ) {
    return { annotation: await this.experimentService.saveAnnotation(auth, projectId, experimentId, body) };
  }

  @Delete("experiments/:experimentId/annotation")
  @HttpCode(200)
  async deleteAnnotation(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Param("experimentId") experimentId: string,
  ) {
    return { deleted: await this.experimentService.deleteAnnotation(auth, projectId, experimentId) };
  }

  @Get("experiment-custom-columns")
  async listCustomColumns(@CurrentAuth() auth: AuthContext, @Param("projectId") projectId: string) {
    return { items: await this.experimentService.listCustomColumns(auth, projectId), nextCursor: null };
  }

  @Post("experiment-custom-columns")
  async createCustomColumn(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Body() body: CreateExperimentCustomColumnDto,
  ) {
    return { customColumn: await this.experimentService.createCustomColumn(auth, projectId, body.label) };
  }

  @Patch("experiment-custom-columns/:columnId")
  async updateCustomColumn(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Param("columnId") columnId: string,
    @Body() body: UpdateExperimentCustomColumnDto,
  ) {
    return { customColumn: await this.experimentService.updateCustomColumn(auth, projectId, columnId, body) };
  }

  @Delete("experiment-custom-columns/:columnId")
  @HttpCode(200)
  async deleteCustomColumn(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Param("columnId") columnId: string,
  ) {
    return { deleted: await this.experimentService.deleteCustomColumn(auth, projectId, columnId) };
  }

  @Put("experiment-custom-columns/:columnId/experiments/:experimentId")
  async saveCustomValue(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Param("columnId") columnId: string,
    @Param("experimentId") experimentId: string,
    @Body() body: SaveExperimentCustomValueDto,
  ) {
    return {
      customValue: await this.experimentService.saveCustomValue(
        auth, projectId, columnId, experimentId, body,
      ),
    };
  }

  @Get("browser-config")
  getBrowserConfig(@CurrentAuth() auth: AuthContext, @Param("projectId") projectId: string) {
    return this.experimentService.getBrowserConfig(auth, projectId);
  }

  @Patch("browser-config")
  saveBrowserConfig(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Body() body: ProjectBrowserConfigDto,
  ) {
    return this.experimentService.saveBrowserConfig(auth, projectId, body);
  }

  @Get("browser-views")
  async listBrowserViews(@CurrentAuth() auth: AuthContext, @Param("projectId") projectId: string) {
    return { items: await this.experimentService.listBrowserViews(auth, projectId), nextCursor: null };
  }

  @Post("browser-views")
  async createBrowserView(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Body() body: CreateBrowserViewDto,
  ) {
    return { browserView: await this.experimentService.createBrowserView(auth, projectId, body) };
  }

  @Patch("browser-views/:viewId")
  async updateBrowserView(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Param("viewId") viewId: string,
    @Body() body: UpdateBrowserViewDto,
  ) {
    return { browserView: await this.experimentService.updateBrowserView(auth, projectId, viewId, body) };
  }

  @Delete("browser-views/:viewId")
  @HttpCode(200)
  async deleteBrowserView(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Param("viewId") viewId: string,
  ) {
    return { deleted: await this.experimentService.deleteBrowserView(auth, projectId, viewId) };
  }
}
