//! Transactional email delivery behind a `Mailer` trait.
//!
//! Request handlers never call a sender directly — they INSERT into the
//! `email_outbox` table (`email_queue::enqueue`) and return. A background
//! worker (`email_queue::run_worker`) drains due rows through one of these
//! senders with retries, so delivery failures never fail user requests.
//!
//! Senders: `InMemoryMailer` (tests), `CloudflareEmailSender` (Cloudflare
//! Email Service REST API), `ResendEmailSender` (Resend REST API),
//! `LoggingMailer` (dev fallback that logs the message instead of
//! delivering), and the legacy `SmtpMailer` (kept for compatibility;
//! no longer wired in production).

use async_trait::async_trait;
use lettre::address::AddressError;
use lettre::message::{Mailbox, header::ContentType};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Tokio1Executor};
use shared::Error;
use std::fmt;
use std::sync::{Arc, Mutex};

/// The mail a transactional handler wants delivered. `body` is the plain-text
/// version (verification / reset links); `html` optionally carries a
/// designed version — senders fall back to rendering `body` when absent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Email {
    pub to: String,
    pub subject: String,
    pub body: String,
    pub html: Option<String>,
}

/// What a single delivery attempt concluded. `Bounced` (e.g. a permanent
/// Cloudflare bounce) tells the outbox worker to dead-letter immediately
/// instead of retrying.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SendOutcome {
    Sent,
    Bounced,
}

/// Minimal mailer abstraction. Implementations must not panic and must
/// translate transport failures into `Error::Internal`.
#[async_trait]
pub trait Mailer: Send + Sync {
    async fn send(&self, email: Email) -> Result<SendOutcome, Error>;
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
    async fn send(&self, email: Email) -> Result<SendOutcome, Error> {
        let mut state = self.inner.lock().expect("mailer lock");
        if state.fail {
            return Err(Error::internal(std::io::Error::other("fake SMTP failure")));
        }
        state.emails.push(email);
        Ok(SendOutcome::Sent)
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
    async fn send(&self, email: Email) -> Result<SendOutcome, Error> {
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
            .map(|_| SendOutcome::Sent)
            .map_err(Error::internal)
    }
}

fn validate_address(addr: &str) -> std::result::Result<(), AddressError> {
    addr.parse::<Mailbox>().map(|_| ())
}

// ---- Cloudflare Email Service (production) ---------------------------------

/// Sends through the Cloudflare Email Service REST API
/// (`POST /accounts/{account_id}/email/sending/send`). No worker required;
/// the outbox worker calls this with retries. Permanent bounces surface as
/// [`SendOutcome::Bounced`] so the worker dead-letters instead of retrying.
#[derive(Clone)]
pub struct CloudflareEmailSender {
    account_id: String,
    api_token: String,
    from: String,
    client: reqwest::Client,
}

impl fmt::Debug for CloudflareEmailSender {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CloudflareEmailSender")
            .field("account_id", &self.account_id)
            .field("from", &self.from)
            .field("api_token", &"<redacted>")
            .finish()
    }
}

impl CloudflareEmailSender {
    pub fn new(account_id: String, api_token: String, from: String) -> Self {
        Self {
            account_id,
            api_token,
            from,
            client: reqwest::Client::new(),
        }
    }
}

#[async_trait]
impl Mailer for CloudflareEmailSender {
    async fn send(&self, email: Email) -> Result<SendOutcome, Error> {
        let url = format!(
            "https://api.cloudflare.com/client/v4/accounts/{}/email/sending/send",
            self.account_id
        );
        let html = email.html.unwrap_or_else(|| text_to_html(&email.body));
        let response = self
            .client
            .post(&url)
            .bearer_auth(&self.api_token)
            .json(&serde_json::json!({
                "to": email.to,
                "from": self.from,
                "subject": email.subject,
                "text": email.body,
                "html": html,
            }))
            .send()
            .await
            .map_err(Error::internal)?;
        let status = response.status();
        let body: serde_json::Value = response.json().await.map_err(Error::internal)?;
        if body.get("success").and_then(|v| v.as_bool()) == Some(true) {
            let delivered = body
                .pointer("/result/delivered")
                .and_then(|v| v.as_array())
                .map(|items| !items.is_empty())
                .unwrap_or(false);
            if delivered {
                return Ok(SendOutcome::Sent);
            }
            let bounced = body
                .pointer("/result/permanent_bounces")
                .and_then(|v| v.as_array())
                .map(|items| !items.is_empty())
                .unwrap_or(false);
            if bounced {
                tracing::warn!(to = %email.to, "email permanently bounced; dead-lettering");
                return Ok(SendOutcome::Bounced);
            }
            return Err(Error::internal(std::io::Error::other(
                "cloudflare accepted the email but reported no delivery",
            )));
        }
        let detail = body
            .pointer("/errors/0/message")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        Err(Error::internal(std::io::Error::other(format!(
            "cloudflare email send failed: HTTP {status}: {detail}"
        ))))
    }
}

// ---- Resend (production outbound) --------------------------------------------

/// Sends through the Resend REST API (`POST https://api.resend.com/emails`).
/// Validation failures (HTTP 422) surface as [`SendOutcome::Bounced`] so the
/// worker dead-letters instead of retrying; everything else retries.
#[derive(Clone)]
pub struct ResendEmailSender {
    api_key: String,
    from: String,
    client: reqwest::Client,
}

impl fmt::Debug for ResendEmailSender {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ResendEmailSender")
            .field("from", &self.from)
            .field("api_key", &"<redacted>")
            .finish()
    }
}

