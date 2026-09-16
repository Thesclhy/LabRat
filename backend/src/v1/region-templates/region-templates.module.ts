import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { EvidenceModule } from "../evidence/evidence.module.js";
import { ProjectRegionTemplatesController, RegionTemplatesController, RegionTemplateVersionsController } from "./region-templates.controller.js";
import { RegionTemplatesRepository } from "./region-templates.repository.js";
import { RegionTemplatesService } from "./region-templates.service.js";

@Module({
  imports: [AuthorizationModule, EvidenceModule],
  controllers: [ProjectRegionTemplatesController, RegionTemplatesController, RegionTemplateVersionsController],
  providers: [RegionTemplatesRepository, RegionTemplatesService],
})
export class RegionTemplatesModule {}
