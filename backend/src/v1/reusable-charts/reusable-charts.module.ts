import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import {
  ChartStyleProfileController,
  ChartTemplateEligibilityController,
  ProjectReusableChartsController,
  ReusableChartTemplateController,
  ReusableChartTemplateVersionController,
} from "./reusable-charts.controller.js";
import { ReusableChartsRepository } from "./reusable-charts.repository.js";
import { ReusableChartsService } from "./reusable-charts.service.js";

@Module({
  imports: [AuthorizationModule, IdentityModule],
  controllers: [
    ProjectReusableChartsController,
    ChartStyleProfileController,
    ReusableChartTemplateController,
    ChartTemplateEligibilityController,
    ReusableChartTemplateVersionController,
  ],
  providers: [ReusableChartsRepository, ReusableChartsService],
  exports: [ReusableChartsRepository],
})
export class ReusableChartsModule {}