impl ResendEmailSender {
    pub fn new(api_key: String, from: String) -> Self {
        Self {
            api_key,
            from,
            client: reqwest::Client::new(),
        }
    }
}

fn escape_html(body: &str) -> String {
    let mut escaped = String::with_capacity(body.len() + 64);
    for ch in body.chars() {
        match ch {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            _ => escaped.push(ch),
        }
    }
    escaped
}

/// Branded organization-invitation email (table layout + inline styles for
/// client compatibility; no external images so nothing can fail to load).
/// `org` and `link` are escaped by construction.
pub fn invite_email_html(org: &str, role: &str, link: &str) -> String {
    let org = escape_html(org);
    let link = escape_html(link);
    let mut role_label = role.to_string();
    if let Some(first) = role_label.get_mut(..1) {
        first.make_ascii_uppercase();
    }
    format!(
        r#"<!doctype html><html><body style="margin:0;padding:0;background-color:#121212;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#121212;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#181818;border:1px solid #2b2b2b;border-radius:8px;max-width:480px;width:100%;">
<tr><td style="padding:28px 28px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;letter-spacing:3px;color:#f5f5f5;">RELEEVE</td></tr>
<tr><td style="padding:20px 28px 0;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#f5f5f5;">You&rsquo;ve been invited to {org}</td></tr>
<tr><td style="padding:10px 28px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#a1a1a1;">You&rsquo;ve been invited to join <strong style="color:#f5f5f5;">{org}</strong> on Releeve as <strong style="color:#f5f5f5;">{role_label}</strong>.</td></tr>
<tr><td align="center" style="padding:24px 28px 8px;"><a href="{link}" style="display:inline-block;background-color:#078a4f;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;text-decoration:none;padding:12px 28px;border-radius:6px;">Accept invitation</a></td></tr>
<tr><td style="padding:16px 28px 28px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#707070;">Button not working? Paste this link into your browser:<br><a href="{link}" style="color:#a1a1a1;word-break:break-all;">{link}</a><br><br>If you weren&rsquo;t expecting this, you can safely ignore it.</td></tr>
</table>
</td></tr>
</table>
</body></html>"#
    )
}

/// Plain-text body rendered as minimal HTML (bare URLs linkified) for
/// senders that only have the text version.
fn text_to_html(body: &str) -> String {
    let escaped = escape_html(body);
    let mut html = String::with_capacity(escaped.len() + 128);
    html.push_str("<p>");
    let mut first = true;
    for token in escaped.split_whitespace() {
        if !first {
            html.push(' ');
        }
        first = false;
        if token.starts_with("http://") || token.starts_with("https://") {
            html.push_str(&format!("<a href=\"{token}\">{token}</a>"));
        } else {
            html.push_str(token);
        }
    }
    html.push_str("</p>");
    html
}

#[async_trait]
impl Mailer for ResendEmailSender {
    async fn send(&self, email: Email) -> Result<SendOutcome, Error> {
        let html = email.html.unwrap_or_else(|| text_to_html(&email.body));
        let response = self
            .client
            .post("https://api.resend.com/emails")
            .bearer_auth(&self.api_key)
            .json(&serde_json::json!({
                "from": self.from,
                "to": [email.to.clone()],
                "subject": email.subject,
                "text": email.body,
                "html": html,
            }))
            .send()
            .await
            .map_err(Error::internal)?;
        let status = response.status();
        if status.is_success() {
            return Ok(SendOutcome::Sent);
        }
        let detail = response
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|body| {
                body.get("message")
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "unknown error".to_string());
        // Unprocessable shapes (bad addresses, unverified sender in test
        // mode, …) will not succeed on retry.
        if status.as_u16() == 422 {
            tracing::warn!(to = %email.to, detail = %detail, "resend rejected the email; dead-lettering");
            return Ok(SendOutcome::Bounced);
        }
        Err(Error::internal(std::io::Error::other(format!(
            "resend send failed: HTTP {status}: {detail}"
        ))))
    }
}

// ---- Logging fallback (dev) --------------------------------------------------

/// Records the message in the logs instead of delivering it. Used when no
/// email provider is configured, so local signup flows (verification links
/// included) keep working end to end.
#[derive(Debug, Clone, Default)]
pub struct LoggingMailer;

#[async_trait]
impl Mailer for LoggingMailer {
    async fn send(&self, email: Email) -> Result<SendOutcome, Error> {
        tracing::info!(to = %email.to, subject = %email.subject, body = %email.body, "dev email (not delivered)");
        Ok(SendOutcome::Sent)
    }
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
            html: None,
        };
        mailer.send(email.clone()).await.expect("sends");
        let sent = mailer.drain();
        assert_eq!(sent, vec![email]);
        assert_eq!(
            mailer
                .send(Email {
                    to: "u@example.com".into(),
                    subject: "z".into(),
                    body: "w".into(),
                    html: None,
                })
                .await
                .expect("sends"),
            SendOutcome::Sent
        );

        mailer.should_fail();
        assert!(
            mailer
                .send(Email {
                    to: "u@example.com".into(),
                    subject: "x".into(),
                    body: "y".into(),
                    html: None,
                })
                .await
                .is_err()
        );
    }

    #[test]
    fn accepts_a_display_name_mailbox() {
        assert!(validate_address("Releeve <no-reply@releeve.dev>").is_ok());
    }

    #[test]
    fn text_to_html_escapes_and_linkifies() {
        let html = text_to_html("Hi <there> see https://app.releeve.xyz/signup now");
        assert_eq!(
            html,
            "<p>Hi &lt;there&gt; see <a href=\"https://app.releeve.xyz/signup\">https://app.releeve.xyz/signup</a> now</p>"
        );
    }
}
