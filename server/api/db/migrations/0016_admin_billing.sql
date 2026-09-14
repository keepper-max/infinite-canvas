alter table users add column if not exists account_status text not null default 'active';
alter table users add column if not exists disabled_reason text;
alter table users add column if not exists disabled_at timestamptz;
alter table users add column if not exists disabled_by uuid references users(id) on delete set null;
alter table users add column if not exists last_login_at timestamptz;
alter table users add column if not exists updated_at timestamptz not null default now();
create index if not exists users_status_created_idx on users(account_status, created_at desc);

alter table generation_jobs add column if not exists retry_of_job_id uuid references generation_jobs(id) on delete set null;
alter table generation_jobs add column if not exists billing_trace_id text;
alter table generation_jobs add column if not exists billing_status text not null default 'pending';
alter table generation_jobs add column if not exists billing_last_checked_at timestamptz;
alter table generation_jobs add column if not exists billing_next_check_at timestamptz;
alter table generation_jobs add column if not exists billing_started_at timestamptz;
alter table generation_jobs add column if not exists billing_error text;
alter table generation_jobs add column if not exists billing_attempt_count integer not null default 0;
alter table generation_jobs add column if not exists billing_meter_usage jsonb not null default '{}';
update generation_jobs set billing_status='unavailable',
  billing_error=case when provider='token360' then '历史任务未保存首次提交 Trace，无法精确对账' else '外部渠道无法进行 Token360 对账' end
where billing_trace_id is null;
create unique index if not exists generation_jobs_billing_trace_idx on generation_jobs(billing_trace_id) where billing_trace_id is not null;
create index if not exists generation_jobs_billing_due_idx on generation_jobs(billing_status,billing_next_check_at) where billing_status in ('pending','reconciling');
create index if not exists generation_jobs_retry_of_idx on generation_jobs(retry_of_job_id) where retry_of_job_id is not null;

create table if not exists generation_usage (
  job_id uuid primary key references generation_jobs(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  billing_request_id text not null unique,
  provider text not null,
  model_id text not null,
  capability text not null,
  status text,
  billed boolean,
  prompt_tokens bigint,
  completion_tokens bigint,
  input_tokens bigint,
  output_tokens bigint,
  total_tokens bigint,
  generated_images integer,
  audio_duration_seconds numeric(20,6),
  video_duration_seconds numeric(20,6),
  requested_seconds numeric(20,6),
  amount_base numeric(20,8),
  amount_final numeric(20,8),
  total_amount numeric(20,8),
  wallet_amount numeric(20,8),
  voucher_amount numeric(20,8),
  price numeric(20,8),
  currency text,
  provider_request_id text,
  usage jsonb not null default '{}',
  reconciled_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists generation_usage_user_created_idx on generation_usage(user_id,reconciled_at desc);
create index if not exists generation_usage_project_created_idx on generation_usage(project_id,reconciled_at desc);
create index if not exists generation_usage_model_created_idx on generation_usage(model_id,reconciled_at desc);
