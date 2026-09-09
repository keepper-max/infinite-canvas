create table if not exists assets (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects(id) on delete cascade,
    kind text not null,
    name text not null,
    object_key text,
    uri text,
    mime_type text,
    size integer,
    version integer,
    metadata jsonb,
    created_at timestamptz not null default now()
);

alter table assets add column if not exists object_key text;
alter table assets add column if not exists uri text;
alter table assets add column if not exists mime_type text;
alter table assets add column if not exists size integer;
alter table assets add column if not exists version integer;
alter table assets add column if not exists metadata jsonb;

alter table assets add column if not exists current_version_id uuid;
alter table assets add column if not exists status text not null default 'active';
alter table assets add column if not exists created_by uuid references users(id);
alter table assets add column if not exists updated_at timestamptz not null default now();
alter table assets add column if not exists trashed_at timestamptz;

-- The pre-platform schema stored the current object directly on assets. Keep those
-- columns for rollback, but allow new rows to use the version table exclusively.
alter table assets alter column object_key drop not null;
alter table assets alter column uri drop not null;
alter table assets alter column mime_type drop not null;
alter table assets alter column size drop not null;
alter table assets alter column version drop not null;
alter table assets alter column metadata drop not null;

update assets a
set created_by = p.owner_id
from projects p
where a.project_id = p.id and a.created_by is null;
alter table assets alter column created_by set not null;

create index if not exists assets_project_status_updated_idx on assets(project_id, status, updated_at desc);

create table if not exists asset_versions (
    id uuid primary key default gen_random_uuid(),
    asset_id uuid not null references assets(id) on delete cascade,
    version integer not null,
    storage_key text not null unique,
    mime_type text not null,
    bytes bigint not null default 0,
    width integer,
    height integer,
    duration_ms integer,
    sha256 text not null,
    source text not null,
    source_job_id uuid,
    parent_version_ids jsonb not null default '[]'::jsonb,
    provenance jsonb not null default '{}'::jsonb,
    thumbnail_storage_key text unique,
    thumbnail_mime_type text,
    thumbnail_bytes bigint,
    created_by uuid references users(id),
    created_at timestamptz not null default now(),
    unique(asset_id, version)
);

insert into asset_versions(asset_id, version, storage_key, mime_type, bytes, width, height, duration_ms, sha256, source, provenance, created_by, created_at)
select a.id,
       greatest(coalesce(a.version, 1), 1),
       a.object_key,
       coalesce(nullif(a.mime_type, ''), 'application/octet-stream'),
       greatest(coalesce(a.size, 0), 0),
       case when a.metadata->>'width' ~ '^[0-9]+$' then nullif((a.metadata->>'width')::integer, 0) end,
       case when a.metadata->>'height' ~ '^[0-9]+$' then nullif((a.metadata->>'height')::integer, 0) end,
       case when a.metadata->>'durationMs' ~ '^[0-9]+$' then nullif((a.metadata->>'durationMs')::integer, 0) end,
       coalesce(nullif(a.metadata->>'sha256', ''), repeat('0', 64)),
       'migration',
       coalesce(a.metadata, '{}'::jsonb),
       a.created_by,
       a.created_at
from assets a
where a.object_key is not null
on conflict do nothing;
alter table asset_versions alter column created_by set not null;

update assets a
set current_version_id = v.id
from asset_versions v
where v.asset_id = a.id and a.current_version_id is null;

do $$ begin
    alter table assets add constraint assets_current_version_fk foreign key (current_version_id) references asset_versions(id);
exception when duplicate_object then null;
end $$;

create index if not exists asset_versions_asset_created_idx on asset_versions(asset_id, version desc);

create table if not exists asset_links (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects(id) on delete cascade,
    asset_version_id uuid not null references asset_versions(id) on delete restrict,
    node_id text,
    role text not null default 'reference',
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists asset_links_project_version_idx on asset_links(project_id, asset_version_id);
create index if not exists asset_links_project_node_idx on asset_links(project_id, node_id);

create table if not exists trash_items (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects(id) on delete cascade,
    object_type text not null,
    object_id uuid not null,
    reason text not null default '',
    metadata jsonb not null default '{}'::jsonb,
    deleted_by uuid references users(id),
    deleted_at timestamptz not null default now()
);

create unique index if not exists trash_items_active_object_idx on trash_items(project_id, object_type, object_id);

create table if not exists asset_uploads (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects(id) on delete cascade,
    asset_id uuid not null references assets(id) on delete cascade,
    storage_key text not null unique,
    mime_type text not null,
    bytes bigint not null,
    sha256 text not null,
    width integer,
    height integer,
    duration_ms integer,
    source text not null,
    parent_version_ids jsonb not null default '[]'::jsonb,
    provenance jsonb not null default '{}'::jsonb,
    thumbnail_storage_key text unique,
    thumbnail_mime_type text,
    thumbnail_bytes bigint,
    thumbnail_sha256 text,
    created_by uuid references users(id),
    completed_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists asset_uploads_project_created_idx on asset_uploads(project_id, created_at desc);
