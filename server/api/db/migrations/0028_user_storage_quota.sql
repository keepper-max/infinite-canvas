create table if not exists user_storage_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  reservation_key text not null unique,
  bytes bigint not null check (bytes >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists user_storage_reservations_user_expiry_idx
  on user_storage_reservations(user_id, expires_at);
