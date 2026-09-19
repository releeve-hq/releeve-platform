//! Durable transactional-email outbox.
//!
//! Request handlers call [`enqueue`] (a single `INSERT`) and return
//! immediately — delivery never fails a user request. [`run_worker`] loops
//! forever, claiming due rows with `FOR UPDATE SKIP LOCKED` and delivering
//! them through the configured [`Mailer`] sender with exponential backoff
//! (`30s × 2^attempts`, capped at 1h, 10 attempts, then dead-letter).
//! Permanent bounces dead-letter immediately without retrying.
//!
//! [`process_outbox_once`] runs a single drain pass and is what tests drive
//! directly for deterministic assertions.

use std::sync::Arc;
use std::time::Duration;

use shared::Error;
use sqlx::PgPool;
use uuid::Uuid;

use crate::mailer::{Email, Mailer, SendOutcome};

/// Attempts before a row is dead-lettered.
pub const MAX_ATTEMPTS: i32 = 10;
/// Rows claimed per drain pass.
pub const BATCH_SIZE: i64 = 25;
const BASE_BACKOFF_SECS: i64 = 30;
const MAX_BACKOFF_SECS: i64 = 3600;
/// A `sending` row claimed longer ago than this is assumed orphaned by a
/// crashed worker and becomes eligible again.
const STALE_CLAIM_SECS: i64 = 600;

/// Queue a transactional email for background delivery.
pub async fn enqueue(pool: &PgPool, email: Email) -> Result<(), Error> {
    sqlx::query(
        "INSERT INTO email_outbox (recipient, subject, body, html) VALUES ($1, $2, $3, $4)",
    )
    .bind(&email.to)
    .bind(&email.subject)
    .bind(&email.body)
    .bind(&email.html)
    .execute(pool)
    .await
    .map_err(Error::internal)?;
    Ok(())
}

fn backoff_secs(attempts: i32) -> i64 {
    let shift = attempts.saturating_sub(1).clamp(0, 10) as u32;
    (BASE_BACKOFF_SECS.saturating_mul(2i64.pow(shift))).min(MAX_BACKOFF_SECS)
}

#[derive(Debug, sqlx::FromRow)]
struct Claim {
    id: Uuid,
    recipient: String,
    subject: String,
    body: String,
    html: Option<String>,
    attempts: i32,
}

/// Run one drain pass: recover stale claims, deliver every due row, and
/// return the number of rows handled.
pub async fn process_outbox_once(pool: &PgPool, sender: &Arc<dyn Mailer>) -> Result<usize, Error> {
    sqlx::query(
        "UPDATE email_outbox SET status = 'pending', claimed_at = NULL \
         WHERE status = 'sending' AND claimed_at < now() - make_interval(secs => $1)",
    )
    .bind(STALE_CLAIM_SECS as f64)
    .execute(pool)
    .await
    .map_err(Error::internal)?;

    let rows = sqlx::query_as::<_, Claim>(
        "UPDATE email_outbox SET status = 'sending', claimed_at = now() \
         WHERE id IN ( \
             SELECT id FROM email_outbox \
             WHERE status = 'pending' AND next_attempt_at <= now() \
             ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED \
         ) \
         RETURNING id, recipient, subject, body, html, attempts",
    )
    .bind(BATCH_SIZE)
    .fetch_all(pool)
    .await
    .map_err(Error::internal)?;

    let mut handled = 0;
    for row in rows {
        let email = Email {
            to: row.recipient.clone(),
            subject: row.subject.clone(),
            body: row.body.clone(),
            html: row.html.clone(),
        };
        match sender.send(email).await {
            Ok(SendOutcome::Sent) => {
                sqlx::query(
                    "UPDATE email_outbox SET status = 'sent', sent_at = now(), last_error = NULL WHERE id = $1",
                )
                .bind(row.id)
                .execute(pool)
                .await
                .map_err(Error::internal)?;
            }
            Ok(SendOutcome::Bounced) => {
                sqlx::query(
                    "UPDATE email_outbox SET status = 'dead_letter', last_error = 'permanent bounce' WHERE id = $1",
                )
                .bind(row.id)
                .execute(pool)
                .await
                .map_err(Error::internal)?;
            }
            Err(e) => {
                let attempts = row.attempts + 1;
                tracing::warn!(id = %row.id, attempts, error = %e, "email delivery failed; will retry");
                if attempts >= MAX_ATTEMPTS {
                    sqlx::query(
                        "UPDATE email_outbox SET status = 'dead_letter', attempts = $2, last_error = $3 WHERE id = $1",
                    )
                    .bind(row.id)
                    .bind(attempts)
                    .bind(format!("gave up after {attempts} attempts: {e}"))
                    .execute(pool)
                    .await
                    .map_err(Error::internal)?;
                } else {
                    sqlx::query(
                        "UPDATE email_outbox SET status = 'pending', attempts = $2, \
                         next_attempt_at = now() + make_interval(secs => $3), last_error = $4 \
                         WHERE id = $1",
                    )
                    .bind(row.id)
                    .bind(attempts)
                    .bind(backoff_secs(attempts) as f64)
                    .bind(e.to_string())
                    .execute(pool)
                    .await
                    .map_err(Error::internal)?;
                }
            }
        }
        handled += 1;
    }
    Ok(handled)
}

/// Drain due mail forever, sleeping `poll_interval` between passes. A failed
/// pass is logged, never fatal.
pub async fn run_worker(pool: PgPool, sender: Arc<dyn Mailer>, poll_interval: Duration) {
    loop {
        match process_outbox_once(&pool, &sender).await {
            Ok(0) => {}
            Ok(n) => tracing::info!(delivered = n, "email outbox drained"),
            Err(e) => tracing::error!(error = %e, "email outbox drain failed"),
        }
        tokio::time::sleep(poll_interval).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_grows_and_caps() {
        assert_eq!(backoff_secs(1), 30);
        assert_eq!(backoff_secs(2), 60);
        assert_eq!(backoff_secs(3), 120);
        assert_eq!(backoff_secs(10), MAX_BACKOFF_SECS);
        assert_eq!(backoff_secs(100), MAX_BACKOFF_SECS);
    }
}
