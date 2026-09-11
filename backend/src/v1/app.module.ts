import { Module } from "@nestjs/common";
import { AnalysisModule } from "./analysis/analysis.module.js";
import { AuthorizationModule } from "./authorization/authorization.module.js";
import { ChartModule } from "./charts/chart.module.js";
import { IdentityModule } from "./identity/identity.module.js";
import { ExperimentModule } from "./experiment/experiment.module.js";
import { EvidenceModule } from "./evidence/evidence.module.js";
import { ManuscriptModule } from "./manuscripts/manuscript.module.js";
import { PlatformModule } from "./platform/platform.module.js";
import { ReusableChartsModule } from "./reusable-charts/reusable-charts.module.js";
import { WorkspaceModule } from "./workspace/workspace.module.js";

@Module({
  imports: [
    PlatformModule,
    IdentityModule,
    AuthorizationModule,
    WorkspaceModule,
    ExperimentModule,
    EvidenceModule,
    AnalysisModule,
    ChartModule,
    ReusableChartsModule,
    ManuscriptModule,
  ],
})
export class AppModule {}
