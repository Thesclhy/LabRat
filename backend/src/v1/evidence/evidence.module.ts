import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import {
  ProjectEvidenceController,
  SourceDocumentEvidenceController,
  WorkbookReviewEvidenceController,
} from "./evidence.controller.js";
import { EvidenceRepository } from "./evidence.repository.js";
import { EvidenceService } from "./evidence.service.js";

@Module({
  imports: [AuthorizationModule, IdentityModule],
  controllers: [
    ProjectEvidenceController,
    SourceDocumentEvidenceController,
    WorkbookReviewEvidenceController,
  ],
  providers: [EvidenceRepository, EvidenceService],
  exports: [EvidenceRepository, EvidenceService],
})
export class EvidenceModule {}
