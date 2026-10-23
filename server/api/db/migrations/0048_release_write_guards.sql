-- Additive release guards. Existing jobs/history are retained, never inferred as unsubmitted.
CREATE TABLE user_feature_grants (
 user_id uuid NOT NULL REFERENCES users(id), feature text NOT NULL CHECK(feature='knowledge'),
 enabled boolean NOT NULL DEFAULT false, updated_by uuid NOT NULL REFERENCES users(id),
 reason text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,feature)
);
CREATE TABLE canvas_write_capabilities (
 token_hash text PRIMARY KEY, actor_id uuid NOT NULL REFERENCES users(id), project_id uuid NOT NULL REFERENCES projects(id),
 canvas_revision integer NOT NULL, knowledge_nodes jsonb NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX canvas_write_capabilities_project_revision_idx ON canvas_write_capabilities(project_id,canvas_revision);
CREATE TABLE job_retry_operations (
 actor_id uuid NOT NULL REFERENCES users(id), operation_id text NOT NULL,
 original_job_id uuid NOT NULL REFERENCES generation_jobs(id), payload_hash text NOT NULL,
 result_job_id uuid NOT NULL UNIQUE REFERENCES generation_jobs(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,operation_id)
);
ALTER TABLE generation_jobs ADD COLUMN provider_submission_state text NOT NULL DEFAULT 'legacy'
 CHECK(provider_submission_state IN ('legacy','not_started','dispatching','accepted','resolved','rejected','unknown'));
ALTER TABLE generation_jobs ADD COLUMN retry_operation_id text;
