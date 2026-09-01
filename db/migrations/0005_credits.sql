create table if not exists credit_accounts (user_id uuid primary key references users(id) on delete cascade, balance integer not null default 1000, updated_at timestamptz not null default now());
create table if not exists credit_ledger (id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id) on delete cascade, amount integer not null, reason text not null, job_id uuid references generation_jobs(id) on delete set null, created_at timestamptz not null default now());
create index if not exists credit_ledger_user_idx on credit_ledger(user_id, created_at desc);
