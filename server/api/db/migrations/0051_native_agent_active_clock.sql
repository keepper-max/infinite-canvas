-- Durable active-time accounting. Waiting for user approval is never charged as execution time.
ALTER TABLE native_agent_runs ADD COLUMN active_started_at timestamptz;
