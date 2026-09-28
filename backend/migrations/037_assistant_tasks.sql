create table if not exists assistant_tasks (
  id text primary key,
  lab_id text not null references labs(id),
  project_id text not null references projects(id),
  actor_user_id text not null references users(id),
  request_key text not null,
  request_hash text not null,
  question text not null,
  context jsonb not null default '{}',
  attachments jsonb not null,
  status text not null default 'waiting' check (status in ('waiting','submitted','cancelled')),
  run_id text references research_qa_requests(run_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, actor_user_id, request_key),
  check ((status = 'submitted') = (run_id is not null)),
  check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) between 1 and 8)
);
create index if not exists assistant_tasks_personal_page on assistant_tasks(project_id, actor_user_id, created_at desc, id desc);
