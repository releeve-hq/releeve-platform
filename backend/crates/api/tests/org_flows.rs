//! Org / member / project / access-token CRUD with the flat permission model
//! and pagination, over the real router against disposable containers.

mod common;

use axum::http::{Method, StatusCode};

use common::{TestApp, req};

fn new_email() -> String {
    format!(
        "{}.{}@example.com",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

/// Sign up + verify + login, returning the fresh access token and personal-org slug.
async fn onboard(app: &TestApp) -> (String, String) {
    let email = new_email();
    let (status, _) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/signup",
        Some(serde_json::json!({ "email": email, "password": "password-1234" })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = common::token_from_mail(&app.mailer.drain()[0].body);
    let (status, _) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/verify",
        Some(serde_json::json!({ "token": token })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, login) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/login",
        Some(serde_json::json!({ "email": email, "password": "password-1234" })),
        None,
    )
    .await;
    let access = login["access_token"].as_str().unwrap().to_string();
    let (_, orgs) = req(
        app.router(),
        Method::GET,
        "/api/v1/me/organizations",
        None,
        Some(&access),
    )
    .await;
    let slug = orgs[0]["slug"].as_str().unwrap().to_string();
    (access, slug)
}

/// Register an account that can be invited into an org (returns its email).
async fn registered_member(app: &TestApp) -> String {
    let email = new_email();
    let (status, _) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/signup",
        Some(serde_json::json!({ "email": email, "password": "password-1234" })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let _ = app.mailer.drain();
    email
}

#[tokio::test]
async fn project_crud_and_permission_enforcement() {
    let app = TestApp::new().await;
    let (owner, slug) = onboard(&app).await;
    let path = format!("/api/v1/{slug}/projects");

    // Owner (all permissions) creates a project.
    let (status, project) = req(
        app.router(),
        Method::POST,
        &path,
        Some(serde_json::json!({ "name": "My Project", "network": "mainnet" })),
        Some(&owner),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "owner creates project");
    let proj_slug = project["slug"].as_str().unwrap().to_string();

    // Owner reads + patches (has UpdateProjects).
    let (gstatus, _) = req(
        app.router(),
        Method::GET,
        &format!("{path}/{proj_slug}"),
        None,
        Some(&owner),
    )
    .await;
    assert_eq!(gstatus, StatusCode::OK);
    let (pstatus, pbody) = req(
        app.router(),
        Method::PATCH,
        &format!("{path}/{proj_slug}"),
        Some(serde_json::json!({ "name": "Renamed" })),
        Some(&owner),
    )
    .await;
    assert_eq!(pstatus, StatusCode::OK);
    assert_eq!(pbody["name"], "Renamed");

    // Invite a member with no permissions; they cannot patch the project.
    let email = registered_member(&app).await;
    let (istatus, imember) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{slug}/members"),
        Some(serde_json::json!({ "email": email })),
        Some(&owner),
    )
    .await;
    assert_eq!(istatus, StatusCode::OK, "owner invites member");
    let inv_member = imember["id"].as_str().unwrap().to_string();
    let (_, _) = req(
        app.router(),
        Method::PATCH,
        &format!("/api/v1/{slug}/members/{inv_member}"),
        Some(serde_json::json!({ "permissions": [] })),
        Some(&owner),
    )
    .await;

    let (_, mlogin) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/login",
        Some(serde_json::json!({ "email": email, "password": "password-1234" })),
        None,
    )
    .await;
    let member_access = mlogin["access_token"].as_str().unwrap().to_string();
    let (mstatus, _) = req(
        app.router(),
        Method::PATCH,
        &format!("{path}/{proj_slug}"),
        Some(serde_json::json!({ "name": "x" })),
        Some(&member_access),
    )
    .await;
    assert_eq!(
        mstatus,
        StatusCode::FORBIDDEN,
        "member lacks update permission"
    );
}

#[tokio::test]
async fn member_crud_access_tokens_and_pagination() {
    let app = TestApp::new().await;
    let (owner, slug) = onboard(&app).await;

    // Invite + list + patch + remove.
    let email = registered_member(&app).await;
    let (istatus, member) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{slug}/members"),
        Some(serde_json::json!({ "email": email })),
        Some(&owner),
    )
    .await;
    assert_eq!(istatus, StatusCode::OK, "invite succeeds");
    let member_id = member["id"].as_str().unwrap().to_string();

    let (pstatus, pbody) = req(
        app.router(),
        Method::PATCH,
        &format!("/api/v1/{slug}/members/{member_id}"),
        Some(serde_json::json!({ "permissions": [] })),
        Some(&owner),
    )
    .await;
    assert_eq!(pstatus, StatusCode::OK);
    assert_eq!(pbody["permissions"].as_array().unwrap().len(), 0);

    let (dstatus, _) = req(
        app.router(),
        Method::DELETE,
        &format!("/api/v1/{slug}/members/{member_id}"),
        None,
        Some(&owner),
    )
    .await;
    assert_eq!(dstatus, StatusCode::OK);

    // Paginated member list.
    let (lstatus, list) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/{slug}/members?limit=20"),
        None,
        Some(&owner),
    )
    .await;
    assert_eq!(lstatus, StatusCode::OK);
    assert!(list["pagination"]["limit"].is_number());
    assert!(!list["data"].as_array().unwrap().is_empty());

    // Access token: create (raw once), delete.
    let (tstatus, created) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{slug}/access-tokens"),
        Some(serde_json::json!({ "name": "ci" })),
        Some(&owner),
    )
    .await;
    assert_eq!(tstatus, StatusCode::OK);
    let raw = created["token"].as_str().unwrap().to_string();
    assert!(raw.len() > 20, "raw token returned at creation");
    let token_id = created["id"].as_str().unwrap().to_string();
    assert_ne!(raw, token_id, "raw token is not the stored id");

    let (rstatus, _) = req(
        app.router(),
        Method::DELETE,
        &format!("/api/v1/{slug}/access-tokens/{token_id}"),
        None,
        Some(&owner),
    )
    .await;
    assert_eq!(rstatus, StatusCode::OK, "token revoked");
}

#[tokio::test]
async fn project_transfer_fails_closed_when_destination_inaccessible() {
    let app = TestApp::new().await;
    let (owner, slug) = onboard(&app).await;

    let (status, project) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{slug}/projects"),
        Some(serde_json::json!({ "name": "P" })),
        Some(&owner),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let proj_slug = project["slug"].as_str().unwrap().to_string();

    // A completely different user's personal org. The owner is not a member,
    // so transferring the project there must fail closed — and the destination
    // org's existence is not leaked (404, not 403/200).
    let (_, other_slug) = onboard(&app).await;
    let (tstatus, tbody) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{slug}/projects/{proj_slug}/transfer"),
        Some(serde_json::json!({ "to_org": other_slug })),
        Some(&owner),
    )
    .await;
    assert_eq!(
        tstatus,
        StatusCode::NOT_FOUND,
        "inaccessible destination → 404"
    );
    assert_eq!(tbody["error"]["code"], "not_found");

    // The project is untouched.
    let (gstatus, gbody) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/{slug}/projects/{proj_slug}"),
        None,
        Some(&owner),
    )
    .await;
    assert_eq!(gstatus, StatusCode::OK);
    assert_eq!(gbody["slug"], proj_slug);
}
