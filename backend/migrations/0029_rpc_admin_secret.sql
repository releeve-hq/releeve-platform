-- Tenderly-style two-tier RPC (DECISIONS.md write-path): the public RPC URL is
-- an unguessable capability (env UUID), and the admin URL appends a generated
-- secret that grants environment management. Store the admin secret per env.

ALTER TABLE fork_environments
  ADD COLUMN rpc_admin_secret TEXT;
