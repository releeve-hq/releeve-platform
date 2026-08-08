//! Transactional email delivery behind a `Mailer` trait so tests never touch
//! real SMTP (they use an in-memory fake), and one SMTP implementation
//! (`lettre`) is used in production.

use async_trait::async_trait;
use lettre::address::AddressError;
use lettre::message::{Mailbox, header::ContentType};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Tokio1Executor};
use shared::Error;
use std::fmt;
use std::sync::{Arc, Mutex};

/// The mail a transactional handler wants delivered. The message body is a
/// plain URL the client can visit (verification / reset links).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Email {
    pub to: String,
    pub subject: String,
    pub body: String,
}

/// Minimal mailer abstraction. Implementations must not panic and must
/// translate transport failures into `Error::Internal` (the caller decides
/// whether to roll back the surrounding transaction).
#[async_trait]
pub trait Mailer: Send + Sync {
    async fn send(&self, email: Email) -> Result<(), Error>;
}

// ---- In-memory fake (tests / dev) ----------------------------------------

/// An in-memory mailer that records sent emails for assertions. Optionally
/// configured to fail — used to prove signup rolls back when email fails.
#[derive(Debug)]
pub struct InMemoryMailer {
    inner: Arc<Mutex<InMemoryState>>,
}

#[derive(Debug, Default)]
struct InMemoryState {
    emails: Vec<Email>,
    fail: bool,
}

impl InMemoryMailer {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(InMemoryState::default())),
        }
    }

    pub fn should_fail(&self) {
        self.inner.lock().expect("mailer lock").fail = true;
    }

    pub fn drain(&self) -> Vec<Email> {
        std::mem::take(&mut self.inner.lock().expect("mailer lock").emails)
    }

    pub fn count(&self) -> usize {
        self.inner.lock().expect("mailer lock").emails.len()
    }
}

impl Default for InMemoryMailer {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Mailer for InMemoryMailer {
    async fn send(&self, email: Email) -> Result<(), Error> {
        let mut state = self.inner.lock().expect("mailer lock");
        if state.fail {
            return Err(Error::internal(std::io::Error::other("fake SMTP failure")));
        }
        state.emails.push(email);
        Ok(())
    }
}

impl fmt::Debug for dyn Mailer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Mailer")
    }
}

// ---- SMTP (production) -----------------------------------------------------

#[derive(Clone)]
pub struct SmtpMailer {
    from: String,
    transport: AsyncSmtpTransport<Tokio1Executor>,
    host: String,
}

impl fmt::Debug for SmtpMailer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SmtpMailer")
            .field("from", &self.from)
            .field("host", &self.host)
            .finish()
    }
}

impl SmtpMailer {
    /// Build an SMTP mailer. `host` empty → use the local relay (starttls
    /// opportunistic), which is the least-surprise dev default.
    /// Returns `ServiceUnavailable`-converting errors on construction.
    pub fn new(
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        from: &str,
    ) -> Result<Self, Error> {
        validate_address(from).map_err(Error::internal)?;
        let creds = (!username.is_empty())
            .then(|| (username.to_string(), password.to_string()))
            .filter(|(u, _)| !u.is_empty());

        // Use the same builder shape in both branches so they collide on the
        // concrete `AsyncSmtpTransport<Tokio1Executor>` type. `builder_dangerous`
        // is the least-surprise dev default (opportunistic/no TLS); credentials
        // are attached only when a username is configured.
        let mut builder =
            AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host.to_string()).port(port);
        if let Some((user, pass)) = creds {
            builder = builder.credentials(Credentials::new(user, pass));
        }
        let transport = builder.build();

        Ok(Self {
            from: from.to_string(),
            host: host.to_string(),
            transport,
        })
    }
}

#[async_trait]
impl Mailer for SmtpMailer {
    async fn send(&self, email: Email) -> Result<(), Error> {
        let message = lettre::Message::builder()
            .from(
                self.from
                    .parse()
                    .map_err(|e: AddressError| Error::internal(e))?,
            )
            .to(email
                .to
                .parse()
                .map_err(|e: AddressError| Error::internal(e))?)
            .subject(email.subject)
            .header(ContentType::TEXT_HTML)
            .body(email.body)
            .map_err(Error::internal)?;
        self.transport
            .send(message)
            .await
            .map(|_| ())
            .map_err(Error::internal)
    }
}

fn validate_address(addr: &str) -> std::result::Result<(), AddressError> {
    addr.parse::<Mailbox>().map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn in_memory_mailer_records_and_fails() {
        let mailer = InMemoryMailer::new();
        let email = Email {
            to: "u@example.com".into(),
            subject: "Verify".into(),
            body: "http://localhost:3000/auth/verify?token=abc".into(),
        };
        mailer.send(email.clone()).await.expect("sends");
        let sent = mailer.drain();
        assert_eq!(sent, vec![email]);

        mailer.should_fail();
        assert!(
            mailer
                .send(Email {
                    to: "u@example.com".into(),
                    subject: "x".into(),
                    body: "y".into(),
                })
                .await
                .is_err()
        );
    }

    #[test]
    fn accepts_a_display_name_mailbox() {
        assert!(validate_address("Releeve <no-reply@releeve.dev>").is_ok());
    }
}
