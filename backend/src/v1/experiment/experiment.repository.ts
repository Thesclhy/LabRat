import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { makeId } from "../../saas/ids.js";
import { DatabaseService } from "../platform/database/database.service.js";
import {
  browserViews,
  dataPlans,
  dataSnapshots,
  experimentAnnotations,
  experimentCustomColumns,
  experimentCustomValues,
  projectBrowserConfigs,
} from "../platform/database/schema.js";

interface ProjectionRow {
  identity_id: string;
  identity_lab_id: string;
  identity_project_id: string;
  canonical_label: string;
  normalized_label: string;
  aliases: string[];
  identity_created_at: string;
  identity_updated_at: string;
  identity_created_by: string;
  identity_updated_by: string | null;
  head_id: string;
  head_lab_id: string;
  head_project_id: string;
  experiment_id: string;
  data_snapshot_id: string;
  record_index: number;
  head_updated_at: string;
  head_updated_by: string;
  snapshot_lab_id: string;
  snapshot_project_id: string;
  data_plan_id: string | null;
  analysis_plan_revision_id: string | null;
  analysis_run_id: string | null;
  analysis_result_id: string | null;
  snapshot_schema_version: string;
  snapshot_status: string;
  output_shape: string;
  content_hash: string;
  dependency_hash: string;
  snapshot_summary: Record<string, unknown>;
  snapshot_warnings: unknown[];
  accepted_at: string;
  accepted_by: string;
  snapshot_created_at: string;
  snapshot_created_by: string;
  active_record: Record<string, unknown> | null;
}

@Injectable()
export class ExperimentRepository {
  constructor(private readonly database: DatabaseService) {}

  async loadProjectionState(projectId: string, experimentIds: string[] | null) {
    if (experimentIds?.length === 0) {
      return { dataSnapshots: [], experimentIdentities: [], experimentSnapshotHeads: [] };
    }
    const result = await this.database.rawPool.query<ProjectionRow>(
      `select
         identity.id as identity_id,
         identity.lab_id as identity_lab_id,
         identity.project_id as identity_project_id,
         identity.canonical_label,
         identity.normalized_label,
         identity.aliases,
         identity.created_at as identity_created_at,
         identity.updated_at as identity_updated_at,
         identity.created_by as identity_created_by,
         identity.updated_by as identity_updated_by,
         head.id as head_id,
         head.lab_id as head_lab_id,
         head.project_id as head_project_id,
         head.experiment_id,
         head.data_snapshot_id,
         head.record_index,
         head.updated_at as head_updated_at,
         head.updated_by as head_updated_by,
         snapshot.lab_id as snapshot_lab_id,
         snapshot.project_id as snapshot_project_id,
         snapshot.data_plan_id,
         snapshot.analysis_plan_revision_id,
         snapshot.analysis_run_id,
         snapshot.analysis_result_id,
         snapshot.schema_version as snapshot_schema_version,
         snapshot.status as snapshot_status,
         snapshot.output_shape,
         snapshot.content_hash,
         snapshot.dependency_hash,
         snapshot.summary as snapshot_summary,
         snapshot.warnings as snapshot_warnings,
         snapshot.accepted_at,
         snapshot.accepted_by,
         snapshot.created_at as snapshot_created_at,
         snapshot.created_by as snapshot_created_by,
         snapshot.experiment_records -> head.record_index as active_record
       from experiment_snapshot_heads head
       join experiment_identities identity
         on identity.id = head.experiment_id
        and identity.project_id = head.project_id
       join data_snapshots snapshot
         on snapshot.id = head.data_snapshot_id
        and snapshot.project_id = head.project_id
       where head.project_id = $1
         and ($2::text[] is null or head.experiment_id = any($2::text[]))
       order by identity.canonical_label, identity.id`,
      [projectId, experimentIds],
    );

    const snapshots = new Map<string, Record<string, unknown> & { experimentRecords: Array<Record<string, unknown> | undefined> }>();
    const experimentIdentities = [];
    const experimentSnapshotHeads = [];
    for (const row of result.rows) {
      let snapshot = snapshots.get(row.data_snapshot_id);
      if (!snapshot) {
        snapshot = {
          id: row.data_snapshot_id,
          labId: row.snapshot_lab_id,
          projectId: row.snapshot_project_id,
          dataPlanId: row.data_plan_id,
          analysisPlanRevisionId: row.analysis_plan_revision_id,
          analysisRunId: row.analysis_run_id,
          analysisResultId: row.analysis_result_id,
          schemaVersion: row.snapshot_schema_version,
          status: row.snapshot_status,
          outputShape: row.output_shape,
          contentHash: row.content_hash,
          dependencyHash: row.dependency_hash,
          summary: row.snapshot_summary || {},
          warnings: row.snapshot_warnings || [],
          acceptedAt: row.accepted_at,
          acceptedBy: row.accepted_by,
          createdAt: row.snapshot_created_at,
          createdBy: row.snapshot_created_by,
          experimentRecords: [],
        };
        snapshots.set(row.data_snapshot_id, snapshot);
      }
      if (row.active_record) snapshot.experimentRecords[row.record_index] = row.active_record;
      experimentIdentities.push({
        id: row.identity_id,
        labId: row.identity_lab_id,
        projectId: row.identity_project_id,
        canonicalLabel: row.canonical_label,
        normalizedLabel: row.normalized_label,
        aliases: row.aliases || [],
        createdAt: row.identity_created_at,
        updatedAt: row.identity_updated_at,
        createdBy: row.identity_created_by,
        updatedBy: row.identity_updated_by,
      });
      experimentSnapshotHeads.push({
        id: row.head_id,
        labId: row.head_lab_id,
        projectId: row.head_project_id,
        experimentId: row.experiment_id,
        dataSnapshotId: row.data_snapshot_id,
        recordIndex: Number(row.record_index),
        updatedAt: row.head_updated_at,
        updatedBy: row.head_updated_by,
      });
    }
    return {
      dataSnapshots: [...snapshots.values()],
      experimentIdentities,
      experimentSnapshotHeads,
    };
  }

