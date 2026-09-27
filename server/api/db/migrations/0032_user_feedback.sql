create table user_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  category text not null check (category in ('problem', 'suggestion')),
  content text not null,
  contact text,
  page_path text,
  created_at timestamptz not null default now()
);

create index user_feedback_created_idx on user_feedback(created_at desc);
create index user_feedback_user_created_idx on user_feedback(user_id, created_at desc);
