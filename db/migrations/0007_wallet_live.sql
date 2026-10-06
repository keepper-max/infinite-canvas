create table if not exists payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  amount_cents integer not null check (amount_cents > 0),
  credits integer not null check (credits > 0),
  status text not null default 'pending',
  alipay_trade_no text unique,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists payment_orders_user_created_idx on payment_orders(user_id, created_at desc);

create table if not exists credit_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  source_type text not null,
  source_id uuid not null,
  credits_total integer not null check (credits_total >= 0),
  credits_remaining integer not null check (credits_remaining >= 0),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source_type, source_id)
);
create index if not exists credit_lots_spend_idx on credit_lots(user_id, expires_at, created_at) where credits_remaining > 0;

create table if not exists credit_lot_debits (
  ledger_id uuid not null references credit_ledger(id),
  lot_id uuid not null references credit_lots(id),
  credits integer not null check (credits > 0),
  primary key (ledger_id, lot_id)
);

alter table credit_ledger add column if not exists payment_order_id uuid references payment_orders(id);
create unique index if not exists credit_ledger_payment_order_idx on credit_ledger(payment_order_id) where payment_order_id is not null;
create unique index if not exists credit_ledger_job_charge_idx on credit_ledger(job_id) where job_id is not null and amount < 0;

alter table generation_jobs add column if not exists billing_trace_id text;
alter table generation_jobs add column if not exists billing_status text not null default 'not_applicable';
alter table generation_jobs add column if not exists billing_attempts integer not null default 0;
alter table generation_jobs add column if not exists billed_points integer;
alter table generation_jobs add column if not exists billed_amount numeric(20,8);
alter table generation_jobs add column if not exists billed_currency text;
alter table generation_jobs add column if not exists billed_fx_rate numeric(20,8);

-- Existing balances predate source tracking. Preserve them as one non-expiring legacy lot.
insert into credit_lots (user_id, source_type, source_id, credits_total, credits_remaining)
select user_id, 'legacy', user_id, greatest(balance, 0), greatest(balance, 0)
from credit_accounts
on conflict (source_type, source_id) do nothing;
