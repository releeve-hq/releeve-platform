//! Authenticated Fork Core integration owned by Releeve Platform.

use std::{collections::BTreeSet, time::Duration};

use chrono::Utc;
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use reqwest::{Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("invalid Fork Core configuration: {0}")]
    Configuration(String),
    #[error("could not sign Fork Core assertion: {0}")]
    Signing(String),
    #[error("Fork Core transport failed: {0}")]
    Transport(String),
    #[error("Fork Core returned {status} ({code}): {detail}")]
    Remote {
        status: StatusCode,
        code: String,
        detail: String,
    },
    #[error("Fork Core returned an invalid response: {0}")]
    InvalidResponse(String),
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Clone)]
pub struct ServiceActor {
    pub actor_id: Uuid,
    pub organization_id: Uuid,
    pub project_id: Uuid,
    pub request_id: Uuid,
    pub permissions: BTreeSet<String>,
}

impl ServiceActor {
    pub fn fork_manager(
        actor_id: Uuid,
        organization_id: Uuid,
        project_id: Uuid,
        request_id: Uuid,
    ) -> Self {
        Self {
            actor_id,
            organization_id,
            project_id,
            request_id,
            permissions: BTreeSet::from(["manage_fork_sessions".into()]),
        }
    }
}

#[derive(Clone)]
pub struct ServiceAssertionSigner {
    key: EncodingKey,
    kid: String,
    issuer: String,
    audience: String,
}

impl ServiceAssertionSigner {
    pub fn from_ed25519_pem(
        private_key_pem: &[u8],
        kid: impl Into<String>,
        issuer: impl Into<String>,
        audience: impl Into<String>,
    ) -> Result<Self> {
        let key = EncodingKey::from_ed_pem(private_key_pem)
            .map_err(|error| Error::Configuration(error.to_string()))?;
        Ok(Self {
            key,
            kid: kid.into(),
            issuer: issuer.into(),
            audience: audience.into(),
        })
    }

    pub fn issue(&self, actor: &ServiceActor) -> Result<String> {
        let now = Utc::now().timestamp();
        let claims = ServiceClaims {
            sub: actor.actor_id,
            org_id: actor.organization_id,
            project_id: actor.project_id,
            permissions: actor.permissions.clone(),
            request_id: actor.request_id,
            iss: self.issuer.clone(),
            aud: self.audience.clone(),
            jti: Uuid::new_v4(),
            iat: now,
            nbf: now - 1,
            exp: now + 60,
        };
        let mut header = Header::new(Algorithm::EdDSA);
        header.kid = Some(self.kid.clone());
        encode(&header, &claims, &self.key).map_err(|error| Error::Signing(error.to_string()))
    }
}

#[derive(Debug, Serialize)]
struct ServiceClaims {
    sub: Uuid,
    org_id: Uuid,
    project_id: Uuid,
    permissions: BTreeSet<String>,
    request_id: Uuid,
    iss: String,
    aud: String,
    jti: Uuid,
    iat: i64,
    nbf: i64,
    exp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcceptedSimulation {
    pub simulation_id: Uuid,
    pub job_id: Uuid,
    pub created: bool,
    pub status: String,
    pub simulation_url: String,
    pub status_url: String,
}

#[derive(Clone)]
pub struct ForkCoreClient {
    endpoint: String,
    http: reqwest::Client,
    signer: ServiceAssertionSigner,
}

impl ForkCoreClient {
    pub fn new(endpoint: impl Into<String>, signer: ServiceAssertionSigner) -> Result<Self> {
        let endpoint = endpoint.into().trim_end_matches('/').to_owned();
        reqwest::Url::parse(&endpoint).map_err(|error| Error::Configuration(error.to_string()))?;
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|error| Error::Configuration(error.to_string()))?;
        Ok(Self {
            endpoint,
            http,
            signer,
        })
    }

    pub async fn create_simulation(
        &self,
        actor: &ServiceActor,
        idempotency_key: &str,
        body: &Value,
    ) -> Result<AcceptedSimulation> {
        let value = self
            .request(
                actor,
                Method::POST,
                "/v1/simulations",
                Some(body),
                Some(idempotency_key),
            )
            .await?;
        serde_json::from_value(value).map_err(|error| Error::InvalidResponse(error.to_string()))
    }

    pub async fn get_simulation(&self, actor: &ServiceActor, simulation_id: Uuid) -> Result<Value> {
        self.request(
            actor,
            Method::GET,
            &format!("/v1/simulations/{simulation_id}"),
            None,
            None,
        )
        .await
    }

    pub async fn get_simulation_trace(
        &self,
        actor: &ServiceActor,
        simulation_id: Uuid,
    ) -> Result<Value> {
        self.request(
            actor,
            Method::GET,
            &format!("/v1/simulations/{simulation_id}/trace"),
            None,
            None,
        )
        .await
    }

    pub async fn cancel_simulation(
        &self,
        actor: &ServiceActor,
        simulation_id: Uuid,
    ) -> Result<Value> {
        self.request(
            actor,
            Method::DELETE,
            &format!("/v1/simulations/{simulation_id}"),
            None,
            None,
        )
        .await
    }

