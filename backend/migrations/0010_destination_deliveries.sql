-- Delivery records (doc 03 §3). Moved after alerts (0009) because
-- destination_deliveries.alert_id references alerts(id).

CREATE TABLE destination_deliveries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id      UUID NOT NULL,
  destination_scope   TEXT NOT NULL CHECK (destination_scope IN ('account','project')),
  event_type          TEXT NOT NULL CHECK (event_type IN ('test','alert_fired')),
  alert_id            UUID REFERENCES alerts(id),
  status              TEXT NOT NULL CHECK (status IN ('success','failed','pending','retry','skipped')),
  attempt             INTEGER NOT NULL DEFAULT 1,
  response_code       INTEGER,
  sent_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
