create table if not exists users (
  id text primary key,
  username text unique not null,
  display_name text not null,
  password_hash text not null,
  is_active boolean not null default true,
  is_super_admin boolean not null default false,
  last_login_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  created_by text references users(id)
);

create table if not exists labs (
  id text primary key,
  name text not null,
  slug text unique not null,
  status text not null default 'active',
  settings jsonb not null default '{}',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  created_by text references users(id)
);

create table if not exists lab_memberships (
  id text primary key,
  lab_id text not null references labs(id),
  user_id text not null references users(id),
  role text not null,
  status text not null default 'active',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  created_by text references users(id),
  unique(lab_id, user_id)
);

create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id),
  session_token_hash text unique not null,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  last_seen_at timestamptz,
  ip_address text,
  user_agent text,
  revoked_at timestamptz
);

create table if not exists projects (
  id text primary key,
  lab_id text not null references labs(id),
  name text not null,
  description text,
  status text not null default 'active',
  current_dataset_commit_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  created_by text not null references users(id),
  updated_by text references users(id)
);

create table if not exists file_objects (
  id text primary key,
  lab_id text not null references labs(id),
  project_id text not null references projects(id),
  original_name text not null,
  mime_type text,
  extension text,
  size_bytes bigint not null,
  checksum_sha256 text not null,
  storage_provider text not null default 'local',
  storage_key text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null,
  created_by text not null references users(id),
  unique(project_id, checksum_sha256, original_name)
);

create table if not exists import_runs (
  id text primary key,
  lab_id text not null references labs(id),
  project_id text not null references projects(id),
  file_object_id text references file_objects(id),
  status text not null,
  scan_result jsonb,
  normalize_preview jsonb,
  review_decisions jsonb not null default '{}',
  warnings jsonb not null default '[]',
  error jsonb,
  applied_dataset_commit_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  created_by text not null references users(id),
  updated_by text references users(id)
);

create table if not exists dataset_commits (
  id text primary key,
  lab_id text not null references labs(id),
  project_id text not null references projects(id),
  parent_commit_id text references dataset_commits(id),
  source_import_run_ids jsonb not null default '[]',
  source_mapping_set_ids jsonb not null default '[]',
  dataset_payload jsonb not null,
  summary jsonb not null default '{}',
  warnings jsonb not null default '[]',
  created_at timestamptz not null,
  created_by text not null references users(id)
);

create table if not exists mapping_sets (
  id text primary key,
  lab_id text not null references labs(id),
  project_id text not null references projects(id),
  import_run_id text references import_runs(id),
  dataset_commit_id text references dataset_commits(id),
  schema_version text not null,
  status text not null default 'proposed',
  payload jsonb not null,
  decision_summary jsonb not null default '{}',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  created_by text not null references users(id),
  updated_by text references users(id)
);

create table if not exists chart_proposal_sets (
  id text primary key,
  lab_id text not null references labs(id),
  project_id text not null references projects(id),
  dataset_commit_id text references dataset_commits(id),
  mapping_set_id text references mapping_sets(id),
  schema_version text not null,
  status text not null default 'proposed',
  payload jsonb not null,
  decision_summary jsonb not null default '{}',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  created_by text not null references users(id),
  updated_by text references users(id)
);

create table if not exists chart_specs (
  id text primary key,
  lab_id text not null references labs(id),
  project_id text not null references projects(id),
  dataset_commit_id text references dataset_commits(id),
  mapping_set_id text references mapping_sets(id),
  source_chart_proposal_set_id text references chart_proposal_sets(id),
  source_proposal_id text,
  title text,
  chart_type text not null,
  spec jsonb not null,
  layout jsonb not null default '{}',
  warnings jsonb not null default '[]',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  created_by text not null references users(id),
  updated_by text references users(id)
);

create table if not exists manuscripts (
  id text primary key,
  lab_id text not null references labs(id),
  project_id text not null references projects(id),
  title text not null,
  status text not null default 'draft',
  blocks jsonb not null default '[]',
  pages jsonb not null default '[]',
  canvas_state jsonb not null default '{}',
  references_payload jsonb not null default '[]',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  created_by text not null references users(id),
  updated_by text references users(id)
);

create table if not exists audit_events (
  id text primary key,
  lab_id text references labs(id),
  project_id text references projects(id),
  actor_user_id text references users(id),
  action text not null,
  target_type text,
  target_id text,
  summary text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null,
  ip_address text,
  user_agent text
);

create index if not exists idx_users_username on users(username);
create index if not exists idx_sessions_token_hash on sessions(session_token_hash);
create index if not exists idx_sessions_user_id on sessions(user_id);
create index if not exists idx_sessions_expires_at on sessions(expires_at);
create index if not exists idx_labs_slug on labs(slug);
create index if not exists idx_lab_memberships_user_id on lab_memberships(user_id);
create index if not exists idx_lab_memberships_lab_id on lab_memberships(lab_id);
create index if not exists idx_projects_lab_id on projects(lab_id);
create index if not exists idx_file_objects_project on file_objects(lab_id, project_id);
create index if not exists idx_file_objects_checksum on file_objects(checksum_sha256);
create index if not exists idx_import_runs_project on import_runs(lab_id, project_id);
create index if not exists idx_dataset_commits_project on dataset_commits(lab_id, project_id);
create index if not exists idx_mapping_sets_project on mapping_sets(lab_id, project_id);
create index if not exists idx_chart_proposal_sets_project on chart_proposal_sets(lab_id, project_id);
create index if not exists idx_chart_specs_project on chart_specs(lab_id, project_id);
create index if not exists idx_manuscripts_project on manuscripts(lab_id, project_id);
create index if not exists idx_audit_events_scope on audit_events(lab_id, project_id, created_at);
create index if not exists idx_audit_events_actor on audit_events(actor_user_id, created_at);

alter table projects
  drop constraint if exists projects_current_dataset_commit_id_fkey;
alter table projects
  add constraint projects_current_dataset_commit_id_fkey
  foreign key (current_dataset_commit_id) references dataset_commits(id);

alter table import_runs
  drop constraint if exists import_runs_applied_dataset_commit_id_fkey;
alter table import_runs
  add constraint import_runs_applied_dataset_commit_id_fkey
  foreign key (applied_dataset_commit_id) references dataset_commits(id);

