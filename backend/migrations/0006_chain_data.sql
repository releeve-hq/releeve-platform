-- Chain data (doc 03 §6): ledgers, transactions and child tables.

CREATE TABLE ledgers (
  sequence                BIGINT PRIMARY KEY,
  network                 TEXT NOT NULL,
  hash                    TEXT NOT NULL,
  parent_hash             TEXT,
  transaction_count       INTEGER,
  size_bytes              INTEGER,
  timestamp               TIMESTAMPTZ NOT NULL,
  base_operation_fee      NUMERIC,
  base_reserve            NUMERIC,
  total_cpu_instructions  BIGINT,
  resource_limit          BIGINT
);

CREATE TABLE transactions (
  hash                TEXT PRIMARY KEY,
  network             TEXT NOT NULL,
  ledger_sequence     BIGINT REFERENCES ledgers(sequence),
  status              TEXT NOT NULL CHECK (status IN ('success','failed')),
  source_account      TEXT NOT NULL,
  operation_type      TEXT NOT NULL,
  fee_charged         NUMERIC,
  sequence_number     TEXT,
  application_order   INTEGER,
  timestamp           TIMESTAMPTZ NOT NULL,
  cpu_instructions    BIGINT,
  memory_bytes        BIGINT,
  invoke_time_nsecs   BIGINT,
  disk_read_bytes     BIGINT,
  write_bytes         BIGINT,
  max_rw_key_byte     INTEGER,
  max_rw_data_byte    INTEGER,
  raw_result_meta_xdr TEXT,
  raw_envelope_xdr    TEXT
);

CREATE TABLE tx_call_tree_nodes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_hash             TEXT NOT NULL REFERENCES transactions(hash) ON DELETE CASCADE,
  parent_node_id      UUID REFERENCES tx_call_tree_nodes(id),
  contract_id         TEXT NOT NULL,
  function_name       TEXT NOT NULL,
  args                JSONB NOT NULL,
  return_value        JSONB,
  depth               INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tx_state_changes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_hash             TEXT NOT NULL REFERENCES transactions(hash) ON DELETE CASCADE,
  caused_by_node_id   UUID REFERENCES tx_call_tree_nodes(id),
  entry_type          TEXT NOT NULL CHECK (entry_type IN ('contract_data','account','trustline','offer')),
  entry_key           TEXT NOT NULL,
  value_before        JSONB,
  value_after         JSONB
);

CREATE TABLE tx_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_hash             TEXT NOT NULL REFERENCES transactions(hash) ON DELETE CASCADE,
  contract_id         TEXT NOT NULL,
  topics              JSONB NOT NULL,
  data                JSONB NOT NULL
);

CREATE TABLE tx_fund_flow_edges (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_hash             TEXT NOT NULL REFERENCES transactions(hash) ON DELETE CASCADE,
  from_address        TEXT NOT NULL,
  to_address          TEXT NOT NULL,
  asset               TEXT NOT NULL,
  amount              NUMERIC NOT NULL
);

CREATE TABLE tx_comments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_hash             TEXT NOT NULL REFERENCES transactions(hash) ON DELETE CASCADE,
  target_type         TEXT NOT NULL CHECK (target_type IN ('call_node','state_change','event')),
  target_id           UUID NOT NULL,
  priority            TEXT CHECK (priority IN ('high','medium','low')),
  author_user_id      UUID NOT NULL REFERENCES users(id),
  body                TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
