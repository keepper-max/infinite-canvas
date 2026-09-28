alter table generation_jobs
  add column if not exists credit_delivery_status text not null default 'released';

alter table generation_jobs
  add column if not exists credits_due bigint not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'generation_jobs_credit_delivery_status_check'
  ) then
    alter table generation_jobs add constraint generation_jobs_credit_delivery_status_check
      check (credit_delivery_status in ('pending', 'billing_pending', 'payment_required', 'released'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'generation_jobs_credits_due_check'
  ) then
    alter table generation_jobs add constraint generation_jobs_credits_due_check
      check (credits_due >= 0);
  end if;
end $$;

create index if not exists generation_jobs_credit_delivery_idx
  on generation_jobs(created_by, credit_delivery_status, created_at)
  where credit_delivery_status in ('billing_pending', 'payment_required');

insert into platform_settings(key, value)
values('credit_guard', '{"videoMinimumPoints":3000}')
on conflict(key) do nothing;