  async listDataSnapshotSummaries(projectId: string, experimentIds: string[] | null) {
    if (experimentIds?.length === 0) return [];
    if (experimentIds === null) {
      const result = await this.database.rawPool.query<{
        id: string;
        data_plan_id: string | null;
        analysis_plan_revision_id: string | null;
        analysis_run_id: string | null;
        analysis_result_id: string | null;
        schema_version: string;
        status: string;
        output_shape: string;
        content_hash: string;
        dependency_hash: string;
        summary: Record<string, unknown>;
        warnings: unknown[];
        accepted_at: string;
        accepted_by: string;
        created_at: string;
        authorized_experiment_count: number;
      }>(
        `select
           snapshot.id,
           snapshot.data_plan_id,
           snapshot.analysis_plan_revision_id,
           snapshot.analysis_run_id,
           snapshot.analysis_result_id,
           snapshot.schema_version,
           snapshot.status,
           snapshot.output_shape,
           snapshot.content_hash,
           snapshot.dependency_hash,
           snapshot.summary,
           snapshot.warnings,
           snapshot.accepted_at,
           snapshot.accepted_by,
           snapshot.created_at,
           jsonb_array_length(snapshot.experiment_records)::int as authorized_experiment_count
         from data_snapshots snapshot
         where snapshot.project_id = $1
         order by snapshot.created_at desc, snapshot.id`,
        [projectId],
      );
      return result.rows;
    }
    const result = await this.database.rawPool.query<{
      id: string;
      data_plan_id: string | null;
      analysis_plan_revision_id: string | null;
      analysis_run_id: string | null;
      analysis_result_id: string | null;
      schema_version: string;
      status: string;
      output_shape: string;
      content_hash: string;
      dependency_hash: string;
      summary: Record<string, unknown>;
      warnings: unknown[];
      accepted_at: string;
      accepted_by: string;
      created_at: string;
      authorized_experiment_count: number;
    }>(
      `select
         snapshot.id,
         snapshot.data_plan_id,
         snapshot.analysis_plan_revision_id,
         snapshot.analysis_run_id,
         snapshot.analysis_result_id,
         snapshot.schema_version,
         snapshot.status,
         snapshot.output_shape,
         snapshot.content_hash,
         snapshot.dependency_hash,
         snapshot.summary,
         snapshot.warnings,
         snapshot.accepted_at,
         snapshot.accepted_by,
         snapshot.created_at,
         count(distinct head.experiment_id)::int as authorized_experiment_count
       from data_snapshots snapshot
       join experiment_snapshot_heads head
         on head.data_snapshot_id = snapshot.id
        and head.project_id = snapshot.project_id
       where snapshot.project_id = $1
         and head.experiment_id = any($2::text[])
       group by snapshot.id
       order by snapshot.created_at desc, snapshot.id`,
      [projectId, experimentIds],
    );
    return result.rows;
  }

