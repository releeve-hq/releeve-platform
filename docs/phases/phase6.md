# Phase 6 — Post-MVP / Scale (State Sync, Billing, Hosted RPC, Observability)

**Status:** Planned. **v1.5+** — only pursued once Phases 1–5 demonstrate real usage/traction. This phase is primarily **operational infrastructure**, not feature work (same distinction doc 04 §2.3 draws).
**Depends on:** Phases 1–5.

---

## Features added in this phase

- **Persistent fork environments (State Sync)** — populate `fork_environments`:
  - `POST /api/v1/{org}/{project}/simulations/{id}/fork` promoted from `[v1.5+]` to real — one-shot simulation becomes a named, persistent environment.
  - Sync loop keeps a forked environment live against real mainnet with an explicit conflict-resolution policy: **manual overrides win, sync everything else** (doc 04 §2.3).
  - `state_sync_enabled` / `is_public` flags honored; isolation via the "shared read-only base + per-environment override diff" shape (doc 04 §7) rather than full state duplication.
  - `simulation_runs.fork_environment_id` populated.
- **Billing & plan gating:**
  - The `plans` / `subscriptions` / `billing_events` tables are **already reserved in doc 03 §8.5 and migrated in P0** — P6 populates them (seed `free`/`pro`/`team` plans) and wires the API; no schema retrofit.
  - `GET/PATCH /api/v1/{org}/billing`, `PATCH .../billing/plan`; `manage_billing` enforced; allowed plan transitions enforced against `subscriptions.status`.
  - Plan-tier gates wired: multiple orgs per user, fork environments, `is_public` explorer, feeds window depth, rate-limit quotas.
  - Payment provider abstraction (Stripe/OpenCollective — out of scope detail, interface defined).
- **Hosted RPC per environment:** per-tenant Soroban RPC endpoint backed by the fork, with auth/quota.
- **Public explorer per environment:** shareable read-only view (mirrors Tenderly's public Virtual TestNet explorer) driven by `is_public`.
- **Observability:** OpenTelemetry tracing across API/ingest/alerts/sim; Prometheus metrics (request latency, ingestion lag, queue depth, cache hit-rate); structured logs; error budgets.
- **Capacity & hardening:**
  - Ingestion batching/backpressure; feed cache TTL tuning + LRU bounds (DB doc §11).
  - Redis failover safety already proven (P2) → now tested under load; read replicas for explorer reads.
  - Rate-limit quotas tiered by plan.
- **Alert fan-out scale:** parallel delivery workers on the Redis queue with per-destination concurrency limits; dead-letter for permanently failed deliveries.

---

## Testing

### Unit tests

- Plan-tier gating matrix: each feature × tier → allowed/denied; `manage_billing` enforcement.
- Billing plan change validates provider state transition (allowed transitions only).
- Sync conflict-resolution: override diff wins over incoming real-world change (deterministic rule).
- Queue concurrency: per-destination worker limit respected; dead-letter classification.
- Tenant RPC auth: token → environment mapping; cross-tenant access → denied.

### Integration tests (testcontainers Postgres + Redis for correctness; provider + external services stubbed with wiremock; load tests use a dedicated scripted profile, not testcontainers)

- `POST /simulations/{id}/fork` → `fork_environments` row; subsequent sync tick applies new real-world changes while preserving manual overrides (fixture-driven).
- Two environments forked from the same base diverge correctly (override isolation).
- `is_public=true` → shareable read-only explorer reachable without auth, mutation endpoints still gated; `is_public=false` → denied.
- Plan downgrade blocks a previously-allowed feature (e.g., second org) with a clean 4xx + billing message.
- Hosted RPC: valid token reaches the right fork; invalid/foreign token → 401/403.
- **Load test (k6 or `cargo bench`-style scripted):** feeds endpoints sustain target RPS with p95 under budget; cache hit-rate ≥ threshold; Redis flush during load → Postgres fallback, no 5xx.
- **Failover:** primary DB down → read replica serves explorer; recovery catches up from watermark.
- Delivery at scale: 10k firings → all delivered exactly-once (dedupe), none lost, dead-letter only for simulated permanent failures.

---

## Commit patterns

Branch: `phase/6/<slug>`.

- `feat(fork): promote simulation to persistent fork environment`
- `feat(fork): add state-sync loop with override-wins conflict policy`
- `feat(billing): add plan tiers and feature gating`
- `feat(billing): add provider-agnostic payment interface`
- `feat(rpc): add per-environment hosted rpc endpoint`
- `feat(explorer): add public per-fork read-only view`
- `obs: add otel tracing, metrics, and structured logs`
- `perf: batch ingestion and bound feed cache memory`
- `perf: parallelize alert delivery with per-destination limits`
- `test(scale): add load and failover scenarios`

Rules: infra changes land with their load/failover tests; billing changes land with the tier-gating matrix test.

---

## Checklist

**Pre-merge (every PR):**
- [ ] fmt/clippy/unit/integration green incl. new infra tests
- [ ] Every plan-gated feature has a tier-matrix test
- [ ] Load/failover scenarios committed and runnable in CI (or a documented nightly job)
- [ ] No hard-coded secrets or provider credentials
- [ ] Migration changes (e.g., billing tables) committed with consumers
- [ ] Observability: new endpoints emit traces/metrics consistent with the standard

**Phase completion (Definition of Done):**
- [ ] Fork environments persistent + live-synced with proven override-wins behavior
- [ ] Billing/plan gating end to end; payment provider interface defined (impl can be swapped)
- [ ] Public per-fork explorer functional and correctly isolated
- [ ] Hosted RPC per environment with auth
- [ ] Load test targets met; Redis-failure and DB-failover resilience proven
- [ ] Alert delivery scales with exactly-once semantics under load
- [ ] Platform is operationally self-describing (traces, metrics, logs)

---

## Phase roadmap summary

| Phase | Deliverable | Gate |
|---|---|---|
| 0 | Backend workspace, dockerized Postgres/Redis (dev), testcontainers harness, full schema migrations, CI | green CI |
| 1 | Auth (verify/OAuth/rotating refresh/revoke/reset), org/project/member, access tokens, permissions, pagination | full auth loop |
| 2 | Ingestion (Horizon + RPC), network feeds, Redis cache, rate limiting | idempotent ingestion + live feeds |
| 3 | Explorer API + embedded UI, tags, comments, contract read/write + verification | pages render real data |
| 4 | Monitoring & alerts, webhook/email delivery | alert→deliver loop |
| 5 | Simulation integration (fork-core wires in) | engine oracle passes + UI integration |
| 6 | State Sync, billing, hosted RPC, observability | traction + scale targets |

**Parallel track (not a platform phase):** the fork-core **engine** itself is built + correctness-verified in its own repo per `../04-Releeve-Simulation-Engine.md` (engine Phase 1: CLI MVP + oracle; Phase 2: source-map). Platform P5 consumes it. Nothing in P0–P4 depends on the engine.
