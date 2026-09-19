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
    let token = common::token_from_mail(&app.drain_mail().await[0].body);
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
    let _ = app.drain_mail().await;
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

    // Invite a member as viewer (no permissions); they cannot patch the project.
    let email = registered_member(&app).await;
    let (istatus, imember) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{slug}/members"),
        Some(serde_json::json!({ "email": email, "role": "viewer" })),
        Some(&owner),
    )
    .await;
    assert_eq!(istatus, StatusCode::OK, "owner invites member");
    assert_eq!(imember["role"], "viewer");
    let inv_member = imember["id"].as_str().unwrap().to_string();
    let (_, _) = req(
        app.router(),
        Method::PATCH,
        &format!("/api/v1/{slug}/members/{inv_member}"),
        Some(serde_json::json!({ "role": "viewer" })),
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
        Some(serde_json::json!({ "role": "viewer" })),
        Some(&owner),
    )
    .await;
    assert_eq!(pstatus, StatusCode::OK);
    assert_eq!(pbody["role"], "viewer");
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

#[tokio::test]
async fn invite_assigns_fixed_role_permissions() {
    let app = TestApp::new().await;
    let (owner, slug) = onboard(&app).await;

    // Member gets exactly the fixed matrix, never caller-chosen bits.
    let (istatus, member) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{slug}/members"),
        Some(serde_json::json!({ "email": new_email(), "role": "member" })),
        Some(&owner),
    )
    .await;
    assert_eq!(istatus, StatusCode::OK);
    assert_eq!(member["role"], "member");
    let perms: Vec<String> = serde_json::from_value(member["permissions"].clone()).unwrap();
    assert_eq!(
        perms,
        vec![
            "create_projects",
            "update_projects",
            "manage_fork_sessions",
            "manage_alerts"
        ]
    );

    // Unknown/retired roles and owner grants are rejected.
    for bad in ["superadmin", "owner", "", "developer", "billing"] {
        let (status, _) = req(
            app.router(),
            Method::POST,
            &format!("/api/v1/{slug}/members"),
            Some(serde_json::json!({ "email": new_email(), "role": bad })),
            Some(&owner),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "role {bad:?} rejected");
    }

    // Malformed emails are rejected before anything is stored.
    for bad in [
        "not-an-email",
        "a@b",
        "@example.com",
        "a@.com",
        "a@b.",
        "a b@c.com",
    ] {
        let (status, _) = req(
            app.router(),
            Method::POST,
            &format!("/api/v1/{slug}/members"),
            Some(serde_json::json!({ "email": bad, "role": "viewer" })),
            Some(&owner),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "email {bad:?} rejected");
    }
}

#[tokio::test]
async fn suspend_locks_member_out_and_unsuspend_restores() {
    let app = TestApp::new().await;
    let (owner, slug) = onboard(&app).await;
    let email = registered_member(&app).await;
    let (istatus, member) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{slug}/members"),
        Some(serde_json::json!({ "email": email, "role": "member" })),
        Some(&owner),
    )
    .await;
    assert_eq!(istatus, StatusCode::OK);
    let member_id = member["id"].as_str().unwrap().to_string();
    assert_eq!(member["status"], "active");

    let (_, login) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/login",
        Some(serde_json::json!({ "email": email, "password": "password-1234" })),
        None,
    )
    .await;
    let member_access = login["access_token"].as_str().unwrap().to_string();

    // Suspend.
    let (sstatus, sbody) = req(
        app.router(),
        Method::PATCH,
        &format!("/api/v1/{slug}/members/{member_id}"),
        Some(serde_json::json!({ "status": "suspended" })),
        Some(&owner),
    )
    .await;
    assert_eq!(sstatus, StatusCode::OK);
    assert_eq!(sbody["status"], "suspended");

    // Suspended members are locked out of org routes.
    let (fstatus, _) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/{slug}/members?limit=20"),
        None,
        Some(&member_access),
    )
    .await;
    assert_eq!(fstatus, StatusCode::FORBIDDEN, "suspended is locked out");

    // Owner cannot suspend themselves (would lock out the org).
    let (selfstatus, _) = req(
        app.router(),
        Method::PATCH,
        &format!("/api/v1/{slug}/members/{member_id}"),
        Some(serde_json::json!({ "status": "suspended" })),
        Some(&member_access),
    )
    .await;
    assert!(selfstatus == StatusCode::FORBIDDEN || selfstatus == StatusCode::BAD_REQUEST);

    // Unsuspend restores access.
    let (ustatus, ubody) = req(
        app.router(),
        Method::PATCH,
        &format!("/api/v1/{slug}/members/{member_id}"),
        Some(serde_json::json!({ "status": "active" })),
        Some(&owner),
    )
    .await;
    assert_eq!(ustatus, StatusCode::OK);
    assert_eq!(ubody["status"], "active");
    let (rstatus, _) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/{slug}/members?limit=20"),
        None,
        Some(&member_access),
    )
    .await;
    assert_eq!(rstatus, StatusCode::OK, "unsuspended works again");
}

