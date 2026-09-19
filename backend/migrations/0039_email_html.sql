-- Designed HTML bodies ride the outbox alongside plain text so the worker
-- delivers exactly what the handler composed.
ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS html TEXT;
