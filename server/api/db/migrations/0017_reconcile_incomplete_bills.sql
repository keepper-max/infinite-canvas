update generation_jobs j
set billing_status=case when j.billing_trace_id<>j.id::text then 'mismatch' else 'pending' end,
    billing_started_at=now(),
    billing_attempt_count=0,
    billing_next_check_at=now(),
    billing_error='账单金额尚未返回，等待重新对账',
    updated_at=now()
where j.provider='token360'
  and j.billing_trace_id is not null
  and j.status in ('completed','failed','cancelled')
  and j.billing_status in ('settled','mismatch')
  and exists (
    select 1 from generation_usage gu
    where gu.job_id=j.id
      and (gu.currency is null or btrim(gu.currency)='')
      and gu.amount_final is null
      and gu.total_amount is null
  );
