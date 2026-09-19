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

    pub fn public_rpc(
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
            permissions: BTreeSet::from([
                "rpc_read".into(),
                "rpc_simulate".into(),
                "deploy_environment".into(),
            ]),
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
    #[serde(default)]
    pub stage: String,
    #[serde(default)]
    pub progress: i16,
    #[serde(default)]
    pub retry_after_ms: Option<u64>,
    pub simulation_url: String,
    pub status_url: String,
}

#[derive(Clone)]
pub struct ForkCoreClient {
    endpoint: String,
    http: reqwest::Client,
    signer: ServiceAssertionSigner,
    history_preview_token: Option<String>,
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
            history_preview_token: None,
        })
    }

    pub fn with_history_preview_token(mut self, token: impl Into<String>) -> Result<Self> {
        let token = token.into();
        if !token.is_empty() && token.as_bytes().len() < 32 {
            return Err(Error::Configuration(
                "history preview token must be empty or at least 32 bytes".into(),
            ));
        }
        self.history_preview_token = (!token.is_empty()).then_some(token);
        Ok(self)
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

    pub async fn get_job(&self, actor: &ServiceActor, job_id: Uuid) -> Result<Value> {
        self.request(
            actor,
            Method::GET,
            &format!("/v1/jobs/{job_id}"),
            None,
            None,
        )
        .await
    }

    pub async fn cancel_job(&self, actor: &ServiceActor, job_id: Uuid) -> Result<Value> {
        self.request(
            actor,
            Method::DELETE,
            &format!("/v1/jobs/{job_id}"),
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

    pub async fn create_environment(
        &self,
        actor: &ServiceActor,
        body: &Value,
        idempotency_key: &str,
    ) -> Result<Value> {
        self.request(
            actor,
            Method::POST,
            "/v1/environments",
            Some(body),
            Some(idempotency_key),
        )
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
            "simulate" | "sync/start" | "sync/step" | "sync/stop" | "sync/status" | "overrides"
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

    /// Auto-mines a transaction into a virtual network (write path).
    pub async fn send_environment_transaction(
        &self,
        actor: &ServiceActor,
        environment_id: Uuid,
        body: &Value,
        idempotency_key: Option<&str>,
    ) -> Result<Value> {
        self.request(
            actor,
            Method::POST,
            &format!("/v1/environments/{environment_id}/transactions"),
            Some(body),
            idempotency_key,
        )
        .await
    }

    /// Deploys a contract into a virtual network (write path).
    pub async fn deploy_environment_contract(
        &self,
        actor: &ServiceActor,
        environment_id: Uuid,
        body: &Value,
        idempotency_key: Option<&str>,
    ) -> Result<Value> {
        self.request(
            actor,
            Method::POST,
            &format!("/v1/environments/{environment_id}/deploy"),
            Some(body),
            idempotency_key,
        )
        .await
    }

    pub async fn environment_receipts(
        &self,
        actor: &ServiceActor,
        environment_id: Uuid,
    ) -> Result<Value> {
        self.request(
            actor,
            Method::GET,
            &format!("/v1/environments/{environment_id}/receipts"),
            None,
            None,
        )
        .await
    }

    pub async fn fund_environment(
        &self,
        actor: &ServiceActor,
        environment_id: Uuid,
        body: &Value,
        idempotency_key: &str,
    ) -> Result<Value> {
        self.request(
            actor,
            Method::POST,
            &format!("/v1/environments/{environment_id}/fund"),
            Some(body),
            Some(idempotency_key),
        )
        .await
    }

    /// Hosted JSON-RPC call scoped to a virtual network.
    pub async fn environment_rpc(
        &self,
        actor: &ServiceActor,
        environment_id: Uuid,
        body: &Value,
    ) -> Result<Value> {
        self.request(
            actor,
            Method::POST,
            &format!("/v1/environments/{environment_id}/rpc"),
            Some(body),
            None,
        )
        .await
    }

    pub async fn network_coverage(&self, actor: &ServiceActor, network: &str) -> Result<Value> {
        self.request(
            actor,
            Method::GET,
            &format!("/v1/networks/{network}/coverage"),
            None,
            None,
        )
        .await
    }

    pub async fn repair_network_coverage(
        &self,
        actor: &ServiceActor,
        network: &str,
        idempotency_key: &str,
        body: &Value,
    ) -> Result<Value> {
        self.request(
            actor,
            Method::POST,
            &format!("/v1/networks/{network}/coverage/repair"),
            Some(body),
            Some(idempotency_key),
        )
        .await
    }

    pub async fn environment_snapshots(
        &self,
        actor: &ServiceActor,
        environment_id: Uuid,
    ) -> Result<Value> {
        self.request(
            actor,
            Method::GET,
            &format!("/v1/environments/{environment_id}/snapshots"),
            None,
            None,
        )
        .await
    }

    pub async fn fork_environment(
        &self,
        actor: &ServiceActor,
        environment_id: Uuid,
        body: &Value,
        idempotency_key: &str,
    ) -> Result<Value> {
        self.request(
            actor,
            Method::POST,
            &format!("/v1/environments/{environment_id}/fork"),
            Some(body),
            Some(idempotency_key),
        )
        .await
    }

    pub async fn clone_environment(
        &self,
        actor: &ServiceActor,
        environment_id: Uuid,
        virtual_ledger_id: Uuid,
        body: &Value,
        idempotency_key: &str,
    ) -> Result<Value> {
        self.request(
            actor,
            Method::POST,
            &format!("/v1/environments/{environment_id}/virtual-ledgers/{virtual_ledger_id}/clone"),
            Some(body),
            Some(idempotency_key),
        )
        .await
    }

    pub async fn create_environment_snapshot(
        &self,
        actor: &ServiceActor,
        environment_id: Uuid,
        body: &Value,
        idempotency_key: &str,
    ) -> Result<Value> {
        self.request(
            actor,
            Method::POST,
            &format!("/v1/environments/{environment_id}/snapshots"),
            Some(body),
            Some(idempotency_key),
        )
        .await
    }

    pub async fn rename_environment_snapshot(
        &self,
        actor: &ServiceActor,
        environment_id: Uuid,
        snapshot_id: Uuid,
        body: &Value,
        idempotency_key: &str,
    ) -> Result<Value> {
        self.request(
            actor,
            Method::PATCH,
            &format!("/v1/environments/{environment_id}/snapshots/{snapshot_id}"),
            Some(body),
            Some(idempotency_key),
        )
        .await
    }

    pub async fn delete_environment_snapshot(
        &self,
        actor: &ServiceActor,
        environment_id: Uuid,
        snapshot_id: Uuid,
        idempotency_key: &str,
    ) -> Result<Value> {
        self.request(
            actor,
            Method::DELETE,
            &format!("/v1/environments/{environment_id}/snapshots/{snapshot_id}"),
            None,
            Some(idempotency_key),
        )
        .await
    }

    pub async fn revert_environment_snapshot(
        &self,
        actor: &ServiceActor,
        environment_id: Uuid,
        snapshot_id: Uuid,
        idempotency_key: &str,
    ) -> Result<Value> {
        self.request(
            actor,
            Method::POST,
            &format!("/v1/environments/{environment_id}/snapshots/{snapshot_id}/revert"),
            None,
            Some(idempotency_key),
        )
        .await
    }

    pub async fn environment_lineage(
        &self,
        actor: &ServiceActor,
        environment_id: Uuid,
    ) -> Result<Value> {
        self.request(
            actor,
            Method::GET,
            &format!("/v1/environments/{environment_id}/lineage"),
            None,
            None,
        )
        .await
    }

    pub async fn history_coverage(&self, actor: &ServiceActor, network: &str) -> Result<Value> {
        if !matches!(network, "mainnet" | "testnet") {
            return Err(Error::Configuration("unsupported history network".into()));
        }
        self.request(
            actor,
            Method::GET,
            &format!("/v1/history/coverage?network={network}"),
            None,
            None,
        )
        .await
    }

    pub async fn historical_transaction(
        &self,
        actor: &ServiceActor,
        network: &str,
        hash: &str,
    ) -> Result<Value> {
        if !matches!(network, "mainnet" | "testnet")
            || hash.len() != 64
            || !hash.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(Error::Configuration(
                "invalid historical transaction locator".into(),
            ));
        }
        self.request(
            actor,
            Method::GET,
            &format!("/v1/history/transactions/{hash}?network={network}"),
            None,
            None,
        )
        .await
    }

    pub async fn history_targets(
        &self,
        actor: &ServiceActor,
        network: &str,
        start_time: i64,
        end_time: i64,
        query: &str,
        limit: i64,
    ) -> Result<Value> {
        if network != "mainnet"
            || start_time > end_time
            || query.len() > 56
            || !query.bytes().all(|byte| byte.is_ascii_alphanumeric())
        {
            return Err(Error::Configuration(
                "invalid historical target query".into(),
            ));
        }
        self.request(
            actor,
            Method::GET,
            &format!(
                "/v1/history/targets?network={network}&start_time={start_time}&end_time={end_time}&query={query}&limit={}",
                limit.clamp(1, 100)
            ),
            None,
            None,
        )
        .await
    }

    pub async fn create_history_timeline(
        &self,
        actor: &ServiceActor,
        body: &Value,
        idempotency_key: &str,
    ) -> Result<Value> {
        self.request(
            actor,
            Method::POST,
            "/v1/history/timelines",
            Some(body),
            Some(idempotency_key),
        )
        .await
    }

    pub async fn get_history_timeline(
        &self,
        actor: &ServiceActor,
        timeline_id: Uuid,
        after: i32,
        limit: i64,
    ) -> Result<Value> {
        self.request(
            actor,
            Method::GET,
            &format!(
                "/v1/history/timelines/{timeline_id}?after={after}&limit={}",
                limit.clamp(1, 500)
            ),
            None,
            None,
        )
        .await
    }

    pub async fn fork_history_timeline(
        &self,
        actor: &ServiceActor,
        timeline_id: Uuid,
        body: &Value,
        idempotency_key: &str,
    ) -> Result<Value> {
        self.request(
            actor,
            Method::POST,
            &format!("/v1/history/timelines/{timeline_id}/fork"),
            Some(body),
            Some(idempotency_key),
        )
        .await
    }

    pub async fn create_replay(
        &self,
        actor: &ServiceActor,
        body: &Value,
        idempotency_key: &str,
    ) -> Result<Value> {
        self.request(
            actor,
            Method::POST,
            "/v1/replays",
            Some(body),
            Some(idempotency_key),
        )
        .await
    }

    pub async fn get_replay(&self, actor: &ServiceActor, replay_id: Uuid) -> Result<Value> {
        self.request(
            actor,
            Method::GET,
            &format!("/v1/replays/{replay_id}"),
            None,
            None,
        )
        .await
    }

    pub async fn cancel_replay(&self, actor: &ServiceActor, replay_id: Uuid) -> Result<Value> {
        self.request(
            actor,
            Method::POST,
            &format!("/v1/replays/{replay_id}/cancel"),
            None,
            None,
        )
        .await
    }

    pub async fn promote_replay(
        &self,
        actor: &ServiceActor,
        replay_id: Uuid,
        body: &Value,
        idempotency_key: &str,
    ) -> Result<Value> {
        self.request(
            actor,
            Method::POST,
            &format!("/v1/replays/{replay_id}/promote"),
            Some(body),
            Some(idempotency_key),
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
        if path.starts_with("/v1/history")
            && let Some(token) = &self.history_preview_token
        {
            request = request.header("x-fork-core-history-preview-token", token);
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
