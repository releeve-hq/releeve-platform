//! `api` — the axum HTTP surface for the Releeve platform.
//!
//! Phase 0 shipped `GET /health` (with db/redis connectivity checks and
//! degraded `503` semantics) plus the OpenAPI (`utoipa`) skeleton at `/docs`.
//! Phase 1 wires the identity + authorization surface: signup/login/verify/OAuth,
//! rotating refresh, password reset/change, `/me`, and org-scoped members,
//! projects, and access tokens behind the flat permission model with the
//! email-verified gate. Phase 2 adds the public explorer feed surface backed by
//! Postgres + Redis: latest transactions, ledgers, top tokens, and transfers.

pub mod auth;
pub mod error;
pub mod explorer;
pub mod extract;
pub mod health;
pub mod mailer;
pub mod oauth;
pub mod orgs;
pub mod password;
pub mod state;
pub mod tokens;

use axum::Router;
use axum::routing::{delete, get, patch, post};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use crate::auth::oauth_routes;
use crate::auth::{
    change_password, forgot_password, login, logout, me, my_organizations, refresh,
    resend_verification, reset_password, revoke, signup, update_me, verify,
};
use crate::explorer::{recent_ledgers, recent_transactions, top_tokens, transfers};
use crate::health::{__path_health_check, HealthChecks, HealthResponse, health_check};
use crate::orgs::*;
use crate::state::AppState;

/// Defines the `AuthorizationBearer` HTTP bearer security scheme on the spec.
struct SecurityAddon;
impl utoipa::Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
        let components = openapi.components.as_mut().expect("components present");
        components.security_schemes.insert(
            "AuthorizationBearer".to_string(),
            SecurityScheme::Http(
                HttpBuilder::new()
                    .scheme(HttpAuthScheme::Bearer)
                    .bearer_format("JWT")
                    .build(),
            ),
        );
    }
}

/// OpenAPI document for the platform API. Grows with every phase.
#[derive(OpenApi)]
#[openapi(
    paths(
        health_check,
        auth::signup,
        auth::login,
        auth::verify,
        auth::resend_verification,
        auth::refresh,
        auth::logout,
        auth::revoke,
        auth::forgot_password,
        auth::reset_password,
        auth::change_password,
        auth::me,
        auth::update_me,
        auth::my_organizations,
        auth::oauth_routes::start,
        auth::oauth_routes::callback,
        explorer::recent_transactions,
        explorer::recent_ledgers,
        explorer::top_tokens,
        explorer::transfers,
    ),
    components(schemas(
        HealthResponse,
        HealthChecks,
        auth::PairResponse,
        auth::SignupRequest,
        auth::SignupResponse,
        auth::LoginRequest,
        auth::VerifyRequest,
        auth::VerifyResponse,
        auth::ResendRequest,
        auth::ResendResponse,
        auth::RefreshRequest,
        auth::RefreshBody,
        auth::StatusResponse,
        auth::ForgotRequest,
        auth::ForgotResponse,
        auth::ResetRequest,
        auth::ResetResponse,
        auth::ChangePasswordRequest,
        auth::ChangePasswordResponse,
        auth::MyOrg,
        auth::UpdateMeRequest,
        auth::accounts::UserProfile,
        auth::oauth_routes::StartRequest,
        auth::oauth_routes::StartResponse,
        auth::oauth_routes::CallbackParams,
        shared::Permission,
    )),
    modifiers(&SecurityAddon),
    info(
        title = "Releeve Platform API",
        version = "0.1.0",
        description = "Identity, organizations, projects, access tokens, and public explorer feeds.",
    ),
)]
pub struct ApiDoc;

/// Build the application router. Owns no state; callers supply it.
pub fn app(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health_check))
        .route(
            "/api/v1/explorer/{network}/transactions/latest",
            get(recent_transactions),
        )
        .route("/api/v1/explorer/{network}/ledgers", get(recent_ledgers))
        .route("/api/v1/explorer/{network}/tokens/top", get(top_tokens))
        .route("/api/v1/explorer/{network}/transfers", get(transfers))
        .route("/api/v1/auth/signup", post(signup))
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/verify", post(verify))
        .route(
            "/api/v1/auth/resend-verification",
            post(resend_verification),
        )
        .route("/api/v1/auth/token/refresh", post(refresh))
        .route("/api/v1/auth/token/revoke", post(revoke))
        .route("/api/v1/auth/logout", post(logout))
        .route("/api/v1/auth/forgot-password", post(forgot_password))
        .route("/api/v1/auth/reset-password", post(reset_password))
        .route(
            "/api/v1/auth/oauth/{provider}/start",
            post(oauth_routes::start),
        )
        .route(
            "/api/v1/auth/oauth/{provider}/callback",
            get(oauth_routes::callback),
        )
        .route("/api/v1/me", get(me).patch(update_me))
        .route("/api/v1/me/password", post(change_password))
        .route("/api/v1/me/organizations", get(my_organizations))
        .route("/api/v1/organizations", post(create_org))
        .route(
            "/api/v1/{org}",
            get(get_org).patch(rename_org).delete(delete_org),
        )
        .route(
            "/api/v1/{org}/members",
            get(list_members).post(invite_member),
        )
        .route(
            "/api/v1/{org}/members/{member_id}",
            patch(patch_member).delete(remove_member),
        )
        .route(
            "/api/v1/{org}/access-tokens",
            get(list_access_tokens).post(create_access_token),
        )
        .route(
            "/api/v1/{org}/access-tokens/{token_id}",
            delete(revoke_access_token),
        )
        .route(
            "/api/v1/{org}/projects",
            get(list_projects).post(create_project),
        )
        .route(
            "/api/v1/{org}/projects/{project}",
            get(get_project).patch(patch_project).delete(delete_project),
        )
        .route(
            "/api/v1/{org}/projects/{project}/transfer",
            post(transfer_project),
        )
        .merge(SwaggerUi::new("/docs").url("/api-docs/openapi.json", ApiDoc::openapi()))
        .with_state(state)
}
