ALTER TABLE tx_state_changes
  DROP CONSTRAINT IF EXISTS tx_state_changes_entry_type_check;

ALTER TABLE tx_state_changes
  ADD CONSTRAINT tx_state_changes_entry_type_check
  CHECK (
    entry_type IN (
      'account',
      'trustline',
      'offer',
      'data',
      'claimable_balance',
      'liquidity_pool',
      'contract_data',
      'contract_code',
      'config_setting',
      'ttl'
    )
  );