  listDataPlans(projectId: string) {
    return this.database.db.select().from(dataPlans)
      .where(eq(dataPlans.projectId, projectId))
      .orderBy(desc(dataPlans.createdAt), asc(dataPlans.id));
  }

  listAnnotations(projectId: string, userId: string, experimentIds: string[] | null) {
    if (experimentIds?.length === 0) return Promise.resolve([]);
    return this.database.db.select().from(experimentAnnotations).where(and(
      eq(experimentAnnotations.projectId, projectId),
      eq(experimentAnnotations.userId, userId),
      ...(experimentIds ? [inArray(experimentAnnotations.experimentId, experimentIds)] : []),
    )).orderBy(desc(experimentAnnotations.updatedAt));
  }

  listCustomColumns(projectId: string, experimentIds: string[] | null) {
    if (experimentIds === null) {
      return this.database.db.select().from(experimentCustomColumns)
        .where(eq(experimentCustomColumns.projectId, projectId))
        .orderBy(asc(experimentCustomColumns.createdAt), asc(experimentCustomColumns.id));
    }
    if (!experimentIds.length) return Promise.resolve([]);
    return this.database.db.selectDistinct({ column: experimentCustomColumns })
      .from(experimentCustomColumns)
      .innerJoin(experimentCustomValues, and(
        eq(experimentCustomValues.customColumnId, experimentCustomColumns.id),
        eq(experimentCustomValues.projectId, projectId),
        inArray(experimentCustomValues.experimentId, experimentIds),
      ))
      .where(eq(experimentCustomColumns.projectId, projectId))
      .orderBy(asc(experimentCustomColumns.createdAt), asc(experimentCustomColumns.id))
      .then((rows) => rows.map((row) => row.column));
  }

  listCustomValues(projectId: string, experimentIds: string[] | null) {
    if (experimentIds?.length === 0) return Promise.resolve([]);
    return this.database.db.select().from(experimentCustomValues).where(and(
      eq(experimentCustomValues.projectId, projectId),
      ...(experimentIds ? [inArray(experimentCustomValues.experimentId, experimentIds)] : []),
    ));
  }

  findCustomColumn(projectId: string, columnId: string) {
    return this.database.db.query.experimentCustomColumns.findFirst({
      where: and(
        eq(experimentCustomColumns.projectId, projectId),
        eq(experimentCustomColumns.id, columnId),
      ),
    });
  }

  async createCustomColumn(input: { labId: string; projectId: string; label: string; actorUserId: string }) {
    const now = new Date().toISOString();
    const [row] = await this.database.db.insert(experimentCustomColumns).values({
      id: makeId("experiment_custom_column"),
      labId: input.labId,
      projectId: input.projectId,
      schemaVersion: "labrat.experimentCustomColumn.v1",
      label: input.label,
      version: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: input.actorUserId,
      updatedBy: input.actorUserId,
    }).returning();
    return row;
  }

