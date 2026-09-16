create table if not exists public_guest_accounts (
  user_id text primary key references users(id),
  project_id text not null references projects(id),
  created_at timestamptz not null default now(),
  created_by text not null references users(id)
);
