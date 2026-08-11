-- Older ingesters represented a Soroban invocation as a zero-value CALL
-- transfer. Invocation targets belong to the call tree, not fund flow.
DELETE FROM tx_fund_flow_edges
WHERE asset = 'CALL'
  AND amount = 0;
