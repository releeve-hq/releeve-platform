# AGENTS.md — releeve-platform

Router for this repository. **Read `..\STATE.md` first** (current state,
blockers, exact next task), then **`..\CROSS-CUTTING.md`** (binding
blast-radius, verification-ladder, and evidence rules — apply to every edit),
then only the task-relevant files below.

## What this repo is

The Releeve product platform: Rust backend (`backend/`) + Next.js frontend
(`frontend/`). The backend proxies signed requests to the fork-core engine and
persists authoritative simulation/environment state; it also hosts auth,
orgs/projects, explorer, ingest, alerts, and the SourceLens client. See
`..\PROJECT.md` for the system overview.

## Hard rules

- Worktrees are intentionally dirty with user work — never reset/checkout/
  clean/revert unrelated changes. **Do not commit unless the user asks.**
- **Frontend work requires explicit user permission** (user rule 2026-08-14):
  do backend work first; the UI has fixes to do before wiring.
- **Product posture (2026-08-18, `..\DECISIONS.md`)**: Mainnet-first —
  historical simulation/virtual-envs target Mainnet (P26+). Testnet is
  latest-only (no historical Testnet, no Testnet history storage; Testnet
  resets wipe history). Do not build Testnet historical flows.
- Playwright/browser verification requires explicit user authorization.
- Async ops return 202, env create/branch 201, errors are
  `application/problem+json` preserving upstream status/code/detail.

## Task → files

| Task | Read first | Primary code |
|---|---|---|
| Fork-core integration / proxies | `..\TODO.md` P0-5, P1-6 | `backend/crates/sim/src/lib.rs` (ForkCoreClient), `backend/crates/api/src/simulations.rs`, `environments.rs`, `backend/crates/api/tests/fork_core_runtime.rs` |
| Write-path routes: transaction submit, deploy, hosted RPC + Tenderly-style two-tier RPC URLs | `..\last_part.md` §9, `..\DECISIONS.md` | `backend/crates/api/src/environments.rs` (`environment_transactions`, `environment_deploy`, `environment_rpc`, `environment_rpc_authed`, `environment_rpc_admin`, `resolve_org_project`), `backend/crates/api/src/lib.rs` routes (public `POST /v/{org}/{project}/{env}`, admin `POST /v/{org}/{project}/{env}/{admin_secret}`, authed `POST /api/v1/{org}/{project}/environments/{id}/rpc`), `backend/crates/sim/src/lib.rs` (proxy methods) |
| Auth / orgs / projects | — | `backend/crates/api/src/{lib.rs, auth flows}`, `backend/crates/shared/src/permissions.rs` |
| Explorer / ingest / alerts | `..\TODO.md` P1-1 | `backend/crates/api/src/explorer*.rs`, `backend/crates/ingest`, `backend/crates/alerts` |
| Frontend (only with permission) | `app-routing.md` | `frontend/src/components/app/project-pages.tsx` (simulator + virtual envs), `frontend/src/app/*` routes |
| Migrations / DB | `..\TODO.md` P1-1 | `backend/migrations/` (30; 0026/0027 fork-core authority, 0028 invalidation, 0029 `rpc_admin_secret`, 0030 `rpc_slug` named RPC URLs) |

## Key commands (this Windows machine — sole venue)

```powershell
# Full speed — incremental on, disk no longer a constraint (250 GB attached)
# backend
Set-Location backend
cargo check -p sim -p api
cargo test -p api --test openapi
cargo test -p api --test fork_core_runtime   # write-path + RPC + Tenderly URL proxies
cargo test -p api --test migrations          # schema/idempotency (29 migrations)

# frontend
Set-Location ..\frontend
yarn typecheck
yarn lint
yarn build
```

One heavy command at a time per workspace; preflight disk first
(`..\TESTING.md`).

## Verify before claiming work

Follow the binding ladder + evidence rules in `..\CROSS-CUTTING.md`.

Repo minimums: `cargo fmt --all -- --check`, `git diff --check`, exact
reproduction test, neighboring tests, then the ladder upward — cross-crate →
`cargo test --workspace` (plus `yarn typecheck`/`lint`/`build` when the frontend
is touched) when `..\CROSS-CUTTING.md` full-suite triggers fire. Frontend
commands run only with user permission. Record counts + skipped/ignored; full
evidence rules: `..\TESTING.md`; queue: `..\TODO.md`; decisions:
`..\DECISIONS.md`; full original handoff:
`..\docs\handoffs\2026-08-14-fork-core-handoff.md`. Note: the *replay-parity
oracle* (fork-core `just test-fixtures`) is a correctness gate, not a machine —
keep it.