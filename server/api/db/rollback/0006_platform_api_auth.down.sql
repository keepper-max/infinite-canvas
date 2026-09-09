-- Manual rollback only. Take a fresh full database backup before running.
-- This removes only schema introduced by 0006_platform_api_auth.sql.

drop index if exists sessions_user_expiry_idx;
drop index if exists sessions_token_hash_idx;
drop index if exists projects_recent_idx;
drop index if exists project_members_user_idx;
drop index if exists project_members_project_user_idx;
drop index if exists projects_owner_default_idx;

drop table if exists canvases;

alter table projects drop column if exists last_opened_at;
alter table projects drop column if exists is_default;

delete from platform_schema_migrations
where name = '0006_platform_api_auth.sql';
