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
pub mod environments;
pub mod error;
pub mod explorer;
pub mod explorer_detail;
pub mod extract;
pub mod health;
pub mod mailer;
pub mod monitoring;
pub mod oauth;
pub mod orgs;
pub mod password;
pub mod simulations;
pub mod state;
pub mod tokens;

use axum::routing::{delete, get, patch, post};
use axum::{
    Router,
    extract::DefaultBodyLimit,
    http::{
        HeaderValue, Method,
        header::{AUTHORIZATION, CONTENT_TYPE},
    },
};
use tower_http::cors::CorsLayer;
use utoipa::OpenApi;
use utoipa::openapi::path::Operation;
use utoipa::openapi::response::Response;
use utoipa_swagger_ui::SwaggerUi;

use crate::auth::oauth_routes;
use crate::auth::{
    change_password, forgot_password, login, logout, me, my_organizations, refresh,
    resend_verification, reset_password, revoke, signup, update_me, verify,
};
use crate::environments::*;
use crate::explorer::{
    live_feed, recent_ledgers, recent_transactions, sync_explorer_network, top_tokens, transfers,
};
use crate::explorer_detail::*;
use crate::health::{__path_health_check, HealthChecks, HealthResponse, health_check};
use crate::monitoring::*;
use crate::orgs::*;
use crate::simulations::*;
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
        add_phase3_paths(openapi);
    }
}

fn phase3_operation(summary: &str) -> Operation {
    let mut op = Operation::new();
    op.summary = Some(summary.to_owned());
    op.tags = Some(vec!["explorer".to_owned()]);
    op.responses
        .responses
        .insert("200".to_owned(), Response::new("OK").into());
    op
}

fn add_phase3_path(
    openapi: &mut utoipa::openapi::OpenApi,
    path: &'static str,
    method: utoipa::openapi::path::HttpMethod,
    summary: &'static str,
) {
    openapi
        .paths
        .add_path_operation(path, vec![method], phase3_operation(summary));
}

