create table if not exists activation_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  code_hint text not null,
  credits integer not null check (credits > 0),
  expires_at timestamptz not null,
  created_by uuid not null references users(id),
  redeemed_by uuid references users(id),
  redeemed_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index if not exists activation_codes_created_at_idx on activation_codes(created_at desc);
alter table credit_ledger add column if not exists activation_code_id uuid references activation_codes(id);
create unique index if not exists credit_ledger_activation_code_id_idx on credit_ledger(activation_code_id) where activation_code_id is not null;
