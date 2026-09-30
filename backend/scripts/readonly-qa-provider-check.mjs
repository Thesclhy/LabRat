// Real configured model, real isolated PostgreSQL/tools; synthetic research data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { createV1Application } from '../dist-v1/v1/bootstrap.js';
import { withTestSchema, applyTestMigrations } from '../dist-v1/v1/testing/postgres-test-database.js';
import { seedAnalysisScenario } from '../dist-v1/v1/testing/analysis-review-fixture.js';
import { seedResearchCorpus, researchUpload, researchProjectId as projectId } from '../dist-v1/v1/research-qa/testing/research-qa-scenario.js';
import { ResearchEvidenceService } from '../dist-v1/v1/research-qa/research-evidence.service.js';
import { ResearchQuestionsService } from '../dist-v1/v1/research-qa/research-questions.service.js';
import { DocumentsService } from '../dist-v1/v1/research-qa/documents.service.js';
import { EvidenceRepository } from '../dist-v1/v1/evidence/evidence.repository.js';
import { V1_MODEL_PROVIDER } from '../dist-v1/v1/platform/model/model-provider.js';
import { researchWorkbook } from '../src/research/testing/researchQaCorpus.js';
import { scanWorkbook } from '../src/import/services/workbookScanner.js';
import { buildSourceDocumentIndex } from '../src/saas/sourceDocuments.js';

const databaseUrl=process.env.LABRAT_TEST_DATABASE_URL;
assert.equal(new URL(databaseUrl).hostname,'127.0.0.1','Only a loopback test database is allowed');
const output=path.resolve('doc/qa/readonly-qa-provider-runs');
await fs.mkdir(output,{recursive:true});
const startedAt=new Date().toISOString();
const reportFile=path.join(output,startedAt.replaceAll(':','-')+'.json');
const report={startedAt,material:'synthetic only',provider:null,completed:false,records:[],semanticReview:'pending',files:{}};
for(const name of ['backend/src/research/citedAnswer.js','backend/src/research/evidenceTools.js','backend/src/v1/research-qa/research-questions.service.ts','backend/src/v1/research-qa/research-evidence.service.ts'])
  report.files[name]=createHash('sha256').update(await fs.readFile(name)).digest('hex');
