delete from platform_settings where key='credit_guard';
drop index if exists generation_jobs_credit_delivery_idx;
alter table generation_jobs drop constraint if exists generation_jobs_credits_due_check;
alter table generation_jobs drop constraint if exists generation_jobs_credit_delivery_status_check;
alter table generation_jobs drop column if exists credits_due;
alter table generation_jobs drop column if exists credit_delivery_status;
