-- Simulation engine linkage (doc 03 §8) — reserved from day one.
-- NOTE: fork_environments is created BEFORE simulation_runs here (unlike the
-- doc's illustrative ordering) because simulation_runs.fork_environment_id
-- has a real FK to it; Postgres requires the referenced table to exist.

CREATE TABLE fork_environments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  base_ledger_sequence  BIGINT NOT NULL,
  state_sync_enabled    BOOLEAN NOT NULL DEFAULT false,
  is_public             BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE simulation_runs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  contract_id           UUID REFERENCES contracts(id),
  impersonated_wallet_id UUID REFERENCES wallets(id),
  sender_wallet_id      UUID REFERENCES wallets(id),
  base_ledger_sequence  BIGINT NOT NULL,
  function_name         TEXT NOT NULL,
  args                  JSONB NOT NULL,
  overrides             JSONB NOT NULL DEFAULT '[]',
  auth_impersonation    BOOLEAN NOT NULL DEFAULT false,
  timestamp_override    TIMESTAMPTZ,
  status                TEXT NOT NULL CHECK (status IN ('pending','success','failed','error')),
  cpu_instructions      BIGINT,
  memory_bytes          BIGINT,
  disk_read_bytes       BIGINT,
  write_bytes           BIGINT,
  created_by            UUID NOT NULL REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_verification_run   BOOLEAN NOT NULL DEFAULT false,
  matched_real_result   BOOLEAN,
  fork_environment_id   UUID REFERENCES fork_environments(id)
);

CREATE TABLE simulation_call_tree_nodes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id       UUID NOT NULL REFERENCES simulation_runs(id) ON DELETE CASCADE,
  parent_node_id      UUID REFERENCES simulation_call_tree_nodes(id),
  contract_id         TEXT NOT NULL,
  function_name       TEXT NOT NULL,
  args                JSONB NOT NULL,
  return_value        JSONB,
  depth               INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE simulation_state_changes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id       UUID NOT NULL REFERENCES simulation_runs(id) ON DELETE CASCADE,
  caused_by_node_id   UUID REFERENCES simulation_call_tree_nodes(id),
  entry_type          TEXT NOT NULL,
  entry_key           TEXT NOT NULL,
  value_before        JSONB,
  value_after         JSONB,
  is_override         BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE simulation_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id       UUID NOT NULL REFERENCES simulation_runs(id) ON DELETE CASCADE,
  contract_id         TEXT NOT NULL,
  topics              JSONB NOT NULL,
  data                JSONB NOT NULL
);
