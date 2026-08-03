use serde::Serialize;
use thiserror::Error;

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

/// Domain error. Every handler returns `Result<T, Error>` and the API layer
/// maps it to a uniform envelope (see [`ErrorEnvelope`]).
///
/// Safety rules:
/// - The *Display* impl never includes internal details (SQL text, secrets,
///   file paths). Internal errors log the source at the call site and surface
///   only the generic `internal` code.
/// - [`Error::ServiceUnavailable`] carries only the name of the failed
///   dependency, which is intentionally non-sensitive.
#[derive(Debug, Error)]
pub enum Error {
    #[error("not found")]
    NotFound,

    #[error("bad request: {0}")]
    BadRequest(String),

    #[error("unauthorized")]
    Unauthorized,

    #[error("forbidden")]
    Forbidden,

    /// Email-verified gate: the account is signed in but its email is not yet
    /// verified. Same status as Forbidden but with a distinct code so clients
    /// can route the user to verification.
    #[error("email must be verified to perform this action")]
    EmailUnverified,

    #[error("conflict")]
    Conflict,

    #[error("signer is not configured for this project")]
    SignerNotConfigured,

    #[error("rate limited")]
    RateLimited,

    #[error("internal error")]
    Internal(#[source] Option<Box<dyn std::error::Error + Send + Sync>>),

    #[error("service unavailable: {0}")]
    ServiceUnavailable(String),
}

pub type Result<T> = std::result::Result<T, Error>;

/// Stable, machine-readable error codes exposed in the JSON envelope.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    NotFound,
    BadRequest,
    Unauthorized,
    Forbidden,
    EmailUnverified,
    Conflict,
    SignerNotConfigured,
    RateLimited,
    Internal,
    ServiceUnavailable,
}

impl Error {
    pub fn kind(&self) -> ErrorKind {
        match self {
            Error::NotFound => ErrorKind::NotFound,
            Error::BadRequest(_) => ErrorKind::BadRequest,
            Error::Unauthorized => ErrorKind::Unauthorized,
            Error::Forbidden => ErrorKind::Forbidden,
            Error::EmailUnverified => ErrorKind::EmailUnverified,
            Error::Conflict => ErrorKind::Conflict,
            Error::SignerNotConfigured => ErrorKind::SignerNotConfigured,
            Error::RateLimited => ErrorKind::RateLimited,
            Error::Internal(_) => ErrorKind::Internal,
            Error::ServiceUnavailable(_) => ErrorKind::ServiceUnavailable,
        }
    }

    pub fn status(&self) -> u16 {
        match self.kind() {
            ErrorKind::NotFound => 404,
            ErrorKind::BadRequest => 400,
            ErrorKind::Unauthorized => 401,
            ErrorKind::Forbidden => 403,
            ErrorKind::EmailUnverified => 403,
            ErrorKind::Conflict => 409,
            ErrorKind::SignerNotConfigured => 409,
            ErrorKind::RateLimited => 429,
            ErrorKind::Internal => 500,
            ErrorKind::ServiceUnavailable => 503,
        }
    }

    pub fn code(&self) -> &'static str {
        match self.kind() {
            ErrorKind::NotFound => "not_found",
            ErrorKind::BadRequest => "bad_request",
            ErrorKind::Unauthorized => "unauthorized",
            ErrorKind::Forbidden => "forbidden",
            ErrorKind::EmailUnverified => "email_unverified",
            ErrorKind::Conflict => "conflict",
            ErrorKind::SignerNotConfigured => "signer_not_configured",
            ErrorKind::RateLimited => "rate_limited",
            ErrorKind::Internal => "internal",
            ErrorKind::ServiceUnavailable => "service_unavailable",
        }
    }

    /// Convenience constructors.
    pub fn internal<E: std::error::Error + Send + Sync + 'static>(source: E) -> Self {
        Error::Internal(Some(Box::new(source)))
    }
}

impl IntoResponse for Error {
    fn into_response(self) -> Response {
        let status =
            StatusCode::from_u16(self.status()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        (status, Json(ErrorEnvelope::from_error(&self))).into_response()
    }
}

/// The JSON envelope shape — a contract, not a detail:
///
/// ```json
/// { "error": { "code": "not_found", "message": "..." } }
/// ```
#[derive(Debug, Serialize)]
pub struct ErrorEnvelope {
    pub error: ErrorBody,
}

#[derive(Debug, Serialize)]
pub struct ErrorBody {
    pub code: String,
    pub message: String,
}

impl ErrorEnvelope {
    pub fn from_error(err: &Error) -> Self {
        Self {
            error: ErrorBody {
                code: err.code().to_string(),
                message: err.to_string(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_mapping() {
        assert_eq!(Error::NotFound.status(), 404);
        assert_eq!(Error::BadRequest("x".into()).status(), 400);
        assert_eq!(Error::Unauthorized.status(), 401);
        assert_eq!(Error::Forbidden.status(), 403);
        assert_eq!(Error::Conflict.status(), 409);
        assert_eq!(Error::SignerNotConfigured.status(), 409);
        assert_eq!(Error::RateLimited.status(), 429);
        assert_eq!(Error::Internal(None).status(), 500);
        assert_eq!(Error::ServiceUnavailable("db".into()).status(), 503);
    }

    #[test]
    fn code_mapping() {
        assert_eq!(Error::NotFound.code(), "not_found");
        assert_eq!(Error::SignerNotConfigured.code(), "signer_not_configured");
        assert_eq!(Error::Internal(None).code(), "internal");
        assert_eq!(
            Error::ServiceUnavailable("redis".into()).code(),
            "service_unavailable"
        );
    }

    #[test]
    fn envelope_has_stable_shape() {
        let env = ErrorEnvelope::from_error(&Error::BadRequest("nope".into()));
        let json = serde_json::to_value(&env).unwrap();
        assert_eq!(json["error"]["code"], "bad_request");
        assert_eq!(json["error"]["message"], "bad request: nope");
        // No top-level leakage of anything else.
        assert!(json.get("stack").is_none());
    }

    #[test]
    fn internal_errors_do_not_leak_source() {
        let err = Error::internal(std::io::Error::other("postgres is on fire"));
        assert_eq!(
            err.to_string(),
            "internal error",
            "no internal detail in the message"
        );
        let env = ErrorEnvelope::from_error(&err);
        let json = serde_json::to_value(&env).unwrap();
        assert_eq!(json["error"]["code"], "internal");
        assert!(
            !json["error"]["message"]
                .as_str()
                .unwrap()
                .contains("postgres is on fire")
        );
    }
}
