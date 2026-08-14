-- Pre-release Fork Core environments were built from caller-owned snapshots and
-- cannot be promoted into completeness-certified revisions.
DELETE FROM simulation_runs WHERE fork_environment_id IS NOT NULL;
DELETE FROM fork_environments;

ALTER TABLE simulation_runs
  ALTER COLUMN base_ledger_sequence SET DEFAULT 0,
  DROP CONSTRAINT IF EXISTS simulation_runs_status_check,
  ADD CONSTRAINT simulation_runs_status_check CHECK (status IN
    ('pending','success','failed','error','cancelled','inconclusive','unavailable','budget_limited')),
  ADD COLUMN requested_ledger BIGINT,
  ADD COLUMN state_ledger BIGINT,
  ADD COLUMN execution_ledger BIGINT,
  ADD COLUMN protocol INTEGER,
  ADD COLUMN stage TEXT NOT NULL DEFAULT 'queued',
  ADD COLUMN progress SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN state_source JSONB NOT NULL DEFAULT '{"type":"latest"}'::JSONB,
  ADD COLUMN invocation JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN completeness_certificate JSONB,
  ADD COLUMN provenance JSONB NOT NULL DEFAULT '[]'::JSONB;

ALTER TABLE fork_environments
  ADD COLUMN fork_core_environment_id UUID,
  ADD COLUMN mode TEXT NOT NULL DEFAULT 'frozen' CHECK (mode IN ('frozen','follow_latest')),
  ADD COLUMN active_revision_id UUID,
  ADD COLUMN state_ledger BIGINT,
  ADD COLUMN execution_ledger BIGINT,
  ADD COLUMN protocol INTEGER,
  ADD COLUMN state_hash TEXT,
  ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'pending';

CREATE UNIQUE INDEX uq_fork_environments_fork_core_id
  ON fork_environments(fork_core_environment_id)
  WHERE fork_core_environment_id IS NOT NULL;
