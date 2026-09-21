import { Pool } from "pg";
import { describe, expect, test } from "vitest";
import { hashPassword } from "../../saas/passwords.js";
import { createV1Application } from "../bootstrap.js";
import { applyTestMigrations, withTestSchema } from "../testing/postgres-test-database.js";

const url = process.env.LABRAT_TEST_DATABASE_URL;
const password = "ManualRowTest123!";
const cookieFrom = (response: { headers: Record<string, unknown> }) => String(response.headers["set-cookie"] || "").split(";")[0]!;

describe.skipIf(!url)("manually logged experiments PostgreSQL", () => {
  test("create, document, rename, conflict, permission and delete keep snapshots untouched", async () => {
    await withTestSchema(url!, async ({ databaseUrl }) => {
      await applyTestMigrations(databaseUrl);
      const pool = new Pool({ connectionString: databaseUrl });
      await pool.query(`insert into users (id, username, display_name, password_hash, is_super_admin, created_at, updated_at)
        values ('platform','platform','Platform',$1,true,now(),now())`, [hashPassword(password)]);
      process.env.NODE_ENV = "test";
      process.env.LABRAT_AI_PROVIDER = "anthropic";
      process.env.DATABASE_URL = databaseUrl;
      const app = await createV1Application({ logger: false });
      let sequence = 0;
      const send = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, cookie: string, body?: object) => app.inject({
        method, url: "/api/v1" + path, headers: { cookie }, remoteAddress: "192.0.2." + (++sequence),
        ...(body ? { payload: body } : {}),
      });
      try {
        const platform = cookieFrom(await send("POST", "/auth/login", "", { username: "platform", password }));
        const ownerInvite = (await send("POST", "/admin/invitations", platform, {})).json();
        const ownerResponse = await send("POST", "/auth/register", "", {
          invitationCode: ownerInvite.invitationCode, username: "owner", displayName: "Owner", password, labName: "Lab One",
        });
        expect(ownerResponse.statusCode, ownerResponse.body).toBe(201);
        const owner = cookieFrom(ownerResponse);
        const labId = ownerResponse.json().lab.id;
        const projectId = (await send("POST", "/projects", owner, { labId, name: "Project One" })).json().project.id;

        const memberInvite = (await send("POST", `/labs/${labId}/invitations`, owner, {})).json();
        const memberResponse = await send("POST", "/auth/register", "", {
          invitationCode: memberInvite.invitationCode, username: "viewer", displayName: "Viewer", password,
        });
        const viewer = cookieFrom(memberResponse);
        const viewerId = memberResponse.json().auth.user.id;
        expect((await send("PUT", `/projects/${projectId}/member-access/${viewerId}`, owner, { preset: "view", expectedGrantId: null })).statusCode).toBe(200);

        // View access can read manual rows but cannot log one.
        expect((await send("POST", `/projects/${projectId}/experiments`, viewer, { label: "Blocked" })).statusCode).toBe(403);

        const created = await send("POST", `/projects/${projectId}/experiments`, owner, { label: "Pilot run", note: "No workbook yet" });
        expect(created.statusCode, created.body).toBe(201);
        const manual = created.json().manualExperiment;
        expect(manual).toMatchObject({ label: "Pilot run", note: "No workbook yet", version: 1, createdByName: "Owner" });

        expect((await send("POST", `/projects/${projectId}/experiments`, owner, { label: "pilot-RUN" })).json().error.code).toBe("experiment_label_conflict");
        expect((await send("POST", `/projects/${projectId}/experiments`, owner, { label: "—" })).statusCode).toBe(400);

        const columnId = (await send("POST", `/projects/${projectId}/experiment-custom-columns`, owner, { label: "Decision" })).json().customColumn.id;
        const saved = await send("PUT", `/projects/${projectId}/experiment-custom-columns/${columnId}/experiments/${manual.experimentId}`, owner, { value: "Plan repeat", expectedVersion: 0 });
        expect(saved.statusCode, saved.body).toBe(200);

        const browser = (await send("GET", `/projects/${projectId}/experiment-browser`, viewer)).json();
        expect(browser.totalCount).toBe(1);
        expect(browser.rows[0]).toMatchObject({
          experimentId: manual.experimentId, label: "Pilot run", origin: "manual",
          dataSnapshotId: null, headId: null, seriesInventory: [], sourceRanges: [],
        });
        expect(browser.rows[0].cells[`custom:${columnId}`].value).toBe("Plan repeat");

        // Seed one accepted experiment so the Browser has an accepted-data column to type under.
        const ownerId = ownerResponse.json().auth.user.id;
        const record = {
          experimentId: "identity_accepted", label: "Accepted 1", aliases: [], series: [], warnings: [], sourceRefs: [],
          fields: [{ fieldKey: "temperature", displayName: "Temperature", role: "condition", value: 250, formattedValue: "250", valueType: "number", unit: "degC", confidence: 0.9, warnings: [], sourceRefs: [] }],
        };
        await pool.query(`insert into experiment_identities (id, lab_id, project_id, canonical_label, normalized_label, aliases, created_by)
          values ('identity_accepted', $1, $2, 'Accepted 1', 'accepted1', '[]', $3)`, [labId, projectId, ownerId]);
        await pool.query(`insert into data_snapshots (id, lab_id, project_id, content_hash, dependency_hash, experiment_records, accepted_at, accepted_by, created_by)
          values ('snapshot_1', $1, $2, 'content', 'dependency', $3::jsonb, now(), $4, $4)`, [labId, projectId, JSON.stringify([record]), ownerId]);
        await pool.query(`insert into experiment_snapshot_heads (id, lab_id, project_id, experiment_id, data_snapshot_id, record_index, updated_by)
          values ('head_1', $1, $2, 'identity_accepted', 'snapshot_1', 0, $3)`, [labId, projectId, ownerId]);
        const snapshotBefore = (await pool.query(`select experiment_records from data_snapshots where id = 'snapshot_1'`)).rows[0];

        const temperature = "field:temperature:degC:number";
        const valuePath = `/projects/${projectId}/experiments/${manual.experimentId}/manual-values`;
        expect((await send("PUT", valuePath, viewer, { columnId: temperature, value: "275" })).statusCode).toBe(403);
        const typed = await send("PUT", valuePath, owner, { columnId: temperature, value: "275", expectedVersion: 0 });
        expect(typed.statusCode, typed.body).toBe(200);
        expect(typed.json().manualValue).toMatchObject({ columnId: temperature, value: "275", version: 1 });
        expect((await send("PUT", valuePath, owner, { columnId: temperature, value: "280", expectedVersion: 0 })).json().error.code).toBe("manual_experiment_value_conflict");
        expect((await send("PUT", valuePath, owner, { columnId: temperature, value: "280", expectedVersion: 1 })).json().manualValue.version).toBe(2);
        expect((await send("PUT", valuePath, owner, { columnId: "field:unknown", value: "x" })).json().error.code).toBe("experiment_column_not_found");
        expect((await send("PUT", `/projects/${projectId}/experiments/identity_accepted/manual-values`, owner, { columnId: temperature, value: "1" })).json().error.code).toBe("experiment_not_manual");

        const typedBrowser = (await send("GET", `/projects/${projectId}/experiment-browser`, viewer)).json();
        const typedRow = typedBrowser.rows.find((row: { experimentId: string }) => row.experimentId === manual.experimentId);
        expect(typedRow.cells[temperature]).toMatchObject({ value: "280", isManual: true, version: 2 });
        const acceptedRow = typedBrowser.rows.find((row: { experimentId: string }) => row.experimentId === "identity_accepted");
        expect(acceptedRow.cells[temperature]).toMatchObject({ value: 250 });
        expect(acceptedRow.cells[temperature].isManual).toBeUndefined();
        expect((await pool.query(`select experiment_records from data_snapshots where id = 'snapshot_1'`)).rows[0]).toEqual(snapshotBefore);

        const second = (await send("POST", `/projects/${projectId}/experiments`, owner, { label: "Second run" })).json().manualExperiment;
        const stale = await send("PATCH", `/projects/${projectId}/experiments/${manual.experimentId}`, owner, { label: "Pilot run A", expectedVersion: 7 });
        expect(stale.json().error.code).toBe("manual_experiment_conflict");
        const clash = await send("PATCH", `/projects/${projectId}/experiments/${manual.experimentId}`, owner, { label: "Second Run", expectedVersion: 1 });
        expect(clash.json().error.code).toBe("experiment_label_conflict");
        const renamed = await send("PATCH", `/projects/${projectId}/experiments/${manual.experimentId}`, owner, { label: "Pilot run A", note: "", expectedVersion: 1 });
        expect(renamed.statusCode, renamed.body).toBe(200);
        expect(renamed.json().manualExperiment).toMatchObject({ label: "Pilot run A", note: "", version: 2 });

        expect((await send("DELETE", `/projects/${projectId}/experiments/${manual.experimentId}`, viewer)).statusCode).toBe(403);
        expect((await send("DELETE", `/projects/${projectId}/experiments/${manual.experimentId}`, owner)).statusCode).toBe(200);
        expect((await send("DELETE", `/projects/${projectId}/experiments/${manual.experimentId}`, owner)).statusCode).toBe(404);
        const remaining = (await send("GET", `/projects/${projectId}/experiment-browser`, owner)).json();
        expect(remaining.rows.map((row: { experimentId: string }) => row.experimentId)).toEqual(["identity_accepted", second.experimentId]);

        const leftovers = (await pool.query(`select
          (select count(*)::int from experiment_custom_values where experiment_id = $1) as values,
          (select count(*)::int from manual_experiment_values where experiment_id = $1) as typed,
          (select count(*)::int from experiment_identities where id = $1) as identities,
          (select count(*)::int from data_snapshots) as snapshots,
          (select count(*)::int from experiment_snapshot_heads) as heads`, [manual.experimentId])).rows[0];
        expect(leftovers).toEqual({ values: 0, typed: 0, identities: 0, snapshots: 1, heads: 1 });
      } finally {
        await app.close();
        await pool.end();
      }
    });
  });
});
