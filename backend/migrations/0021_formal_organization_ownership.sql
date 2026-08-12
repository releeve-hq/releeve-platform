ALTER TABLE organizations
ADD COLUMN owner_user_id UUID REFERENCES users(id);

UPDATE organizations o
SET owner_user_id = (
  SELECT m.user_id
  FROM organization_members m
  WHERE m.organization_id = o.id
  ORDER BY (m.permissions = 255) DESC, m.created_at ASC, m.id ASC
  LIMIT 1
)
WHERE o.owner_user_id IS NULL;

ALTER TABLE organizations
ALTER COLUMN owner_user_id SET NOT NULL;

CREATE INDEX idx_organizations_owner ON organizations(owner_user_id);
