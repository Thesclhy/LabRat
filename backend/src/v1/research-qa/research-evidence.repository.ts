import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../platform/database/database.service.js";
import { normalizeIdentity, searchTerms } from "../../research/evidenceTools.js";

@Injectable()
export class ResearchEvidenceRepository {
  constructor(private readonly database: DatabaseService) {}

  private async query(text: string, values: unknown[]) {
    const client = await this.database.rawPool.connect();
    try {
      await client.query("begin read only");
      await client.query("set local statement_timeout = '5000ms'");
      const result = await client.query(text, values);
      await client.query("commit");
      return result.rows;
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }

  async context(projectId: string) {
    const [row] = await this.query(`select id, name, description, metadata -> 'projectProfile' as "projectProfile", updated_at as "updatedAt"
      from projects where id=$1 and status='active'`, [projectId]);
    return row;
  }

  async activeSession(sessionId: string, userId: string) {
    const rows = await this.query(`select id from sessions where id=$1 and user_id=$2 and revoked_at is null and expires_at>now()`, [sessionId, userId]);
    return rows.length > 0;
  }

  async search(projectId: string, query: string, offset: number, preferredVersions: string[] = [], selectedOnly = false) {
    const terms = searchTerms(query);
    return this.query(`with candidates as (
      select 'document'::text kind, p.version_id || ':' || p.id sort_id,
        d.original_name label, p.text searchable,
        jsonb_build_object('versionId',p.version_id,'passageId',p.id,'documentId',d.id,
          'locator',p.locator,'snippet',left(p.text,700),'status',v.status,'ordinal',p.ordinal) target
      from context_document_passages p
      join context_documents d on d.project_id=$1 and d.status='active' and
        (p.version_id=any($5::text[]) or (d.current_version_id=p.version_id and not exists
          (select 1 from context_document_versions selected where selected.document_id=d.id and selected.id=any($5::text[]))))
      join context_document_versions v on v.id=p.version_id and v.project_id=$1 and v.status in ('ready','partial')
      where p.project_id=$1 and v.document_id=d.id and (not $6 or p.version_id=any($5::text[]))
      union all
      select 'confirmed_region',r.id,coalesce(d.metadata->>'workbookName',d.id) || ' / ' || r.sheet_name || ' ' || r.range_ref,
        coalesce(v.summary::text,'') || ' ' || r.sheet_name || ' ' || coalesce(d.metadata->>'workbookName',''),
        jsonb_build_object('regionId',r.id,'revisionId',v.id,'sourceDocumentId',r.source_document_id,
          'sheetName',r.sheet_name,'range',r.range_ref,'snippet',left(v.summary::text,700))
      from workbook_review_regions r join region_understanding_revisions v on v.id=r.accepted_revision_id and v.project_id=$1
      join source_documents d on d.id=r.source_document_id and d.project_id=$1
      where r.project_id=$1 and r.disposition='active' and r.review_status='accepted' and not $6
      union all
      select 'experiment_field',h.id || ':field:' || f.n,i.canonical_label,
        coalesce(f.body->>'displayName','') || ' ' || coalesce(f.body->>'columnId','') || ' ' || coalesce(f.body->>'unit',''),
        jsonb_build_object('experimentId',i.id,'canonicalLabel',i.canonical_label,'snapshotId',s.id,
          'fieldOffset',f.n-1,'columnId',f.body->>'columnId','snippet',left(coalesce(f.body->>'displayName',f.body->>'columnId',''),700))
      from experiment_identities i join experiment_snapshot_heads h on h.experiment_id=i.id and h.project_id=$1
      join data_snapshots s on s.id=h.data_snapshot_id and s.project_id=$1 and s.status='accepted'
      cross join lateral jsonb_array_elements(coalesce((s.experiment_records->h.record_index)->'fields','[]')) with ordinality f(body,n)
      where i.project_id=$1 and $4=false and not $6
    ), ranked as (
      select *, (select coalesce(sum(case when case when t ~ '^[a-z0-9]{1,3}$' then lower(searchable) ~ ('(^|[^[:alnum:]_])' || t || '([^[:alnum:]_]|$)')
        else position(t in lower(searchable))>0 end then 2 else 0 end
        +case when case when t ~ '^[a-z0-9]{1,3}$' then lower(label) ~ ('(^|[^[:alnum:]_])' || t || '([^[:alnum:]_]|$)')
        else position(t in lower(label))>0 end then 1 else 0 end),0) from unnest($2::text[]) t) score
      from candidates
    ) select kind,label,target,score from ranked where $4 or score>0 or
      (kind='document' and target->>'versionId'=any($5::text[]) and (target->>'ordinal')::int<2)
      order by (kind='document' and target->>'versionId'=any($5::text[])) desc,
        score desc,sort_id offset $3 limit 40`, [projectId, terms, offset, !query.trim(), preferredVersions, selectedOnly]);
  }

  async neighbors(projectId: string, versionId: string, ordinal: number) {
    return this.query(`(select id,ordinal,locator from context_document_passages
      where project_id=$1 and version_id=$2 and ordinal<$3 order by ordinal desc,id desc limit 1)
      union all (select id,ordinal,locator from context_document_passages
      where project_id=$1 and version_id=$2 and ordinal>=$3 order by ordinal,id limit 2)
      order by ordinal,id`, [projectId, versionId, ordinal]);
  }

  async workbook(projectId: string, sourceId: string, sheet: string, startRow: number, endRow: number, startCol: number, endCol: number) {
    return this.query(`select b.id,b.checksum_sha256 as "checksumSha256",
      jsonb_build_object('sheets',jsonb_build_array(jsonb_build_object('name',s.body->>'name','cellGrid',
        jsonb_build_object('cells',coalesce((select jsonb_agg(case when (c->>'row')::int between $4 and $5
          and (c->>'col')::int between $6 and $7 then c else jsonb_build_object('address',c->>'address',
            'row',c->'row','col',c->'col','mergedRange',c->>'mergedRange') end)
          from jsonb_array_elements(s.body->'cellGrid'->'cells') c
          where ((c->>'row')::int between $4 and $5 and (c->>'col')::int between $6 and $7)
          or (c->>'mergedRange' ~ '^[A-Z]+[0-9]+:[A-Z]+[0-9]+$'
            and substring(c->>'mergedRange' from '^[A-Z]+([0-9]+)')::int <= $5
            and substring(c->>'mergedRange' from ':([A-Z]+)([0-9]+)$') is not null
            and substring(c->>'mergedRange' from ':?[A-Z]+([0-9]+)$')::int >= $4
            and (length(substring(c->>'mergedRange' from '^([A-Z]+)')),substring(c->>'mergedRange' from '^([A-Z]+)')) <= (length($9::text),$9::text)
            and (length(substring(c->>'mergedRange' from ':([A-Z]+)')),substring(c->>'mergedRange' from ':([A-Z]+)')) >= (length($8::text),$8::text))),'[]'::jsonb))))) payload
      from source_index_blobs b cross join lateral jsonb_array_elements(coalesce(b.payload->'sheets','[]')) s(body)
      where b.project_id=$1 and b.source_document_id=$2 and lower(s.body->>'name')=lower($3)
      order by b.id limit 2`, [projectId, sourceId, sheet, startRow, endRow, startCol, endCol, columnLetters(startCol), columnLetters(endCol)]);
  }

  async experiments(projectId: string, query: string, offset: number) {
    return this.query(`select i.id, i.canonical_label as "canonicalLabel", i.aliases,
      h.id as "headId", h.updated_at as "headUpdatedAt", h.record_index as "recordIndex", s.id as "snapshotId", s.content_hash as "contentHash"
      from experiment_identities i join experiment_snapshot_heads h on h.experiment_id=i.id and h.project_id=$1
      join data_snapshots s on s.id=h.data_snapshot_id and s.project_id=$1 and s.status='accepted'
      where i.project_id=$1 and ($2='' or
        regexp_replace(lower(i.canonical_label),'[[:space:]_-]','','g')=$2 or
        exists(select 1 from jsonb_array_elements_text(i.aliases) a where regexp_replace(lower(a),'[[:space:]_-]','','g')=$2))
      order by i.id offset $3 limit 9`, [projectId, normalizeIdentity(query), offset]);
  }

  async experiment(projectId: string, snapshotId: string, recordIndex: number, fieldOffset: number, seriesOffset: number, seriesKey: string | undefined, pointOffset: number) {
    const [row] = await this.query(`with pinned as (
      select id,content_hash,accepted_at,warnings,experiment_records->$3::int record
      from data_snapshots where project_id=$1 and id=$2 and status='accepted'
    ) select id as "snapshotId", content_hash as "contentHash", accepted_at as "acceptedAt", warnings,
      record->>'experimentId' as "experimentId",record->>'sourceAlias' as "sourceAlias",
      record->'warnings' as "recordWarnings",record->'sourceRefs' as "sourceRefs",
      jsonb_array_length(coalesce(record->'fields','[]')) as "fieldCount",
      jsonb_array_length(coalesce(record->'series','[]')) as "seriesCount",
      coalesce((select jsonb_agg(f) from (select f from jsonb_array_elements(coalesce(record->'fields','[]')) with ordinality z(f,n)
        order by n offset $4 limit 20) a),'[]') fields,
      coalesce((select jsonb_agg(jsonb_set(s-'points','{pointCount}',to_jsonb(jsonb_array_length(coalesce(s->'points','[]')))))
        from (select s from jsonb_array_elements(coalesce(record->'series','[]')) with ordinality z(s,n)
          order by n offset $5 limit 8) a),'[]') series,
      (select jsonb_build_object('seriesKey',s->>'seriesKey','xField',s->'xField','yField',s->'yField',
        'pointCount',jsonb_array_length(coalesce(s->'points','[]')),'sourceRefs',s->'sourceRefs',
        'points',coalesce((select jsonb_agg(p) from (select p from jsonb_array_elements(coalesce(s->'points','[]'))
          with ordinality z(p,n) order by n offset $7 limit 40) a),'[]'))
        from jsonb_array_elements(coalesce(record->'series','[]')) s where s->>'seriesKey'=$6 limit 1) as "seriesWindow"
      from pinned`, [projectId, snapshotId, recordIndex, fieldOffset, seriesOffset, seriesKey || null, pointOffset]);
    return row;
  }

  async confirmedRegions(projectId: string, experimentId: string) {
    return this.query(`select id as "regionId",accepted_revision_id as "revisionId",sheet_name as "sheetName",range_ref as "range"
      from workbook_review_regions where project_id=$1 and linked_experiment_id=$2
      and disposition='active' and review_status='accepted' order by id limit 9`, [projectId, experimentId]);
  }

  async region(projectId: string, regionId: string, revisionId: string, offset: number) {
    const [row] = await this.query(`select r.id as "regionId",r.version,r.source_document_id as "sourceDocumentId",
      r.sheet_name as "sheetName",r.range_ref as "range",r.accepted_at as "acceptedAt",v.id as "revisionId",
      v.source_content_hash as "sourceContentHash",v.dependency_hash as "dependencyHash",v.warnings,
      v.interpretation - 'fields' - 'series' as interpretation,
      jsonb_array_length(coalesce(v.interpretation->'fields','[]')) as "fieldCount",
      jsonb_array_length(coalesce(v.interpretation->'series','[]')) as "seriesCount",
      coalesce((select jsonb_agg(f) from (select f from jsonb_array_elements(coalesce(v.interpretation->'fields','[]'))
        with ordinality z(f,n) order by n offset $4 limit 20) a),'[]') fields,
      coalesce((select jsonb_agg(s) from (select s from jsonb_array_elements(coalesce(v.interpretation->'series','[]'))
        with ordinality z(s,n) order by n offset $4 limit 20) a),'[]') series
      from workbook_review_regions r join region_understanding_revisions v on v.id=r.accepted_revision_id and v.project_id=$1
      where r.project_id=$1 and r.id=$2 and v.id=$3 and r.disposition='active' and r.review_status='accepted'`, [projectId, regionId, revisionId, offset]);
    return row;
  }
}

function columnLetters(oneBased: number) {
  let value = oneBased, letters = "";
  while (value > 0) { value -= 1; letters = String.fromCharCode(65 + value % 26) + letters; value = Math.floor(value / 26); }
  return letters;
}
