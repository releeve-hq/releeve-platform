ALTER TABLE simulation_runs
  ADD COLUMN fork_core_simulation_id UUID,
  ADD COLUMN fork_core_job_id UUID,
  ADD COLUMN fork_core_summary JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN completed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX uq_simulation_runs_fork_core_id
  ON simulation_runs(fork_core_simulation_id)
  WHERE fork_core_simulation_id IS NOT NULL;