  async updateCustomColumn(input: {
    projectId: string;
    columnId: string;
    expectedVersion: number;
    label: string;
    actorUserId: string;
  }) {
    const [row] = await this.database.db.update(experimentCustomColumns).set({
      label: input.label,
      version: sql`${experimentCustomColumns.version} + 1`,
      updatedAt: new Date().toISOString(),
      updatedBy: input.actorUserId,
    }).where(and(
      eq(experimentCustomColumns.projectId, input.projectId),
      eq(experimentCustomColumns.id, input.columnId),
      eq(experimentCustomColumns.version, input.expectedVersion),
    )).returning();
    return row;
  }

  async deleteCustomColumn(projectId: string, columnId: string) {
    const rows = await this.database.db.delete(experimentCustomColumns).where(and(
      eq(experimentCustomColumns.projectId, projectId),
      eq(experimentCustomColumns.id, columnId),
    )).returning({ id: experimentCustomColumns.id });
    return rows.length > 0;
  }

  async saveCustomValue(input: {
    labId: string;
    projectId: string;
    columnId: string;
    experimentId: string;
    value: string;
    expectedVersion: number;
    actorUserId: string;
  }) {
    const now = new Date().toISOString();
    if (input.expectedVersion === 0) {
      const [created] = await this.database.db.insert(experimentCustomValues).values({
        id: makeId("experiment_custom_value"),
        labId: input.labId,
        projectId: input.projectId,
        customColumnId: input.columnId,
        experimentId: input.experimentId,
        schemaVersion: "labrat.experimentCustomValue.v1",
        value: input.value,
        version: 1,
        createdAt: now,
        updatedAt: now,
        createdBy: input.actorUserId,
        updatedBy: input.actorUserId,
      }).onConflictDoNothing({
        target: [
          experimentCustomValues.projectId,
          experimentCustomValues.customColumnId,
          experimentCustomValues.experimentId,
        ],
      }).returning();
      return created;
    }
    const [updated] = await this.database.db.update(experimentCustomValues).set({
      value: input.value,
      version: sql`${experimentCustomValues.version} + 1`,
      updatedAt: now,
      updatedBy: input.actorUserId,
    }).where(and(
      eq(experimentCustomValues.projectId, input.projectId),
      eq(experimentCustomValues.customColumnId, input.columnId),
      eq(experimentCustomValues.experimentId, input.experimentId),
      eq(experimentCustomValues.version, input.expectedVersion),
    )).returning();
    return updated;
  }

  async saveAnnotation(input: {
    labId: string;
    projectId: string;
    userId: string;
    experimentId: string;
    note: string;
    color: string;
  }) {
    const now = new Date().toISOString();
    const [row] = await this.database.db.insert(experimentAnnotations).values({
      id: makeId("experiment_annotation"),
      labId: input.labId,
      projectId: input.projectId,
      userId: input.userId,
      experimentId: input.experimentId,
      schemaVersion: "labrat.experimentAnnotation.v1",
      note: input.note,
      color: input.color,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [
        experimentAnnotations.projectId,
        experimentAnnotations.userId,
        experimentAnnotations.experimentId,
      ],
      set: { note: input.note, color: input.color, updatedAt: now },
    }).returning();
    return row;
  }

  async deleteAnnotation(projectId: string, userId: string, experimentId: string) {
    const rows = await this.database.db.delete(experimentAnnotations).where(and(
      eq(experimentAnnotations.projectId, projectId),
      eq(experimentAnnotations.userId, userId),
      eq(experimentAnnotations.experimentId, experimentId),
    )).returning({ id: experimentAnnotations.id });
    return rows.length > 0;
  }

  findBrowserConfig(projectId: string) {
    return this.database.db.query.projectBrowserConfigs.findFirst({
      where: eq(projectBrowserConfigs.projectId, projectId),
    });
  }

