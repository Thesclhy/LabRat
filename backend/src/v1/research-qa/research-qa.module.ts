import { Module } from "@nestjs/common";
import { AssistantTasksController } from "./assistant-tasks.controller.js";
import { AssistantTasksRepository } from "./assistant-tasks.repository.js";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { EvidenceModule } from "../evidence/evidence.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { ContextDocumentsController, ContextDocumentVersionsController } from "./documents.controller.js";
import { DocumentsRepository } from "./documents.repository.js";
import { DocumentsService } from "./documents.service.js";
import { ResearchEvidenceRepository } from "./research-evidence.repository.js";
import { ResearchEvidenceService } from "./research-evidence.service.js";
import { ResearchQuestionsController } from "./research-questions.controller.js";
import { ResearchQuestionsRepository } from "./research-questions.repository.js";
import { ResearchQuestionsService } from "./research-questions.service.js";

@Module({
  imports: [AuthorizationModule, EvidenceModule, IdentityModule],
  controllers: [ContextDocumentsController, ContextDocumentVersionsController, ResearchQuestionsController, AssistantTasksController],
  providers: [DocumentsRepository, DocumentsService, ResearchEvidenceRepository, ResearchEvidenceService, ResearchQuestionsRepository, ResearchQuestionsService, AssistantTasksRepository],
  exports: [DocumentsRepository, DocumentsService, ResearchEvidenceRepository, ResearchEvidenceService],
})
export class ResearchQaModule {}
