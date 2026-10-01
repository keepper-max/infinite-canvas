insert into provider_configs(provider_id,display_name,config,enabled) values
  ('volcengine_ark','火山方舟','{"apiStyle":"volcengine-ark-v3","region":"cn-beijing"}',true)
on conflict(provider_id) do update set
  display_name=excluded.display_name,
  config=excluded.config,
  updated_at=now();

insert into provider_routes(id,provider_id,capability,base_url_env,api_key_env,priority) values
  ('volcengine-ark-text','volcengine_ark','text','VOLCENGINE_ARK_API_BASE_URL','VOLCENGINE_ARK_API_KEY',30),
  ('volcengine-ark-image','volcengine_ark','image','VOLCENGINE_ARK_API_BASE_URL','VOLCENGINE_ARK_API_KEY',30),
  ('volcengine-ark-video','volcengine_ark','video','VOLCENGINE_ARK_API_BASE_URL','VOLCENGINE_ARK_API_KEY',30)
on conflict(id) do update set
  provider_id=excluded.provider_id,
  capability=excluded.capability,
  base_url_env=excluded.base_url_env,
  api_key_env=excluded.api_key_env,
  updated_at=now();
