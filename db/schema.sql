-- 灵创视界类漫剧平台：第一阶段持久化边界草案
-- 当前界面仍使用浏览器本地状态，接入服务端时以此 schema 为基础迁移。

create table if not exists users (
  id uuid primary key,
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key,
  owner_id uuid not null references users(id),
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists project_members (
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'editor',
  primary key (project_id, user_id)
);

create table if not exists assets (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null,
  name text not null,
  uri text,
  version integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists canvas_nodes (
  id text not null,
  project_id uuid not null references projects(id) on delete cascade,
  node_type text not null,
  label text not null,
  position jsonb not null,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'idle',
  updated_at timestamptz not null default now(),
  primary key (project_id, id)
);

create table if not exists canvas_edges (
  id text not null,
  project_id uuid not null references projects(id) on delete cascade,
  source_node_id uuid not null references canvas_nodes(id) on delete cascade,
  target_node_id uuid not null references canvas_nodes(id) on delete cascade,
  edge_type text not null,
  primary key (project_id, id)
);

create table if not exists generation_jobs (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  node_id uuid references canvas_nodes(id) on delete set null,
  provider text not null,
  model_id text not null,
  mode text not null,
  prompt_version integer not null default 1,
  input jsonb not null default '{}'::jsonb,
  parameters jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  provider_job_id text,
  error_reason text,
  credits_reserved integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists job_events (
  id bigserial primary key,
  job_id uuid not null references generation_jobs(id) on delete cascade,
  status text not null,
  progress integer not null default 0,
  message text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists job_artifacts (
  id uuid primary key,
  job_id uuid not null references generation_jobs(id) on delete cascade,
  asset_id uuid references assets(id) on delete set null,
  uri text not null,
  mime_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists story_outlines (
  id uuid primary key default gen_random_uuid(), project_id uuid not null unique references projects(id) on delete cascade,
  title text not null default '', content text not null default '', updated_at timestamptz not null default now()
);

create table if not exists project_agents (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references projects(id) on delete cascade,
  name text not null, kind text not null default 'agent', enabled integer not null default 1,
  config jsonb not null default '{}', updated_at timestamptz not null default now()
);

create table if not exists automation_runs (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references projects(id) on delete cascade,
  template text not null, status text not null default 'draft', input jsonb not null default '{}', created_at timestamptz not null default now()
);
