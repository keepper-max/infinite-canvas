update generation_jobs j
set billing_status = 'settled',
    billing_error = null,
    billing_next_check_at = null,
    billing_last_checked_at = coalesce(j.billing_last_checked_at, u.reconciled_at, now()),
    updated_at = now()
from generation_usage u
where u.job_id = j.id
  and j.provider = 'token360'
  and j.billing_status = 'mismatch'
  and u.billed = true
  and nullif(trim(u.currency), '') is not null
  and (u.amount_final is not null or u.total_amount is not null);
