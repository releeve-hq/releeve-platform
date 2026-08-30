-- Platform stores only project-scoped audit metadata for Fork Core replays.
-- Replay state, canonical XDR, capsules, and job results remain authoritative
-- in Fork Core/R2 and are never duplicated here.
CREATE TABLE historical_replay_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  fork_core_replay_id UUID,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('created','cancelled','promoted','viewed','analysis_created')),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_historical_replay_audit_project
  ON historical_replay_audit(project_id,created_at DESC);
CREATE INDEX idx_historical_replay_audit_replay
  ON historical_replay_audit(project_id,fork_core_replay_id,created_at DESC);

-- Only the cross-service identifiers needed to authorize SourceLens access are
-- retained here. Replay results and traces remain authoritative in Fork Core.
CREATE TABLE historical_replay_analysis_bindings (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  fork_core_replay_id UUID NOT NULL,
  transaction_hash TEXT NOT NULL DEFAULT '',
  source_lens_execution_artifact_id UUID NOT NULL,
  source_lens_analysis_id UUID NOT NULL,
  source_lens_debug_session_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id,fork_core_replay_id,transaction_hash),
  UNIQUE(project_id,source_lens_analysis_id)
);
