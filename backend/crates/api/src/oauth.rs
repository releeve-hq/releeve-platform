//! OAuth clients for GitHub and Google: `start` (build the provider auth URL +
//! CSRF state) and `callback` (exchange the one-time code for an identity).
//!
//! The provider base-URLs and the callback redirect base are configurable so
//! integration tests can point them at an in-process mock provider instead of
//! the live GitHub/Google endpoints.

use serde::{Deserialize, Serialize};
use shared::{Error, Settings};

/// Supported OAuth providers. `parse` returns `BadRequest` for anything else.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OAuthProvider {
    #[serde(rename = "github")]
    Github,
    #[serde(rename = "google")]
    Google,
}

impl OAuthProvider {
    pub fn parse(s: &str) -> Result<Self, Error> {
        match s {
            "github" => Ok(OAuthProvider::Github),
            "google" => Ok(OAuthProvider::Google),
            _ => Err(Error::BadRequest("unsupported oauth provider".into())),
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            OAuthProvider::Github => "github",
            OAuthProvider::Google => "google",
        }
    }
}

/// Identity resolved from a provider after a successful code exchange.
#[derive(Debug, Clone)]
pub struct ProviderIdentity {
    pub provider: OAuthProvider,
    pub provider_id: String,
    pub email: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
}

/// Provider endpoints default to the live services and are overridable
/// (mainly for tests, which point them at an in-process mock).
#[derive(Debug, Clone)]
pub struct OAuthClients {
    client: reqwest::Client,

    callback_base: String,

    github_client_id: String,
    github_client_secret: String,
    github_base: String,
    github_api_base: String,

    google_client_id: String,
    google_client_secret: String,
    google_auth_base: String,
    google_userinfo_url: String,
}

impl OAuthClients {
    pub fn from_settings(settings: &Settings) -> Self {
        Self {
            client: reqwest::Client::new(),
            callback_base: "http://127.0.0.1:8080".to_string(),
            github_client_id: settings.oauth_github_client_id.clone(),
            github_client_secret: settings.oauth_github_client_secret.clone(),
            github_base: "https://github.com".to_string(),
            github_api_base: "https://api.github.com".to_string(),
            google_client_id: settings.oauth_google_client_id.clone(),
            google_client_secret: settings.oauth_google_client_secret.clone(),
            google_auth_base: "https://oauth2.googleapis.com".to_string(),
            google_userinfo_url: "https://openidconnect.googleapis.com/v1/userinfo".to_string(),
        }
    }

    /// Override all provider endpoints with an in-process stub (tests).
    #[cfg(test)]
    pub fn stub(callback_base: &str, provider_base: &str) -> Self {
        let mut o = Self::from_settings(&Settings {
            bind_addr: "127.0.0.1:8080".into(),
            database_url: String::new(),
            redis_url: String::new(),
            log_filter: "info".into(),
            jwt_secret: "test".into(),
            jwt_access_ttl: 900,
            jwt_refresh_ttl: 2592000,
            app_base_url: "http://localhost:3000".into(),
            smtp_host: String::new(),
            smtp_port: 587,
            smtp_username: String::new(),
            smtp_password: String::new(),
            smtp_from: String::new(),
            oauth_github_client_id: "gh-id".into(),
            oauth_github_client_secret: "gh-secret".into(),
            oauth_google_client_id: "g-id".into(),
            oauth_google_client_secret: "g-secret".into(),
            soroban_rpc_url: String::new(),
        });
        o.callback_base = callback_base.to_string();
        o.github_base = provider_base.to_string();
        o.github_api_base = provider_base.to_string();
        o.google_auth_base = provider_base.to_string();
        o.google_userinfo_url = format!("{provider_base}/userinfo");
        o
    }

    pub fn auth_url(&self, provider: OAuthProvider, state: &str) -> String {
        match provider {
            OAuthProvider::Github => format!(
                "{}/login/oauth/authorize?client_id={}&redirect_uri={}/api/v1/auth/oauth/github/callback&scope=user:email&state={}",
                self.github_base, self.github_client_id, self.callback_base, state
            ),
            OAuthProvider::Google => format!(
                "{}/o/oauth2/v2/auth?client_id={}&redirect_uri={}/api/v1/auth/oauth/google/callback&response_type=code&scope=openid%20email%20profile&state={}",
                self.google_auth_base, self.google_client_id, self.callback_base, state
            ),
        }
    }

