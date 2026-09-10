create table if not exists timelines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  node_key text not null,
  name text not null default '成片时间线',
  current_version_id uuid,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, node_key)
);

create table if not exists timeline_versions (
  id uuid primary key default gen_random_uuid(),
  timeline_id uuid not null references timelines(id) on delete cascade,
  version integer not null,
  document jsonb not null,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  unique(timeline_id, version)
);

do $$ begin
  alter table timelines add constraint timelines_current_version_fk
    foreign key (current_version_id) references timeline_versions(id) on delete set null;
exception when duplicate_object then null;
end $$;

create table if not exists composition_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  node_key text not null,
  timeline_version_id uuid not null references timeline_versions(id) on delete restrict,
  created_by uuid not null references users(id),
  status text not null default 'pending',
  progress integer not null default 0,
  idempotency_key text not null,
  request_fingerprint text not null,
  attempts integer not null default 0,
  error_code text,
  error_message text,
  retryable boolean not null default false,
  cancel_requested_at timestamptz,
  output_asset_id uuid references assets(id) on delete set null,
  output_asset_version_id uuid references asset_versions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique(project_id, idempotency_key)
);

create index if not exists composition_jobs_project_created_idx on composition_jobs(project_id, created_at desc);
create index if not exists composition_jobs_status_updated_idx on composition_jobs(status, updated_at);

create table if not exists composition_job_events (
  id bigserial primary key,
  job_id uuid not null references composition_jobs(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  event_type text not null,
  status text not null,
  progress integer not null default 0,
  message text,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists composition_job_events_project_idx on composition_job_events(project_id, id);

