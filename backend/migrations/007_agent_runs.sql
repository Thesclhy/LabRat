create table if not exists agent_runs (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  schema_version text not null default 'labrat.agentRun.v1',
  status text not null default 'waiting_for_user',
  mode text,
  user_message text not null default '',
  selected_context jsonb not null default '{}'::jsonb,
  visible_steps jsonb not null default '[]'::jsonb,
  tool_trace jsonb not null default '[]'::jsonb,
  proposal_refs jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  usage jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text references users(id),
  updated_by text references users(id)
);

create index if not exists agent_runs_project_idx
  on agent_runs(project_id, updated_at desc);
