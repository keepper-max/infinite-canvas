-- Native runtime only; preserve all existing sessions, business data and grants.
ALTER TABLE user_feature_grants DROP CONSTRAINT user_feature_grants_feature_check;
ALTER TABLE user_feature_grants ADD CONSTRAINT user_feature_grants_feature_check CHECK(feature IN ('knowledge','native_agent'));
CREATE TABLE native_agent_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES users(id), project_id uuid NOT NULL REFERENCES projects(id),
 operation_id uuid NOT NULL, title text NOT NULL, mode text NOT NULL CHECK(mode IN ('advice','execute')),
 protocol_version integer NOT NULL DEFAULT 1, message_schema_version integer NOT NULL DEFAULT 1,
 closed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(actor_id,operation_id)
);
CREATE TABLE native_agent_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL REFERENCES native_agent_sessions(id), actor_id uuid NOT NULL REFERENCES users(id), project_id uuid NOT NULL REFERENCES projects(id),
 operation_id uuid NOT NULL, payload_hash text NOT NULL, prompt text NOT NULL, model_id text NOT NULL,
 mode text NOT NULL CHECK(mode IN ('advice','execute')), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','planning','awaiting_approval','running','completed','failed','cancelled','awaiting_manual_review')),
 revision integer NOT NULL DEFAULT 1, phase text NOT NULL DEFAULT 'model', rounds integer NOT NULL DEFAULT 0, tool_count integer NOT NULL DEFAULT 0,
 input_tokens bigint NOT NULL DEFAULT 0, output_tokens bigint NOT NULL DEFAULT 0, elapsed_ms bigint NOT NULL DEFAULT 0,
 budget_cents integer NOT NULL DEFAULT 0 CHECK(budget_cents>=0), spent_cents integer NOT NULL DEFAULT 0, reserved_cents integer NOT NULL DEFAULT 0,
 sources jsonb NOT NULL DEFAULT '[]', context jsonb NOT NULL DEFAULT '[]', pending_calls jsonb NOT NULL DEFAULT '[]',
 cancel_requested boolean NOT NULL DEFAULT false, error_code text, error_message text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, UNIQUE(actor_id,operation_id)
);
CREATE UNIQUE INDEX native_agent_one_unfinished ON native_agent_runs(actor_id) WHERE status IN ('pending','planning','awaiting_approval','running','awaiting_manual_review');
CREATE TABLE native_agent_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL REFERENCES native_agent_sessions(id), run_id uuid NOT NULL REFERENCES native_agent_runs(id),
 turn_id uuid NOT NULL, item_id text NOT NULL, role text NOT NULL CHECK(role IN ('user','assistant')), content text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(run_id,item_id)
);
CREATE TABLE native_agent_steps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES native_agent_runs(id), ordinal integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('model','tool')), tool_name text, tool_call_id text, operation_id uuid NOT NULL UNIQUE,
 status text NOT NULL CHECK(status IN ('pending','submitting','awaiting_approval','running','completed','failed','unknown','cancelled')),
 input jsonb NOT NULL DEFAULT '{}', output jsonb, input_hash text NOT NULL, input_tokens bigint NOT NULL DEFAULT 0, output_tokens bigint NOT NULL DEFAULT 0,
 provider_request_id text, error_code text, error_message text, started_at timestamptz, finished_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(run_id,ordinal), UNIQUE(run_id,tool_call_id)
);
CREATE TABLE native_agent_approvals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES native_agent_runs(id), actor_id uuid NOT NULL REFERENCES users(id),
 payload_hash text NOT NULL, calls jsonb NOT NULL, preview jsonb NOT NULL, revision integer NOT NULL DEFAULT 1,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','revised','cancelled','completed')),
 decision_operation_id uuid UNIQUE, decision_hash text, decided_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX native_agent_one_approval ON native_agent_approvals(run_id) WHERE status='pending';
CREATE TABLE native_agent_usage (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES native_agent_runs(id), step_id uuid NOT NULL UNIQUE REFERENCES native_agent_steps(id),
 model_id text NOT NULL, input_tokens bigint NOT NULL, output_tokens bigint NOT NULL, supplier_cents integer NOT NULL DEFAULT 0,
 job_id uuid REFERENCES generation_jobs(id), meter_status text NOT NULL CHECK(meter_status IN ('substitute','verified','unknown')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE native_agent_events (
 id bigserial PRIMARY KEY, session_id uuid NOT NULL REFERENCES native_agent_sessions(id), run_id uuid NOT NULL REFERENCES native_agent_runs(id),
 turn_id uuid NOT NULL, item_id text NOT NULL, type text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX native_agent_events_replay ON native_agent_events(run_id,id);
CREATE INDEX native_agent_sessions_owner ON native_agent_sessions(actor_id,updated_at DESC);
CREATE INDEX native_agent_messages_page ON native_agent_messages(session_id,created_at,id);
