create table if not exists region_template_apply_receipts (
  project_id text not null references projects(id) on delete cascade,
  idempotency_key text not null,
  lab_id text not null references labs(id) on delete cascade,
  actor_user_id text not null references users(id),
  template_version_id text not null references region_extraction_template_versions(id),
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (project_id, idempotency_key)
);
