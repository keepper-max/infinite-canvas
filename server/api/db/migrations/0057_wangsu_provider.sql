-- Additive only: do not switch the current canvas provider or modify existing jobs.
insert into provider_configs(provider_id,display_name,config,enabled) values
  ('wangsu','网宿 AI','{"apiStyle":"doubao-native","models":["doubao-seedance-2-5-260628"]}',true)
on conflict(provider_id) do nothing;

insert into provider_routes(id,provider_id,capability,base_url_env,api_key_env,priority) values
  ('wangsu-video','wangsu','video','WANGSU_API_BASE_URL','AIGATEWAY_TOKEN',30)
on conflict(id) do nothing;
