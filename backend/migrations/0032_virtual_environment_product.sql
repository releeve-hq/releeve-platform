ALTER TABLE fork_environments
  ADD COLUMN initialization_status TEXT NOT NULL DEFAULT 'ready'
    CHECK (initialization_status IN ('preparing','ready','failed')),
  ADD COLUMN initialization_progress SMALLINT NOT NULL DEFAULT 100
    CHECK (initialization_progress BETWEEN 0 AND 100),
  ADD COLUMN initialization_error JSONB,
  ADD COLUMN public_explorer_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN rpc_admin_secret_hash TEXT,
  ADD COLUMN rpc_previous_secret_hash TEXT,
  ADD COLUMN rpc_previous_secret_expires_at TIMESTAMPTZ,
  ADD COLUMN rpc_secret_rotated_at TIMESTAMPTZ;

CREATE TABLE environment_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES fork_environments(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  label TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(environment_id, address)
);

CREATE TABLE environment_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES fork_environments(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  contract_id TEXT NOT NULL,
  wasm_hash TEXT,
  upload_hash TEXT,
  create_hash TEXT,
  source_account TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(environment_id, contract_id)
);

CREATE TABLE environment_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES fork_environments(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE environment_rpc_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES fork_environments(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  caller_class TEXT NOT NULL CHECK (caller_class IN ('anonymous','member','admin')),
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE environment_mutations (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id, idempotency_key, operation)
);

CREATE INDEX idx_environment_wallets_env ON environment_wallets(environment_id, created_at DESC);
CREATE INDEX idx_environment_deployments_env ON environment_deployments(environment_id, created_at DESC);
CREATE INDEX idx_environment_activity_cursor ON environment_activity(environment_id, created_at DESC, id DESC);
CREATE INDEX idx_environment_rpc_logs_cursor ON environment_rpc_logs(environment_id, created_at DESC, id DESC);
CREATE INDEX idx_environment_rpc_logs_retention ON environment_rpc_logs(created_at);
