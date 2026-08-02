# Phase 0 — Foundations & Scaffolding

**Status:** Planned.
**Depends on:** None (design docs `01`–`04` are the input).
**Goal:** A bootable `backend/` Rust workspace, dockerized Postgres + Redis for **local development**, the full DB schema from `../03-Releeve-DB-Schema.md` applied as migrations (all tables from day one, including the reserved `simulation_*`, `contract_verifications`, `token_prices`, and billing tables — the "no retrofitting" principle), and CI that runs every later phase on.

---

## Stack (decided, shared by all phases)

- **Language:** Rust (edition 2024), `cargo` workspace. Pinned via `rust-toolchain.toml` (channel `1.92`, components `rustfmt`, `clippy`). All dependency versions centralised in the root `[workspace.dependencies]` so crates can't silently diverge.
- **HTTP:** axum + tower (middleware), serde, utoipa (OpenAPI) with swagger-ui served at `/docs`.
- **DB:** Postgres via **SQLx** (compile-time-checked queries with `sqlx::query!`). **Offline mode**: `cargo sqlx prepare` artifacts in `.sqlx/` are committed so CI (and fresh clones without a live DB) can type-check queries. Migrations in `backend/migrations/`.
- **Cache/queue:** `redis` crate (tokio). Redis is **never** the source of truth (DB schema §11).
- **Config:** `config` + `dotenvy`; `.env.example` committed, real `.env` gitignored.
- **Errors:** `thiserror` domain errors → uniform JSON error envelope.
- **Obs:** `tracing` + `tracing-subscriber` (EnvFilter) from day one — structured logs, request spans via `tower-http`.
- **Auth (P1 will consume):** `jsonwebtoken` (JWT), `argon2` (password hashing). Declared as workspace deps now so P1 has zero dependency churn.
- **Testing infra — `testcontainers` (the standard), NOT docker-compose:** integration tests spawn disposable Postgres (`postgres:16`) and Redis (`redis:7`) containers in-process via the [`testcontainers`](https://crates.io/crates/testcontainers) crate + `testcontainers-modules`. A shared `releeve-test-support` crate (workspace member, dev-dependency only) owns "spawn Postgres/Redis + migrate + return URL(s)". Every crate's integration suite uses it — P2/P4 onward get this for free. `docker-compose.yml` is now **dev-only** (no `test` profile) — `docker compose up` gives you a local environment; tests never depend on it.
- **Frontend:** existing `frontend/` (Next.js) — being **rebranded from Seidar to Releeve**; not built this phase, but the phase plan keeps its API contracts in mind (see the rebrand note in Phase 3).

### Workspace layout (target)

```
backend/
├── Cargo.toml                # [workspace] + [workspace.dependencies]
├── rust-toolchain.toml
├── .env.example
├── .gitignore                # target/, .env, *.local, node_modules...
├── .sqlx/                    # committed sqlx offline query data (cargo sqlx prepare)
├── docker-compose.yml        # dev only: postgres, redis (NO test profile)
├── migrations/               # SQLx migrations = doc 03 schema
├── crates/
│   ├── releeve-core/         # domain types, shared DTOs, pagination, cursor, error envelope, config
│   ├── releeve-api/          # axum app, routes, auth, permission middleware (P1+)
│   ├── releeve-ingest/       # RPC/Horizon/BigQuery workers, feed materialization (P2) — skeleton
│   ├── releeve-alerts/       # evaluation + delivery (P4) — skeleton
│   ├── releeve-sim/          # fork-core integration client (P5) — skeleton
│   └── releeve-test-support/ # testcontainers harness: spawn postgres/redis + migrate + urls (dev-dep only)
```

---

## Features added in this phase

- `backend/` cargo workspace with the six crates above (skeleton modules; `releeve-api` is the only one with a live route table).
- Axum app boots: `GET /health` → `200 {"status":"ok","checks":{"db":"ok","redis":"ok"}}`. **Degraded semantics:** if Postgres or Redis is unreachable, the endpoint returns `503` with the failing dependency named in `checks` (e.g. `"db":"down"`). A dependency that is down is *reported*, never silently swallowed.
- **Migrations:** the entire schema from `03` rendered as `backend/migrations/NNNN_*.sql` — every table, constraint, and index in doc 03 (incl. `token_volume_stats`, `token_prices`, `contract_verifications`, the auth-token tables, the reserved `simulation_*`/`fork_environments`/billing tables, and every index in §9). Nothing is "added later via ALTER" that doc 03 already defines.
- **`releeve-test-support` harness:** one function each for `spawn_postgres()` and `spawn_redis()`, plus `run_migrations(&pool)` — all three integration suites (API health, migration idempotency, Redis ping) share it. Tests mark themselves `#[ignore]`-free and self-contained: each test gets its **own** Postgres container + migrated schema (isolation by construction, no cross-test state).
- `sqlx::migrate!()` embedded migrations + offline `.sqlx/` artifacts committed.
- **Shared pagination utilities** in `releeve-core` (pure functions, unit-tested now, wired into routes in P1+):
  - `clamp_limit(limit) -> {20,50,100}` (default 20).
  - Opaque keyset cursor encode/decode `(sort_key, stable_id)` → base64url, both directions.
  - `Pagination` response envelope type (`data`, `pagination.{limit,next_cursor,prev_cursor}`).
- Uniform error envelope + `thiserror` error types; a `Result` alias used across handlers. **Envelope shape is a contract:**
  ```json
  { "error": { "code": "not_found", "message": "..." } }
  ```
  HTTP status maps from the error; internal details never leak (server errors log the detail, return a generic `internal` code).
- OpenAPI (utoipa) skeleton wired to the health route, served at `/docs`.
- `GET /health` on the `releeve-api` binary plus a `docker-compose.yml` (dev only) with healthchecks.
- CI (GitHub Actions): `fmt --check`, `clippy -D warnings`, `cargo test` (unit), `cargo sqlx prepare --check`, and an integration job that runs on `ubuntu-latest` (has a Docker daemon) executing the `testcontainers`-backed suite — **no compose services are booted by CI**; the containers come from the test code itself.
- `CONTRIBUTING`/commit conventions documented (see Commit patterns).

---

## Testing

### Unit tests (`cargo test`, no infra needed)

- `config`: env parsing, defaults, required-variable error.
- `pagination::clamp_limit`: `20`/`50`/`100` pass through; absent → `20`; `0`, negatives, `21`, `1000` clamp to nearest allowed.
- `cursor`: round-trip encode→decode preserves `(sort_key, id)`; malformed/base64url-garbage input → error, not panic; cursor generated for forward and backward traversal.
- `error envelope`: error type → correct HTTP status + JSON shape; no internal details leaked.
- `migrations` marker: `sqlx::migrate!()` is embedded and compiles.

### Integration tests (testcontainers — Postgres + Redis spawned in-process; requires Docker on the machine/runner)

- `GET /health` → 200 when Postgres and Redis reachable, `checks` all `"ok"`.
- **Degraded health:** spawn the app with a bogus Redis URL (or stop the Redis container) → `GET /health` returns `503` with `checks.redis == "down"`, Postgres still `"ok"`. Same shape for a down DB.
- **Migration application:** fresh Postgres container → run all migrations → assert key tables exist (`users`, `organizations`, `projects`, `transactions`, `simulation_runs`, `token_volume_stats`, `token_prices`, `refresh_tokens`, `email_verification_tokens`, `password_reset_tokens`, `contract_verifications`, `plans`, `subscriptions`, `billing_events`, …) and the reserved FKs/indexes from doc 03 are present (`information_schema` checks for a representative sample of tables + at least one unique index such as `uq_alert_firing_dedupe`).
- Migration **idempotency**: re-running the migration set is a no-op (SQLx tracks applied versions; assert `_sqlx_migrations` count is unchanged and no error).
- Redis `ping` through the client module.

---

## Commit patterns

Conventional Commits. Branch per phase slice: `phase/0/<slug>`.

- `build: scaffold cargo workspace and dev docker-compose`
- `feat(core): add keyset cursor encode/decode utilities`
- `feat(core): add limit clamping and pagination envelope types`
- `feat(api): add health endpoint with db/redis connectivity`
- `db: import full schema from ../03-Releeve-DB-Schema as sqlx migrations`
- `test(support): add testcontainers-based postgres/redis harness`
- `ci: add lint, clippy, offline-sqlx, and containerized integration jobs`
- `chore(api): wire utoipa openapi skeleton`

Rules:
- No feature commits without their tests in the same commit.
- Migration changes go in the **same** commit as the code that uses them.
- `clippy -D warnings` must be clean; formatting must be `cargo fmt` output.
- Any new `sqlx::query!` must ship with its regenerated `.sqlx/` offline data in the same commit (`cargo sqlx prepare`).
- Integration tests must be self-contained via `releeve-test-support`; no test may require a running `docker compose` stack.

---

## Checklist

**Pre-merge (every PR):**
- [ ] `cargo fmt --check` clean
- [ ] `cargo clippy --all-targets --all-features -- -D warnings` clean
- [ ] `cargo test` (unit) green
- [ ] Integration suite green via testcontainers (Docker required on the runner)
- [ ] `cargo sqlx prepare --check` passes; `.sqlx/` artifacts committed
- [ ] `.env.example` updated for any new config
- [ ] New API surface reflected in OpenAPI spec
- [ ] Commit follows conventional-commit format; no untested code committed

**Phase completion (Definition of Done):**
- [ ] `backend/` builds and all tests pass locally AND in CI
- [ ] Full doc-03 schema applied via migrations on a clean DB (verified by test)
- [ ] `docker compose up` brings up a dev environment with migrations applied
- [ ] `GET /health` reports db/redis state, including degraded `503` behavior
- [ ] Pagination utilities + envelope exist in `releeve-core` and are unit-tested
- [ ] `releeve-test-support` testcontainers harness exists and is used by the integration suite
- [ ] P1 can start with zero scaffolding work remaining
