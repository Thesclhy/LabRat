import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module.js";
import { AuthorizationController } from "./authorization.controller.js";
import { AuthorizationRepository } from "./authorization.repository.js";
import { AuthorizationService } from "./authorization.service.js";

@Module({
  imports: [IdentityModule],
  controllers: [AuthorizationController],
  providers: [AuthorizationRepository, AuthorizationService],
  exports: [AuthorizationRepository, AuthorizationService],
})
export class AuthorizationModule {}
