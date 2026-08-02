# Phase 3 — Explorer (Transactions, Accounts, Contracts, Ledgers)

**Status:** Planned.
**Depends on:** Phase 2 (data + feeds live).
**Goal:** The decoded, embedded explorer from `../02-Releeve-API-Design.md` §5 — public lookup + project-tracked modes, tags, comments/priority, contract read/write **and source verification**, and the frontend pages that render it all, with pagination everywhere.

> **Rebrand note (frontend):** the existing `frontend/` is the former **Seidar** bounty/hiring marketplace and is being rebranded to **Releeve**. Its current `src/lib/api.ts` targets Seidar endpoints (`/api/v1/users/me`, `/api/v1/bounties/create`, `/api/v1/orgs/{id}/repos`, …) that do **not** exist in the Releeve API design. Phase 3 frontend work means building new/renamed pages against the Releeve contract (`02`), **not** retrofitting the Seidar client. The shared pagination component, auth contexts, and app shell survive the rebrand; the data layer does not.

---

## Features added in this phase

### API (`releeve-api`) — public + project-tracked

- **Transactions** (§5.1):
  - `GET /api/v1/explorer/{network}/tx/{hash}` (public) and `GET /api/v1/{org}/{project}/transactions?...` (filtered list, paginated).
  - Full response shape: call tree, state changes, events, fund flow edges, resource usage, operation type, status, ledger, sequence.
  - `GET .../tx/{hash}/search?q=&scope=all|from|to|function|contract|file|comment|metric` (no `opcode` scope — doc 01 §3.1.1).
  - `POST .../transactions/{hash}/comments`, `POST .../transactions/{hash}/priority`.
- **Accounts (wallets)** (§5.2): public lookup; project-tracked list/add; `GET .../accounts/{address}/transactions?type=payments|invocations|trustline_offer|token_transfers` (paginated); holdings + USD where a price feed exists (`token_prices`, null-safe).
- **Contracts** (§5.3): public lookup; project-tracked list/add; transactions + events (filtered, paginated); **source verification** (`POST .../contracts/{address}/verify` → async job, `GET .../contracts/{address}/verifications` for attempt history); upgrades history (`contract_wasm_history`); `POST .../contracts/{address}/call?mode=simulate|run` (Read/Write panel).
- **Ledgers** (§5.4): `GET .../ledger/{sequence}`, `GET .../ledger/latest`.
- **Tags** (§4): CRUD + attach/detach (`wallet`/`contract`).
- **Project-tracked vs public access** enforced; adding to project enables tags + (later) alerts.

### Shared decoding util (`releeve-core`)

A single ScVal↔JSON codec used by both the P2 decoder and these endpoints — one mapping table from `ScVal` variants to JSON (`{ type, value }`), one `Vec<ScVal>` → typed-args mapper for the Read/Write panel. No per-endpoint decode logic. Also the fund-flow extractor (payments + SEP-41 event edges) reused by the tx detail response.

### Contract Read/Write semantics

