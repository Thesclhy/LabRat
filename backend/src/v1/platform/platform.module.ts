import { Global, Module } from "@nestjs/common";
import { V1_CONFIG, loadV1Config } from "./config/v1-config.js";
import { DatabaseService } from "./database/database.service.js";
import { HealthController } from "./health.controller.js";
import { createV1ModelProvider, V1_MODEL_PROVIDER } from "./model/model-provider.js";
import {
  createV1AnalysisExecutor,
  V1_ANALYSIS_EXECUTOR,
} from "./analysis/analysis-executor.js";

@Global()
@Module({
  controllers: [HealthController],
  providers: [
    { provide: V1_CONFIG, useFactory: loadV1Config },
    {
      provide: V1_MODEL_PROVIDER,
      inject: [V1_CONFIG],
      useFactory: createV1ModelProvider,
    },
    {
      provide: V1_ANALYSIS_EXECUTOR,
      inject: [V1_CONFIG],
      useFactory: createV1AnalysisExecutor,
    },
    DatabaseService,
  ],
  exports: [V1_CONFIG, V1_MODEL_PROVIDER, V1_ANALYSIS_EXECUTOR, DatabaseService],
})
export class PlatformModule {}
