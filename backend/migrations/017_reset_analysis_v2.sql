create temporary table labrat_legacy_analysis_chart_specs
on commit drop
as
select id
from chart_specs
where analysis_result_id is not null;

update manuscripts
set blocks = (
  select coalesce(jsonb_agg(block), '[]'::jsonb)
  from jsonb_array_elements(manuscripts.blocks) as block
  where coalesce(block ->> 'chartSpecId', '') not in (
    select id from labrat_legacy_analysis_chart_specs
  )
)
where exists (
  select 1
  from jsonb_array_elements(manuscripts.blocks) as block
  where coalesce(block ->> 'chartSpecId', '') in (
    select id from labrat_legacy_analysis_chart_specs
  )
);

delete from analysis_thread_retry_receipts;
delete from analysis_publications;
delete from chart_specs
where id in (select id from labrat_legacy_analysis_chart_specs);
delete from analysis_results;
delete from analysis_runs;
delete from analysis_plan_revisions;
delete from analysis_threads;

alter table analysis_plan_revisions
  drop column if exists selection,
  drop column if exists selection_request,
  drop column if exists processing_summary,
  drop column if exists calculation_manifest,
  drop column if exists python_program,
  drop column if exists expected_output,
  drop column if exists plan_hash,
  drop column if exists dependency_hash,
  drop column if exists selection_hash,
  drop column if exists program_hash,
  drop column if exists runtime_version;
