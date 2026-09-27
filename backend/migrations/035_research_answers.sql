create table if not exists research_qa_requests (
  run_id text primary key references agent_runs(id),
  lab_id text not null references labs(id),
  project_id text not null references projects(id),
  actor_user_id text not null references users(id),
  request_key text not null,
  request_hash text not null,
  question text not null check(length(question) between 1 and 4000),
  status text not null default 'queued' check(status in ('queued','running','completed','failed','cancelled')),
  attempt integer not null default 0,
  lease_token text,
  lease_expires_at timestamptz,
  usage jsonb not null default '{}',
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,actor_user_id,request_key)
);
create index if not exists research_qa_requests_actor on research_qa_requests(project_id,actor_user_id,created_at desc,run_id);

create table if not exists answer_artifacts (
  id text primary key,
  run_id text not null unique references research_qa_requests(run_id),
  project_id text not null references projects(id),
  created_by text not null references users(id),
  schema_version text not null default 'labrat.answerArtifact.v1',
  answer jsonb not null,
  evidence jsonb not null,
  trace jsonb not null,
  usage jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists answer_artifacts_project on answer_artifacts(project_id,created_by,run_id);
