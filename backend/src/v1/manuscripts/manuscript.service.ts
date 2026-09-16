import { Injectable } from "@nestjs/common";
import { AuthorizationService } from "../authorization/authorization.service.js";
import { IdentityRepository } from "../identity/identity.repository.js";
import type { AuthContext } from "../identity/identity.types.js";
import { ApiError } from "../platform/http/api-error.js";
import type {
  CreateManuscriptDto,
  ManuscriptPageQueryDto,
  UpdateManuscriptDto,
} from "./manuscript.dto.js";
import { ManuscriptRepository } from "./manuscript.repository.js";

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Number.isInteger(value?.offset) || value.offset < 0) throw new Error("invalid");
    return value.offset;
  } catch {
    throw new ApiError(400, "invalid_cursor", "The pagination cursor is invalid.");
  }
}

@Injectable()
export class ManuscriptService {
  constructor(
    private readonly repository: ManuscriptRepository,
    private readonly authorization: AuthorizationService,
    private readonly identityRepository: IdentityRepository,
  ) {}

  async list(auth: AuthContext, projectId: string, query: ManuscriptPageQueryDto) {
    await this.authorization.requireFullProjectCapability(auth, projectId, "read");
    const offset = decodeCursor(query.cursor);
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
    const manuscripts = await this.repository.list(projectId);
    const items = manuscripts.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    return {
      items,
      nextCursor: nextOffset < manuscripts.length ? encodeCursor(nextOffset) : null,
    };
  }

  async create(auth: AuthContext, projectId: string, input: CreateManuscriptDto) {
    const { project } = await this.authorization.requireFullProjectCapability(auth, projectId, "propose");
    const manuscript = await this.repository.create({
      labId: project.labId,
      projectId,
      title: String(input.title || "").trim() || "Untitled manuscript",
      blocks: input.blocks || [],
      pages: input.pages || [],
      canvasState: input.canvasState || {},
      references: input.references || [],
      actorUserId: auth.user.id,
    });
    if (!manuscript) throw new ApiError(500, "manuscript_create_failed", "Manuscript could not be created.");
    await this.audit(auth, project.labId, projectId, "manuscript.create", manuscript.id, manuscript.title);
    return manuscript;
  }

  async update(auth: AuthContext, manuscriptId: string, input: UpdateManuscriptDto) {
    const manuscript = await this.repository.findById(manuscriptId);
    if (!manuscript) throw new ApiError(404, "manuscript_not_found", "Manuscript not found.");
    const resolved = await this.authorization.resolveProjectAccess(auth, manuscript.projectId);
    if (!resolved?.access?.allExperiments) {
      throw new ApiError(404, "manuscript_not_found", "Manuscript not found.");
    }
    if (!resolved.access.capabilities.includes("propose")) {
      throw new ApiError(403, "forbidden", "Full-project capability propose is required.");
    }
    if (![input.title, input.blocks, input.pages, input.canvasState, input.references]
      .some((value) => value !== undefined)) {
      throw new ApiError(400, "manuscript_update_required", "Provide at least one manuscript field to update.");
    }
    const title = input.title === undefined ? undefined : input.title.trim();
    if (title !== undefined && !title) {
      throw new ApiError(400, "manuscript_title_required", "Manuscript title cannot be blank.");
    }
    const updated = await this.repository.update(manuscript.id, {
      ...(title !== undefined ? { title } : {}),
      ...(input.blocks !== undefined ? { blocks: input.blocks } : {}),
      ...(input.pages !== undefined ? { pages: input.pages } : {}),
      ...(input.canvasState !== undefined ? { canvasState: input.canvasState } : {}),
      ...(input.references !== undefined ? { references: input.references } : {}),
      actorUserId: auth.user.id,
    });
    if (!updated) throw new ApiError(404, "manuscript_not_found", "Manuscript not found.");
    await this.audit(auth, manuscript.labId, manuscript.projectId, "manuscript.update", manuscript.id, updated.title);
    return updated;
  }

  private async audit(
    auth: AuthContext,
    labId: string,
    projectId: string,
    action: string,
    targetId: string,
    title: string,
  ) {
    await this.identityRepository.recordAudit({
      labId,
      projectId,
      actorUserId: auth.user.id,
      action,
      targetType: "manuscript",
      targetId,
      summary: `${action === "manuscript.create" ? "Created" : "Updated"} manuscript ${title}.`,
    });
  }
}
