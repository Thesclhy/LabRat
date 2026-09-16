import { Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { DatabaseService } from "../platform/database/database.service.js";
import { chartSpecs } from "../platform/database/schema.js";

@Injectable()
export class ChartRepository {
  constructor(private readonly database: DatabaseService) {}

  listChartSpecs(projectId: string) {
    return this.database.db.select().from(chartSpecs)
      .where(eq(chartSpecs.projectId, projectId))
      .orderBy(desc(chartSpecs.updatedAt), desc(chartSpecs.id));
  }

  async findChartSpecById(id: string) {
    const [row] = await this.database.db.select().from(chartSpecs)
      .where(eq(chartSpecs.id, id)).limit(1);
    return row || null;
  }
}
