-- Named RPC URLs (user-requested 2026-08-22): an environment may expose a
-- memorable `rpc_slug` alongside its unguessable UUID capability URL, e.g.
-- POST /v/{org}/{project}/{rpc_slug}. Uniqueness is project-scoped (the URL
-- already contains the org/project slugs) and case-insensitive; NULL (the
-- default) keeps UUID-only routing so existing integrations never change.
--
-- Policy (DECISIONS.md 2026-08-22, "Named RPC URLs"): a named URL grants the
-- same public RPC surface as the UUID URL — guessability of a human-chosen
-- name is an accepted tradeoff. Only org admins (ManageMembers) may set or
-- clear a slug; environment mutation stays behind rpc_admin_secret.
ALTER TABLE fork_environments
  ADD COLUMN rpc_slug TEXT;

CREATE UNIQUE INDEX uq_fork_environments_rpc_slug
  ON fork_environments(project_id, lower(rpc_slug))
  WHERE rpc_slug IS NOT NULL;
