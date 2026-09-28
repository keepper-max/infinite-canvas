create table if not exists channels (
  id uuid primary key default gen_random_uuid(),
  system_key text unique,
  channel_type text not null,
  channel_name text not null,
  code_prefix text,
  contact_name text,
  contact_phone text,
  remark text not null default '',
  status text not null default 'active' check(status in ('active','disabled')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists channels_code_prefix_uidx
  on channels(upper(code_prefix)) where code_prefix is not null;
create index if not exists channels_type_status_idx on channels(channel_type,status);

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references channels(id) on delete restrict,
  name text not null,
  description text not null default '',
  start_at timestamptz,
  end_at timestamptz,
  status text not null default 'active' check(status in ('active','disabled')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(end_at is null or start_at is null or end_at > start_at)
);
create index if not exists campaigns_channel_status_idx on campaigns(channel_id,status);

create table if not exists batches (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete restrict,
  name text not null,
  description text not null default '',
  start_at timestamptz,
  end_at timestamptz,
  status text not null default 'active' check(status in ('active','disabled')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(end_at is null or start_at is null or end_at > start_at)
);
create index if not exists batches_campaign_status_idx on batches(campaign_id,status);

create table if not exists invite_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  channel_id uuid not null references channels(id) on delete restrict,
  campaign_id uuid references campaigns(id) on delete restrict,
  batch_id uuid references batches(id) on delete restrict,
  name text not null,
  description text not null default '',
  max_uses integer check(max_uses is null or max_uses > 0),
  used_count integer not null default 0 check(used_count >= 0),
  start_at timestamptz,
  expire_at timestamptz,
  status text not null default 'active' check(status in ('active','disabled')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(expire_at is null or start_at is null or expire_at > start_at)
);
create unique index if not exists invite_codes_code_uidx on invite_codes(upper(code));
create index if not exists invite_codes_channel_idx on invite_codes(channel_id);
create index if not exists invite_codes_campaign_idx on invite_codes(campaign_id);
create index if not exists invite_codes_batch_idx on invite_codes(batch_id);
create index if not exists invite_codes_status_time_idx on invite_codes(status,start_at,expire_at);

insert into channels(id,system_key,channel_type,channel_name,code_prefix,remark,status)
values
  ('00000000-0000-4000-8000-000000000361','legacy','legacy','历史用户',null,'系统内置渠道','active'),
  ('00000000-0000-4000-8000-000000000362','organic','organic','自然注册','ORG','系统内置渠道','active')
on conflict(system_key) do nothing;

alter table users add column if not exists invite_code_id uuid references invite_codes(id) on delete restrict;
alter table users add column if not exists channel_id uuid references channels(id) on delete restrict;
alter table users add column if not exists campaign_id uuid references campaigns(id) on delete restrict;
alter table users add column if not exists batch_id uuid references batches(id) on delete restrict;
alter table users add column if not exists source_registered_at timestamptz;
alter table users add column if not exists registration_ip inet;

update users
set channel_id=(select id from channels where system_key='legacy'),
    source_registered_at=created_at
where channel_id is null;

alter table users alter column channel_id set not null;
alter table users alter column source_registered_at set not null;
alter table users alter column channel_id set default '00000000-0000-4000-8000-000000000362'::uuid;
alter table users alter column source_registered_at set default now();
create index if not exists users_invite_code_idx on users(invite_code_id);
create index if not exists users_channel_idx on users(channel_id);
create index if not exists users_campaign_idx on users(campaign_id);
create index if not exists users_batch_idx on users(batch_id);
create index if not exists users_source_registered_idx on users(source_registered_at desc);
create index if not exists users_registration_ip_created_idx on users(registration_ip,created_at desc);

create table if not exists registration_risk_events (
  id bigserial primary key,
  ip_address inet,
  device_hash text,
  event_type text not null check(event_type in ('attempt','invite_failure','success')),
  created_at timestamptz not null default now()
);
create index if not exists registration_risk_ip_created_idx
  on registration_risk_events(ip_address,created_at desc);
create index if not exists registration_risk_device_created_idx
  on registration_risk_events(device_hash,created_at desc) where device_hash is not null;
create index if not exists registration_risk_created_idx on registration_risk_events(created_at);

alter table admin_audit_logs add column if not exists actor_ip inet;

insert into platform_settings(key,value)
values
  ('registration_invite','{"mode":"optional"}'),
  ('registration_risk','{"windowMinutes":10,"maxAttempts":5,"maxInviteFailures":5,"maxSuccessfulAccountsPerIpDay":50,"deviceRetentionDays":7}')
on conflict(key) do nothing;

create index if not exists payment_orders_paid_user_idx
  on payment_orders(user_id,paid_at desc) where status='paid';
create index if not exists generation_jobs_creator_created_idx
  on generation_jobs(created_by,created_at desc);
create index if not exists credit_ledger_generation_created_idx
  on credit_ledger(account_id,created_at desc) where entry_type='generation';
