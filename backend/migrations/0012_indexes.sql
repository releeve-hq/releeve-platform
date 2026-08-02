-- Load-bearing indexes (doc 03 §9). All tables from earlier migrations exist here.

CREATE INDEX idx_transactions_source_account ON transactions(source_account);
CREATE INDEX idx_transactions_ledger ON transactions(ledger_sequence);
CREATE INDEX idx_tx_call_tree_contract ON tx_call_tree_nodes(contract_id);
CREATE INDEX idx_simulation_runs_contract ON simulation_runs(contract_id);
CREATE INDEX idx_simulation_runs_sender ON simulation_runs(sender_wallet_id);
CREATE INDEX idx_simulation_runs_impersonated ON simulation_runs(impersonated_wallet_id);
CREATE INDEX idx_alert_firings_alert ON alert_firings(alert_id, fired_at DESC);
CREATE INDEX idx_wallets_address ON wallets(address);
CREATE INDEX idx_contracts_address ON contracts(address);

-- note: idx_refresh_tokens_user / idx_email_verification_user /
-- idx_password_reset_user already exist from 0001_identity_and_auth.sql.
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- same (alert, tx) never fires twice
CREATE UNIQUE INDEX uq_alert_firing_dedupe ON alert_firings(alert_id, tx_hash) WHERE simulation_id IS NULL;

CREATE INDEX idx_transactions_network_time ON transactions(network, timestamp DESC, hash);
CREATE INDEX idx_ledgers_network_seq ON ledgers(network, sequence DESC);
CREATE INDEX idx_tx_events_contract ON tx_events(contract_id, id);
CREATE INDEX idx_tx_fund_flow_asset ON tx_fund_flow_edges(asset, tx_hash);
CREATE INDEX idx_token_volume_window ON token_volume_stats(network, window_start DESC, volume DESC);
CREATE INDEX idx_wallets_network_address ON wallets(network, address);
CREATE INDEX idx_contracts_network_address ON contracts(network, address);
CREATE INDEX idx_token_prices_lookup ON token_prices(network, asset, updated_at DESC);
