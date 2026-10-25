-- Additive P2.5.1 metadata; no canvas/history/balance rewrite.
ALTER TABLE native_agent_runs DROP CONSTRAINT native_agent_runs_status_check;
ALTER TABLE native_agent_runs ADD CONSTRAINT native_agent_runs_status_check CHECK(status IN ('pending','planning','awaiting_approval','running','paused','completed','failed','cancelled','awaiting_manual_review'));
DROP INDEX native_agent_one_unfinished;
CREATE UNIQUE INDEX native_agent_one_unfinished ON native_agent_runs(actor_id) WHERE status IN ('pending','planning','awaiting_approval','running','paused','awaiting_manual_review');
ALTER TABLE native_agent_runs ADD COLUMN plan_protocol integer NOT NULL DEFAULT 0 CHECK(plan_protocol IN (0,1));
ALTER TABLE native_agent_runs ADD COLUMN budget_limits jsonb;
ALTER TABLE native_agent_runs ADD COLUMN consecutive_failures integer NOT NULL DEFAULT 0;
ALTER TABLE native_agent_runs ADD COLUMN goal_reviewed boolean NOT NULL DEFAULT false;
CREATE TABLE native_agent_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid NOT NULL REFERENCES native_agent_runs(id),
 revision integer NOT NULL DEFAULT 1,status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','awaiting_approval','approved','executing','completed','revised','failed','cancelled')),
 goal text NOT NULL,steps jsonb NOT NULL DEFAULT '[]',approval_scope jsonb NOT NULL DEFAULT '{}',expected_outputs jsonb NOT NULL DEFAULT '{}',
 reviewed_revision integer,approval_id uuid UNIQUE REFERENCES native_agent_approvals(id),payload_hash text,outputs jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(run_id,revision)
);
CREATE INDEX native_agent_plans_run ON native_agent_plans(run_id,created_at);
CREATE TABLE native_agent_run_controls (
 operation_id uuid PRIMARY KEY,run_id uuid NOT NULL REFERENCES native_agent_runs(id),actor_id uuid NOT NULL REFERENCES users(id),
 payload_hash text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
