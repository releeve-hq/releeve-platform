-- Projects and destinations (doc 03 §2/§3).

CREATE TABLE projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug            TEXT NOT NULL,
  name            TEXT NOT NULL,
  network         TEXT NOT NULL DEFAULT 'testnet',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);

-- Account-scoped destinations, reusable across all projects in an org.
CREATE TABLE account_destinations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('email','slack','telegram','discord','sentry','pagerduty')),
  config          JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Project-scoped destinations: webhooks (v1), actions (v2, reserved).
CREATE TABLE project_destinations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type              TEXT NOT NULL CHECK (type IN ('webhook','action')),
  url               TEXT,
  signing_secret    TEXT,
  timeout_seconds   INTEGER NOT NULL DEFAULT 5,
  max_retries       INTEGER NOT NULL DEFAULT 5,
  config            JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- destination_deliveries lives in a later migration (0010) because it references
-- alerts(id), which must exist first.
