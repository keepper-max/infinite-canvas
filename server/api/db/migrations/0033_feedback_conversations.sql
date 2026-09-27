alter table user_feedback
  add column status text not null default 'open'
    check (status in ('open', 'replied', 'closed')),
  add column updated_at timestamptz not null default now();

create table user_feedback_messages (
  id bigserial primary key,
  feedback_id uuid not null references user_feedback(id) on delete cascade,
  author_user_id uuid references users(id) on delete set null,
  author_role text not null check (author_role in ('admin', 'user')),
  content text not null,
  created_at timestamptz not null default now()
);

create index user_feedback_status_updated_idx on user_feedback(status, updated_at desc);
create index user_feedback_messages_feedback_created_idx on user_feedback_messages(feedback_id, created_at);
