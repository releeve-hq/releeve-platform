-- Prune alert triggers to the 9 supported types (Successful Transaction,
-- Failed Transaction, Contract Event, Asset Transfer, Allowlisted/Blocklisted
-- Callers, Balance Change, State Change, Event Parameter) and add a
-- firing-context snapshot for history rendering.

-- Remove expressions using retired trigger types before tightening the CHECK.
DELETE FROM alert_expressions WHERE expression_type NOT IN (
  'successful_transaction','failed_transaction',
  'event_emitted','event_parameter','token_transfer',
  'allowlisted_callers','blocklisted_callers',
  'balance_change','state_change'
);
-- Remove orphaned alerts that lost all expressions (or were already empty).
DELETE FROM alerts WHERE id NOT IN (SELECT DISTINCT alert_id FROM alert_expressions);

ALTER TABLE alert_expressions DROP CONSTRAINT IF EXISTS alert_expressions_expression_type_check;
ALTER TABLE alert_expressions ADD CONSTRAINT alert_expressions_expression_type_check
  CHECK (expression_type IN (
    'successful_transaction','failed_transaction',
    'event_emitted','event_parameter','token_transfer',
    'allowlisted_callers','blocklisted_callers',
    'balance_change','state_change'
  ));

-- Enriched firing payload for history page: stores the AlertEvent snapshot
-- at fire time so the message (Observed/Condition/Scope/Context/Transaction
-- /Ledger/Time + deep links) can be rendered without re-deriving.
ALTER TABLE alert_firings ADD COLUMN IF NOT EXISTS firing_context JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE alert_firings ADD COLUMN IF NOT EXISTS firing_message JSONB NOT NULL DEFAULT '{}'::jsonb;
