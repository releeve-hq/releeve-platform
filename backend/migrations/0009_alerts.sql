-- Alerts (doc 03 §7).

CREATE TABLE alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  target_type     TEXT NOT NULL CHECK (target_type IN ('address','network','project','tag')),
  target_value    TEXT,
  match_logic     TEXT NOT NULL DEFAULT 'all' CHECK (match_logic IN ('all','any')),
  enabled         BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alert_expressions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id        UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  expression_type TEXT NOT NULL CHECK (expression_type IN (
    'successful_transaction','failed_transaction','tx_error','function_call','function_params',
    'event_emitted','event_parameter','token_transfer','allowlisted_callers','blocklisted_callers',
    'balance_change','transaction_value','state_change','view_function','no_action','token_transfer_matcher'
  )),
  params          JSONB NOT NULL
);

CREATE TABLE alert_destinations (
  alert_id             UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  destination_id       UUID NOT NULL,
  destination_scope    TEXT NOT NULL CHECK (destination_scope IN ('account','project')),
  PRIMARY KEY (alert_id, destination_id, destination_scope)
);

CREATE TABLE alert_firings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id        UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  tx_hash         TEXT REFERENCES transactions(hash),
  simulation_id   UUID REFERENCES simulation_runs(id),
  fired_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (tx_hash IS NOT NULL OR simulation_id IS NOT NULL)
);
