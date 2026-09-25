create table if not exists provider_billing_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null,
  version integer not null check(version > 0),
  provider text not null check(provider in ('runninghub','runninghub_global')),
  model_pattern text not null,
  match_type text not null check(match_type in ('exact','contains')),
  discount_rate numeric(12,8) not null check(discount_rate > 0 and discount_rate <= 1),
  priority integer not null default 0,
  enabled boolean not null default true,
  note text not null default '',
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(rule_key,version)
);
create index if not exists provider_billing_rules_match_idx
  on provider_billing_rules(provider,enabled,priority desc,version desc);

insert into provider_billing_rules(id,rule_key,version,provider,model_pattern,match_type,discount_rate,priority,enabled,note)
values
  ('00000000-0000-4000-8000-000000000271','runninghub-seedance-2-5',1,'runninghub','seedance-2.5','contains',0.8,100,true,'迁移自既有 Seedance 2.5 八折原价还原规则'),
  ('00000000-0000-4000-8000-000000000272','runninghub-global-seedance-2-5',1,'runninghub_global','seedance-2.5','contains',0.8,100,true,'迁移自既有 Seedance 2.5 八折原价还原规则')
on conflict(rule_key,version) do nothing;

alter table generation_jobs add column if not exists billing_rule_snapshot jsonb not null default '{}';

update generation_jobs j
set billing_rule_snapshot=jsonb_build_object(
  'ruleId',r.id,
  'ruleKey',r.rule_key,
  'version',r.version,
  'provider',r.provider,
  'modelPattern',r.model_pattern,
  'matchType',r.match_type,
  'discountRate',r.discount_rate::text,
  'priority',r.priority,
  'capturedAt',j.created_at
)
from provider_billing_rules r
where j.provider=r.provider
  and r.version=1
  and (
    lower(j.model_id) like '%seedance-2.5%'
    or lower(j.model_id) like '%seedance-2-5%'
    or lower(j.model_id) like '%seedance_2_5%'
  )
  and j.billing_rule_snapshot='{}'::jsonb;
