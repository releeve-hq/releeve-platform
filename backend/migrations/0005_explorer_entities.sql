-- Explorer entities (doc 03 §5): wallets, contracts, source, verification.

CREATE TABLE wallets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  address         TEXT NOT NULL,
  network         TEXT NOT NULL,
  last_synced_at  TIMESTAMPTZ,
  UNIQUE (project_id, address)
);

CREATE TABLE contracts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  address                 TEXT NOT NULL,
  network                 TEXT NOT NULL,
  contract_type           TEXT NOT NULL DEFAULT 'contract' CHECK (contract_type IN ('contract','upgradeable_contract')),
  deployment_tx_hash      TEXT,
  deployment_timestamp    TIMESTAMPTZ,
  verification_status     TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('verified','unverified')),
  verification_type       TEXT,
  verified_at             TIMESTAMPTZ,
  rust_version            TEXT,
  soroban_sdk_version     TEXT,
  wasm_target             TEXT,
  opt_level               TEXT,
  wasm_opt_applied        BOOLEAN,
  debug_symbols_present   BOOLEAN NOT NULL DEFAULT false,
  current_wasm_hash       TEXT,
  last_synced_at          TIMESTAMPTZ,
  UNIQUE (project_id, address)
);

CREATE TABLE contract_wasm_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id     UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  wasm_hash       TEXT NOT NULL,
  tx_hash         TEXT NOT NULL,
  effective_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE contract_source (
  contract_id             UUID PRIMARY KEY REFERENCES contracts(id) ON DELETE CASCADE,
  source_archive_url      TEXT,
  compiler_settings       JSONB,
  spec_xdr                TEXT,
  creation_wasm_ref       TEXT,
  deployed_wasm_ref       TEXT,
  source_map_ref          TEXT,
  source_map_status       TEXT NOT NULL DEFAULT 'not_available' CHECK (source_map_status IN ('not_available','pending','available'))
);

CREATE TABLE contract_verifications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id           UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  submitted_by          UUID NOT NULL REFERENCES users(id),
  visibility            TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public','private')),
  status                TEXT NOT NULL DEFAULT 'submitted'
                        CHECK (status IN ('submitted','compiling','verified','failed')),
  source_archive_url    TEXT NOT NULL,
  rust_version          TEXT,
  soroban_sdk_version   TEXT,
  wasm_target           TEXT,
  opt_level             TEXT,
  wasm_opt_applied      BOOLEAN,
  built_wasm_hash       TEXT,
  failure_reason        TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ
);
CREATE INDEX idx_contract_verifications_contract ON contract_verifications(contract_id, created_at DESC);
