-- Additive only; do not switch the active provider or rewrite existing model settings.
insert into provider_routes(id,provider_id,capability,base_url_env,api_key_env,priority) values
  ('wangsu-image','wangsu','image','WANGSU_API_BASE_URL','AIGATEWAY_TOKEN',30)
on conflict(id) do nothing;
