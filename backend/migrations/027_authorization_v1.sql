create table if not exists lab_groups (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  name text not null,
  description text not null default '',
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text references users(id),
  updated_by text references users(id)
);

create unique index if not exists lab_groups_active_name_idx
  on lab_groups(lab_id, lower(name))
  where status = 'active';

create index if not exists lab_groups_lab_idx
  on lab_groups(lab_id, status, updated_at desc);

create table if not exists lab_group_members (
  group_id text not null references lab_groups(id) on delete cascade,
  lab_id text not null references labs(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text references users(id),
  updated_by text references users(id),
  primary key (group_id, user_id)
);

create index if not exists lab_group_members_lab_user_idx
  on lab_group_members(lab_id, user_id, status);

create table if not exists project_access_grants (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  user_id text references users(id) on delete cascade,
  group_id text references lab_groups(id) on delete cascade,
  scope text not null
    check (scope in ('all_experiments', 'selected_experiments')),
  capabilities jsonb not null default '[]'::jsonb
    check (jsonb_typeof(capabilities) = 'array'),
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text references users(id),
  updated_by text references users(id),
  check ((user_id is not null)::integer + (group_id is not null)::integer = 1)
);

create unique index if not exists project_access_grants_user_idx
  on project_access_grants(project_id, user_id)
  where user_id is not null and status = 'active';

create unique index if not exists project_access_grants_group_idx
  on project_access_grants(project_id, group_id)
  where group_id is not null and status = 'active';

create index if not exists project_access_grants_lab_project_idx
  on project_access_grants(lab_id, project_id, status);

create table if not exists experiment_access_grants (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  experiment_id text not null references experiment_identities(id) on delete cascade,
  user_id text references users(id) on delete cascade,
  group_id text references lab_groups(id) on delete cascade,
  capabilities jsonb not null default '[]'::jsonb
    check (jsonb_typeof(capabilities) = 'array'),
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text references users(id),
  updated_by text references users(id),
  check ((user_id is not null)::integer + (group_id is not null)::integer = 1)
);

create unique index if not exists experiment_access_grants_user_idx
  on experiment_access_grants(project_id, experiment_id, user_id)
  where user_id is not null and status = 'active';

create unique index if not exists experiment_access_grants_group_idx
  on experiment_access_grants(project_id, experiment_id, group_id)
  where group_id is not null and status = 'active';

create index if not exists experiment_access_grants_lab_project_idx
  on experiment_access_grants(lab_id, project_id, experiment_id, status);

insert into project_access_grants (
  id,
  lab_id,
  project_id,
  user_id,
  scope,
  capabilities,
  status,
  created_at,
  updated_at,
  created_by,
  updated_by
)
select
  'legacy_project_grant_' || membership.id || '_' || project.id,
  project.lab_id,
  project.id,
  membership.user_id,
  'all_experiments',
  case membership.role
    when 'editor' then '["read", "propose", "approve", "export"]'::jsonb
    else '["read", "export"]'::jsonb
  end,
  'active',
  now(),
  now(),
  coalesce(membership.created_by, project.created_by),
  coalesce(membership.created_by, project.created_by)
from lab_memberships membership
join projects project on project.lab_id = membership.lab_id
where membership.status = 'active'
  and membership.role in ('viewer', 'editor')
on conflict do nothing;