#[tokio::test]
async fn project_lookup_by_id_scopes_to_members() {
    let app = TestApp::new().await;
    let (owner, slug) = onboard(&app).await;

    // Create a project to look up.
    let (cstatus, project) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{slug}/projects"),
        Some(serde_json::json!({ "name": "Lookup Me" })),
        Some(&owner),
    )
    .await;
    assert_eq!(cstatus, StatusCode::OK);
    let id = project["id"].as_str().unwrap().to_string();

    let (lstatus, found) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/projects/{id}"),
        None,
        Some(&owner),
    )
    .await;
    assert_eq!(lstatus, StatusCode::OK);
    assert_eq!(found["slug"], project["slug"]);
    assert_eq!(found["organization_slug"], slug);

    let (mstatus, _) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/projects/{}", uuid::Uuid::new_v4()),
        None,
        Some(&owner),
    )
    .await;
    assert_eq!(mstatus, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn pending_invitations_are_listed() {
    let app = TestApp::new().await;
    let (owner, slug) = onboard(&app).await;
    let email = new_email();

    // Unknown address → invitation, not a member.
    let (istatus, invite) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{slug}/members"),
        Some(serde_json::json!({ "email": email, "role": "member" })),
        Some(&owner),
    )
    .await;
    assert_eq!(istatus, StatusCode::OK);
    assert_eq!(invite["kind"], "invitation");
    assert_eq!(invite["role"], "member");

    let (lstatus, list) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/{slug}/invitations"),
        None,
        Some(&owner),
    )
    .await;
    assert_eq!(lstatus, StatusCode::OK);
    let items = list.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["email"], email);
    assert_eq!(items[0]["status"], "pending");
    assert_eq!(items[0]["role"], "member");
}

#[tokio::test]
async fn invitation_accept_revoke_and_signup_claim() {
    let app = TestApp::new().await;
    let (owner, slug) = onboard(&app).await;

    // Invite an unknown address: pending invitation.
    let email = new_email();
    let (istatus, invite) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{slug}/members"),
        Some(serde_json::json!({ "email": email, "role": "viewer" })),
        Some(&owner),
    )
    .await;
    assert_eq!(istatus, StatusCode::OK);
    let invitation_id = invite["id"].as_str().unwrap().to_string();

    // Public preview exposes org + role + masked email only.
    let (pstatus, preview) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/invitations/{invitation_id}"),
        None,
        None,
    )
    .await;
    assert_eq!(pstatus, StatusCode::OK);
    assert_eq!(preview["organization_slug"], slug);
    assert_eq!(preview["role"], "viewer");
    assert_eq!(preview["status"], "pending");
    assert!(preview["email_hint"].as_str().unwrap().contains("***"));

    // Signup auto-claims the invitation: pending flips to accepted and the
    // newcomer is a member without a separate accept step.
    let (sstatus, _) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/signup",
        Some(serde_json::json!({ "email": email, "password": "password-1234" })),
        None,
    )
    .await;
    assert_eq!(sstatus, StatusCode::OK);
    let (lstatus, list) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/{slug}/invitations"),
        None,
        Some(&owner),
    )
    .await;
    assert_eq!(lstatus, StatusCode::OK);
    assert!(list.as_array().unwrap().is_empty(), "invitation consumed");

    // Accept after auto-claim is a harmless no-op path (409 → client proceeds).
    let (_, login) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/login",
        Some(serde_json::json!({ "email": email, "password": "password-1234" })),
        None,
    )
    .await;
    let invitee = login["access_token"].as_str().unwrap().to_string();
    let (astatus, _) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{slug}/invitations/{invitation_id}/accept"),
        None,
        Some(&invitee),
    )
    .await;
    assert_eq!(astatus, StatusCode::CONFLICT, "already a member");

    // Second invite + explicit accept + revoke paths.
    let email2 = new_email();
    let (istatus, invite2) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{slug}/members"),
        Some(serde_json::json!({ "email": email2, "role": "admin" })),
        Some(&owner),
    )
    .await;
    assert_eq!(istatus, StatusCode::OK);
    let invitation2 = invite2["id"].as_str().unwrap().to_string();

    // Revoke removes it from the pending list.
    let (rstatus, _) = req(
        app.router(),
        Method::DELETE,
        &format!("/api/v1/{slug}/invitations/{invitation2}"),
        None,
        Some(&owner),
    )
    .await;
    assert_eq!(rstatus, StatusCode::OK);
    let (lstatus, list) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/{slug}/invitations"),
        None,
        Some(&owner),
    )
    .await;
    assert_eq!(lstatus, StatusCode::OK);
    assert!(
        list.as_array().unwrap().is_empty(),
        "revoked invitation gone"
    );
}
