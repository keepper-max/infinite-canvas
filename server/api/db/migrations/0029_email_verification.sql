create table if not exists email_verification_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  purpose text not null default 'register',
  code_hash text not null,
  request_ip_hash text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint email_verification_status_check
    check (status in ('pending', 'consumed', 'expired', 'failed', 'superseded', 'send_failed')),
  constraint email_verification_attempts_check check (attempts >= 0)
);

create index if not exists email_verification_email_created_idx
  on email_verification_codes(email, purpose, created_at desc);
create index if not exists email_verification_ip_created_idx
  on email_verification_codes(request_ip_hash, created_at desc);
create index if not exists email_verification_created_idx
  on email_verification_codes(created_at);
create index if not exists email_verification_pending_expiry_idx
  on email_verification_codes(expires_at)
  where status = 'pending';
