create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id),
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table projects add column if not exists is_default boolean not null default false;
alter table projects add column if not exists last_opened_at timestamptz not null default now();

create table if not exists project_members (
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'editor',
  primary key (project_id, user_id)
);

insert into project_members (project_id, user_id, role)
select id, owner_id, 'owner' from projects
on conflict (project_id, user_id) do nothing;

create table if not exists canvases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references projects(id) on delete cascade,
  revision integer not null default 0,
  contract_version integer not null default 1,
  viewport jsonb not null default '{"x":0,"y":0,"k":1}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into canvases (project_id)
select id from projects
on conflict (project_id) do nothing;

create unique index if not exists projects_owner_default_idx
  on projects(owner_id) where is_default = true;
create unique index if not exists project_members_project_user_idx
  on project_members(project_id, user_id);
create index if not exists project_members_user_idx on project_members(user_id);
create index if not exists projects_recent_idx on projects(last_opened_at desc, updated_at desc);
create index if not exists sessions_token_hash_idx on sessions(token_hash);
create index if not exists sessions_user_expiry_idx on sessions(user_id, expires_at);
