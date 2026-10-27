alter table autocut_projects add column archived_at timestamptz;
-- Analysis is a derived cache, not a permanent foreign-key barrier to explicit asset deletion.
alter table autocut_analyses drop constraint autocut_analyses_asset_version_id_fkey;
alter table autocut_analyses add constraint autocut_analyses_asset_version_id_fkey
  foreign key(asset_version_id) references asset_versions(id) on delete cascade;
alter table autocut_tasks drop constraint autocut_tasks_output_asset_version_id_fkey;
alter table autocut_tasks add constraint autocut_tasks_output_asset_version_id_fkey
  foreign key(output_asset_version_id) references asset_versions(id) on delete set null;
