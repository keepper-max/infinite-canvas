alter table users add column if not exists is_admin boolean not null default false;

create table if not exists sms_verification_requests (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  purpose text not null,
  code_hash text,
  status text not null default 'disabled',
  attempts integer not null default 0,
  expires_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sms_verification_phone_created_idx on sms_verification_requests(phone, created_at desc);

create table if not exists credit_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id) on delete cascade,
  balance bigint not null default 0,
  reserved bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists credit_ledger (
  id bigserial primary key,
  account_id uuid not null references credit_accounts(id) on delete cascade,
  entry_type text not null,
  delta bigint not null,
  balance_after bigint not null,
  reference_type text,
  reference_id text,
  idempotency_key text not null unique,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_account_created_idx on credit_ledger(account_id, created_at desc);

create table if not exists billing_plans (
  id text primary key,
  name text not null,
  credits bigint not null default 0,
  price_cents integer not null default 0,
  currency text not null default 'CNY',
  enabled boolean not null default false,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete restrict,
  plan_id text references billing_plans(id) on delete restrict,
  amount_cents integer not null default 0,
  currency text not null default 'CNY',
  provider text not null,
  provider_order_id text,
  status text not null default 'disabled',
  idempotency_key text not null,
  metadata jsonb not null default '{}',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, idempotency_key)
);
create index if not exists payment_orders_user_created_idx on payment_orders(user_id, created_at desc);

create table if not exists payment_callback_receipts (
  id bigserial primary key,
  provider text not null,
  event_id text not null,
  payload_sha256 text not null,
  signature_valid boolean not null default false,
  status text not null default 'disabled',
  created_at timestamptz not null default now(),
  unique(provider, event_id)
);

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key(team_id, user_id)
);
create index if not exists team_members_user_idx on team_members(user_id);

create table if not exists team_projects (
  team_id uuid not null references teams(id) on delete cascade,
  project_id uuid not null unique references projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(team_id, project_id)
);

create table if not exists admin_audit_logs (
  id bigserial primary key,
  actor_user_id uuid references users(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  request_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_logs_actor_created_idx on admin_audit_logs(actor_user_id, created_at desc);
