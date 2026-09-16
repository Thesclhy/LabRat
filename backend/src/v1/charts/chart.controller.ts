import { Controller, Get, Param, Query } from "@nestjs/common";
import { CurrentAuth } from "../identity/current-auth.js";
import type { AuthContext } from "../identity/identity.types.js";
import { ChartSpecPageQueryDto } from "./chart.dto.js";
import { ChartService } from "./chart.service.js";

@Controller("api/v1/projects/:projectId/chart-specs")
export class ProjectChartController {
  constructor(private readonly chartService: ChartService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Query() query: ChartSpecPageQueryDto,
  ) {
    return this.chartService.list(auth, projectId, query);
  }
}

@Controller("api/v1/chart-specs/:chartSpecId")
export class ChartController {
  constructor(private readonly chartService: ChartService) {}

  @Get()
  async detail(@CurrentAuth() auth: AuthContext, @Param("chartSpecId") chartSpecId: string) {
    return { chartSpec: await this.chartService.detail(auth, chartSpecId) };
  }
}