fn add_phase3_paths(openapi: &mut utoipa::openapi::OpenApi) {
    use utoipa::openapi::path::HttpMethod::{Delete, Get, Patch, Post};

    for (path, method, summary) in [
        (
            "/api/v1/explorer/{network}/tx/{hash}",
            Get,
            "Decoded transaction detail",
        ),
        (
            "/api/v1/explorer/{network}/tx/{hash}/search",
            Get,
            "Search decoded transaction detail",
        ),
        (
            "/api/v1/explorer/{network}/account/{address}",
            Get,
            "Public account lookup",
        ),
        (
            "/api/v1/explorer/{network}/account/{address}/transactions",
            Get,
            "Public account transactions",
        ),
        (
            "/api/v1/explorer/{network}/contract/{address}",
            Get,
            "Public contract lookup",
        ),
        (
            "/api/v1/explorer/{network}/ledger/{sequence}",
            Get,
            "Ledger detail",
        ),
        (
            "/api/v1/explorer/{network}/ledger/latest",
            Get,
            "Latest ledger detail",
        ),
        (
            "/api/v1/{org}/{project}/transactions",
            Get,
            "Project transaction list",
        ),
        (
            "/api/v1/{org}/{project}/transactions/{hash}/comments",
            Post,
            "Create transaction comment",
        ),
        (
            "/api/v1/{org}/{project}/transactions/{hash}/priority",
            Post,
            "Set transaction priority",
        ),
        (
            "/api/v1/{org}/{project}/accounts",
            Get,
            "List tracked accounts",
        ),
        ("/api/v1/{org}/{project}/accounts", Post, "Track account"),
        (
            "/api/v1/{org}/{project}/accounts/delete",
            Post,
            "Remove tracked accounts",
        ),
        (
            "/api/v1/{org}/{project}/accounts/{address}",
            Get,
            "Tracked account detail",
        ),
        (
            "/api/v1/{org}/{project}/accounts/{address}",
            Delete,
            "Remove tracked account",
        ),
        (
            "/api/v1/{org}/{project}/accounts/{address}/transactions",
            Get,
            "Tracked account transactions",
        ),
        (
            "/api/v1/{org}/{project}/contracts",
            Get,
            "List tracked contracts",
        ),
        ("/api/v1/{org}/{project}/contracts", Post, "Track contract"),
        (
            "/api/v1/{org}/{project}/contracts/{address}",
            Get,
            "Tracked contract detail",
        ),
        (
            "/api/v1/{org}/{project}/contracts/{address}/transactions",
            Get,
            "Tracked contract transactions",
        ),
        (
            "/api/v1/{org}/{project}/contracts/{address}/events",
            Get,
            "Tracked contract events",
        ),
        (
            "/api/v1/{org}/{project}/contracts/{address}/source",
            Get,
            "Tracked contract source",
        ),
        (
            "/api/v1/{org}/{project}/contracts/{address}/upgrades",
            Get,
            "Tracked contract upgrades",
        ),
        (
            "/api/v1/{org}/{project}/contracts/{address}/verify",
            Post,
            "Submit contract verification",
        ),
        (
            "/api/v1/{org}/{project}/contracts/{address}/verifications",
            Get,
            "Contract verification history",
        ),
        (
            "/api/v1/{org}/{project}/contracts/{address}/call",
            Post,
            "Call contract",
        ),
        ("/api/v1/{org}/{project}/tags", Get, "List tags"),
        ("/api/v1/{org}/{project}/tags", Post, "Create tag"),
        (
            "/api/v1/{org}/{project}/tags/{tag_id}",
            utoipa::openapi::path::HttpMethod::Patch,
            "Update tag",
        ),
        (
            "/api/v1/{org}/{project}/tags/{tag_id}",
            Delete,
            "Delete tag",
        ),
        (
            "/api/v1/{org}/{project}/tags/{tag_id}/attach",
            Post,
            "Attach tag",
        ),
        (
            "/api/v1/{org}/{project}/tags/{tag_id}/detach/{entity_id}",
            Delete,
            "Detach tag",
        ),
        (
            "/api/v1/{org}/destinations",
            Get,
            "List account destinations",
        ),
        (
            "/api/v1/{org}/destinations",
            Post,
            "Create account destination",
        ),
        (
            "/api/v1/{org}/destinations/{destination_id}",
            Patch,
            "Update account destination",
        ),
        (
            "/api/v1/{org}/destinations/{destination_id}",
            Delete,
            "Delete account destination",
        ),
        (
            "/api/v1/{org}/destinations/{destination_id}/test",
            Post,
            "Test account destination",
        ),
        (
            "/api/v1/{org}/{project}/destinations",
            Get,
            "List project destinations",
        ),
        (
            "/api/v1/{org}/{project}/destinations",
            Post,
            "Create project destination",
        ),
        (
            "/api/v1/{org}/{project}/destinations/{destination_id}",
            Patch,
            "Update project destination",
        ),
        (
            "/api/v1/{org}/{project}/destinations/{destination_id}",
            Delete,
            "Delete project destination",
        ),
        (
            "/api/v1/{org}/{project}/destinations/{destination_id}/test",
            Post,
            "Test project destination",
        ),
        ("/api/v1/{org}/{project}/alerts", Get, "List alerts"),
        ("/api/v1/{org}/{project}/alerts", Post, "Create alert"),
        (
            "/api/v1/{org}/{project}/alerts/{alert_id}",
            Patch,
            "Update alert",
        ),
        (
            "/api/v1/{org}/{project}/alerts/{alert_id}",
            Delete,
            "Delete alert",
        ),
        (
            "/api/v1/{org}/{project}/alerts/{alert_id}/history",
            Get,
            "Alert firing history",
        ),
        (
            "/api/v1/{org}/{project}/environments",
            Get,
            "List Fork Core environments",
        ),
        (
            "/api/v1/{org}/{project}/environments",
            Post,
            "Create Fork Core environment",
        ),
        (
            "/api/v1/{org}/{project}/environments/{environment_id}",
            Get,
            "Get Fork Core environment",
        ),
        (
            "/api/v1/{org}/{project}/environments/{environment_id}",
            Patch,
            "Update Fork Core environment",
        ),
        (
            "/api/v1/{org}/{project}/environments/{environment_id}",
            Delete,
            "Delete Fork Core environment",
        ),
        (
            "/api/v1/{org}/{project}/environments/{environment_id}/simulate",
            Post,
            "Queue Fork Core environment simulation",
        ),
        (
            "/api/v1/{org}/{project}/environments/{environment_id}/overrides",
            Get,
            "List Fork Core environment overrides",
        ),
        (
            "/api/v1/{org}/{project}/environments/{environment_id}/overrides",
            Post,
            "Create Fork Core environment override",
        ),
        (
            "/api/v1/{org}/{project}/environments/{environment_id}/overrides/{override_id}",
            Delete,
            "Disable Fork Core environment override",
        ),
        (
            "/api/v1/{org}/{project}/environments/{environment_id}/sync/start",
            Post,
            "Start Fork Core environment sync",
        ),
        (
            "/api/v1/{org}/{project}/environments/{environment_id}/sync/stop",
            Post,
            "Stop Fork Core environment sync",
        ),
        (
            "/api/v1/{org}/{project}/environments/{environment_id}/sync/status",
            Get,
            "Get Fork Core environment sync status",
        ),
        (
            "/api/v1/{org}/{project}/environments/{environment_id}/rollback",
            Post,
            "Rewind Fork Core environment sync cursor",
        ),
    ] {
        add_phase3_path(openapi, path, method, summary);
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
    let allowed_origin = HeaderValue::from_str(&state.settings.app_base_url)
        .expect("APP_BASE_URL must be a valid HTTP origin");
    let cors = CorsLayer::new()
        .allow_origin(allowed_origin)
        .allow_credentials(true)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
        ])
        .allow_headers([AUTHORIZATION, CONTENT_TYPE]);

    Router::new()
        .route("/health", get(health_check))
        .route(
            "/api/v1/explorer/{network}/transactions/latest",
            get(recent_transactions),
        )
        .route("/api/v1/explorer/{network}/ledgers", get(recent_ledgers))
        .route("/api/v1/explorer/{network}/live", get(live_feed))
        .route(
            "/api/v1/explorer/{network}/sync",
            post(sync_explorer_network),
        )
        .route("/api/v1/explorer/{network}/tokens/top", get(top_tokens))
        .route("/api/v1/explorer/{network}/transfers", get(transfers))
        .route("/api/v1/explorer/{network}/lookup", get(public_lookup))
        .route(
            "/api/v1/explorer/{network}/tx/{hash}",
            get(public_tx_detail),
        )
        .route(
            "/api/v1/explorer/{network}/tx/{hash}/search",
            get(tx_search),
        )
        .route(
            "/api/v1/explorer/{network}/account/{address}",
            get(public_account),
        )
        .route(
            "/api/v1/explorer/{network}/account/{address}/transactions",
            get(public_account_transactions),
        )
        .route(
            "/api/v1/explorer/{network}/contract/{address}",
            get(public_contract),
        )
        .route(
            "/api/v1/explorer/{network}/contract/{address}/transactions",
            get(public_contract_transactions),
        )
        .route(
            "/api/v1/explorer/{network}/contract/{address}/events",
            get(public_contract_events),
        )
        .route(
            "/api/v1/explorer/{network}/ledger/latest",
            get(latest_ledger),
        )
        .route(
            "/api/v1/explorer/{network}/ledger/{sequence}",
            get(ledger_detail),
        )
        .route(
            "/api/v1/explorer/{network}/ledger/{sequence}/transactions",
            get(public_ledger_transactions),
        )
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
        .route("/api/v1/{org}/owner", post(transfer_ownership))
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
            "/api/v1/{org}/destinations",
            get(list_org_destinations).post(create_org_destination),
        )
        .route(
            "/api/v1/{org}/destinations/{destination_id}",
            patch(patch_org_destination).delete(delete_org_destination),
        )
        .route(
            "/api/v1/{org}/destinations/{destination_id}/test",
            post(test_org_destination),
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
        .route(
            "/api/v1/{org}/{project}/transactions",
            get(project_transactions),
        )
        .route(
            "/api/v1/{org}/{project}/destinations",
            get(list_project_destinations).post(create_project_destination),
        )
        .route(
            "/api/v1/{org}/{project}/destinations/{destination_id}",
            patch(patch_project_destination).delete(delete_project_destination),
        )
        .route(
            "/api/v1/{org}/{project}/destinations/{destination_id}/test",
            post(test_project_destination),
        )
        .route(
            "/api/v1/{org}/{project}/alerts",
            get(list_alerts).post(create_alert),
        )
        .route(
            "/api/v1/{org}/{project}/alerts/{alert_id}",
            patch(patch_alert).delete(delete_alert),
        )
        .route(
            "/api/v1/{org}/{project}/alerts/{alert_id}/history",
            get(alert_history),
        )
        .route(
            "/api/v1/{org}/{project}/simulations",
            get(list_simulations).post(create_simulation),
        )
        .route(
            "/api/v1/{org}/{project}/simulations/{simulation_id}",
            get(get_simulation).delete(cancel_simulation),
        )
        .route(
            "/api/v1/{org}/{project}/simulations/{simulation_id}/analysis",
            get(get_simulation_analysis).post(create_simulation_analysis),
        )
        .route(
            "/api/v1/{org}/{project}/simulations/{simulation_id}/debugger",
            get(get_simulation_debugger).post(create_simulation_debugger),
        )
        .route(
            "/api/v1/{org}/{project}/simulations/{simulation_id}/debugger/trace",
            get(get_simulation_debug_trace),
        )
        .route(
            "/api/v1/{org}/{project}/debugger/{analysis_id}",
            get(get_debugger_workspace).post(create_debugger_workspace),
        )
        .route(
            "/api/v1/{org}/{project}/debugger/{analysis_id}/trace",
            get(get_debugger_workspace_trace),
        )
        .route(
            "/api/v1/{org}/{project}/debugger/{analysis_id}/source/{*source_path}",
            get(get_debugger_source_file),
        )
        .route(
            "/api/v1/{org}/{project}/environments",
            get(list_environments).post(create_environment),
        )
        .route(
            "/api/v1/{org}/{project}/environments/{environment_id}",
            get(get_environment)
                .patch(update_environment)
                .delete(delete_environment),
        )
        .route(
            "/api/v1/{org}/{project}/environments/{environment_id}/overrides/{override_id}",
            delete(delete_environment_override),
        )
        .route(
            "/api/v1/{org}/{project}/environments/{environment_id}/overrides",
            get(list_or_add_environment_overrides).post(list_or_add_environment_overrides),
        )
        .route(
            "/api/v1/{org}/{project}/environments/{environment_id}/simulate",
            post(environment_simulate),
        )
        .route(
            "/api/v1/{org}/{project}/environments/{environment_id}/rollback",
            post(environment_rollback),
        )
        .route(
            "/api/v1/{org}/{project}/environments/{environment_id}/sync/start",
            post(start_environment_sync),
        )
        .route(
            "/api/v1/{org}/{project}/environments/{environment_id}/sync/stop",
            post(stop_environment_sync),
        )
        .route(
            "/api/v1/{org}/{project}/environments/{environment_id}/sync/status",
            get(environment_sync_status),
        )
        .route(
            "/api/v1/{org}/{project}/transactions/{hash}/comments",
            post(add_comment),
        )
        .route(
            "/api/v1/{org}/{project}/transactions/{hash}/priority",
            post(set_priority),
        )
        .route(
            "/api/v1/{org}/{project}/accounts",
            get(list_accounts).post(add_account),
        )
        .route(
            "/api/v1/{org}/{project}/accounts/delete",
            post(delete_accounts),
        )
        .route(
            "/api/v1/{org}/{project}/accounts/{address}",
            get(project_account)
                .patch(rename_account)
                .delete(delete_account),
        )
        .route(
            "/api/v1/{org}/{project}/accounts/{address}/transactions",
            get(account_transactions),
        )
        .route(
            "/api/v1/{org}/{project}/contracts",
            get(list_contracts).post(add_contract),
        )
        .route(
            "/api/v1/{org}/{project}/contracts/delete",
            post(delete_contracts),
        )
        .route(
            "/api/v1/{org}/{project}/contracts/{address}",
            get(project_contract)
                .patch(rename_contract)
                .delete(delete_contract),
        )
        .route(
            "/api/v1/{org}/{project}/contracts/{address}/transactions",
            get(contract_transactions),
        )
        .route(
            "/api/v1/{org}/{project}/contracts/{address}/events",
            get(contract_events),
        )
        .route(
            "/api/v1/{org}/{project}/contracts/{address}/source",
            get(contract_source),
        )
        .route(
            "/api/v1/{org}/{project}/contracts/{address}/upgrades",
            get(contract_upgrades),
        )
        .route(
            "/api/v1/{org}/{project}/contracts/{address}/verify",
            post(submit_verification),
        )
        .route(
            "/api/v1/{org}/{project}/contracts/{address}/verification-upload",
            post(upload_verification_source).layer(DefaultBodyLimit::max(50 * 1024 * 1024)),
        )
        .route(
            "/api/v1/{org}/{project}/contracts/{address}/verifications",
            get(verification_history),
        )
        .route(
            "/api/v1/{org}/{project}/contracts/{address}/call",
            post(contract_call),
        )
        .route(
            "/api/v1/{org}/{project}/tags",
            get(list_tags).post(create_tag),
        )
        .route(
            "/api/v1/{org}/{project}/tags/{tag_id}",
            patch(update_tag).delete(delete_tag),
        )
        .route(
            "/api/v1/{org}/{project}/tags/{tag_id}/attach",
            post(attach_tag),
        )
        .route(
            "/api/v1/{org}/{project}/tags/{tag_id}/detach/{entity_id}",
            delete(detach_tag),
        )
        .merge(SwaggerUi::new("/docs").url("/api-docs/openapi.json", ApiDoc::openapi()))
        .layer(cors)
        .with_state(state)
}
