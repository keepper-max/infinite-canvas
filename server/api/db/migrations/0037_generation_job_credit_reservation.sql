alter table generation_jobs
  add column if not exists credits_reserved integer not null default 0;
