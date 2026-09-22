create table if not exists activation_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  code_hint text not null,
  credits bigint not null check (credits > 0),
  expires_at timestamptz not null,
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  redeemed_by uuid references users(id) on delete set null,
  redeemed_at timestamptz,
  revoked_by uuid references users(id) on delete set null,
  revoked_at timestamptz
);
create index if not exists activation_codes_created_idx on activation_codes(created_at desc);
