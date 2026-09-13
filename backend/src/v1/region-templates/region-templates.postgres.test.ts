import { Pool } from "pg";
import { describe, expect, test, vi } from "vitest";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { V1_MODEL_PROVIDER } from "../platform/model/model-provider.js";
import { V1_ANALYSIS_EXECUTOR } from "../platform/analysis/analysis-executor.js";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { hashPassword } from "../../saas/passwords.js";
import { createV1Application } from "../bootstrap.js";
import { applyTestMigrations, withTestSchema } from "../testing/postgres-test-database.js";

const url = process.env.LABRAT_TEST_DATABASE_URL;
const interpretation = {
  semanticType: "component_distribution", experimentAxis: "region", headerRow: 31,
  experimentLabel: "Exp31", fields: [], inclusion: { startRow: 32, endRow: 32 },
  series: [{ seriesKey: "carbon_distribution", label: "Overall carbon distribution",
    orientation: "header_row_categories", xHeaderRange: "Q31:U31", yValueRange: "Q32:U32",
    xSemanticKey: "carbon_number", ySemanticKey: "carbon_distribution", xValueType: "number",
    yUnit: "% of feed carbon", yNumericScale: "percent_points" }],
};

export async function seedLinkedWorkbooks(pool: Pool, ownerRole = "lab_owner") {
  for (const role of ["owner", "reader", "editor", "approver", "platform", "outsider"]) {
    await pool.query(`insert into users (id,username,display_name,password_hash,is_super_admin,created_at,updated_at)
      values ($1,$1,$1,$2,$3,now(),now())`, [role, hashPassword("IntegrationTest123!"), role === "platform"]);
  }
  await pool.query(`insert into labs (id,name,slug,created_at,updated_at) values ('lab','Lab','lab',now(),now());
    insert into projects (id,lab_id,name,created_by,created_at,updated_at) values ('project','lab','Project','owner',now(),now());`);
  for (const role of ["owner", "reader", "editor", "approver"]) {
    await pool.query(`insert into lab_memberships (id,lab_id,user_id,role,created_at,updated_at)
      values ($1,'lab',$1,$2,now(),now())`, [role, role === "owner" ? ownerRole : "lab_member"]);
  }
  for (const n of [31,32,33,34]) {
    await pool.query(`insert into experiment_identities (id,lab_id,project_id,canonical_label,normalized_label,created_at,updated_at,created_by)
      values ($1,'lab','project',$2,$3,now(),now(),'owner')`, [`exp${n}`, `Exp${n}`, `exp${n}`]);
    await pool.query(`insert into file_objects (id,lab_id,project_id,original_name,size_bytes,checksum_sha256,storage_key,created_at,created_by)
      values ($1,'lab','project',$2,123,$3,$4,now(),'owner')`, [`file${n}`,`Calculation Exp${n}.xlsx`,`file-hash-${n}`,`fixtures/Exp${n}.xlsx`]);
    const cell = (address: string, rawValue: string | number, formula: string | null = null) => ({ address,rawValue,formattedValue:String(rawValue),formula,type:formula ? "formula" : typeof rawValue });
    const cells = [cell("A1","Filename"), cell("A2",`Exp${n}`), cell("A11",22.03), cell("A12","Total C atoms"),
      cell("B12",1.57,"A11/28.05*2"), cell("E14","Yield"), cell("P28","Total C (liq)"), cell("P31","Overall tots")];
    ["Q","R","S","T","U"].forEach((col,i) => {
      const gas = ["F","G","H","I","J"][i];
      cells.push(cell(`${gas}6`,0.001*(i+1)),cell(`${gas}14`,0.1*(i+1),`${gas}6/B12*100`),
        cell(`${col}31`,`C${i+1}`),cell(`${col}32`,0.1*(i+1),`${gas}14`));
    });
    await pool.query(`insert into source_documents (id,lab_id,project_id,file_object_id,metadata)
      values ($1,'lab','project',$2,$3)`, [`doc${n}`,`file${n}`,JSON.stringify({workbookName:`Calculation Exp${n}.xlsx`,sheets:[{name:"Sheet1",usedRange:"A1:U32"}]})]);
    await pool.query(`insert into source_index_blobs (id,lab_id,project_id,source_document_id,blob_kind,payload,checksum_sha256)
      values ($1,'lab','project',$2,'workbook_cell_index',$3,$4)`, [`index${n}`,`doc${n}`,JSON.stringify({sheets:[{name:"Sheet1",cellGrid:{range:"A1:U32",cells}}]}),`index-hash-${n}`]);
  }
  await pool.query(`insert into workbook_review_sessions (id,lab_id,project_id,source_document_id) values ('session31','lab','project','doc31');
    insert into workbook_review_regions (id,lab_id,project_id,workbook_review_session_id,source_document_id,sheet_name,range_ref)
      values ('region31','lab','project','session31','doc31','Sheet1','P31:U32');`);
  await pool.query(`insert into region_understanding_revisions
    (id,lab_id,project_id,workbook_review_session_id,source_document_id,region_id,revision_number,interpretation,source_content_hash,dependency_hash,validation)
    values ('revision31','lab','project','session31','doc31','region31',1,$1,'source-hash-31','dependency-hash-31','{"blockers":[]}')`, [JSON.stringify(interpretation)]);
  await pool.query(`update workbook_review_regions set current_revision_id='revision31',accepted_revision_id='revision31',review_status='accepted',accepted_at=now() where id='region31'`);
}

