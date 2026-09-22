insert into credit_accounts(user_id)
select id from users
on conflict(user_id) do nothing;

create table if not exists credit_lots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references credit_accounts(id) on delete cascade,
  source text not null,
  credits bigint not null check(credits > 0),
  remaining bigint not null check(remaining >= 0 and remaining <= credits),
  reference_type text,
  reference_id text,
  expires_at timestamptz,
  metadata jsonb not null default '{}',
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists credit_lots_account_expiry_idx
  on credit_lots(account_id,expires_at,created_at) where remaining > 0;

create table if not exists credit_lot_allocations (
  ledger_id bigint not null references credit_ledger(id) on delete restrict,
  lot_id uuid not null references credit_lots(id) on delete restrict,
  credits bigint not null check(credits > 0),
  primary key(ledger_id,lot_id)
);
create index if not exists credit_lot_allocations_lot_idx
  on credit_lot_allocations(lot_id);

alter table generation_usage add column if not exists credit_status text not null default 'historical';
alter table generation_usage add column if not exists credit_points bigint;
alter table generation_usage add column if not exists cost_cny numeric(20,8);
alter table generation_usage add column if not exists exchange_rate numeric(20,8);
alter table generation_usage add column if not exists markup numeric(10,4);
alter table generation_usage add column if not exists points_per_cny bigint;
alter table generation_usage add column if not exists credit_ledger_id bigint references credit_ledger(id) on delete set null;
create index if not exists generation_usage_credit_status_idx
  on generation_usage(credit_status,reconciled_at desc);

insert into platform_settings(key,value)
values('credit_pricing','{"pointsPerCny":100,"markup":"1.2","rounding":"ceil","usdCnyRate":null}')
on conflict(key) do nothing;
