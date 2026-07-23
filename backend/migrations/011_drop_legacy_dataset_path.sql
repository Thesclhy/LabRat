alter table if exists agent_runs
  drop constraint if exists agent_runs_analysis_view_id_fkey,
  drop column if exists analysis_view_id;

alter table if exists chart_specs
  drop constraint if exists chart_specs_dataset_commit_id_fkey,
  drop constraint if exists chart_specs_mapping_set_id_fkey,
  drop column if exists dataset_commit_id,
  drop column if exists mapping_set_id;

alter table if exists import_runs
  drop constraint if exists import_runs_applied_dataset_commit_id_fkey,
  drop column if exists applied_dataset_commit_id;

alter table if exists projects
  drop constraint if exists projects_current_dataset_commit_id_fkey,
  drop column if exists current_dataset_commit_id;

drop table if exists observation_series cascade;
drop table if exists analysis_views cascade;
drop table if exists mapping_sets cascade;
drop table if exists dataset_commits cascade;
