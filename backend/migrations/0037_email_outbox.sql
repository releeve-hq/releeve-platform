-- Durable outbox for transactional email.
--
-- Request handlers only INSERT here and return; a background worker drains
-- due rows through the configured sender (Cloudflare Email Service REST in
-- production, logging sender in dev, in-memory fake in tests) with
-- exponential-backoff retries. Sending failures never fail user requests.

CREATE TABLE email_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sending', 'sent', 'dead_letter')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error TEXT,
    claimed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ
);

-- The worker's claim query filters on (status, next_attempt_at).
CREATE INDEX ix_email_outbox_due
    ON email_outbox (status, next_attempt_at, created_at);
