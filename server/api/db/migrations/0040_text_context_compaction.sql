alter table text_conversations
  add column if not exists context_summary text not null default '',
  add column if not exists context_summary_source_chars integer not null default 0,
  add column if not exists context_summary_message_count integer not null default 0,
  add column if not exists context_compacted_at timestamptz;

alter table text_messages
  add column if not exists context_compacted_at timestamptz;

create index if not exists text_messages_context_pending_idx
  on text_messages(conversation_id, created_at asc, id asc)
  where status='completed' and context_compacted_at is null;
