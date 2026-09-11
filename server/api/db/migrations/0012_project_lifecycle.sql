alter table projects add column if not exists deleted_at timestamptz;

drop index if exists projects_owner_default_idx;
create unique index projects_owner_default_idx
  on projects(owner_id) where is_default = true and deleted_at is null;

create index if not exists projects_active_recent_idx
  on projects(last_opened_at desc, updated_at desc) where deleted_at is null;