    pub async fn create_environment(&self, actor: &ServiceActor, body: &Value) -> Result<Value> {
        self.request(actor, Method::POST, "/v1/environments", Some(body), None)
            .await
    }

    pub async fn list_environments(&self, actor: &ServiceActor) -> Result<Value> {
        self.request(actor, Method::GET, "/v1/environments", None, None)
            .await
    }

    pub async fn get_environment(
        &self,
        actor: &ServiceActor,
        environment_id: Uuid,
    ) -> Result<Value> {
        self.request(
            actor,
            Method::GET,
            &format!("/v1/environments/{environment_id}"),
            None,
            None,
        )
        .await
    }

    pub async fn update_environment(
        &self,
        actor: &ServiceActor,
        environment_id: Uuid,
        body: &Value,
    ) -> Result<Value> {
        self.request(
            actor,
            Method::PATCH,
            &format!("/v1/environments/{environment_id}"),
            Some(body),
            None,
        )
        .await
    }

    pub async fn delete_environment(
        &self,
        actor: &ServiceActor,
        environment_id: Uuid,
    ) -> Result<Value> {
        self.request(
            actor,
            Method::DELETE,
            &format!("/v1/environments/{environment_id}"),
            None,
            None,
        )
        .await
    }

    pub async fn environment_action(
        &self,
        actor: &ServiceActor,
        environment_id: Uuid,
        action: &str,
        body: Option<&Value>,
        idempotency_key: Option<&str>,
    ) -> Result<Value> {
        if !matches!(
            action,
            "simulate" | "rollback" | "sync/start" | "sync/stop" | "sync/status" | "overrides"
        ) {
            return Err(Error::Configuration(
                "unsupported environment action".into(),
            ));
        }
        let method = if matches!(action, "sync/status" | "overrides") && body.is_none() {
            Method::GET
        } else {
            Method::POST
        };
        self.request(
            actor,
            method,
            &format!("/v1/environments/{environment_id}/{action}"),
            body,
            idempotency_key,
        )
        .await
    }

    pub async fn delete_environment_override(
        &self,
        actor: &ServiceActor,
        environment_id: Uuid,
        override_id: Uuid,
    ) -> Result<Value> {
        self.request(
            actor,
            Method::DELETE,
            &format!("/v1/environments/{environment_id}/overrides/{override_id}"),
            None,
            None,
        )
        .await
    }

    async fn request(
        &self,
        actor: &ServiceActor,
        method: Method,
        path: &str,
        body: Option<&Value>,
        idempotency_key: Option<&str>,
    ) -> Result<Value> {
        let token = self.signer.issue(actor)?;
        let mut request = self
            .http
            .request(method, format!("{}{}", self.endpoint, path))
            .bearer_auth(token);
        if let Some(body) = body {
            request = request.json(body);
        }
        if let Some(key) = idempotency_key {
            request = request.header("idempotency-key", key);
        }
        let response = request
            .send()
            .await
            .map_err(|error| Error::Transport(error.to_string()))?;
        let status = response.status();
        let bytes = response
            .bytes()
            .await
            .map_err(|error| Error::Transport(error.to_string()))?;
        let value = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes)
                .map_err(|error| Error::InvalidResponse(error.to_string()))?
        };
        if !status.is_success() {
            return Err(Error::Remote {
                status,
                code: value
                    .get("code")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown_error")
                    .into(),
                detail: value
                    .get("detail")
                    .and_then(Value::as_str)
                    .unwrap_or("Fork Core rejected the request")
                    .into(),
            });
        }
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header};

    const PRIVATE_KEY: &[u8] = br#"-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIBae9dM/HT/asr3+2QFTFTHrEXLUjjpfseI2pvjpL5O3
-----END PRIVATE KEY-----"#;
    const PUBLIC_KEY: &[u8] = br#"-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAjZ/gl1/SqXrnlXAKK5fUGzjuwaPuWdoxyHXNjQtXGQY=
-----END PUBLIC KEY-----"#;

    #[test]
    fn assertion_is_ed25519_project_scoped_and_sixty_seconds() {
        let signer = ServiceAssertionSigner::from_ed25519_pem(
            PRIVATE_KEY,
            "platform-1",
            "releeve-platform",
            "fork-core",
        )
        .unwrap();
        let actor = ServiceActor::fork_manager(
            Uuid::new_v4(),
            Uuid::new_v4(),
            Uuid::new_v4(),
            Uuid::new_v4(),
        );
        let token = signer.issue(&actor).unwrap();
        let header = decode_header(&token).unwrap();
        assert_eq!(header.alg, Algorithm::EdDSA);
        assert_eq!(header.kid.as_deref(), Some("platform-1"));
        let mut validation = Validation::new(Algorithm::EdDSA);
        validation.set_issuer(&["releeve-platform"]);
        validation.set_audience(&["fork-core"]);
        let claims = decode::<Value>(
            &token,
            &DecodingKey::from_ed_pem(PUBLIC_KEY).unwrap(),
            &validation,
        )
        .unwrap()
        .claims;
        assert_eq!(claims["project_id"], actor.project_id.to_string());
        assert_eq!(
            claims["exp"].as_i64().unwrap() - claims["iat"].as_i64().unwrap(),
            60
        );
    }
}
