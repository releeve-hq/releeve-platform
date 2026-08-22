//! Platform database-integrity tests for the Fork Core integration surface
//! (P1 checklist): Fork Core ID uniqueness, local/fork ID mapping, simulation
//! terminal-status constraints, and persisted certificate/provenance/retry/
//! ledger fields. Uses a fresh Postgres with the full migration set applied.

use test_support::{run_migrations, spawn_postgres};
use uuid::Uuid;

async fn seed_org_project_user(pool: &sqlx::PgPool) -> (Uuid, Uuid, Uuid, Uuid) {
    let org = Uuid::new_v4();
    let user = Uuid::new_v4();
    let project = Uuid::new_v4();
    let env = Uuid::new_v4();
    sqlx::query("INSERT INTO users (id, email) VALUES ($1, $2)")
        .bind(user)
        .bind(format!("{user}@test.dev"))
        .execute(pool)
        .await
        .expect("user seeded");
    sqlx::query("INSERT INTO organizations (id, slug, owner_user_id) VALUES ($1, $2, $3)")
        .bind(org)
        .bind(format!("org-{org}"))
        .bind(user)
        .execute(pool)
        .await
        .expect("org seeded");
    sqlx::query("INSERT INTO projects (id, organization_id, slug, name) VALUES ($1,$2,$3,$4)")
        .bind(project)
        .bind(org)
        .bind(format!("proj-{project}"))
        .bind("proj")
        .execute(pool)
        .await
        .expect("project seeded");
    (org, user, project, env)
}

#[tokio::test]
async fn fork_core_id_is_unique_across_environments() {
    let pg = spawn_postgres().await;
    run_migrations(&pg.pool).await;
    let (_org, _user, project, env_a) = seed_org_project_user(&pg.pool).await;
    let env_b = Uuid::new_v4();
    let fork_core_id = Uuid::new_v4();

    sqlx::query(
        "INSERT INTO fork_environments
            (id, project_id, name, base_ledger_sequence, network, fork_core_environment_id)
         VALUES ($1,$2,'a',0,'testnet',$3)",
    )
    .bind(env_a)
    .bind(project)
    .bind(fork_core_id)
    .execute(&pg.pool)
    .await
    .expect("first env with fork core id inserts");
    let err = sqlx::query(
        "INSERT INTO fork_environments
            (id, project_id, name, base_ledger_sequence, network, fork_core_environment_id)
         VALUES ($1,$2,'b',0,'testnet',$3)",
    )
    .bind(env_b)
    .bind(project)
    .bind(fork_core_id)
    .execute(&pg.pool)
    .await
    .expect_err("duplicate fork_core_environment_id must be rejected");
    assert!(
        err.to_string()
            .to_lowercase()
            .contains("uq_fork_environments_fork_core_id"),
        "duplicate rejected by the fork-core-id unique index: {err}"
    );
}

#[tokio::test]
async fn simulation_terminal_status_is_constrained() {
    let pg = spawn_postgres().await;
    run_migrations(&pg.pool).await;
    let (_org, user, project, _env) = seed_org_project_user(&pg.pool).await;
    let err = sqlx::query(
        "INSERT INTO simulation_runs
            (project_id, base_ledger_sequence, function_name, args, status, created_by)
         VALUES ($1, 1, 'f', '[]', 'bogus_status', $2)",
    )
    .bind(project)
    .bind(user)
    .execute(&pg.pool)
    .await
    .expect_err("invalid simulation status must violate the CHECK constraint");
    assert!(
        err.to_string().to_lowercase().contains("check"),
        "invalid status rejected by CHECK: {err}"
    );
}

#[tokio::test]
async fn local_fork_mapping_and_persisted_fields_round_trip() {
    let pg = spawn_postgres().await;
    run_migrations(&pg.pool).await;
    let (_org, user, project, env) = seed_org_project_user(&pg.pool).await;
    let fork_core_id = Uuid::new_v4();
    let sim = Uuid::new_v4();

    sqlx::query(
        "INSERT INTO fork_environments
            (id, project_id, name, base_ledger_sequence, network, fork_core_environment_id,
             state_ledger, execution_ledger, protocol, state_hash, verification_status)
         VALUES ($1,$2,'mapped',0,'testnet',$3,100,101,27,'hash','verified')",
    )
    .bind(env)
    .bind(project)
    .bind(fork_core_id)
    .execute(&pg.pool)
    .await
    .expect("fork environment seeded");

    let certificate = serde_json::json!({"status": "complete", "state_ledger": 100});
    sqlx::query(
        "INSERT INTO simulation_runs
            (id, project_id, base_ledger_sequence, function_name, args, status, created_by,
             fork_environment_id, state_ledger, execution_ledger, protocol,
             completeness_certificate, provenance, retry_count)
         VALUES ($1,$2,1,'f','[]','success',$3,$4,100,101,27,$5,'[{\"s\":\"rpc\"}]',2)",
    )
    .bind(sim)
    .bind(project)
    .bind(user)
    .bind(env)
    .bind(&certificate)
    .execute(&pg.pool)
    .await
    .expect("simulation with persisted fork fields inserts");

    let (fork_core_env, state_ledger, execution_ledger, protocol, retry_count, provenance) =
        sqlx::query_as::<_, (Uuid, i64, i64, i32, i32, serde_json::Value)>(
            "SELECT f.fork_core_environment_id, s.state_ledger, s.execution_ledger, s.protocol,
                    s.retry_count, s.provenance
               FROM fork_environments f
               JOIN simulation_runs s ON s.fork_environment_id = f.id
              WHERE f.id = $1 AND s.id = $2",
        )
        .bind(env)
        .bind(sim)
        .fetch_one(&pg.pool)
        .await
        .expect("mapping + persisted fields read back");
    assert_eq!(
        fork_core_env, fork_core_id,
        "local/fork id mapping persists"
    );
    assert_eq!(state_ledger, 100);
    assert_eq!(execution_ledger, 101);
    assert_eq!(protocol, 27);
    assert_eq!(retry_count, 2);
    assert_eq!(provenance[0]["s"], "rpc", "provenance persists");

    let certificate_read: serde_json::Value =
        sqlx::query_scalar("SELECT completeness_certificate FROM simulation_runs WHERE id = $1")
            .bind(sim)
            .fetch_one(&pg.pool)
            .await
            .expect("certificate persists");
    assert_eq!(certificate_read["state_ledger"], 100);
}
