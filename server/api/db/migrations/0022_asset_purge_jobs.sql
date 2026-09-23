create table if not exists asset_purge_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  asset_id uuid not null unique,
  storage_keys jsonb not null default '[]'::jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  requested_by uuid references users(id) on delete set null,
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists asset_purge_jobs_status_requested_idx
  on asset_purge_jobs(status, requested_at);
