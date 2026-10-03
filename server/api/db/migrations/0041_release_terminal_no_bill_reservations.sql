begin;

create temporary table terminal_no_bill_users on commit drop as
select distinct created_by user_id
from generation_jobs
where status in ('failed', 'cancelled')
  and billing_status in ('not_billed', 'unavailable')
  and credits_due = 0
  and credits_reserved > 0;

select pg_advisory_xact_lock(hashtextextended(user_id::text, 0))
from terminal_no_bill_users
order by user_id;

create temporary table terminal_no_bill_jobs on commit drop as
select job.id, job.created_by user_id, job.credits_reserved::bigint points
from generation_jobs job
join terminal_no_bill_users target on target.user_id = job.created_by
where job.status in ('failed', 'cancelled')
  and job.billing_status in ('not_billed', 'unavailable')
  and job.credits_due = 0
  and job.credits_reserved > 0;

update credit_accounts account
set reserved = greatest(0, account.reserved - releases.points),
    updated_at = now()
from (
  select user_id, sum(points)::bigint points
  from terminal_no_bill_jobs
  group by user_id
) releases
where account.user_id = releases.user_id;

update generation_jobs job
set credits_reserved = 0,
    credits_due = 0,
    credit_delivery_status = 'released',
    updated_at = now()
from terminal_no_bill_jobs target
where job.id = target.id
  and job.status in ('failed', 'cancelled')
  and job.billing_status in ('not_billed', 'unavailable')
  and job.credits_due = 0
  and job.credits_reserved = target.points;

commit;
