update platform_settings
set value='{"providerId":"token360"}',updated_at=now()
where key='managed_provider' and value->>'providerId'='volcengine_ark';

delete from model_catalog where provider_id='volcengine_ark';
delete from provider_routes where provider_id='volcengine_ark';
delete from provider_configs where provider_id='volcengine_ark';
