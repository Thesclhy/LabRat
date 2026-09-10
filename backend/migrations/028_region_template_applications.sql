alter table workbook_review_regions
  add column if not exists linked_experiment_id text,
  add column if not exists data_kind text,
  add column if not exists region_extraction_template_version_id text
    references region_extraction_template_versions(id) on delete set null,
  add column if not exists template_match jsonb;

create index if not exists workbook_review_regions_linked_experiment_idx
  on workbook_review_regions(project_id, linked_experiment_id)
  where linked_experiment_id is not null;

alter table region_understanding_revisions
  drop constraint if exists region_understanding_revisions_trigger_check;
alter table region_understanding_revisions
  add constraint region_understanding_revisions_trigger_check
  check (trigger in ('initial', 'user_feedback', 'retry', 'template_match'));
