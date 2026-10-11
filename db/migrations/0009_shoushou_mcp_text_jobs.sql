CREATE TABLE IF NOT EXISTS shoushou_mcp_text_jobs (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  created_by UUID NOT NULL,
  model_config_id UUID NOT NULL,
  stage TEXT NOT NULL,
  request_key TEXT NOT NULL,
  instructions TEXT NOT NULL,
  context TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  output_text TEXT,
  error_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  UNIQUE (project_id, created_by, request_key)
);
