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

update data_snapshots
set analysis_plan_revision_id = null,
    analysis_run_id = null,
    analysis_result_id = null
where analysis_plan_revision_id is not null
   or analysis_run_id is not null
   or analysis_result_id is not null;

delete from analysis_experiment_publications;
delete from analysis_thread_retry_receipts;
delete from analysis_publications;
delete from chart_specs
where id in (select id from labrat_legacy_analysis_chart_specs);
delete from analysis_results;
delete from analysis_runs;
delete from analysis_plan_revisions;
delete from analysis_threads;