describe.skipIf(!url)("Claude features on Nest v1 / PostgreSQL", () => {
  test("templates, receipts, independent confirmations, linked comparison and permission boundaries", async () => {
    await withTestSchema(url!, async ({databaseUrl}) => {
      await applyTestMigrations(databaseUrl);
      const pool = new Pool({connectionString:databaseUrl});
      let app: NestFastifyApplication | undefined;
      try {
        await seedLinkedWorkbooks(pool);
        for (const [role, capabilities] of [["reader",["read"]],["editor",["read","propose"]],["approver",["read","propose","approve"]]] as const) {
          await pool.query(`insert into project_access_grants (id,lab_id,project_id,user_id,scope,capabilities,status,created_at,updated_at)
            values ($1,'lab','project',$1,'all_experiments',$2,'active',now(),now())`, [role,JSON.stringify(capabilities)]);
        }
        process.env.NODE_ENV="test"; process.env.LABRAT_AI_PROVIDER="anthropic"; process.env.DATABASE_URL=databaseUrl;
        app=await createV1Application({logger:false});
        const provider = app.get(V1_MODEL_PROVIDER);
        const modelCalls = Object.keys(provider).filter((key)=>key!=="publicConfig" && typeof provider[key]==="function")
          .map((key)=>vi.spyOn(provider,key).mockImplementation(()=>{throw new Error("Unexpected provider call");}));
        const python = vi.spyOn(app.get(V1_ANALYSIS_EXECUTOR),"executeAcceptedRun").mockImplementation(()=>{throw new Error("Unexpected Python execution");});
        const cookies: Record<string,string>={};
        for (const role of ["owner","reader","editor","approver","platform","outsider"]) {
          const login=await app.inject({method:"POST",url:"/api/v1/auth/login",payload:{username:role,password:"IntegrationTest123!"}});
          expect(login.statusCode,login.body).toBe(200);
          cookies[role]=String(login.headers["set-cookie"]).split(";")[0]!;
        }
        const call = (method: "GET"|"POST", path: string, role="owner", payload?: any, key?: string) => app!.inject({
          method,url:`/api/v1/${path}`,headers:{cookie:cookies[role],...(key?{"idempotency-key":key}:{})},...(payload ? {payload}:{}),
        });
        const createBody={name:"Carbon distribution",regionId:"region31"};
        for (const role of ["reader","editor","platform","outsider"]) {
          expect([403,404]).toContain((await call("POST","projects/project/region-extraction-templates",role,createBody)).statusCode);
        }
        const created=await call("POST","projects/project/region-extraction-templates","approver",createBody);
        expect(created.statusCode,created.body).toBe(201);
        const template=created.json().regionExtractionTemplate;
        const version=created.json().versions[0];
        expect(created.json().sourceRegionLink.linkedExperimentId).toBe("exp31");
        expect((await pool.query("select data_kind,linked_experiment_id from workbook_review_regions where id='region31'")).rows[0])
          .toEqual({data_kind:"Carbon distribution",linked_experiment_id:"exp31"});
        expect((await call("GET","projects/project/region-extraction-templates?limit=1","reader")).json().items[0].id).toBe(template.id);
        expect((await call("GET",`region-extraction-templates/${template.id}`,"outsider")).statusCode).toBe(404);
        const classes=await call("GET","source-documents/doc31/cell-classes?sheetName=Sheet1&range=P31%3AU32","reader");
        expect(classes.statusCode,classes.body).toBe(200);
        const matchPath=`region-extraction-template-versions/${version.id}/matches`;
        const matches=await call("POST",matchPath,"reader",{sourceDocumentIds:["doc32","doc33"]});
        expect(matches.statusCode,matches.body).toBe(200);
        expect(matches.json().matches.map((x:any)=>x.status)).toEqual(["exact","exact"]);
        const applyPath=`region-extraction-template-versions/${version.id}/apply`;
        const input={sourceDocumentIds:["doc32","doc33"]};
        expect((await call("POST",applyPath,"reader",input,"denied")).statusCode).toBe(403);
        expect((await call("POST",applyPath,"editor",input)).statusCode).toBe(400);
        const applied=await Promise.all([call("POST",applyPath,"editor",input,"same"),call("POST",applyPath,"editor",input,"same")]);
        expect(applied.map(x=>x.statusCode),applied.map(x=>x.body).join("\n")).toEqual([200,200]);
        expect(applied[0].json()).toEqual(applied[1].json());
        const rows=applied[0].json().applied;
        expect(rows).toHaveLength(2);
        expect(rows.every((x:any)=>x.created && x.region.reviewStatus==="awaiting_review")).toBe(true);
        expect((await pool.query("select count(*)::int as n from region_template_apply_receipts")).rows[0].n).toBe(1);
        expect((await call("POST",applyPath,"editor",{sourceDocumentIds:["doc34"]},"same")).statusCode).toBe(409);
        const again=await call("POST",applyPath,"editor",input,"different-key");
        expect(again.json().applied.every((x:any)=>!x.created)).toBe(true);

        const item=(row:any)=>({regionId:row.region.id,revisionId:row.revision.id,expectedRegionVersion:row.region.version});
        const confirmPath="projects/project/workbook-review-regions/confirm-batch";
        expect((await call("POST",confirmPath,"editor",{items:[item(rows[0])]})).statusCode).toBe(403);
        expect((await call("POST",confirmPath,"approver",{items:[{regionId:rows[0].region.id}]})).statusCode).toBe(400);
        const mixed=await call("POST",confirmPath,"approver",{items:[item(rows[0]),{...item(rows[1]),revisionId:"revision31",linkedExperimentId:"exp34"}]});
        expect(mixed.statusCode,mixed.body).toBe(200);
        expect(mixed.json()).toMatchObject({confirmedCount:1,rejectedCount:1});
        expect((await pool.query("select linked_experiment_id,accepted_revision_id from workbook_review_regions where id=$1",[rows[1].region.id])).rows[0])
          .toEqual({linked_experiment_id:"exp33",accepted_revision_id:null});
        const racing=await Promise.all([call("POST",confirmPath,"approver",{items:[item(rows[1])]}),call("POST",confirmPath,"approver",{items:[item(rows[1])]})]);
        expect(racing.reduce((n,r)=>n+r.json().confirmedCount,0)).toBe(1);

        // A failure after prefill must roll back all newly created evidence and the receipt.
        await pool.query(`create function reject_apply_audit() returns trigger language plpgsql as $$ begin
          if new.action='workbook_review_region.template_apply' then raise exception 'test rollback'; end if; return new; end $$;
          create trigger reject_apply_audit before insert on audit_events for each row execute function reject_apply_audit();`);
        const rollback=await call("POST",applyPath,"editor",{sourceDocumentIds:["doc34"]},"rollback");
        expect(rollback.statusCode).toBe(500);
        expect((await pool.query("select count(*)::int n from workbook_review_sessions where source_document_id='doc34'")).rows[0].n).toBe(0);
        expect((await pool.query("select count(*)::int n from region_template_apply_receipts where idempotency_key='rollback'")).rows[0].n).toBe(0);
        await pool.query("drop trigger reject_apply_audit on audit_events; drop function reject_apply_audit()");
        expect((await call("POST",applyPath,"editor",{sourceDocumentIds:["doc34"]},"rollback")).statusCode).toBe(200);

        const kinds=await call("GET","projects/project/linked-data-kinds","reader");
        expect(kinds.statusCode,kinds.body).toBe(200);
        expect(kinds.json().dataKinds[0].experimentCount).toBe(3);
        const comparison={dataKind:"Carbon distribution",experimentIds:["exp31","exp32"],dryRun:true};
        const preview=await call("POST","projects/project/linked-data-comparisons","reader",comparison);
        expect(preview.statusCode,preview.body).toBe(200);
        expect(preview.json().comparison.experiments).toHaveLength(2);
        expect((await pool.query("select count(*)::int n from analysis_threads")).rows[0].n).toBe(0);
        await pool.query(`create function reject_comparison_audit() returns trigger language plpgsql as $$ begin
          if new.action='analysis_thread.linked_data_comparison' then raise exception 'test rollback'; end if; return new; end $$;
          create trigger reject_comparison_audit before insert on audit_events for each row execute function reject_comparison_audit();`);
        expect((await call("POST","projects/project/linked-data-comparisons","editor",{...comparison,dryRun:false})).statusCode).toBe(500);
        expect((await pool.query("select count(*)::int n from analysis_threads")).rows[0].n).toBe(0);
        expect((await pool.query("select count(*)::int n from analysis_plan_revisions")).rows[0].n).toBe(0);
        await pool.query("drop trigger reject_comparison_audit on audit_events; drop function reject_comparison_audit()");
        const proposal=await call("POST","projects/project/linked-data-comparisons","editor",{...comparison,dryRun:false});
        expect(proposal.statusCode,proposal.body).toBe(201);
        expect(proposal.json().analysisPlanRevision.sourceSelections).toHaveLength(2);
        expect(proposal.json().analysisPlanRevision.linkedDataComparison.dataKind).toBe("Carbon distribution");
        const savedPlan = (await pool.query("select plan from analysis_plan_revisions where id=$1",[proposal.json().analysisPlanRevision.id])).rows[0].plan;
        expect(savedPlan.linkedDataComparison.dataKind).toBe("Carbon distribution");
        expect(savedPlan.sourceSelections[0].regionUnderstandingRevisionId).toBe("revision31");
        expect((await pool.query("select count(*)::int n from data_snapshots")).rows[0].n).toBe(0);

        const sourceChart={schemaVersion:"labrat.chartSpec.v3",origin:"analysis_result",status:"accepted",chartType:"grouped_bar",
          analysisPlanRevisionId:proposal.json().analysisPlanRevision.id,sourceSelections:savedPlan.sourceSelections,
          experimentSelections:[],traceCatalog:[{traceId:"trace31"},{traceId:"trace32"}]};
        await pool.query(`insert into chart_specs (id,lab_id,project_id,title,chart_type,spec,created_at,updated_at,created_by)
          values ('chart_source','lab','project','Carbon distribution','grouped_bar',$1,now(),now(),'owner')`,[JSON.stringify(sourceChart)]);
        const eligible=await call("GET","chart-specs/chart_source/template-eligibility","reader");
        expect(eligible.json(),eligible.body).toMatchObject({status:"eligible",inputSlots:[{sourceKind:"linked_region"}]});
        const chartTemplate=await call("POST","projects/project/reusable-chart-templates","editor",{name:"Carbon comparison",sourceChartSpecId:"chart_source"});
        expect(chartTemplate.statusCode,chartTemplate.body).toBe(201);
        const chartVersion=chartTemplate.json().versions[0];
        const chartApplied=await call("POST",`reusable-chart-template-versions/${chartVersion.id}/applications`,"editor",{experimentIds:["exp31","exp32"]},"linked-chart");
        expect(chartApplied.statusCode,chartApplied.body).toBe(201);
        expect(chartApplied.json().compatibility.status).toBe("ready");
        expect(chartApplied.json().analysisPlanRevision.templateLineage.frozenRegionRefs).toHaveLength(2);
        expect(chartApplied.json().analysisPlanRevision.templateLineage.linkedDataKind).toBe("Carbon distribution");
        const runId=chartApplied.json().analysisRun.id;
        // A new accepted interpretation must not replace the prepared run's frozen revision.
        await pool.query(`insert into region_understanding_revisions
          (id,lab_id,project_id,workbook_review_session_id,source_document_id,region_id,revision_number,interpretation,source_content_hash,dependency_hash,validation)
          select 'revision31_new',lab_id,project_id,workbook_review_session_id,source_document_id,region_id,2,
            jsonb_set(interpretation,'{series,0,label}','"Updated distribution"'),source_content_hash,dependency_hash,validation
          from region_understanding_revisions where id='revision31';
          update workbook_review_regions set current_revision_id='revision31_new',accepted_revision_id='revision31_new',version=version+1 where id='region31';`);
        const executed=await call("POST",`analysis-runs/${runId}/execute`,"editor",{executionStrategy:"chart_template_v1"});
        expect(executed.statusCode,executed.body).toBe(201);
        expect(executed.json().analysisRun.status,executed.body).toBe("awaiting_result_review");
        const plotted=await call("GET",`analysis-runs/${runId}/result-preview`,"reader");
        expect(plotted.statusCode,plotted.body).toBe(200);
        expect(plotted.json().plotly.data.map((trace:any)=>trace.y)).toEqual([[0.1,0.2,0.30000000000000004,0.4,0.5],[0.1,0.2,0.30000000000000004,0.4,0.5]]);
        const publication=await call("POST",`analysis-runs/${runId}/accept-and-create-chart`,"approver",{
          analysisResultId:executed.json().analysisResult.id,defaultVisibleTraceIds:plotted.json().plotly.data.map((trace:any)=>trace.traceId)},"linked-publish");
        expect(publication.statusCode,publication.body).toBe(201);
        expect(JSON.stringify(publication.json().chartSpec)).toContain("revision31");
        expect(JSON.stringify(publication.json().chartSpec)).not.toContain("revision31_new");
        expect(JSON.stringify(publication.json().chartSpec)).toContain("Q32");
        await pool.query("update workbook_review_sessions set status='deleted' where id='session31'");
        const persisted=await call("GET",`chart-specs/${publication.json().chartSpec.id}`,"reader");
        expect(persisted.json().chartSpec.spec).toEqual(publication.json().chartSpec.spec);
        await pool.query("update workbook_review_sessions set status='needs_user_review' where id='session31'");

        const next=await call("POST",`region-extraction-templates/${template.id}/versions`,"approver",{regionId:"region31"});
        expect(next.statusCode,next.body).toBe(201);
        expect(next.json().sourceRegionLink.linkedExperimentId).toBe("exp31");
        await pool.query("update project_access_grants set status='inactive' where id='editor'");
        expect((await call("POST",applyPath,"editor",input,"same")).statusCode).toBe(404);
        expect((await call("POST",`region-extraction-templates/${template.id}/archive`)).statusCode).toBe(200);
        expect((await call("POST",applyPath,"owner",input,"archived")).statusCode).toBe(409);
        expect((await call("GET","projects/project/region-extraction-templates","reader")).json().items).toHaveLength(0);
        expect((await call("GET","projects/project/region-extraction-templates?includeArchived=true","reader")).json().items).toHaveLength(1);
        expect((await app.inject({method:"GET",url:"/api/projects/project/linked-data-kinds",headers:{cookie:cookies.owner}})).statusCode).toBe(404);
        modelCalls.forEach((spy)=>expect(spy).not.toHaveBeenCalled());
        expect(python).not.toHaveBeenCalled();

        // Browser scalar rows still come only from accepted heads; linked cells are evidence summaries.
        await pool.query(`insert into data_plans(id,lab_id,project_id,dependency_hash,accepted_at,accepted_by,created_by)
          values('browser_plan','lab','project','labels-only',now(),'owner','owner');`);
        await pool.query(`insert into data_snapshots(id,lab_id,project_id,data_plan_id,content_hash,dependency_hash,experiment_records,accepted_at,accepted_by,created_by)
          values('browser_snapshot','lab','project','browser_plan','labels-only','labels-only',$1,now(),'owner','owner')`,
          [JSON.stringify([{experimentId:'exp31',label:'Exp31',fields:[],series:[],sourceRefs:[],warnings:[]}])]);
        await pool.query(`insert into experiment_snapshot_heads(id,lab_id,project_id,experiment_id,data_snapshot_id,record_index,updated_by)
          values('browser_head','lab','project','exp31','browser_snapshot',0,'owner')`);
        const browser=await call('GET','projects/project/experiment-browser','reader');
        expect(browser.statusCode,browser.body).toBe(200);
        expect(browser.json().totalCount).toBe(1);
        expect(browser.json().columns).toEqual(expect.arrayContaining([expect.objectContaining({dataKind:'Carbon distribution'})]));
        const detail=await call('GET','projects/project/experiments/exp31','reader');
        expect(detail.json().linkedRegions).toEqual(expect.arrayContaining([expect.objectContaining({
          regionId:'region31',revisionId:'revision31_new',workbookName:'Calculation Exp31.xlsx',range:'P31:U32',
        })]));
        await pool.query(`insert into lab_memberships(id,lab_id,user_id,role,created_at,updated_at) values('selected','lab','outsider','lab_member',now(),now())`);
        const selected=await call('POST','projects/project/access-grants','owner',{
          subject:{type:'user',id:'outsider'},scope:'selected_experiments',capabilities:['read'],experimentIds:['exp31'],
        });
        expect(selected.statusCode,selected.body).toBe(201);
        const selectedBrowser=await call('GET','projects/project/experiment-browser','outsider');
        expect(selectedBrowser.json().totalCount).toBe(1);
        expect(JSON.stringify(selectedBrowser.json())).not.toContain('Carbon distribution');
        expect((await call('GET','projects/project/experiments/exp31','outsider')).json().linkedRegions).toEqual([]);

        // A provider response cannot write an interpretation after the actor loses access.
        await pool.query("update project_access_grants set status='active' where id='editor'");
        await pool.query(`insert into workbook_review_regions
          (id,lab_id,project_id,workbook_review_session_id,source_document_id,sheet_name,range_ref)
          values ('pending_region','lab','project','session31','doc31','Sheet1','A11:B12')`);
        let started!: () => void;
        let release!: () => void;
        const began = new Promise<void>((resolve) => { started = resolve; });
        const pending = new Promise<void>((resolve) => { release = resolve; });
        (provider.interpretWorkbookRegion as any).mockImplementationOnce(async (input: any) => {
          started(); await pending;
          return {ok:true,interpretation:input.region.deterministicCandidate,summary:["A controlled response for revocation testing.","Cached source values remain unchanged."]};
        });
        const late = call("POST","workbook-review-sessions/session31/regions/pending_region/interpret","editor",{expectedRegionVersion:1}).then((response)=>response);
        await began;
        await pool.query("update project_access_grants set status='inactive' where id='editor'");
        release();
        expect([403,404]).toContain((await late).statusCode);
        expect((await pool.query("select count(*)::int n from region_understanding_revisions where region_id='pending_region'")).rows[0].n).toBe(0);
      } finally { await app?.close(); await pool.end(); }
    });
  },120_000);
});