const save=()=>fs.writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
await withTestSchema(databaseUrl,async({databaseUrl:isolated})=>{
  await applyTestMigrations(isolated);await seedAnalysisScenario(isolated);
  const storage=await fs.mkdtemp(path.join(os.tmpdir(),'labrat-readonly-eval-'));
  const pool=new Pool({connectionString:isolated});let app;
  try {
    Object.assign(process.env,{NODE_ENV:'test',DATABASE_URL:isolated,LABRAT_FILE_STORAGE_ROOT:storage});
    app=await createV1Application({logger:false});
    report.provider=app.get(V1_MODEL_PROVIDER).publicConfig();assert.ok(report.provider.configured,'Real provider credentials required');
    const fixture=await seedResearchCorpus(app,isolated);
    const documents=app.get(DocumentsService),questions=app.get(ResearchQuestionsService);
    const evidenceService=app.get(ResearchEvidenceService),createSession=evidenceService.createSession.bind(evidenceService);
    let currentSession;
    evidenceService.createSession=(...args)=>{ currentSession=createSession(...args); return currentSession; };
    const addText=async(name,text)=>{
      const file=await researchUpload(app,fixture.cookie,name,Buffer.from(text));
      const registered=await documents.register(fixture.auth,projectId,file.id,{newDocument:true});
      for(let n=0;n<200;n++) {
        const version=await documents.version(fixture.auth,projectId,registered.version.id);
        if(['ready','partial'].includes(version.status))return {documentId:registered.document.id,versionId:version.id};
        if(version.status==='failed')throw new Error('Synthetic document parse failed: '+version.failureCode);
        await new Promise(resolve=>setTimeout(resolve,50));
      }throw new Error('Synthetic parse timed out');
    };
    const scope=await addText('Q01-scope.txt','Project: Synthetic catalyst stability study.\nProtocol: RQ-001.\nSample condition: dry sample only; wet samples are excluded.\nTemperature: 80 C.\nDuration: 30 minutes.\n');
    await addText('Q01-scope.txt','Protocol: RQ-OTHER.\nTemperature: 99 C.\nThis unrelated document does not describe RQ-001.');
    const buffer=researchWorkbook();const file=await researchUpload(app,fixture.cookie,'Q09-raw.xlsx',buffer);
    const indexed=buildSourceDocumentIndex({project:{id:projectId,labId:'lab_analysis'},fileObject:file,importRun:{id:null},actorUserId:fixture.auth.user.id,
      scanResult:scanWorkbook({buffer,filename:file.originalName,fileId:file.id,sizeBytes:buffer.length})});
    indexed.importRunId=null;
    const source=await app.get(EvidenceRepository).replaceSourceDocumentIndex(indexed);
    await pool.query("insert into workbook_review_sessions(id,lab_id,project_id,source_document_id,schema_version,status,version,workbook_summary,messages,warnings,created_at,updated_at,created_by,updated_by) select 'review_readonly_eval',lab_id,project_id,$1,schema_version,status,version,workbook_summary,messages,warnings,created_at,updated_at,created_by,updated_by from workbook_review_sessions where id='review_analysis'",[source.id]);
    await pool.query("insert into workbook_review_regions(id,lab_id,project_id,workbook_review_session_id,source_document_id,sheet_name,range_ref,selection_method,disposition,review_status,version,warnings,accepted_at,accepted_by,created_at,updated_at,created_by,updated_by,linked_experiment_id) select 'region_readonly_eval',lab_id,project_id,'review_readonly_eval',$1,'Measurements','A1:G3',selection_method,disposition,review_status,version,warnings,accepted_at,accepted_by,created_at,updated_at,created_by,updated_by,'experiment_17' from workbook_review_regions where id='review_region_analysis'",[source.id]);
    await pool.query("insert into region_understanding_revisions(id,lab_id,project_id,workbook_review_session_id,source_document_id,region_id,revision_number,trigger,user_feedback,summary,interpretation,source_refs,source_content_hash,dependency_hash,validation,provider,warnings,confidence,created_at,created_by) select 'revision_readonly_eval',lab_id,project_id,'review_readonly_eval',$1,'region_readonly_eval',revision_number,trigger,user_feedback,'[\"Q09 experimental measurements for Exp17 and Exp17B\"]','{\"semanticType\":\"experiment_table\"}',source_refs,source_content_hash,dependency_hash,validation,provider,warnings,confidence,created_at,created_by from region_understanding_revisions where id='revision_analysis'",[source.id]);
    await pool.query("update workbook_review_regions set current_revision_id='revision_readonly_eval',accepted_revision_id='revision_readonly_eval' where id='region_readonly_eval'");
    const scan={documentId:fixture.sources.scan.document.id,versionId:fixture.sources.scan.version.id};
    await pool.query("update context_document_passages set metadata=metadata || '{\"uncertain\":true}'::jsonb where version_id=$1",[scan.versionId]);
    const cases=[
      {id:'R01',question:'Based only on this document, what are the temperature, duration, and applicable sample types for RQ-001?',referenceDocuments:[scope],expected:'80 C; 30 minutes; dry only, wet excluded; selected version (not same-name 99 C)'},
      {id:'R02',question:'仅根据这份资料，RQ-001 对湿样品规定的温度是多少？',referenceDocuments:[scope],expected:'wet samples excluded; no applicable wet temperature'},
      {id:'R03',question:'What is the accepted Temperature for Exp17?',expected:'exact Exp17 find then accepted snapshot, 82 C'},
      {id:'R04',question:'读取 Q09-raw.xlsx 已确认区域的 Measurements!A1:C2，B2 原始值和表头单位是什么？',expected:'confirmed region, B2=80, header Temperature (C)'},
      {id:'R05',question:'List RQ-001 method temperature and Exp17 accepted temperature with their respective sources. Do not calculate.',referenceDocuments:[scope],expected:'80 C method, 82 C accepted; both read'},
      {id:'R06',question:'共同别名 Batch-A 对应实验的温度是多少？',expected:'clarify ambiguous Exp17/Exp17B; no arbitrary accepted snapshot read'},
      {id:'R07',question:'Q09-raw.xlsx 中 Exp17B 的催化剂质量是多少？读取已确认区域，缺失就说明缺失。',expected:'Measurements C3 blank; not zero or 0.12'},
      {id:'R08',question:'仅根据选中资料，Exp17 的实测温度是多少？',referenceDocuments:[scope],expected:'selected document has method only; no experiment read or inferred measured value'},
      {id:'R08-followup',question:'那它的时长是多少？',selectedExperimentLabel:'Exp17',conversation:[{role:'user',text:'我在问 Exp17 当前已接受的温度。'},{role:'assistant',text:'Exp17 的已接受温度为 82 C。'}],expected:'resolve Exp17 again, read snapshot Duration 30 min'},
      {id:'R09',question:'Read the unconfirmed research.xls workbook Notes!A2:B2.',expected:'unconfirmed workbook unavailable; request region review'},
      {id:'R10',question:'计算 Exp17 温度序列的均值。',expected:'needs_analysis; no new number or execution'},
      {id:'R10-diagnosis',question:'诊断为什么 Exp17 失败，并推荐下一次实验温度。',expected:'out_of_scope; no recommendation'},
      {id:'R11',question:'Based only on this scanned document, what temperature does it appear to state? Is the OCR reliable enough for a definite measurement?',referenceDocuments:[scan],expected:'OCR uncertainty retained; original scan link, no claim of definite measurement'},
      {id:'R12',question:'What is the accepted temperature of Exp404?',expected:'no match; no substitute experiment'},
      {id:'R12-field',question:'What is the accepted Pressure for Exp17? If missing, explain the stored reason.',expected:'missing, source_blank, unit bar; no invented value'},
      {id:'R12-topic',question:'What concentration of cobalt does the project evidence establish?',expected:'bounded search and insufficient evidence'},
    ];
    const selected=process.env.LABRAT_READONLY_EVAL_IDS?.split(',');
    for(const item of cases.filter(item=>!selected||selected.includes(item.id))) {
      const {id,expected,...input}=item;const started=Date.now();
      let result=await questions.create(fixture.auth,projectId,{requestKey:'readonly-'+id+'-'+Date.now(),...input});
      while(['queued','running'].includes(result.request.status)&&Date.now()-started<155000){
        await new Promise(resolve=>setTimeout(resolve,250));result=await questions.get(fixture.auth,projectId,result.request.runId);
      }
      const evidence=[];
      for(const item of result.artifact?.evidence||[])evidence.push((await questions.source(fixture.auth,projectId,result.request.runId,item.id)).evidence);
      report.records.push({trace:currentSession?.trace||[],readWindows:currentSession?.registry.values()||[],id,question:input.question,expected,request:result.request,artifact:result.artifact,evidence,elapsedMs:Date.now()-started,semanticReview:'pending'});
      await save();console.log(id+': '+result.request.status+' / '+(result.artifact?.answer.status||result.request.failureCode)+' ('+(Date.now()-started)+' ms)');
      if(['qa_provider_balance','qa_provider_credentials','ai_unavailable'].includes(result.request.failureCode))throw new Error('Provider unavailable: '+result.request.failureCode);
    }
    report.completed=true;report.finishedAt=new Date().toISOString();await save();
    assert.ok(report.records.every(record=>record.request.status==='completed'),'One or more questions failed; inspect '+reportFile);
  }finally{await app?.close();await pool.end();await fs.rm(storage,{recursive:true,force:true});}
});
console.log('Provider records: '+reportFile);
