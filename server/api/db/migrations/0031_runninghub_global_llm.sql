insert into provider_routes(id,provider_id,capability,base_url_env,api_key_env,priority) values
  ('runninghub-global-text','runninghub_global','text','RH_GLOBAL_LLM_BASE_URL','RH_GLOBAL_API_KEY',20)
on conflict(id) do update set
  provider_id=excluded.provider_id,
  capability=excluded.capability,
  base_url_env=excluded.base_url_env,
  api_key_env=excluded.api_key_env,
  updated_at=now();
