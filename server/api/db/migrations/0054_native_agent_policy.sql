alter table native_agent_runs add column if not exists policy_snapshot jsonb;
alter table native_agent_runs add column if not exists purpose text not null default 'user' check(purpose in ('user','model_probe'));
create table native_agent_model_verifications (
 id uuid primary key default gen_random_uuid(),run_id uuid not null unique references native_agent_runs(id),
 model_id text not null references model_catalog(id),status text not null check(status in ('pending','passed','failed')),
 definition_hash text not null,credential_hash text not null,capabilities jsonb not null default '{}',metrics jsonb not null default '{}',
 created_by uuid not null references users(id),created_at timestamptz not null default now(),finished_at timestamptz
);
create index native_agent_model_verifications_model_idx on native_agent_model_verifications(model_id,created_at desc);
insert into platform_settings(key,value) values('native_agent_policy','{"version":1,"enabled":false,"defaultModelId":null,"allowedModelIds":[],"userModelSelectionEnabled":false,"maxBudgetCents":100,"knowledgeReasoningEnabled":false,"limits":{"rounds":16,"tools":32,"totalTokens":64000,"contextTokens":12000,"outputTokens":2000,"activeMs":900000,"perUser":1,"concurrency":2,"modelMs":60000,"toolMs":30000,"failures":1}}') on conflict(key) do nothing;
