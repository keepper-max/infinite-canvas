drop index if exists projects_active_recent_idx;
drop index if exists projects_owner_default_idx;
create unique index projects_owner_default_idx
  on projects(owner_id) where is_default = true;
alter table projects drop column if exists deleted_at;