  async saveBrowserConfig(input: {
    labId: string;
    projectId: string;
    payload: Record<string, unknown>;
    expectedVersion: number;
    actorUserId: string;
  }) {
    const now = new Date().toISOString();
    if (input.expectedVersion === 0) {
      const [created] = await this.database.db.insert(projectBrowserConfigs).values({
        id: makeId("project_browser_config"),
        labId: input.labId,
        projectId: input.projectId,
        schemaVersion: "labrat.projectBrowserConfig.v1",
        payload: input.payload,
        version: 1,
        createdAt: now,
        updatedAt: now,
        updatedBy: input.actorUserId,
      }).onConflictDoNothing({ target: projectBrowserConfigs.projectId }).returning();
      return created;
    }
    const [updated] = await this.database.db.update(projectBrowserConfigs).set({
      payload: input.payload,
      version: sql`${projectBrowserConfigs.version} + 1`,
      updatedAt: now,
      updatedBy: input.actorUserId,
    }).where(and(
      eq(projectBrowserConfigs.projectId, input.projectId),
      eq(projectBrowserConfigs.version, input.expectedVersion),
    )).returning();
    return updated;
  }

  listBrowserViews(projectId: string, ownerUserId: string) {
    return this.database.db.select().from(browserViews).where(and(
      eq(browserViews.projectId, projectId),
      eq(browserViews.ownerUserId, ownerUserId),
    )).orderBy(desc(browserViews.updatedAt), asc(browserViews.id));
  }

  findBrowserView(projectId: string, ownerUserId: string, viewId: string) {
    return this.database.db.query.browserViews.findFirst({
      where: and(
        eq(browserViews.id, viewId),
        eq(browserViews.projectId, projectId),
        eq(browserViews.ownerUserId, ownerUserId),
      ),
    });
  }

  async createBrowserView(input: {
    labId: string;
    projectId: string;
    ownerUserId: string;
    name: string;
    payload: Record<string, unknown>;
    isDefault: boolean;
  }) {
    return this.database.db.transaction(async (tx) => {
      const now = new Date().toISOString();
      if (input.isDefault) {
        await tx.update(browserViews).set({ isDefault: false, updatedAt: now }).where(and(
          eq(browserViews.projectId, input.projectId),
          eq(browserViews.ownerUserId, input.ownerUserId),
          eq(browserViews.isDefault, true),
        ));
      }
      const [row] = await tx.insert(browserViews).values({
        id: makeId("browser_view"),
        labId: input.labId,
        projectId: input.projectId,
        ownerUserId: input.ownerUserId,
        schemaVersion: "labrat.browserView.v1",
        name: input.name,
        payload: input.payload,
        isDefault: input.isDefault,
        createdAt: now,
        updatedAt: now,
      }).returning();
      return row;
    });
  }

  async updateBrowserView(input: {
    projectId: string;
    ownerUserId: string;
    viewId: string;
    name?: string;
    payload?: Record<string, unknown>;
    isDefault?: boolean;
  }) {
    return this.database.db.transaction(async (tx) => {
      const now = new Date().toISOString();
      if (input.isDefault) {
        await tx.update(browserViews).set({ isDefault: false, updatedAt: now }).where(and(
          eq(browserViews.projectId, input.projectId),
          eq(browserViews.ownerUserId, input.ownerUserId),
          eq(browserViews.isDefault, true),
        ));
      }
      const [row] = await tx.update(browserViews).set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.payload !== undefined ? { payload: input.payload } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
        updatedAt: now,
      }).where(and(
        eq(browserViews.id, input.viewId),
        eq(browserViews.projectId, input.projectId),
        eq(browserViews.ownerUserId, input.ownerUserId),
      )).returning();
      return row;
    });
  }

  async deleteBrowserView(projectId: string, ownerUserId: string, viewId: string) {
    const rows = await this.database.db.delete(browserViews).where(and(
      eq(browserViews.id, viewId),
      eq(browserViews.projectId, projectId),
      eq(browserViews.ownerUserId, ownerUserId),
    )).returning({ id: browserViews.id });
    return rows.length > 0;
  }
}
