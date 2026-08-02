# Phase 5 — Simulation Integration (Wire the Separately-Built Fork-Core In)

**Status:** Planned. **Gated on:** the fork-core engine passing its own correctness oracle (doc `04` §6) standalone. This phase is **not** the engine build — the engine ships separately; this phase wires it into the platform's `[SIM-HOOK]` surface.
**Depends on:** Phase 3 (shared Transaction-detail UI), Phase 4 (destination test path).
**Goal:** `../02-Releeve-API-Design.md` §7 — turn the stubbed simulation endpoints into real ones, persist runs in the reserved `simulation_*` tables, render simulated results through the **same** Transaction-detail UI, and enforce `manage_fork_sessions`.

> **Two build tracks — do not conflate.** The **engine** (fork-core: snapshot / store / override / auth_bypass / executor) is a standalone Rust project built and correctness-verified per `../04-Releeve-Simulation-Engine.md`'s own phases (engine Phase 1: CLI MVP + oracle; engine Phase 2: source-map). This **platform phase (P5)** only consumes the engine across a clean boundary (CLI or service). The gate for starting P5 is engine Phase 1 green, not "everything is wired". Platform CI never builds the engine; engine CI never knows about the platform. A "fix" to the engine never ships through this repo (Rules below).

---

## Features added in this phase

- **`releeve-sim` crate:** client that talks to the standalone fork-core engine (CLI or its own service boundary) and maps engine output → platform DTOs.
- **Simulation endpoints (§7, now real):**
  - `POST /api/v1/{org}/{project}/simulations` — body `{ base_ledger?, contract_id, function_name, args, overrides, impersonate? }`. Returns a run id; executes async; `status` pending→success/failed/error.
  - `GET /api/v1/{org}/{project}/simulations?contract_id=&impersonated_address=&sender_address=` — history, newest-first, paginated. **One shared table powers both the Contract and Account Simulations tabs** (DB doc §8 rationale) — no second simulation type.
  - `GET /api/v1/{org}/{project}/simulations/{id}` — **same response shape as a Transaction (§5.1)**, so the existing detail UI renders it unchanged.
  - `POST .../simulations/{id}/fork` — remains `[v1.5+]` reserved (State Sync is P6).
- **Persistence:** populate `simulation_runs` + `simulation_call_tree_nodes` / `simulation_state_changes` / `simulation_events`; `is_override` flags distinguish cheatcode-driven state changes from natural ones.
- **Auth:** `manage_fork_sessions` permission now enforced — this is the Releeve-specific gate on running mutation/impersonation (not just viewing results).
- **UI:** Contract + Account Simulations tabs surface history; a simulated run opens the shared Transaction-detail component fed from simulation data (contract_id/sender/impersonation provenance shown in the header).
- **Destination test enhancement** (Overview §5 / API doc §3.1): `POST .../destinations/{id}/test` now also accepts `{ simulation_id }` — test a delivery against simulated fork output, not just a real historical hash.
- **Correctness-oracle CI job** (doc 04 §6.3): unmutated replay through the platform path must byte-match (field-for-field after normalization) the real `getTransaction` result for the same invocation, run against a **fixed set of committed engine-output fixtures** on every PR. Version bumps to `soroban-env-host`/`soroban-simulation` always trigger the full suite before merge. (The live engine-vs-RPC oracle runs in the engine's own repo/CI; the platform consumes its fixtures.)

---

## Testing

### Unit tests

- Engine output → DTO mapping (call tree, state changes incl. `is_override`, events, resource usage).
- `overrides` JSON validation (type ∈ balance|storage, well-formed targets/values); malformed → 4xx, never partial run.
- `impersonate` flag handling; status transitions (pending→success/failed/error); error payload capture.
- Provenance logic: same run shows under contract filter AND account filter without duplicating rows.

### Integration tests (testcontainers Postgres + Redis; fork-core stubbed — wiremock as a fake engine HTTP boundary, or a fixture-producing subprocess that never requires the real engine in CI)

- `POST /simulations` → row in `pending`; on completion → `success` + child `simulation_*` rows (incl. `is_override=true` on an override-driven state change).
- `GET /simulations?contract_id=` returns exactly the runs for that contract; `?impersonated_address=` returns runs that impersonated that account (doc 03 §8 semantics).
- **Shared-UI proof:** the Transaction-detail component renders identically from a real tx and a simulation fixture (frontend test).
- **Oracle job:** unmutated replay for a fixture tx matches the real `getTransaction` result; an introduced mutation correctly diffs only the causal state changes (doc 04 §6.2 stages 1–3). In platform CI this runs against **committed engine output fixtures** (the engine's own oracle suite is the real gate); the live engine oracle runs in the engine's repo.
- Negative auth-bypass case (doc 04 §6.2 stage 3): impersonating A must not bypass auth for B.
- `manage_fork_sessions=false` → `POST /simulations` → 403; `true` → allowed.
- Destination test with `{ simulation_id }` → webhook receives `TEST` event carrying simulated payload.
- `POST /simulations/{id}/fork` → 501/absent (still deferred to P6).

---

## Commit patterns

Branch: `phase/5/<slug>`.

- `feat(sim): add fork-core client and dto mapping`
- `feat(sim): implement run lifecycle (pending→success/failed)`
- `feat(api): add simulation list/detail endpoints`
- `feat(api): enforce manage_fork_sessions on run/create`
- `feat(destinations): support simulation_id in destination test`
- `feat(web): add simulations tabs to contract and account pages`
- `feat(web): render simulated results via shared transaction detail`
- `ci: add correctness-oracle regression job for unmutated replays`
- `test(sim): cover overrides, provenance, and oracle diff`

Rules: never commit a "fix" to the engine from this repo — engine changes go through the engine's own repo/CI (doc 04); this repo only consumes and integrates.

---

## Checklist

**Pre-merge (every PR):**
- [ ] Oracle CI job green (unmutated replay matches real result)
- [ ] Overrides/impersonation validated server-side; no partial writes
- [ ] `manage_fork_sessions` enforced on run/create
- [ ] Simulation list endpoints paginated; filters tested
- [ ] Shared UI renders simulated + real fixtures identically (frontend test)
- [ ] `is_override` provenance correct in persisted state changes
- [ ] OpenAPI updated; `[SIM-HOOK]` markers removed for implemented routes

**Phase completion (Definition of Done):**
- [ ] Full loop: run a fork-core simulation from the API → persisted → viewable in the shared detail UI
- [ ] Contract + Account Simulations tabs live and correctly filtered
- [ ] Destination test works with a simulated source
- [ ] Oracle regression in CI for every PR + on engine dependency bumps
- [ ] No platform logic depends on the engine being built into this repo (clean boundary)
- [ ] P6 can layer persistent environments on top without schema retrofits
