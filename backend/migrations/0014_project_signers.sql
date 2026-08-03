-- Project-scoped signers for the Phase 3 Contract Read/Write panel.
--
-- The encrypted secret is opaque to the API layer here; it exists so `run`
-- mode can be explicitly gated by configured project state instead of ever
-- attempting a partial submit without a signer.

CREATE TABLE project_signers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  network               TEXT NOT NULL,
  public_key            TEXT NOT NULL,
  encrypted_secret_ref  TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, network, public_key)
);

CREATE INDEX idx_project_signers_project ON project_signers(project_id, network);
