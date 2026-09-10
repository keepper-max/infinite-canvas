create table if not exists model_catalog (
  id text primary key,
  display_name text not null,
  capability text not null,
  upstream_model text not null,
  provider_id text not null,
  discovered boolean not null default false,
  enabled boolean not null default false,
  healthy boolean not null default false,
  catalog_metadata jsonb not null default '{}',
  discovered_at timestamptz,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists model_capabilities (
  model_id text primary key references model_catalog(id) on delete cascade,
  modes jsonb not null default '[]',
  accepted_parameters jsonb not null default '[]',
  required_parameters_by_mode jsonb not null default '{}',
  limits jsonb not null default '{}',
  parameter_map jsonb not null default '{}',
  overrides_version integer not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists provider_routes (
  id text primary key,
  provider_id text not null,
  capability text not null,
  base_url_env text not null,
  api_key_env text not null,
  enabled boolean not null default true,
  priority integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists provider_configs (
  provider_id text primary key,
  display_name text not null,
  config jsonb not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workflow_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  created_by uuid not null references users(id),
  status text not null default 'pending',
  input_snapshot jsonb not null default '{}',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table if not exists node_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_run_id uuid references workflow_runs(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  node_key text not null,
  node_revision integer not null default 0,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table if not exists generation_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  node_id uuid,
  provider text not null default 'managed',
  model_id text not null,
  mode text not null,
  prompt_version integer not null default 1,
  input jsonb not null default '{}',
  parameters jsonb not null default '{}',
  status text not null default 'pending',
  provider_job_id text,
  error_reason text,
  credits_reserved integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table generation_jobs add column if not exists node_key text;
alter table generation_jobs add column if not exists node_run_id uuid references node_runs(id) on delete set null;
alter table generation_jobs add column if not exists created_by uuid references users(id);
alter table generation_jobs add column if not exists capability text;
alter table generation_jobs add column if not exists node_revision integer not null default 0;
alter table generation_jobs add column if not exists idempotency_key text;
alter table generation_jobs add column if not exists request_fingerprint text;
alter table generation_jobs add column if not exists input_snapshot jsonb not null default '{}';
alter table generation_jobs add column if not exists compiled_request jsonb;
alter table generation_jobs add column if not exists progress integer not null default 0;
alter table generation_jobs add column if not exists max_attempts integer not null default 3;
alter table generation_jobs add column if not exists attempt_count integer not null default 0;
alter table generation_jobs add column if not exists retryable boolean not null default false;
alter table generation_jobs add column if not exists provider_error_code text;
alter table generation_jobs add column if not exists provider_error_sanitized jsonb;
alter table generation_jobs add column if not exists user_error_code text;
alter table generation_jobs add column if not exists user_error_message text;
alter table generation_jobs add column if not exists bullmq_job_id text;
alter table generation_jobs add column if not exists queued_at timestamptz;
alter table generation_jobs add column if not exists started_at timestamptz;
alter table generation_jobs add column if not exists finished_at timestamptz;
alter table generation_jobs add column if not exists heartbeat_at timestamptz;
alter table generation_jobs add column if not exists cancel_requested_at timestamptz;
alter table generation_jobs add column if not exists output_asset_version_ids jsonb not null default '[]';

update generation_jobs j set created_by = p.owner_id from projects p where j.project_id = p.id and j.created_by is null;
update generation_jobs set capability = case when mode in ('t2v','i2v','flf2v','multiref','extend') then 'video' else coalesce(capability, 'video') end where capability is null;

create unique index if not exists generation_jobs_project_idempotency_idx on generation_jobs(project_id, idempotency_key) where idempotency_key is not null;
create index if not exists generation_jobs_project_created_idx on generation_jobs(project_id, created_at desc);
create index if not exists generation_jobs_status_heartbeat_idx on generation_jobs(status, heartbeat_at);

create table if not exists job_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references generation_jobs(id) on delete cascade,
  attempt integer not null,
  status text not null,
  provider_job_id text,
  error_code text,
  error_sanitized jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique(job_id, attempt)
);

create table if not exists job_events (
  id bigserial primary key,
  job_id uuid not null references generation_jobs(id) on delete cascade,
  status text not null,
  progress integer not null default 0,
  message text,
  created_at timestamptz not null default now()
);

alter table job_events add column if not exists project_id uuid references projects(id) on delete cascade;
alter table job_events add column if not exists sequence integer;
alter table job_events add column if not exists event_type text;
alter table job_events add column if not exists node_key text;
alter table job_events add column if not exists data jsonb not null default '{}';
update job_events e set project_id = j.project_id from generation_jobs j where e.job_id = j.id and e.project_id is null;
update job_events set event_type = coalesce(event_type, status), sequence = coalesce(sequence, id::integer) where event_type is null or sequence is null;
create unique index if not exists job_events_job_sequence_idx on job_events(job_id, sequence);
create index if not exists job_events_project_id_idx on job_events(project_id, id);

create or replace function assign_job_event_sequence() returns trigger language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.job_id::text, 0));
  select coalesce(max(sequence), 0) + 1 into new.sequence from job_events where job_id = new.job_id;
  return new;
end;
$$;
drop trigger if exists job_events_assign_sequence on job_events;
create trigger job_events_assign_sequence before insert on job_events for each row execute function assign_job_event_sequence();

create table if not exists job_artifacts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references generation_jobs(id) on delete cascade,
  asset_id uuid references assets(id),
  uri text,
  mime_type text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table job_artifacts add column if not exists project_id uuid references projects(id) on delete cascade;
alter table job_artifacts add column if not exists asset_version_id uuid references asset_versions(id) on delete restrict;
alter table job_artifacts add column if not exists role text not null default 'output';
alter table job_artifacts add column if not exists sort_order integer not null default 0;
alter table job_artifacts add column if not exists storage_key text;
update job_artifacts a set project_id = j.project_id from generation_jobs j where a.job_id = j.id and a.project_id is null;
create index if not exists job_artifacts_job_order_idx on job_artifacts(job_id, sort_order);

insert into provider_configs(provider_id, display_name, config) values
  ('token360', '内置模型服务', '{"apiStyle":"openai-compatible"}')
on conflict(provider_id) do update set display_name = excluded.display_name, config = excluded.config, updated_at = now();

insert into provider_routes(id, provider_id, capability, base_url_env, api_key_env, priority) values
  ('token360-text', 'token360', 'text', 'TOKEN360_UPSTREAM', 'TOKEN360_API_KEY', 10),
  ('token360-image', 'token360', 'image', 'TOKEN360_UPSTREAM', 'TOKEN360_API_KEY', 10),
  ('token360-video', 'token360', 'video', 'TOKEN360_UPSTREAM', 'TOKEN360_API_KEY', 10),
  ('token360-audio', 'token360', 'audio', 'TOKEN360_UPSTREAM', 'TOKEN360_API_KEY', 10)
on conflict(id) do update set provider_id = excluded.provider_id, capability = excluded.capability, base_url_env = excluded.base_url_env, api_key_env = excluded.api_key_env, updated_at = now();

insert into model_catalog(id, display_name, capability, upstream_model, provider_id, discovered, enabled, healthy) values
  ('text.gpt-5-5', 'GPT-5.5', 'text', 'gpt-5.5', 'token360', false, true, false),
  ('image.nano-banana-2', 'Nano Banana 2', 'image', 'nano-banana-2', 'token360', false, true, false),
  ('video.seedance-2-5', 'Seedance 2.5', 'video', 'seedance-2.5', 'token360', false, true, false),
  ('audio.seed-audio-1', 'Seed Audio 1.0', 'audio', 'seed-audio-1.0', 'token360', false, true, false)
on conflict(id) do update set display_name = excluded.display_name, capability = excluded.capability, upstream_model = excluded.upstream_model, provider_id = excluded.provider_id, enabled = excluded.enabled, updated_at = now();

insert into model_capabilities(model_id, modes, accepted_parameters, required_parameters_by_mode, limits, parameter_map) values
  ('text.gpt-5-5', '["chat"]', '["reasoningEffort","systemPrompt"]', '{}', '{"maxPromptChars":120000}', '{}'),
  ('image.nano-banana-2', '["t2i","i2i"]', '["count","size","quality","background","references"]', '{"i2i":["references"]}', '{"maxImages":9,"maxPromptChars":20000}', '{"count":"n","references":"images"}'),
  ('video.seedance-2-5', '["t2v","i2v","flf2v","multiref"]', '["duration","resolution","aspectRatio","generateAudio","watermark","firstFrame","lastFrame","references"]', '{"i2v":["firstFrame"],"flf2v":["firstFrame","lastFrame"],"multiref":["references"]}', '{"maxImages":9,"maxVideos":3,"maxAudios":3,"maxPromptChars":20000}', '{"duration":"duration","resolution":"resolution","aspectRatio":"aspect_ratio","generateAudio":"generate_audio","watermark":"watermark"}'),
  ('audio.seed-audio-1', '["tts"]', '["voice","format","speed","instructions"]', '{}', '{"maxPromptChars":10000}', '{"format":"response_format"}')
on conflict(model_id) do update set modes = excluded.modes, accepted_parameters = excluded.accepted_parameters, required_parameters_by_mode = excluded.required_parameters_by_mode, limits = excluded.limits, parameter_map = excluded.parameter_map, overrides_version = model_capabilities.overrides_version + 1, updated_at = now();
