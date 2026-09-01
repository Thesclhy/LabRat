import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { ApiError } from "../http/api-error.js";
import { V1_CONFIG, type V1Config } from "../config/v1-config.js";
import { v1Schema } from "./schema.js";

export type V1Database = NodePgDatabase<typeof v1Schema>;

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool | null;
  private readonly database: V1Database | null;

  constructor(@Inject(V1_CONFIG) config: V1Config) {
    this.pool = config.databaseUrl
      ? new Pool({ connectionString: config.databaseUrl })
      : null;
    this.database = this.pool ? drizzle(this.pool, { schema: v1Schema }) : null;
  }

  get db(): V1Database {
    if (!this.database) {
      throw new ApiError(503, "database_unavailable", "PostgreSQL is not configured.");
    }
    return this.database;
  }

  get rawPool(): Pool {
    if (!this.pool) {
      throw new ApiError(503, "database_unavailable", "PostgreSQL is not configured.");
    }
    return this.pool;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}
