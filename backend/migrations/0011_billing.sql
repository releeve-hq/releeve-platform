-- Billing & plan tiering (doc 03 §8.5) — reserved from day one, populated in P6.

CREATE TABLE plans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key               TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  price_monthly_usd NUMERIC,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  features          JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE subscriptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id           UUID NOT NULL REFERENCES plans(id),
  status            TEXT NOT NULL CHECK (status IN ('trialing','active','past_due','canceled')),
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  provider          TEXT,
  provider_subscription_id TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_subscriptions_org ON subscriptions(organization_id);

CREATE TABLE billing_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  provider        TEXT,
  provider_event_id TEXT,
  payload         JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_billing_events_org ON billing_events(organization_id, created_at DESC);
