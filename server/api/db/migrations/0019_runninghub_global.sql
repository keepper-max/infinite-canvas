update provider_configs
set display_name='海马云 · 中国区',updated_at=now()
where provider_id='runninghub';

insert into provider_configs(provider_id,display_name,config,enabled) values
  ('runninghub_global','海马云 · 国际区','{"apiStyle":"runninghub-openapi-v2","region":"global"}',true)
on conflict(provider_id) do update set
  display_name=excluded.display_name,
  config=excluded.config,
  updated_at=now();

insert into provider_routes(id,provider_id,capability,base_url_env,api_key_env,priority) values
  ('runninghub-global-image','runninghub_global','image','RH_GLOBAL_API_BASE_URL','RH_GLOBAL_API_KEY',20)
on conflict(id) do update set
  provider_id=excluded.provider_id,
  capability=excluded.capability,
  base_url_env=excluded.base_url_env,
  api_key_env=excluded.api_key_env,
  updated_at=now();
