ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS cpu_instruction_limit BIGINT,
  ADD COLUMN IF NOT EXISTS disk_read_bytes_limit BIGINT,
  ADD COLUMN IF NOT EXISTS write_bytes_limit BIGINT,
  ADD COLUMN IF NOT EXISTS resource_fee NUMERIC,
  ADD COLUMN IF NOT EXISTS operation_target_address TEXT,
  ADD COLUMN IF NOT EXISTS operation_target_kind TEXT;

ALTER TABLE tx_call_tree_nodes
  ADD COLUMN IF NOT EXISTS sequence INTEGER NOT NULL DEFAULT 0;

ALTER TABLE tx_state_changes
  ADD COLUMN IF NOT EXISTS sequence INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cause_confidence TEXT NOT NULL DEFAULT 'transaction'
    CHECK (cause_confidence IN ('exact', 'contract', 'transaction'));

ALTER TABLE tx_events
  ADD COLUMN IF NOT EXISTS caused_by_node_id UUID REFERENCES tx_call_tree_nodes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sequence INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'contract'
    CHECK (event_type IN ('contract', 'system', 'diagnostic')),
  ADD COLUMN IF NOT EXISTS successful BOOLEAN,
  ADD COLUMN IF NOT EXISTS stage TEXT;

ALTER TABLE tx_fund_flow_edges
  ADD COLUMN IF NOT EXISTS caused_by_node_id UUID REFERENCES tx_call_tree_nodes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sequence INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS asset_type TEXT NOT NULL DEFAULT 'stellar_asset',
  ADD COLUMN IF NOT EXISTS usd_value NUMERIC;

CREATE INDEX IF NOT EXISTS idx_tx_call_tree_sequence
  ON tx_call_tree_nodes (tx_hash, sequence);

CREATE INDEX IF NOT EXISTS idx_tx_events_sequence
  ON tx_events (tx_hash, sequence);

CREATE INDEX IF NOT EXISTS idx_tx_fund_flow_sequence
  ON tx_fund_flow_edges (tx_hash, sequence);
