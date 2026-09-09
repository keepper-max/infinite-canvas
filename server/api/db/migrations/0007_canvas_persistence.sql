alter table canvases
  add column if not exists settings jsonb not null default '{"backgroundMode":"lines","showImageInfo":false}'::jsonb;

create table if not exists canvas_nodes (
  id text not null,
  project_id uuid not null references projects(id) on delete cascade,
  definition_id text not null default 'legacy',
  definition_version integer not null default 1,
  node_type text not null,
  workflow_kind text not null default 'generic',
  label text not null,
  position jsonb not null,
  width integer not null default 320,
  height integer not null default 220,
  locked boolean not null default false,
  group_id text,
  sort_order integer not null default 0,
  data jsonb not null default '{}',
  status text not null default 'idle',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, id)
);

alter table canvas_nodes add column if not exists definition_id text not null default 'legacy';
alter table canvas_nodes add column if not exists definition_version integer not null default 1;
alter table canvas_nodes add column if not exists workflow_kind text not null default 'generic';
alter table canvas_nodes add column if not exists width integer not null default 320;
alter table canvas_nodes add column if not exists height integer not null default 220;
alter table canvas_nodes add column if not exists locked boolean not null default false;
alter table canvas_nodes add column if not exists group_id text;
alter table canvas_nodes add column if not exists sort_order integer not null default 0;
alter table canvas_nodes add column if not exists created_at timestamptz not null default now();

create table if not exists canvas_edges (
  id text not null,
  project_id uuid not null references projects(id) on delete cascade,
  source_node_id text not null,
  source_port_id text not null default 'legacy.output',
  target_node_id text not null,
  target_port_id text not null default 'legacy.input',
  resource_type text not null default 'asset',
  role text not null default 'data',
  sort_order integer not null default 0,
  edge_type text not null default 'reference',
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  primary key (project_id, id)
);

alter table canvas_edges add column if not exists source_port_id text not null default 'legacy.output';
alter table canvas_edges add column if not exists target_port_id text not null default 'legacy.input';
alter table canvas_edges add column if not exists resource_type text not null default 'asset';
alter table canvas_edges add column if not exists role text not null default 'data';
alter table canvas_edges add column if not exists sort_order integer not null default 0;
alter table canvas_edges add column if not exists created_at timestamptz not null default now();

create table if not exists canvas_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  version integer not null,
  contract_version integer not null default 1,
  nodes jsonb not null,
  edges jsonb not null,
  viewport jsonb not null default '{"x":0,"y":0,"k":1}'::jsonb,
  settings jsonb not null default '{"backgroundMode":"lines","showImageInfo":false}'::jsonb,
  source text not null default 'save',
  restored_from_version integer,
  created_at timestamptz not null default now(),
  unique(project_id, version)
);

alter table canvas_snapshots add column if not exists contract_version integer not null default 1;
alter table canvas_snapshots add column if not exists viewport jsonb not null default '{"x":0,"y":0,"k":1}'::jsonb;
alter table canvas_snapshots add column if not exists settings jsonb not null default '{"backgroundMode":"lines","showImageInfo":false}'::jsonb;
alter table canvas_snapshots add column if not exists source text not null default 'save';
alter table canvas_snapshots add column if not exists restored_from_version integer;

create table if not exists canvas_migrations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  migration_key text not null,
  from_revision integer not null default 0,
  to_revision integer not null,
  report jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique(project_id, user_id, migration_key)
);

update canvases c
set revision = greatest(c.revision, snapshots.latest_version)
from (
  select project_id, max(version) as latest_version
  from canvas_snapshots
  group by project_id
) snapshots
where c.project_id = snapshots.project_id;

create index if not exists canvas_nodes_project_updated_idx on canvas_nodes(project_id, sort_order, updated_at desc);
create index if not exists canvas_edges_project_target_idx on canvas_edges(project_id, target_node_id, sort_order);
create unique index if not exists canvas_snapshots_project_version_idx on canvas_snapshots(project_id, version);
create index if not exists canvas_snapshots_project_created_idx on canvas_snapshots(project_id, created_at desc);
create unique index if not exists canvas_migrations_project_user_key_idx on canvas_migrations(project_id, user_id, migration_key);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'canvas_edges_source_node_fk') then
    alter table canvas_edges add constraint canvas_edges_source_node_fk
      foreign key (project_id, source_node_id) references canvas_nodes(project_id, id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'canvas_edges_target_node_fk') then
    alter table canvas_edges add constraint canvas_edges_target_node_fk
      foreign key (project_id, target_node_id) references canvas_nodes(project_id, id) on delete cascade not valid;
  end if;
end $$;
