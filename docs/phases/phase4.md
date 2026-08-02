# Phase 4 — Monitoring & Alerts

**Status:** Planned.
**Depends on:** Phase 2 (ingested data), Phase 3 (embedded detail views).
**Goal:** `../02-Releeve-API-Design.md` §6 — composable alert expressions, an evaluation pipeline over ingested data, destinations (account-scoped + project webhooks) with HMAC-signed delivery, retries, dedupe, history, and test flows. **No auto-reaction** (that's v2 / P6).

---

## Features added in this phase

### Alerts CRUD (§6)

- `GET/POST/PATCH/DELETE /api/v1/{org}/{project}/alerts`; `GET .../alerts/{id}/history` (paginated firing log). Body = `target` × `expressions[]` × `match_logic` × `destinations[]`.
- `match_logic` `all`/`any` across expressions; at least one expression required.

### Expression evaluator (`releeve-alerts` crate) — every type in the enum (Overview §5 / API doc §6)

- `successful_transaction`, `failed_transaction`, `tx_error`
- `function_call` (walk call tree), `function_params`
- `event_emitted`, `event_parameter` (native Soroban events — no topic-reconstruction)
- `token_transfer` (classic + SEP-41), `allowlisted_callers`, `blocklisted_callers`
- `balance_change`, `transaction_value` — for **classic** ops these evaluate against Horizon-derived rows (payments/trustlines), not just Soroban invocations; both paths must be covered
- `state_change` (storage-key level, `condition` on threshold/percentage/criteria/any_change)
- `view_function` (periodic `simulateTransaction` polling — real infra cost, flagged in ops; poll interval configurable)
- `no_action` (inactivity window per target — e.g. oracle silence)
- `token_transfer_matcher` (internal balance bookkeeping vs emitted events)
- `sandwich_transaction` **excluded** (deferred — Overview §5/§9)

### Evaluation pipeline (mechanism made explicit)

1. **Ingestion publishes, alerts consume.** P2's ingestion worker publishes an "entity updated" notification (tx hash / event id / state-change key) to a Redis stream (`releeve:events:new`). A `releeve-alerts` worker consumes it, loads the decoded transaction from Postgres, and evaluates every enabled alert whose `target` matches.
2. **Firing bookkeeping.** A match inserts an `alert_firings` row. **Dedupe is structural:** the partial unique index `uq_alert_firing_dedupe` (DB schema §9) prevents a second firing for the same `(alert_id, tx_hash)`; a conflict is treated as "already evaluated" and skipped.
3. **Fan-out.** Each firing → `destination_deliveries` rows (one per destination) → delivery queue.
4. **Schedulers (periodic triggers, tokio intervals):**
   - `view_function` poller — per-alert interval, calls real `simulateTransaction`, evaluates the condition. Cost is real RPC traffic; the poll budget must be capped (global per-project/org cap) and the ops note in the code + README updated.
   - `no_action` detector — per-alert window; if the target had no matching activity within the window, fire (once per window; re-arm only after activity resumes).
   - `token_volume_stats` rollup ticks (already P2) feed nothing here — this pipeline is transaction/event driven, not aggregate driven.

### Destinations

**Account-scoped** (reusable across every project in the org) — concrete config shapes (`account_destinations.config` JSONB):

| type | config fields |
|---|---|
| `email` | `{ smtp_profile, to: [email...] }` — mailer from P1; multiple recipients; rate-capped |
| `slack` | `{ webhook_url, channel? }` |
| `telegram` | `{ bot_token, chat_id }` |
| `discord` | `{ webhook_url }` |
| `sentry` | `{ dsn, organization?, team? }` — uses the Sentry API to create an issue |
| `pagerduty` | `{ integration_key, service_id? }` — Events API v2 `trigger` payload |

**Project-scoped** — webhook CRUD (url, auto-generated `signing_secret`, `timeout_seconds=5`, `max_retries=5`); `action` type reserved for v2.

**Webhook delivery engine** (doc 01 webhook spec, made complete):
- On destination **create** and on **test**, the engine performs a **GET health probe** to the endpoint (must return 200 on the same URI) before the POST is trusted; probe failure → create rejected or surfaced as a warning.
- POST payload delivery with HMAC SHA256 signature `hash(secret + payload + timestamp)`; 5s timeout → marked failed.
- Statuses: `success | failed | pending | retry | skipped`. Retry with **exponential backoff** (e.g. 30s, 1m, 2m, 4m, 8m → max 5 attempts then `failed`); a 2xx at any attempt → `success`.
- **Redis queue + dedupe** (`releeve:delivery:*` per DB doc §11) — at-least-once without double-send; `releeve:delivery:{id}:seen` prevents a retried delivery from double-sending; `destination_deliveries` rows remain the source of truth.
- `POST .../destinations/{id}/test` — body `{ tx_hash }` **or** `[SIM-HOOK]` `{ simulation_id }` (stubbed until P5). A test fires the `TEST` event type, runs the full delivery path, and returns the delivery record.

**Email/SMTP**: delivered through the P1 mailer module (`lettre`). SMTP failures go through the same retry/status machinery (deliveries are queued, not fire-and-forget).

---

## Testing

### Unit tests

- **Each expression matcher** against crafted fixture transactions/events (positive + negative):
  - function_call matches nested call-tree node; function_params matches args
  - event_emitted/event_parameter match native topics/data
  - token_transfer (classic + SEP-41) matches edges; blocklist/allowlist caller logic
  - balance_change/transaction_value thresholds (stroops/units) for **both classic ops and Soroban invocations**
  - state_change storage-key + condition evaluation
  - `no_action` window detection (activity present vs absent; re-arm semantics)
  - view_function condition evaluation over a stubbed `simulateTransaction` result
  - token_transfer_matcher consistency check
- **match_logic:** all vs any across a multi-expression alert.
- **Webhook:** HMAC compute/verify; GET health probe (200 vs non-200); timeout → failed; retry backoff sequence → skipped at 5; dedupe key logic; payload serialization stable.
- **Firing bookkeeping:** `alert_firings` row created per match; `uq_alert_firing_dedupe` conflict → skip, no duplicate firing for same (alert, tx).

### Integration tests (testcontainers Postgres + Redis; webhook/email targets stubbed with wiremock + mailpit)

- Create alert (function_call + blocklisted_callers, `match_logic=all`) → ingest fixture tx that matches → firing row + delivery to a mock webhook with a valid signature.
- Alert that shouldn't fire (caller not blocklisted) → no firing row.
- Same tx re-delivered through the pipeline → no second firing (dedupe index).
- Webhook returns 500 → retried (attempts 1→5, backoff) → status `failed`; a 2xx mid-retries → `success`.
- **Dedupe:** delivery retried after a network blip does not double-send to the webhook.
- **GET health probe:** webhook URL that returns non-200 on GET → create/test flags it; 200 → proceeds.
- `no_action` alert: fixture window with no matching activity → firing; activity present → none; re-arm after activity.
- `view_function` alert: poller hits stubbed `simulateTransaction` per interval; condition fires/doesn't; poll budget cap enforced.
- Email destination: firing → mailpit captures the alert email (and, when a new user signs up, the verification email from P1 — regression guard).
- History endpoint returns firing log, paginated (20/50/100, next/prev).
- `destination test` with a real fixture `tx_hash` → mock webhook receives `TEST` event.
- Permission gating: alert/destination writes require appropriate project membership.

---

## Commit patterns

Branch: `phase/4/<slug>`.

- `feat(alerts): add alert CRUD with composable expressions`
- `feat(alerts): add expression evaluator for call/event/token matchers`
- `feat(alerts): add state_change and view_function matchers`
- `feat(alerts): add no_action window detection`
- `feat(pipeline): add ingestion→alerts stream consumer with firing dedupe`
- `feat(destinations): add account-scoped destination adapters (incl. email)`
- `feat(destinations): add webhook delivery with hmac, health probe, retries`
- `feat(delivery): add redis queue and dedupe`
- `feat(api): add alert history and delivery records endpoints`
- `test(alerts): cover each expression and match_logic`
- `test(delivery): cover retries, timeout, health probe, and dedupe`

Rules: one expression type per PR where practical; wiremock/mailpit fixtures committed with their tests.

---

## Checklist

**Pre-merge (every PR):**
- [ ] Every new expression type has a unit test (positive + negative case)
- [ ] Webhook signature verified in integration test; secret never logged/returned
- [ ] GET health probe covered (200 vs non-200)
- [ ] Dedupe proven (no double-send test; firing dedupe index tested)
- [ ] Delivery retry/timeout/skip semantics match doc 01 webhook spec
- [ ] `sandwich_transaction` still excluded from the enum
- [ ] History paginated; OpenAPI updated
- [ ] `view_function` polling cost flagged in code comment + ops note (per Overview §5)

**Phase completion (Definition of Done):**
- [ ] Alert → evaluate → fire → deliver → record lifecycle works end to end
- [ ] All expression types from the enum implemented and tested (minus `sandwich_transaction`)
- [ ] Account-scoped (incl. email) + project webhook destinations functional
- [ ] HMAC-verified deliveries with retry/dedupe behavior verified by test
- [ ] Test flow works with a real `tx_hash` (simulation_id path awaits P5)
- [ ] P5 can extend the same delivery path with simulated sources
