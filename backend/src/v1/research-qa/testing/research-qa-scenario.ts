import { Pool } from "pg";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { researchDocuments, researchWorkbook, acceptedRecord } from "../../../research/testing/researchQaCorpus.js";
import { scanWorkbook } from "../../../import/services/workbookScanner.js";
import { buildSourceDocumentIndex } from "../../../saas/sourceDocuments.js";
import { sha256Hex } from "../../../saas/ids.js";
import { EvidenceRepository } from "../../evidence/evidence.repository.js";
import { IdentityService } from "../../identity/identity.service.js";
import { DocumentsService } from "../documents.service.js";

export const researchProjectId = "project_analysis";
export async function researchLogin(app: NestFastifyApplication, username = "owner") {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: "LabRatTest123!" } });
  if (response.statusCode !== 200) throw new Error(`Synthetic login failed (${response.statusCode}).`);
  const cookie = String(response.headers["set-cookie"]).split(";")[0]!;
  const auth = await app.get(IdentityService).authenticateCookieHeader(cookie);
  if (!auth) throw new Error("Synthetic session missing.");
  return { cookie, auth };
}

export async function researchUpload(app: NestFastifyApplication, cookie: string, name: string, buffer: Buffer) {
  const boundary = "research-fixture-boundary";
  const response = await app.inject({ method: "POST", url: `/api/v1/projects/${researchProjectId}/files`,
    headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),buffer,Buffer.from(`\r\n--${boundary}--\r\n`)]) });
  if (response.statusCode !== 201) throw new Error(`Synthetic upload failed: ${response.body}`);
  if (response.json().fileObject.originalName !== name) throw new Error("Synthetic upload did not preserve the original filename.");
  return response.json().fileObject;
}

export async function seedResearchCorpus(app: NestFastifyApplication, databaseUrl: string) {
  const owner = await researchLogin(app);
  const pool = new Pool({ connectionString: databaseUrl });
  const sources: Record<string, any> = {};
  const documents = app.get(DocumentsService);
  try {
    await pool.query(`update projects set metadata='{"projectProfile":{"researchGoal":"Study catalyst stability","materials":"catalyst K","methods":"dry samples"}}' where id=$1`, [researchProjectId]);
    await pool.query(`update project_access_grants set capabilities='["read"]' where user_id='user_reviewer'`);
    for (const fixture of researchDocuments()) {
      const file = await researchUpload(app, owner.cookie, fixture.name, fixture.buffer);
      const registered = await documents.register(owner.auth, researchProjectId, file.id);
      const deadline = Date.now() + 60_000;
      let version;
      do {
        version = await documents.version(owner.auth, researchProjectId, registered.version.id);
        if (["ready", "partial", "failed"].includes(version.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 30));
      } while (Date.now() < deadline);
      if (!version || !["ready", "partial"].includes(version.status)) throw new Error(`Synthetic ${fixture.key} parse failed: ${version?.failureCode}`);
      sources[fixture.key] = { document: registered.document, version, file };
    }
    for (const format of ["xlsx", "xls"]) {
      const buffer = researchWorkbook(format);
      const name = `research.${format}`;
      const file = await researchUpload(app, owner.cookie, name, buffer);
      const input = (buildSourceDocumentIndex as any)({ project: { id: researchProjectId, labId: "lab_analysis" }, fileObject: file,
        importRun: { id: null }, actorUserId: owner.auth.user.id,
        scanResult: scanWorkbook({ buffer, filename: name, fileId: file.id, sizeBytes: buffer.length }) });
      input.importRunId = null;
      sources[format === "xlsx" ? "workbook" : "workbook_xls"] = await app.get(EvidenceRepository).replaceSourceDocumentIndex(input);
    }
    // Independent synthetic accepted data, deliberately different from raw B2.
    for (const [id, name] of [["experiment_17", "Exp17"], ["experiment_17b", "Exp17B"]]) {
      await pool.query(`insert into experiment_identities(id,lab_id,project_id,canonical_label,normalized_label,aliases,created_at,updated_at,created_by)
        values($1,'lab_analysis',$2,$3,lower($3),'["Batch-A"]',now(),now(),'user_owner')`, [id, researchProjectId, name]);
      const record = acceptedRecord(); record.experimentId = id!; record.sourceAlias = name!;
      const snapshotId = `snapshot_${id}`;
      await pool.query(`insert into data_snapshots(id,lab_id,project_id,status,content_hash,dependency_hash,experiment_records,accepted_at,accepted_by,created_at,created_by)
        values($1,'lab_analysis',$2,'accepted',$3,'synthetic_dependency',$4,now(),'user_reviewer',now(),'user_owner')`,
        [snapshotId, researchProjectId, sha256Hex(JSON.stringify(record)), JSON.stringify([record])]);
      await pool.query(`insert into experiment_snapshot_heads(id,lab_id,project_id,experiment_id,data_snapshot_id,record_index,updated_at,updated_by)
        values($1,'lab_analysis',$2,$3,$4,0,now(),'user_owner')`, [`head_${id}`, researchProjectId, id, snapshotId]);
    }
    await pool.query(`update workbook_review_regions set linked_experiment_id='experiment_17' where id='review_region_analysis'`);
    await pool.query(`insert into source_index_blobs(id,lab_id,project_id,source_document_id,blob_kind,payload,checksum_sha256,created_at)
      values('blob_carbon','lab_analysis',$1,'source_analysis','excel_cell_grid_v1',$2,'synthetic_carbon',now())`,
      [researchProjectId, JSON.stringify({ sheets: [{ name: "Carbon", cellGrid: { cells: [{ address: "A1", row: 1, col: 1, rawValue: "Carbon", formattedValue: "Carbon", type: "string" }] } }] })]);
    return { ...owner, sources };
  } finally { await pool.end(); }
}
