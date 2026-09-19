//! Email outbox worker tests — enqueue, delivery, retries with backoff,
//! dead-lettering, bounce handling, and stale-claim recovery. The worker
//! drains through the test sender (`InMemoryMailer`); production swaps in
//! the Cloudflare REST sender without changing this contract.

mod common;

use std::sync::Arc;

use async_trait::async_trait;
use shared::Error;

use api::mailer::{Email, InMemoryMailer, Mailer, SendOutcome};
use common::TestApp;

/// A sender that reports every message as a permanent bounce.
struct BounceMailer;

#[async_trait]
impl Mailer for BounceMailer {
    async fn send(&self, _email: Email) -> Result<SendOutcome, Error> {
        Ok(SendOutcome::Bounced)
    }
}

async fn outbox_row(app: &TestApp, recipient: &str) -> (String, i32, Option<String>) {
    sqlx::query_as("SELECT status, attempts, last_error FROM email_outbox WHERE recipient = $1")
        .bind(recipient)
        .fetch_one(app.db())
        .await
        .expect("outbox row exists")
}

#[tokio::test]
async fn queued_mail_is_delivered_and_marked_sent() {
    let app = TestApp::new().await;
    api::email_queue::enqueue(
        app.db(),
        Email {
            to: "user@example.com".into(),
            subject: "Hello".into(),
            body: "body".into(),
            html: None,
        },
    )
    .await
    .expect("enqueue works");

    assert_eq!(app.drain_mail().await.len(), 1, "one email delivered");
    let (status, attempts, _) = outbox_row(&app, "user@example.com").await;
    assert_eq!(status, "sent");
    assert_eq!(attempts, 0);
}

#[tokio::test]
async fn failed_delivery_retries_with_backoff_then_recovers() {
    let app = TestApp::new().await;
    let email = "retry@example.com";
    api::email_queue::enqueue(
        app.db(),
        Email {
            to: email.into(),
            subject: "Hi".into(),
            body: "body".into(),
            html: None,
        },
    )
    .await
    .expect("enqueue works");

    // Sender is failing: nothing delivered, attempt recorded, row stays due
    // in the future.
    app.fail_next_mail();
    assert!(app.drain_mail().await.is_empty());
    let (status, attempts, _) = outbox_row(&app, email).await;
    assert_eq!(status, "pending");
    assert_eq!(attempts, 1);
    let next: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT next_attempt_at FROM email_outbox WHERE recipient = $1")
            .bind(email)
            .fetch_one(app.db())
            .await
            .expect("next attempt readable");
    assert!(
        next > chrono::Utc::now(),
        "backoff pushes the next attempt into the future"
    );

    // Sender recovers once the row is due again.
    sqlx::query("UPDATE email_outbox SET next_attempt_at = now() WHERE recipient = $1")
        .bind(email)
        .execute(app.db())
        .await
        .expect("row made due");
    let working: Arc<dyn Mailer> = Arc::new(InMemoryMailer::new());
    let handled = api::email_queue::process_outbox_once(app.db(), &working)
        .await
        .expect("outbox drains");
    assert_eq!(handled, 1);
    let (status, _, _) = outbox_row(&app, email).await;
    assert_eq!(status, "sent");
}

#[tokio::test]
async fn exhausted_retries_dead_letter() {
    let app = TestApp::new().await;
    let email = "exhausted@example.com";
    api::email_queue::enqueue(
        app.db(),
        Email {
            to: email.into(),
            subject: "Hi".into(),
            body: "body".into(),
            html: None,
        },
    )
    .await
    .expect("enqueue works");
    sqlx::query(
        "UPDATE email_outbox SET attempts = $2, next_attempt_at = now() WHERE recipient = $1",
    )
    .bind(email)
    .bind(api::email_queue::MAX_ATTEMPTS - 1)
    .execute(app.db())
    .await
    .expect("attempts seeded");

    app.fail_next_mail();
    assert!(app.drain_mail().await.is_empty());
    let (status, attempts, last_error) = outbox_row(&app, email).await;
    assert_eq!(status, "dead_letter");
    assert_eq!(attempts, api::email_queue::MAX_ATTEMPTS);
    assert!(last_error.unwrap_or_default().contains("gave up"));
}

#[tokio::test]
async fn permanent_bounce_dead_letters_immediately() {
    let app = TestApp::new().await;
    api::email_queue::enqueue(
        app.db(),
        Email {
            to: "bounce@example.com".into(),
            subject: "Hi".into(),
            body: "body".into(),
            html: None,
        },
    )
    .await
    .expect("enqueue works");

    let sender: Arc<dyn Mailer> = Arc::new(BounceMailer);
    let handled = api::email_queue::process_outbox_once(app.db(), &sender)
        .await
        .expect("outbox drains");
    assert_eq!(handled, 1);
    let (status, attempts, _) = outbox_row(&app, "bounce@example.com").await;
    assert_eq!(status, "dead_letter");
    assert_eq!(attempts, 0, "bounces never retry");
}

#[tokio::test]
async fn stale_sending_claims_are_recovered() {
    let app = TestApp::new().await;
    api::email_queue::enqueue(
        app.db(),
        Email {
            to: "stale@example.com".into(),
            subject: "Hi".into(),
            body: "body".into(),
            html: None,
        },
    )
    .await
    .expect("enqueue works");
    sqlx::query(
        "UPDATE email_outbox SET status = 'sending', claimed_at = now() - make_interval(secs => 3600) WHERE recipient = $1",
    )
    .bind("stale@example.com")
    .execute(app.db())
    .await
    .expect("claim orphaned");

    assert_eq!(app.drain_mail().await.len(), 1, "orphaned row recovered");
    let (status, _, _) = outbox_row(&app, "stale@example.com").await;
    assert_eq!(status, "sent");
}