    pub async fn exchange_code(
        &self,
        provider: OAuthProvider,
        code: &str,
    ) -> Result<ProviderIdentity, Error> {
        match provider {
            OAuthProvider::Github => {
                let token = self.github_access_token(code).await?;
                self.github_userinfo(&token).await
            }
            OAuthProvider::Google => {
                let token = self.google_access_token(code).await?;
                let userinfo: GoogleUserinfo = self
                    .client
                    .get(&self.google_userinfo_url)
                    .bearer_auth(&token)
                    .send()
                    .await
                    .map_err(Error::internal)?
                    .error_for_status()
                    .map_err(|e| {
                        tracing::warn!(error = %e, "google userinfo rejected");
                        Error::BadRequest("provider rejected the code".into())
                    })?
                    .json()
                    .await
                    .map_err(Error::internal)?;
                let email = userinfo.email.ok_or_else(|| {
                    Error::BadRequest("provider returned no verified email".into())
                })?;
                Ok(ProviderIdentity {
                    provider: OAuthProvider::Google,
                    provider_id: userinfo.sub,
                    email,
                    name: userinfo.name,
                    avatar_url: userinfo.picture,
                })
            }
        }
    }

    async fn github_access_token(&self, code: &str) -> Result<String, Error> {
        let params = [
            ("client_id", self.github_client_id.as_str()),
            ("client_secret", self.github_client_secret.as_str()),
            ("code", code.trim()),
        ];
        let resp = self
            .client
            .post(format!("{}/login/oauth/access_token", self.github_base))
            .header("Accept", "application/json")
            .form(&params)
            .send()
            .await
            .map_err(Error::internal)?;
        let token: GithubToken = resp
            .error_for_status()
            .map_err(|e| {
                tracing::warn!(error = %e, "github token exchange rejected");
                Error::BadRequest("provider rejected the code".into())
            })?
            .json()
            .await
            .map_err(Error::internal)?;
        if let Some(err) = token.error {
            return Err(Error::BadRequest(format!("provider error: {err}")));
        }
        token
            .access_token
            .ok_or_else(|| Error::BadRequest("provider returned no token".into()))
    }

    async fn github_userinfo(&self, token: &str) -> Result<ProviderIdentity, Error> {
        let user: GithubUser = self
            .client
            .get(format!("{}/user", self.github_api_base))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "releeve")
            .bearer_auth(token)
            .send()
            .await
            .map_err(Error::internal)?
            .error_for_status()
            .map_err(|e| {
                tracing::warn!(error = %e, "github userinfo rejected");
                Error::BadRequest("provider rejected the token".into())
            })?
            .json()
            .await
            .map_err(Error::internal)?;

        let email = if !user.email.is_empty() {
            user.email
        } else {
            self.github_primary_email(token)
                .await?
                .ok_or_else(|| Error::BadRequest("provider returned no verified email".into()))?
        };

        Ok(ProviderIdentity {
            provider: OAuthProvider::Github,
            provider_id: user.id.to_string(),
            email,
            name: user.name.or(user.login),
            avatar_url: user.avatar_url,
        })
    }

    async fn github_primary_email(&self, token: &str) -> Result<Option<String>, Error> {
        let emails: Vec<GithubEmail> = self
            .client
            .get(format!("{}/user/emails", self.github_api_base))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "releeve")
            .bearer_auth(token)
            .send()
            .await
            .map_err(Error::internal)?
            .error_for_status()
            .map_err(Error::internal)?
            .json()
            .await
            .map_err(Error::internal)?;
        Ok(emails
            .iter()
            .find(|e| e.primary)
            .or_else(|| emails.first())
            .and_then(|e| e.email.clone()))
    }

    async fn google_access_token(&self, code: &str) -> Result<String, Error> {
        let params = [
            ("code", code.to_string()),
            ("client_id", self.google_client_id.clone()),
            ("client_secret", self.google_client_secret.clone()),
            (
                "redirect_uri",
                format!("{}/api/v1/auth/oauth/google/callback", self.callback_base),
            ),
            ("grant_type", "authorization_code".to_string()),
        ];
        let resp = self
            .client
            .post(format!("{}/token", self.google_auth_base))
            .form(&params)
            .send()
            .await
            .map_err(Error::internal)?;
        let token: GoogleToken = resp
            .error_for_status()
            .map_err(|e| {
                tracing::warn!(error = %e, "google token rejected");
                Error::BadRequest("provider rejected the code".into())
            })?
            .json()
            .await
            .map_err(Error::internal)?;
        token
            .access_token
            .ok_or_else(|| Error::BadRequest("provider returned no token".into()))
    }
}

// ---- Provider response DTOs -----------------------------------------------

#[derive(Debug, Deserialize)]
struct GithubToken {
    access_token: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubUser {
    id: u64,
    email: String,
    login: Option<String>,
    name: Option<String>,
    avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubEmail {
    email: Option<String>,
    primary: bool,
}

#[derive(Debug, Deserialize)]
struct GoogleToken {
    access_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleUserinfo {
    sub: String,
    email: Option<String>,
    name: Option<String>,
    picture: Option<String>,
}
