-- Manual rollback only. Restore the deployment backup when data must be preserved.

alter table canvas_edges drop constraint if exists canvas_edges_source_node_fk;
alter table canvas_edges drop constraint if exists canvas_edges_target_node_fk;

drop table if exists canvas_migrations;

drop index if exists canvas_snapshots_project_created_idx;
drop index if exists canvas_snapshots_project_version_idx;
drop index if exists canvas_edges_project_target_idx;
drop index if exists canvas_nodes_project_updated_idx;

alter table canvas_snapshots drop column if exists restored_from_version;
alter table canvas_snapshots drop column if exists source;
alter table canvas_snapshots drop column if exists settings;
alter table canvas_snapshots drop column if exists viewport;
alter table canvas_snapshots drop column if exists contract_version;

alter table canvas_edges drop column if exists created_at;
alter table canvas_edges drop column if exists sort_order;
alter table canvas_edges drop column if exists role;
alter table canvas_edges drop column if exists resource_type;
alter table canvas_edges drop column if exists target_port_id;
alter table canvas_edges drop column if exists source_port_id;

alter table canvas_nodes drop column if exists created_at;
alter table canvas_nodes drop column if exists sort_order;
alter table canvas_nodes drop column if exists group_id;
alter table canvas_nodes drop column if exists locked;
alter table canvas_nodes drop column if exists height;
alter table canvas_nodes drop column if exists width;
alter table canvas_nodes drop column if exists workflow_kind;
alter table canvas_nodes drop column if exists definition_version;
alter table canvas_nodes drop column if exists definition_id;

alter table canvases drop column if exists settings;

delete from platform_schema_migrations where name = '0007_canvas_persistence.sql';
