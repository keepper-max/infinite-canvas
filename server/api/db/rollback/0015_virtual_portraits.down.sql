-- Manual rollback only. Take a fresh full database backup before running.
-- These tables only contain provider links; source assets and versions are preserved.
drop table if exists virtual_portraits;
drop table if exists virtual_portrait_libraries;
