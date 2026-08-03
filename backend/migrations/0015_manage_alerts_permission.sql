-- Phase 4: alert management gets its own permission bit.
-- Existing owners/full-permission members keep full access after the new bit is introduced.
UPDATE organization_members
SET permissions = permissions | 128
WHERE (permissions & 127) = 127;
