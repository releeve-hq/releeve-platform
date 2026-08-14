-- Keep Platform's environment reference synchronized with Fork Core's
-- authoritative immutable revision model.
DELETE FROM simulation_runs WHERE fork_environment_id IS NOT NULL;
DELETE FROM fork_environments;

ALTER TABLE fork_environments
  ADD COLUMN network TEXT NOT NULL CHECK (network IN ('mainnet','testnet')),
  ADD COLUMN requested_ledger BIGINT,
  ADD COLUMN revision BIGINT,
  ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'paused' CHECK
    (sync_status IN ('creating','syncing','healthy','degraded','paused','error'));

CREATE INDEX idx_fork_environments_project_network
  ON fork_environments(project_id, network);
