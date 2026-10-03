drop index if exists text_messages_context_pending_idx;

alter table text_messages
  drop column if exists context_compacted_at;

alter table text_conversations
  drop column if exists context_compacted_at,
  drop column if exists context_summary_message_count,
  drop column if exists context_summary_source_chars,
  drop column if exists context_summary;