describe.skipIf(!url)("Independent main / Claude database upgrades", () => {
  for (const baseline of ["empty","main","claude"] as const) test(`${baseline} upgrades preserve evidence and reject changed history`, async () => {
    await withTestSchema(url!,async ({databaseUrl})=>{
      const pool=new Pool({connectionString:databaseUrl});
      const directory=fileURLToPath(new URL("../../../migrations/",import.meta.url));
      const files=(await fs.readdir(directory)).filter((x)=>x.endsWith(".sql")).sort();
      const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
      const run=()=>promisify(execFile)(process.execPath,[fileURLToPath(new URL("../../saas/migrate.js",import.meta.url))],{
        env:{...process.env,NODE_ENV:"test",DATABASE_URL:databaseUrl},timeout:30_000});
      try {
        if (baseline!=="empty") {
          await pool.query("create table labrat_schema_migrations (filename text primary key,checksum text not null,applied_at timestamptz default now())");
          for (const filename of files.filter((x)=>!x.startsWith("029_") && !(baseline==="main"
            ? ["027_region_extraction_templates.sql","028_region_template_applications.sql"]
            : ["027_authorization_v1.sql","028_invitation_onboarding.sql"]).includes(x))) {
            const sql=await fs.readFile(`${directory}/${filename}`,"utf8");
            await pool.query(sql);
            await pool.query("insert into labrat_schema_migrations (filename,checksum) values ($1,$2)",[filename,hash(sql)]);
          }
          await seedLinkedWorkbooks(pool,baseline==="claude" ? "owner" : "lab_owner");
          if (baseline==="claude") {
            await pool.query(`update workbook_review_regions set linked_experiment_id='exp31',data_kind='Carbon distribution' where id='region31'`);
          }
        }
        const evidence=baseline==="empty" ? null : (await pool.query("select row_to_json(r) value from region_understanding_revisions r order by id")).rows;
        const fileRefs=baseline==="empty" ? null : (await pool.query("select id,checksum_sha256,storage_key from file_objects order by id")).rows;
        const first=await run();
        expect(first.stdout).toContain("Applied 029_region_template_apply_receipts.sql");
        const second=await run();
        expect(second.stdout).not.toContain("Applied");
        const ledger=(await pool.query("select filename from labrat_schema_migrations order by filename")).rows.map((x)=>x.filename);
        expect(ledger).toEqual(files);
        if (evidence) {
          expect((await pool.query("select row_to_json(r) value from region_understanding_revisions r order by id")).rows).toEqual(evidence);
          expect((await pool.query("select id,checksum_sha256,storage_key from file_objects order by id")).rows).toEqual(fileRefs);
          expect((await pool.query("select accepted_revision_id from workbook_review_regions where id='region31'")).rows[0].accepted_revision_id).toBe("revision31");
        }
        if (baseline==="claude") expect((await pool.query("select linked_experiment_id,data_kind from workbook_review_regions where id='region31'")).rows[0])
          .toEqual({linked_experiment_id:"exp31",data_kind:"Carbon distribution"});
        await pool.query("update labrat_schema_migrations set checksum='unexpected' where filename='029_region_template_apply_receipts.sql'");
        await expect(run()).rejects.toMatchObject({stderr:expect.stringContaining("changed after it was applied")});
      } finally {await pool.end();}
    });
  },90_000);
});
