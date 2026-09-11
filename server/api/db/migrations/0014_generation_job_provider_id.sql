alter table generation_jobs
  add column if not exists provider_job_id text;
