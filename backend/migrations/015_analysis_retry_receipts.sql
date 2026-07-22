create table if not exists analysis_thread_retry_receipts (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  analysis_thread_id text not null references analysis_threads(id) on delete cascade,
  actor_user_id text not null references users(id) on delete restrict,
  schema_version text not null default 'labrat.analysisThreadRetryReceipt.v1',
  idempotency_key text not null,
  request_hash text not null,
  status text not null check (status in ('drafting', 'retryable', 'completed')),
  lease_expires_at timestamptz,
  attempt_count integer not null default 1 check (attempt_count > 0),
  analysis_plan_revision_id text references analysis_plan_revisions(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, idempotency_key)
);

create index if not exists analysis_thread_retry_receipts_thread_idx
  on analysis_thread_retry_receipts(project_id, analysis_thread_id, updated_at desc);
