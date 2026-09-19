ALTER TABLE fork_environments
  ADD COLUMN creation_kind TEXT NOT NULL DEFAULT 'normal'
    CHECK (creation_kind IN ('normal','fork','clone')),
  ADD COLUMN source_environment_id UUID REFERENCES fork_environments(id) ON DELETE RESTRICT,
  ADD COLUMN source_virtual_ledger_id UUID,
  ADD COLUMN active_generation_id UUID,
  ADD COLUMN active_virtual_ledger_id UUID,
  ADD COLUMN virtual_head_sequence BIGINT,
  ADD COLUMN source_head_sequence BIGINT,
  ADD COLUMN source_sync_state TEXT NOT NULL DEFAULT 'paused'
    CHECK (source_sync_state IN ('paused','following','catching_up','protocol_paused','error')),
  ADD COLUMN close_mode TEXT NOT NULL DEFAULT 'instant'
    CHECK (close_mode IN ('network_cadence','instant')),
  ADD COLUMN public_rpc_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN vnet_passphrase TEXT,
  ADD COLUMN vnet_network_id TEXT;

CREATE UNIQUE INDEX uq_fork_environments_vnet_passphrase
  ON fork_environments(vnet_passphrase) WHERE vnet_passphrase IS NOT NULL;
CREATE UNIQUE INDEX uq_fork_environments_vnet_network_id
  ON fork_environments(vnet_network_id) WHERE vnet_network_id IS NOT NULL;
