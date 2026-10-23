-- Additive only. Historical canvas rows and snapshots are deliberately untouched.
create table canvas_operations (
  project_id uuid not null,
  actor_id uuid not null,
  operation_id uuid not null,
  kind text not null,
  payload_hash text not null,
  receipt jsonb not null,
  created_at timestamptz not null default now(),
  primary key (project_id, actor_id, operation_id)
);

create table canvas_repair_archives (
  id uuid primary key,
  project_id uuid not null,
  actor_id uuid not null,
  operation_id uuid not null,
  reason text not null,
  state_hash text not null,
  before_state jsonb not null,
  resulting_revision integer not null,
  created_at timestamptz not null default now(),
  unique (project_id, actor_id, operation_id)
);
-- No cascading FKs: receipts/archives survive account/project lifecycle changes.
-- Rollback is application read-only mode, not dropping these audit/history tables.
