create table if not exists chart_style_profiles (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  schema_version text not null default 'labrat.chartStyleProfile.v1',
  name text not null,
  description text not null default '',
  status text not null default 'active' check (status in ('active', 'archived')),
  current_version_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text references users(id) on delete set null,
  updated_by text references users(id) on delete set null
);

create unique index if not exists chart_style_profiles_project_name_key
  on chart_style_profiles(project_id, lower(name));
create index if not exists chart_style_profiles_project_status_idx
  on chart_style_profiles(project_id, status, updated_at desc, id);

create table if not exists chart_style_profile_versions (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  chart_style_profile_id text not null references chart_style_profiles(id) on delete restrict,
  schema_version text not null default 'labrat.chartStyleProfileVersion.v1',
  version integer not null check (version > 0),
  status text not null default 'accepted' check (status in ('draft', 'accepted')),
  payload jsonb not null default '{}'::jsonb,
  content_hash text not null,
  created_at timestamptz not null default now(),
  created_by text references users(id) on delete set null,
  accepted_at timestamptz,
  accepted_by text references users(id) on delete set null,
  unique (chart_style_profile_id, version),
  unique (chart_style_profile_id, content_hash)
);

alter table chart_style_profiles
  add constraint chart_style_profiles_current_version_fk
  foreign key (current_version_id) references chart_style_profile_versions(id) on delete restrict;

create index if not exists chart_style_profile_versions_profile_idx
  on chart_style_profile_versions(chart_style_profile_id, version desc);

create table if not exists reusable_chart_templates (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  schema_version text not null default 'labrat.reusableChartTemplate.v1',
  name text not null,
  description text not null default '',
  status text not null default 'active' check (status in ('active', 'archived')),
  current_version_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text references users(id) on delete set null,
  updated_by text references users(id) on delete set null
);

create unique index if not exists reusable_chart_templates_project_name_key
  on reusable_chart_templates(project_id, lower(name));
create index if not exists reusable_chart_templates_project_status_idx
  on reusable_chart_templates(project_id, status, updated_at desc, id);

create table if not exists reusable_chart_template_versions (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  reusable_chart_template_id text not null references reusable_chart_templates(id) on delete restrict,
  schema_version text not null default 'labrat.reusableChartTemplateVersion.v1',
  version integer not null check (version > 0),
  status text not null default 'accepted' check (status = 'accepted'),
  source_chart_spec_id text not null references chart_specs(id) on delete restrict,
  chart_style_profile_version_id text references chart_style_profile_versions(id) on delete restrict,
  payload jsonb not null default '{}'::jsonb,
  content_hash text not null,
  created_at timestamptz not null default now(),
  created_by text references users(id) on delete set null,
  accepted_at timestamptz not null default now(),
  accepted_by text references users(id) on delete set null,
  unique (reusable_chart_template_id, version),
  unique (reusable_chart_template_id, content_hash)
);

alter table reusable_chart_templates
  add constraint reusable_chart_templates_current_version_fk
  foreign key (current_version_id) references reusable_chart_template_versions(id) on delete restrict;

create index if not exists reusable_chart_template_versions_template_idx
  on reusable_chart_template_versions(reusable_chart_template_id, version desc);
create index if not exists reusable_chart_template_versions_source_chart_idx
  on reusable_chart_template_versions(project_id, source_chart_spec_id);
