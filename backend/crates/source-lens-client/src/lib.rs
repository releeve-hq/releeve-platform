//! Private, project-scoped SourceLens transport for Releeve Platform.

use std::{collections::BTreeSet, time::Duration};

use chrono::Utc;
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use reqwest::{Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("invalid SourceLens configuration: {0}")]
    Configuration(String),
    #[error("could not sign SourceLens assertion: {0}")]
    Signing(String),
    #[error("SourceLens transport failed: {0}")]
    Transport(String),
    #[error("SourceLens returned {status} ({code}): {detail}")]
    Remote {
        status: StatusCode,
        code: String,
        detail: String,
    },
    #[error("SourceLens returned an invalid response: {0}")]
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
    pub fn project_member(
        actor_id: Uuid,
        organization_id: Uuid,
        project_id: Uuid,
        request_id: Uuid,
        can_write: bool,
    ) -> Self {
        let mut permissions = BTreeSet::from([
            "verifications:read".into(),
            "analyses:read".into(),
            "debug:read".into(),
            "sources:read".into(),
        ]);
        if can_write {
            permissions.extend([
                "verifications:write".into(),
                "analyses:write".into(),
                "debug:write".into(),
                "sources:write".into(),
            ]);
        }
        Self {
            actor_id,
            organization_id,
            project_id,
            request_id,
            permissions,
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
        Ok(Self {
            key: EncodingKey::from_ed_pem(private_key_pem)
                .map_err(|error| Error::Configuration(error.to_string()))?,
            kid: kid.into(),
            issuer: issuer.into(),
            audience: audience.into(),
        })
    }

    fn issue(&self, actor: &ServiceActor) -> Result<String> {
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

#[derive(Serialize)]
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

#[derive(Debug, Deserialize)]
pub struct AcceptedJob {
    #[serde(default)]
    pub verification_id: Option<Uuid>,
    #[serde(default)]
    pub analysis_id: Option<Uuid>,
    #[serde(default)]
    pub debug_session_id: Option<Uuid>,
    pub job_id: Uuid,
    pub created: bool,
    pub status: String,
}

#[derive(Clone)]
pub struct SourceLensClient {
    endpoint: String,
    http: reqwest::Client,
    signer: ServiceAssertionSigner,
}

impl SourceLensClient {
    pub fn new(endpoint: impl Into<String>, signer: ServiceAssertionSigner) -> Result<Self> {
        let endpoint = endpoint.into().trim_end_matches('/').to_owned();
        let parsed = reqwest::Url::parse(&endpoint)
            .map_err(|error| Error::Configuration(error.to_string()))?;
        if parsed.scheme() != "https"
            && !matches!(parsed.host_str(), Some("127.0.0.1" | "localhost"))
        {
            return Err(Error::Configuration(
                "SourceLens must use TLS outside loopback".into(),
            ));
        }
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|error| Error::Configuration(error.to_string()))?;
        Ok(Self {
            endpoint,
            http,
            signer,
        })
    }

    pub async fn create_upload(&self, actor: &ServiceActor, bytes: &[u8]) -> Result<Value> {
        let created = self
            .json(
                actor,
                Method::POST,
                "/v1/uploads",
                Some(&serde_json::json!({
                    "declared_bytes": bytes.len(),
                    "content_type": "application/zip"
                })),
                None,
            )
            .await?;
        let id = created
            .get("upload_id")
            .and_then(Value::as_str)
            .ok_or_else(|| Error::InvalidResponse("upload_id is missing".into()))?;
        self.bytes(
            actor,
            Method::PUT,
            &format!("/v1/uploads/{id}/content"),
            bytes,
        )
        .await
    }

    pub async fn create_verification(
        &self,
        actor: &ServiceActor,
        idempotency_key: &str,
        body: &Value,
    ) -> Result<AcceptedJob> {
        let value = self
            .json(
                actor,
                Method::POST,
                "/v1/verifications",
                Some(body),
                Some(idempotency_key),
            )
            .await?;
        serde_json::from_value(value).map_err(|error| Error::InvalidResponse(error.to_string()))
    }

    pub async fn list_verifications(&self, actor: &ServiceActor) -> Result<Value> {
        self.json(actor, Method::GET, "/v1/verifications", None, None)
            .await
    }

    pub async fn get_verification(&self, actor: &ServiceActor, id: Uuid) -> Result<Value> {
        self.json(
            actor,
            Method::GET,
            &format!("/v1/verifications/{id}"),
            None,
            None,
        )
        .await
    }

    pub async fn cancel_verification(&self, actor: &ServiceActor, id: Uuid) -> Result<Value> {
        self.json(
            actor,
            Method::DELETE,
            &format!("/v1/verifications/{id}"),
            None,
            None,
        )
        .await
    }

    pub async fn create_execution_artifact(
        &self,
        actor: &ServiceActor,
        body: &Value,
    ) -> Result<Value> {
        self.json(
            actor,
            Method::POST,
            "/v1/execution-artifacts",
            Some(body),
            None,
        )
        .await
    }

    pub async fn create_analysis(
        &self,
        actor: &ServiceActor,
        idempotency_key: &str,
        body: &Value,
    ) -> Result<AcceptedJob> {
        let value = self
            .json(
                actor,
                Method::POST,
                "/v1/analyses",
                Some(body),
                Some(idempotency_key),
            )
            .await?;
        serde_json::from_value(value).map_err(|error| Error::InvalidResponse(error.to_string()))
    }

    pub async fn get_analysis(&self, actor: &ServiceActor, id: Uuid) -> Result<Value> {
        self.json(
            actor,
            Method::GET,
            &format!("/v1/analyses/{id}"),
            None,
            None,
        )
        .await
    }

    pub async fn create_debug_session(
        &self,
        actor: &ServiceActor,
        idempotency_key: &str,
        analysis_id: Uuid,
    ) -> Result<AcceptedJob> {
        let body = serde_json::json!({"analysis_id": analysis_id});
        let value = self
            .json(
                actor,
                Method::POST,
                "/v1/debug-sessions",
                Some(&body),
                Some(idempotency_key),
            )
            .await?;
        serde_json::from_value(value).map_err(|error| Error::InvalidResponse(error.to_string()))
    }

    pub async fn get_debug_session(&self, actor: &ServiceActor, id: Uuid) -> Result<Value> {
        self.json(
            actor,
            Method::GET,
            &format!("/v1/debug-sessions/{id}"),
            None,
            None,
        )
        .await
    }

    pub async fn get_debug_trace(&self, actor: &ServiceActor, id: Uuid) -> Result<Value> {
        self.get_debug_trace_page(actor, id, None, None).await
    }

    pub async fn get_debug_trace_page(
        &self,
        actor: &ServiceActor,
        id: Uuid,
        cursor: Option<usize>,
        limit: Option<usize>,
    ) -> Result<Value> {
        let mut path = format!("/v1/debug-sessions/{id}/trace");
        let mut separator = '?';
        if let Some(cursor) = cursor {
            path.push_str(&format!("{separator}cursor={cursor}"));
            separator = '&';
        }
        if let Some(limit) = limit {
            path.push_str(&format!("{separator}limit={}", limit.clamp(1, 2_000)));
        }
        self.json(actor, Method::GET, &path, None, None).await
    }

    pub async fn get_source_file(
        &self,
        actor: &ServiceActor,
        verification_id: Uuid,
        source_path: &str,
    ) -> Result<Vec<u8>> {
        let encoded = source_path
            .split('/')
            .filter(|part| !part.is_empty())
            .map(|part| urlencoding::encode(part).into_owned())
            .collect::<Vec<_>>()
            .join("/");
        let response = self
            .http
            .get(format!(
                "{}/v1/verifications/{verification_id}/source/{encoded}",
                self.endpoint
            ))
            .bearer_auth(self.signer.issue(actor)?)
            .send()
            .await
            .map_err(|error| Error::Transport(error.to_string()))?;
        let status = response.status();
        let bytes = response
            .bytes()
            .await
            .map_err(|error| Error::Transport(error.to_string()))?;
        if !status.is_success() {
            let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
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
                    .unwrap_or("SourceLens rejected the request")
                    .into(),
            });
        }
        Ok(bytes.to_vec())
    }

    async fn json(
        &self,
        actor: &ServiceActor,
        method: Method,
        path: &str,
        body: Option<&Value>,
        idempotency_key: Option<&str>,
    ) -> Result<Value> {
        let mut request = self
            .http
            .request(method, format!("{}{}", self.endpoint, path))
            .bearer_auth(self.signer.issue(actor)?);
        if let Some(body) = body {
            request = request.json(body);
        }
        if let Some(key) = idempotency_key {
            request = request.header("idempotency-key", key);
        }
        self.response(request.send().await).await
    }

    async fn bytes(
        &self,
        actor: &ServiceActor,
        method: Method,
        path: &str,
        bytes: &[u8],
    ) -> Result<Value> {
        let response = self
            .http
            .request(method, format!("{}{}", self.endpoint, path))
            .bearer_auth(self.signer.issue(actor)?)
            .header("content-type", "application/zip")
            .body(bytes.to_vec())
            .send()
            .await;
        self.response(response).await
    }

    async fn response(
        &self,
        response: std::result::Result<reqwest::Response, reqwest::Error>,
    ) -> Result<Value> {
        let response = response.map_err(|error| Error::Transport(error.to_string()))?;
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
                    .unwrap_or("SourceLens rejected the request")
                    .into(),
            });
        }
        Ok(value)
    }
}
