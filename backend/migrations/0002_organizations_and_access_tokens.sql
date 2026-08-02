-- Organizations, members (flat permission bitmask), access tokens (doc 03 §1/§2).

CREATE TABLE organizations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL,
  name            TEXT,
  is_personal     BOOLEAN NOT NULL DEFAULT true,
  plan_tier       TEXT NOT NULL DEFAULT 'free',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Flat permission model — no named-role hierarchy. permissions is a bitmask:
--   bit 0 = create_projects, bit 1 = update_projects, bit 2 = delete_projects,
--   bit 3 = manage_members,  bit 4 = manage_access_tokens, bit 5 = manage_billing,
--   bit 6 = manage_fork_sessions (inert until P5)
CREATE TABLE organization_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permissions     SMALLINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX idx_org_members_user ON organization_members(user_id);

CREATE TABLE access_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  token_hash      TEXT NOT NULL UNIQUE,
  created_by      UUID NOT NULL REFERENCES users(id),
  revoked_at      TIMESTAMPTZ,
  last_used_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_access_tokens_org ON access_tokens(organization_id);
CREATE INDEX idx_access_tokens_hash ON access_tokens(token_hash);
