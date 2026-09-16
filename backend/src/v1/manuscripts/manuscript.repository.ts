import { Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { makeId } from "../../saas/ids.js";
import { DatabaseService } from "../platform/database/database.service.js";
import { manuscripts } from "../platform/database/schema.js";

type ManuscriptRow = typeof manuscripts.$inferSelect;

function publicManuscript(row: ManuscriptRow | null | undefined) {
  if (!row) return null;
  const { referencesPayload, ...manuscript } = row;
  return { ...manuscript, references: referencesPayload || [] };
}

@Injectable()
export class ManuscriptRepository {
  constructor(private readonly database: DatabaseService) {}

  async list(projectId: string) {
    const rows = await this.database.db.select().from(manuscripts)
      .where(eq(manuscripts.projectId, projectId))
      .orderBy(desc(manuscripts.updatedAt), desc(manuscripts.id));
    return rows.map(publicManuscript);
  }

  async findById(id: string) {
    const [row] = await this.database.db.select().from(manuscripts)
      .where(eq(manuscripts.id, id)).limit(1);
    return publicManuscript(row);
  }

  async create(input: {
    labId: string;
    projectId: string;
    title: string;
    blocks: unknown[];
    pages: unknown[];
    canvasState: Record<string, unknown>;
    references: unknown[];
    actorUserId: string;
  }) {
    const timestamp = new Date().toISOString();
    const [row] = await this.database.db.insert(manuscripts).values({
      id: makeId("manuscript"),
      labId: input.labId,
      projectId: input.projectId,
      title: input.title,
      status: "draft",
      blocks: input.blocks,
      pages: input.pages,
      canvasState: input.canvasState,
      referencesPayload: input.references,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: input.actorUserId,
      updatedBy: input.actorUserId,
    }).returning();
    return publicManuscript(row);
  }

  async update(id: string, input: {
    title?: string;
    blocks?: unknown[];
    pages?: unknown[];
    canvasState?: Record<string, unknown>;
    references?: unknown[];
    actorUserId: string;
  }) {
    const current = await this.findById(id);
    if (!current) return null;
    const [row] = await this.database.db.update(manuscripts).set({
      title: input.title ?? current.title,
      blocks: input.blocks ?? current.blocks,
      pages: input.pages ?? current.pages,
      canvasState: input.canvasState ?? current.canvasState,
      referencesPayload: input.references ?? current.references,
      updatedAt: new Date().toISOString(),
      updatedBy: input.actorUserId,
    }).where(eq(manuscripts.id, id)).returning();
    return publicManuscript(row);
  }
}