- `mode=simulate` — dry-run via real `simulateTransaction` against unmodified live state (not the fork-core). Free, no key needed.
- `mode=run` — actually submits. **Requires a signer configured on the project** (project-scoped keypair, stored encrypted, `manage_fork_sessions`-style gating to be decided with P4's permission model; `update_projects` at minimum). Without a configured signer → `409 signer_not_configured`, never a partial submit. On testnet/futurenet only for MVP unless a mainnet signer is explicitly configured.
- Both modes encode args via the shared ScVal codec; `simulate` responses reuse the Transaction response shape (call tree/events/state changes) so the same UI renders them.

### Frontend (`frontend/`, Next.js app being rebranded from Seidar)

- Transaction detail page: call-tree trace, state-changes before/after, events, fund-flow graph (the differentiator — recharts), resource usage, trace search box with scope selector, comments/priority.
- Account page: balance, holdings, filtered+paginated tx list, Add-to-Project, Simulations tab (stub until P5).
- Contract page: header fields, tabs (Transactions, Events, Source + Verify, Upgrades, Read/Write), Simulations tab (stub until P5).
- Ledger page: header + tx list (paginated).
- **Shared pagination component:** page-size select (20/50/100, default 20) + Next/Prev buttons driven by `next_cursor`/`prev_cursor`.
- API client layer (`src/lib/api.ts`) **replaced** with typed helpers returning the pagination envelope against the Releeve contract (see rebrand note).

---

## Testing

### Unit tests (Rust)

- Decoders reused from P2 output → DTO mapping for every §5 shape.
- ScVal↔JSON codec: round-trip for each ScVal variant; malformed input → error, not panic.
- Search scope filtering (function/contract/comment/metric); invalid scope → 400.
- Comment/priority validation (target type ∈ call_node|state_change|event; level ∈ high|medium|low).
- Fund-flow edge extraction/dedup from a fixture tx (classic + SEP-41).
- Contract call mode: `simulate` vs `run` routing; arg encoding to ScVal; `run` without a configured signer → 409.
- **Verification flow unit logic:** status transitions (submitted→compiling→verified/failed); WASM-hash diff decides verified vs failed; `failure_reason` captured.
- Access control logic: public vs project-tracked resolution.

### Integration tests (testcontainers Postgres + Redis; Soroban RPC/Horizon stubbed with wiremock)

- `GET /explorer/{network}/tx/{hash}` returns the full decoded shape for a seeded fixture; unknown hash → 404.
- Filtered project transaction list honors filters and pagination.
- Account + contract + ledger endpoints return expected shapes; `source_map_status` correctly `not_available` pre-P5.
- Tags attach/detach; tag filters lists.
- Contract `call?mode=simulate` hits a stubbed `simulateTransaction` (wiremock) and returns result; `run` with no signer → 409; with a stubbed signer → submit path exercised and flagged.
- **Verification:** `POST /contracts/{address}/verify` → 202 + `verifications` row `submitted`; stubbed compile job flips to `verified` when the produced WASM hash matches the fixture `current_wasm_hash`, `failed` with `failure_reason` otherwise; history endpoint returns attempts, paginated.
- Public endpoints work unauthenticated; project-tracked routes require auth + project membership.
- Pagination walk (20/50/100, next/prev) on account tx list and contract events.

### Frontend tests (Vitest + React Testing Library)

- Transaction detail panels render from fixture data (call tree, events, fund-flow graph, resource usage).
- **Pagination component:** selecting 50 changes request param; Next uses `next_cursor`; Prev uses `prev_cursor`; disabled states on empty cursors.
- Search box applies scope + query to the API call.
- Comment/priority forms submit and reflect persisted state.
- Verify form: submit → success state on `verified`, error state on `failed` with `failure_reason` shown.

---

## Commit patterns

Branch: `phase/3/<slug>`.

- `feat(core): add scval-json codec and fund-flow extractor`
- `feat(api): add transaction detail with call tree and resource usage`
- `feat(api): add trace search endpoint with scopes`
- `feat(api): add account and contract detail endpoints`
- `feat(api): add contract read/write call endpoint (simulate|run)`
- `feat(api): add contract source verification flow`
- `feat(api): add ledger detail and latest endpoints`
- `feat(api): add tags CRUD and attach/detach`
- `feat(api): add comments and priority annotations`
- `feat(web): add pagination component with 20/50/100 and next/prev`
- `feat(web): add transaction detail page and fund-flow graph`
- `feat(web): add account/contract/ledger pages`
- `feat(web): replace seidar api client with releeve contract client`
- `test(api): cover endpoint shapes, access modes, verification, and pagination`

Rules: API shape changes land with frontend consumption in the same PR where feasible; fixtures shared between Rust tests and frontend tests live in a committed `fixtures/` dir.

---

## Checklist

**Pre-merge (every PR):**
- [ ] Rust + frontend tests green; fmt/clippy clean
- [ ] Public vs project-tracked access tested on every §5 endpoint
- [ ] Every list endpoint paginated (20/50/100, next/prev) — no unpaginated lists
- [ ] Source-map fields degrade gracefully (`not_available`) until P5
- [ ] Verification flow: submit→status transitions→history covered by tests
- [ ] OpenAPI spec matches implemented routes; frontend uses typed client
- [ ] Fund-flow graph renders from fixture; no live RPC in frontend tests

**Phase completion (Definition of Done):**
- [ ] Transaction/account/contract/ledger pages render real (fixture-seeded) data end to end
- [ ] Contract source verification works end to end (submit → verified/failed)
- [ ] Pagination component (20/50/100 + next/prev) proven on multiple pages
- [ ] Tags, comments, priority functional
- [ ] Contract read/write works in `simulate` mode; `run` mode properly gated
- [ ] Search scopes behave per doc 01 §3.1
- [ ] Seidar API client fully replaced by the Releeve contract client
- [ ] P4 (alerts) has the embedded detail views it needs to render firing context
