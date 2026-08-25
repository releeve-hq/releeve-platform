-- Public deployment is intentionally anonymous; management actions retain an
-- actor through environment_activity while the deployment record records no
-- fabricated user identity.
ALTER TABLE environment_deployments
  ALTER COLUMN created_by DROP NOT NULL;

COMMENT ON COLUMN environment_deployments.created_by IS
  'Authenticated platform actor, or NULL for an allowed public deployment.';
