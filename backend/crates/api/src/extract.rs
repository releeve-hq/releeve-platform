//! Middleware / extractors for authenticated and org-scoped requests.
//!
//! The `Authorization: Bearer <jwt>` header resolves to an `AuthUser`. Each
//! handler also consults `shared::Error`-compatible responses via the
//! `shared` crate's `IntoResponse` impl.

use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::response::{IntoResponse, Response};
use shared::Error;
use uuid::Uuid;

use crate::state::AppState;

/// An authenticated user whose request carried a valid JWT access token.
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: Uuid,
}

/// Extractor rejection that wraps [`shared::Error`] and renders via its
/// `IntoResponse` impl (the uniform envelope). Because `shared::Error` is a
/// foreign type we must not implement `IntoResponse` on it directly here; the
/// wrapper carries it to a response.
#[derive(Debug)]
pub struct AuthError(Error);

impl From<Error> for AuthError {
    fn from(e: Error) -> Self {
        Self(e)
    }
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        self.0.into_response()
    }
}

/// Read the `Authorization: Bearer <token>` header value, if any.
fn bearer_token(parts: &Parts) -> Option<String> {
    parts
        .headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .map(|t| t.to_string())
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AuthError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = bearer_token(parts).ok_or(Error::Unauthorized)?;
        let claims = state.jwt.decode(&token).map_err(|_| Error::Unauthorized)?;
        Ok(Self {
            user_id: claims.sub,
        })
    }
}
