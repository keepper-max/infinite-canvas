-- Roll back only the additive platform tables. Legacy columns on assets remain intact.
alter table assets drop constraint if exists assets_current_version_fk;
drop table if exists asset_uploads;
drop table if exists trash_items;
drop table if exists asset_links;
drop table if exists asset_versions;
alter table assets drop column if exists current_version_id;
alter table assets drop column if exists status;
alter table assets drop column if exists created_by;
alter table assets drop column if exists updated_at;
alter table assets drop column if exists trashed_at;
