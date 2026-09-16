import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { ExperimentController } from "./experiment.controller.js";
import { ExperimentRepository } from "./experiment.repository.js";
import { ExperimentService } from "./experiment.service.js";

@Module({
  imports: [AuthorizationModule, IdentityModule],
  controllers: [ExperimentController],
  providers: [ExperimentRepository, ExperimentService],
  exports: [ExperimentService],
})
export class ExperimentModule {}
