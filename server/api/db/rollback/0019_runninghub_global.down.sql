update platform_settings
set value='{"providerId":"runninghub"}',updated_at=now()
where key='managed_provider' and value->>'providerId'='runninghub_global';

delete from model_catalog where provider_id='runninghub_global';
delete from provider_routes where provider_id='runninghub_global';
delete from provider_configs where provider_id='runninghub_global';

update provider_configs
set display_name='海马云',updated_at=now()
where provider_id='runninghub';
