update provider_configs
set display_name='Token360', updated_at=now()
where provider_id='token360';

insert into provider_configs(provider_id,display_name,config,enabled) values
  ('runninghub','海马云','{"apiStyle":"runninghub-openapi-v2"}',true)
on conflict(provider_id) do update set
  display_name=excluded.display_name,
  config=excluded.config,
  updated_at=now();

insert into provider_routes(id,provider_id,capability,base_url_env,api_key_env,priority) values
  ('runninghub-text','runninghub','text','RH_API_BASE_URL','RH_API_KEY',20),
  ('runninghub-image','runninghub','image','RH_API_BASE_URL','RH_API_KEY',20),
  ('runninghub-video','runninghub','video','RH_API_BASE_URL','RH_API_KEY',20),
  ('runninghub-audio','runninghub','audio','RH_API_BASE_URL','RH_API_KEY',20)
on conflict(id) do update set
  provider_id=excluded.provider_id,
  capability=excluded.capability,
  base_url_env=excluded.base_url_env,
  api_key_env=excluded.api_key_env,
  updated_at=now();

create table if not exists platform_settings (
  key text primary key,
  value jsonb not null default '{}',
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into platform_settings(key,value)
values('managed_provider','{"providerId":"token360"}')
on conflict(key) do nothing;

create index if not exists model_catalog_provider_capability_idx
  on model_catalog(provider_id,capability,display_name);
