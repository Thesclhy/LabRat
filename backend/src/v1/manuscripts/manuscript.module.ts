import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { ManuscriptController, ProjectManuscriptController } from "./manuscript.controller.js";
import { ManuscriptRepository } from "./manuscript.repository.js";
import { ManuscriptService } from "./manuscript.service.js";

@Module({
  imports: [AuthorizationModule, IdentityModule],
  controllers: [ProjectManuscriptController, ManuscriptController],
  providers: [ManuscriptRepository, ManuscriptService],
  exports: [ManuscriptService],
})
export class ManuscriptModule {}
