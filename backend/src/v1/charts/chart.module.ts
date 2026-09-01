import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { ChartController, ProjectChartController } from "./chart.controller.js";
import { ChartRepository } from "./chart.repository.js";
import { ChartService } from "./chart.service.js";

@Module({
  imports: [AuthorizationModule],
  controllers: [ProjectChartController, ChartController],
  providers: [ChartRepository, ChartService],
  exports: [ChartService],
})
export class ChartModule {}
