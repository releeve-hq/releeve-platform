-- Surface Fork Core's Testnet latest-only invalidation (DECISIONS.md 2026-08-18)
-- in the Platform's local environment reference so the reason an environment was
-- marked invalid/frozen is persisted and queryable.

ALTER TABLE fork_environments
  ADD COLUMN invalidated_reason TEXT;