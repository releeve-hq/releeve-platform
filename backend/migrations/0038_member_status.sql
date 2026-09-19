-- Member suspension state. Invitations already carry their own
-- pending/accepted/revoked lifecycle; memberships were missing the
-- suspended state the members UI filters on.

ALTER TABLE organization_members
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended'));

CREATE INDEX IF NOT EXISTS ix_org_members_status
  ON organization_members (organization_id, status);
