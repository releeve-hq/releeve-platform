ALTER TABLE contract_verifications
  ADD COLUMN source_lens_verification_id UUID,
  ADD COLUMN source_lens_job_id UUID,
  ADD COLUMN source_lens_status TEXT,
  ADD COLUMN capability_summary JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN source_input JSONB,
  ADD COLUMN recipe_id TEXT,
  ADD COLUMN source_lens_synced_at TIMESTAMPTZ,
  ADD COLUMN legacy_claim BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE contract_verifications
  ALTER COLUMN source_archive_url DROP NOT NULL;

ALTER TABLE contracts
  ADD COLUMN source_lens_capabilities JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN source_lens_synced_at TIMESTAMPTZ;

CREATE UNIQUE INDEX uq_contract_verifications_source_lens_id
  ON contract_verifications(source_lens_verification_id)
  WHERE source_lens_verification_id IS NOT NULL;

ALTER TABLE simulation_runs
  ADD COLUMN source_lens_execution_artifact_id UUID,
  ADD COLUMN source_lens_analysis_id UUID,
  ADD COLUMN source_lens_debug_session_id UUID,
  ADD COLUMN source_lens_capabilities JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN source_lens_synced_at TIMESTAMPTZ;

CREATE INDEX idx_simulation_runs_source_lens_analysis
  ON simulation_runs(source_lens_analysis_id)
  WHERE source_lens_analysis_id IS NOT NULL;
