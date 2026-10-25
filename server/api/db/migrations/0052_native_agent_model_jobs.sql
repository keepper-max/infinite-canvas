CREATE TABLE native_agent_model_jobs (
 step_id uuid PRIMARY KEY REFERENCES native_agent_steps(id),
 job_id uuid NOT NULL UNIQUE REFERENCES generation_jobs(id),
 run_id uuid NOT NULL REFERENCES native_agent_runs(id),
 actor_id uuid NOT NULL REFERENCES users(id),
 payload_hash text NOT NULL,
 quote_cents integer NOT NULL CHECK(quote_cents > 0),
 settled_cents integer,
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','settled','unknown')),
 created_at timestamptz NOT NULL DEFAULT now(),
 settled_at timestamptz
);
CREATE INDEX native_agent_model_jobs_actor ON native_agent_model_jobs(actor_id,run_id);
