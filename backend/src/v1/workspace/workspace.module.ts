import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { WorkspaceController } from "./workspace.controller.js";
import { WorkspaceRepository } from "./workspace.repository.js";
import { WorkspaceService } from "./workspace.service.js";

@Module({
  imports: [AuthorizationModule, IdentityModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceRepository, WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
