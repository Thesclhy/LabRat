import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthController, IdentityAdminController } from "./identity.controller.js";
import { IdentityRepository } from "./identity.repository.js";
import { IdentityService } from "./identity.service.js";
import { SessionAuthGuard } from "./session-auth.guard.js";

@Module({
  controllers: [AuthController, IdentityAdminController],
  providers: [
    IdentityRepository,
    IdentityService,
    { provide: APP_GUARD, useClass: SessionAuthGuard },
  ],
  exports: [IdentityRepository, IdentityService],
})
export class IdentityModule {}
