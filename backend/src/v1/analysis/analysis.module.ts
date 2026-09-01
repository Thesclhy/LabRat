import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { EvidenceModule } from "../evidence/evidence.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import {
  AnalysisPlanRevisionController,
  AnalysisRunController,
  AnalysisThreadController,
  AgentRunController,
  ProjectAnalysisController,
} from "./analysis.controller.js";
import { AnalysisRepository } from "./analysis.repository.js";
import { AnalysisService } from "./analysis.service.js";

@Module({
  imports: [AuthorizationModule, EvidenceModule, IdentityModule],
  controllers: [
    ProjectAnalysisController,
    AgentRunController,
    AnalysisThreadController,
    AnalysisPlanRevisionController,
    AnalysisRunController,
  ],
  providers: [AnalysisRepository, AnalysisService],
  exports: [AnalysisService],
})
export class AnalysisModule {}
