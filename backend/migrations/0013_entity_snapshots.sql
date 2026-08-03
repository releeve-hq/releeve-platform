-- Entity snapshots (doc 03 §6, Soroban-RPC `getLedgerEntries`).
--
-- Source-of-truth rule: getLedgerEntries returns *specific* ledger entries
-- (accounts/contracts/trustlines/contract-data), never enumerated ledgers or
-- transactions. This table stores those snapshots for the fork-core baseline
-- and for lazy profile enrichment. Upserted by ledger sequence + key so a
-- re-run is a no-op; the latest known sequence is capture for correctness.

CREATE TABLE entity_snapshots (
  network            TEXT NOT NULL,
  entry_type         TEXT NOT NULL,
  entry_key          TEXT NOT NULL,
  xdr                TEXT,
  value              JSONB,
  ledger_sequence    BIGINT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (network, entry_key)
);