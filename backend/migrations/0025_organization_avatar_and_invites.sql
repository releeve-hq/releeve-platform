ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

CREATE TABLE IF NOT EXISTS organization_invitations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  permissions     SMALLINT NOT NULL DEFAULT 0,
  invited_by      UUID NOT NULL REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, email)
);

CREATE INDEX IF NOT EXISTS idx_org_invitations_org ON organization_invitations(organization_id);
