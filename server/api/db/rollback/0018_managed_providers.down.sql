drop index if exists model_catalog_provider_capability_idx;
drop table if exists platform_settings;
delete from provider_routes where provider_id='runninghub';
delete from provider_configs where provider_id='runninghub';
update provider_configs set display_name='内置模型服务',updated_at=now() where provider_id='token360';
