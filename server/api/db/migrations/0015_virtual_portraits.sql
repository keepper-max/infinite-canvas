create table if not exists virtual_portrait_libraries (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null unique references projects(id) on delete cascade,
    provider_group_id text not null unique,
    name text not null,
    provider_status text not null default 'active',
    created_by uuid not null references users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists virtual_portraits (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects(id) on delete cascade,
    library_id uuid not null references virtual_portrait_libraries(id) on delete cascade,
    source_asset_id uuid not null references assets(id) on delete restrict,
    source_asset_version_id uuid not null references asset_versions(id) on delete restrict,
    provider_record_id text,
    provider_asset_id text not null unique,
    name text not null,
    status text not null default 'processing',
    error_message text,
    created_by uuid not null references users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    archived_at timestamptz
);

create index if not exists virtual_portraits_project_status_updated_idx
    on virtual_portraits(project_id, status, updated_at desc)
    where archived_at is null;
