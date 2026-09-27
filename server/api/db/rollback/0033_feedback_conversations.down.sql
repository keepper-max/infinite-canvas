drop table if exists user_feedback_messages;
drop index if exists user_feedback_status_updated_idx;
alter table user_feedback
  drop column if exists updated_at,
  drop column if exists status;
