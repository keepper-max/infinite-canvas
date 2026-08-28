do $$
begin
  if exists (select 1 from pg_constraint where conname = 'canvas_nodes_pkey' and conrelid = 'canvas_nodes'::regclass) then
    alter table canvas_nodes drop constraint canvas_nodes_pkey;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'canvas_nodes_project_id_id_pk' and conrelid = 'canvas_nodes'::regclass) then
    alter table canvas_nodes add constraint canvas_nodes_project_id_id_pk primary key (project_id, id);
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'canvas_edges_pkey' and conrelid = 'canvas_edges'::regclass) then
    alter table canvas_edges drop constraint canvas_edges_pkey;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'canvas_edges_project_id_id_pk' and conrelid = 'canvas_edges'::regclass) then
    alter table canvas_edges add constraint canvas_edges_project_id_id_pk primary key (project_id, id);
  end if;
end $$;
