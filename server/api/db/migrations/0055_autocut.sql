-- Additive, isolated from drama timelines and all existing assets.
create table autocut_projects (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references projects(id),
  created_by uuid not null references users(id), name text not null,
  asset_version_ids uuid[] not null, current_revision_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index autocut_projects_owner_idx on autocut_projects(project_id,created_by,updated_at desc);
create table autocut_revisions (
  id uuid primary key, project_id uuid not null references autocut_projects(id),
  parent_id uuid references autocut_revisions(id), document jsonb not null,
  created_by uuid not null references users(id), created_at timestamptz not null default now()
);
alter table autocut_projects add constraint autocut_current_revision_fk foreign key(current_revision_id) references autocut_revisions(id);
create table autocut_analyses (
  asset_version_id uuid not null references asset_versions(id), analyzer_version text not null,
  document jsonb not null, created_at timestamptz not null default now(),
  primary key(asset_version_id,analyzer_version)
);
create table autocut_tasks (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references autocut_projects(id),
  actor_id uuid not null references users(id), operation_id uuid not null,
  fingerprint text not null, input jsonb not null, base_revision_id uuid references autocut_revisions(id),
  status text not null default 'queued', stage text not null default 'queued', progress integer not null default 0,
  cancel_requested boolean not null default false, attempts integer not null default 0,
  budget_cents integer not null, reserved_cents integer not null default 0,
  output_revision_id uuid references autocut_revisions(id), output_asset_version_id uuid references asset_versions(id),
  error_code text, error_message text, metrics jsonb not null default '{}',
  created_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz,
  unique(actor_id,operation_id)
);
create unique index autocut_one_active_task_idx on autocut_tasks(project_id) where status in ('queued','running');
create table autocut_model_calls (
  task_id uuid not null references autocut_tasks(id), call_key text not null,
  generation_job_id uuid references generation_jobs(id), quote_cents integer not null,
  created_at timestamptz not null default now(), primary key(task_id,call_key)
);
