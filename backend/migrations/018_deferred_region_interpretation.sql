alter table workbook_review_regions
  add column if not exists interpretation_hint jsonb not null default '{}'::jsonb;
