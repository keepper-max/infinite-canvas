create table if not exists text_conversations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  created_by uuid not null references users(id),
  title text not null default '新对话',
  mode text not null default 'chat',
  model_id text not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists text_conversations_project_recent_idx
  on text_conversations(project_id, updated_at desc)
  where archived_at is null;

create table if not exists text_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references text_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  status text not null default 'completed' check (status in ('pending', 'completed', 'failed', 'cancelled')),
  generation_job_id uuid references generation_jobs(id) on delete set null,
  model_id text,
  mode text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists text_messages_conversation_order_idx
  on text_messages(conversation_id, created_at asc);

create unique index if not exists text_messages_generation_job_idx
  on text_messages(generation_job_id)
  where generation_job_id is not null;
