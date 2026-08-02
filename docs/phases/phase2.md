# Phase 2 — Data Backbone (Ingestion, Caching, Network Feeds)

**Status:** Planned.
**Depends on:** Phase 1 (auth/permissions for the API surface; tables exist from P0).
**Goal:** Pull real chain data into Postgres, build the network-wide feeds (latest transactions, latest ledgers, top tokens, token transfers), stand up the Redis cache layer (DB doc §11) + rate limiting, and make cursor pagination work at scale on every read path.

---

## Features added in this phase

### Ingestion workers (`releeve-ingest` crate)

**Two data sources, two ingestion paths — do not conflate them:**

| Path | Data source | What it feeds |
|---|---|---|
| **Ledgers + classic transactions** | **Horizon** (`/ledgers`, `/transactions`, `/accounts`, `/operations`) | `ledgers`, classic `transactions` rows (payment/trustline/offer ops), classic fund-flow edges, account balances |
| **Soroban invocation detail** | **Soroban RPC** (`getTransaction`, `getEvents`) | `invoke_host_function` transactions: call tree, state changes, events, resource metrics |
| **Entity snapshots (on demand)** | **Soroban RPC `getLedgerEntries`** | Live account/contract/trustline entries for the fork-core snapshot and for lazy profile enrichment. **This method returns specific ledger entries — it does NOT enumerate ledgers/blocks.** Never used to discover blocks or transactions. |

- Ledger/block headers come from **Horizon** (`/ledgers?cursor=...`); latest-sequence cursor from Horizon `/ledgers` tail or RPC `getLatestLedger`.
- For every ledger, pull its transactions via Horizon (classic ops) and match Soroban invocations via RPC `getTransaction`/`getEvents` for the extra decoded detail.
- Decode and store into `ledgers`, `transactions`, and child tables `tx_call_tree_nodes`, `tx_state_changes`, `tx_events`, `tx_fund_flow_edges`.
- **Protocol-23-aware decoding:** the RPC `events` object is nested (`diagnosticEventsXdr`, `transactionEventsXdr`, `contractEventsXdr`) — never assume the flat shape. Defensive decode + explicit error on schema drift.
- Parse diagnostic `core_metrics` (`cpu_insn`, `mem_byte`, `invoke_time_nsecs`, `disk_read_bytes`, `write_bytes`, `max_rw_key_byte`, `max_rw_data_byte`) into the `resource_usage` columns; treat missing diagnostic events as absent, not zero (a node without `ENABLE_SOROBAN_DIAGNOSTIC_EVENTS` must not produce fake zero metrics).
- **Classic ops**: payments → `tx_fund_flow_edges` (from/to/asset/amount, with trustline-aware asset resolution); manage_offer / set_trust_line_flags → operation-type rows + account balance updates.
- **SEP-41 token detection** (for the transfers/top-tokens feeds): identify whether a token is a classic asset (`CODE:ISSUER`) or an SEP-41 contract (via its Soroban interface — `token` interface functions). A contract not matching SEP-41 is excluded from token feeds but still tracked as a contract.
- **USD prices**: the feeds need USD figures (`usd_volume`, account/contract `usd_value`) — Stellar has no native oracle. The ingestion pipeline refreshes `token_prices` (DB schema §6.1) from a configured external price feed on a schedule; missing/illiquid tokens simply have `NULL` USD (never a failed request). See "Price feed contract" below.
- Idempotent upsert (dedupe by hash) — re-ingesting a ledger range is a no-op.
- **Sync watermark + worker lock in Redis** (`releeve:sync:watermark:{network}`, `releeve:sync:lock:{network}`) so exactly one worker owns a ledger range; watermark rebuildable from `max(sequence)`.
- Backfill path from BigQuery/Hubble for history beyond the RPC retention window (24h–7d), out of critical path.
- **Upstream politeness:** per-network RPC/Horizon URL config, connection pooling, bounded concurrency (a worker budget that never hammers public RPC endpoints), retry with exponential backoff + jitter, circuit-breaker on repeated 5xx, per-endpoint timeout. A dead upstream pauses that network's ingestion (logged, surfaced in health) without blocking others.

### Token volume rollup

- `token_volume_stats`: scheduled aggregation over `tx_fund_flow_edges` into 24h/7d/30d buckets, joined with `token_prices` for `usd_volume`; feeds top-tokens.

### Network feed endpoints (public, cacheable, paginated — API doc §5.5)

- `GET /api/v1/explorer/{network}/transactions/latest`
- `GET /api/v1/explorer/{network}/ledgers`
- `GET /api/v1/explorer/{network}/tokens/top?window=24h|7d|30d`
- `GET /api/v1/explorer/{network}/transfers?asset=&window=` (SEP-41 + classic assets)

### Redis cache layer (DB doc §11, cache-only, Postgres fallback)

- `releeve:feeds:*` (latest ledgers/transactions, top tokens, transfers) — TTL ~5–15s / ~60s.
- `releeve:ledger:{network}:{seq}`, `releeve:tx:{network}:{hash}`.
- `releeve:ratelimit:{scope}:{key}` sliding-window counters.
- Invalidations keyed off Postgres truth (`last_synced_at`, watermark advances) — never write-through.
- Graceful degradation: Redis flush → feeds served from Postgres (correctness, only slower).

### Rate limiting

- Middleware on public explorer endpoints (per-IP, per-access-token, per-quota).

### Pagination at scale

- Keyset cursor indexes from doc 03 (`idx_transactions_network_time`, `idx_ledgers_network_seq`, `idx_tx_fund_flow_asset`, `idx_token_volume_window`, …) proven with the new feed queries.

---

## Price feed contract (external dependency, own the cache not the source)

USD values come from an external price provider (exchange/oracle). Releeve owns the cache, never the source:

- Config: provider endpoints + refresh interval (e.g. every 5m) + the set of assets to track (fed by the top-tokens ranking).
- Failure behavior: a stale/missing quote → `token_prices` row simply goes stale; feeds return `usd_volume: null` (or the last known price with a `stale` flag). **No request fails because of a missing price.**
- This is deliberately a thin, swappable adapter (interface in `releeve-ingest`, impl behind a trait) — see P6 for provider-agnostic principles.

---

## Testing

### Unit tests

- **Decoding:** known-good RPC fixture JSON → correct `transactions`/`ledgers`/`tx_*` rows (call tree depth, state-change before/after, event topics/data, fund-flow edges, resource metrics); Horizon fixture JSON → correct ledger/classic-tx rows and payment edges.
- **Protocol drift:** fixture with the flat `diagnosticEvents` shape (pre-P23) → decoded correctly OR fails loudly; nested P23 shape → decoded correctly.
- **Data-source accuracy:** `getLedgerEntries` fixture used only for entity snapshots; block/tx discovery never routes to it (a guard test).
- **Idempotency:** same ledger ingested twice → no duplicate rows.
- **Watermark:** advance logic (monotonic, per-network), lock contention → only one worker proceeds.
- **Token rollup math:** known edges → correct volume/tx_count/active_accounts per bucket; overlap between buckets handled; SEP-41 vs classic asset classification.
- **Price integration:** stale/missing price → null USD (no panic/error); price refresh writes `token_prices`.
- **Cursor correctness for feeds:** newest-first ordering; keyset boundary across equal timestamps resolved by the stable id tiebreaker.
- **Retry/backoff:** transient 5xx → retries with backoff; persistent failure → circuit open, network paused, others unaffected.
- **Rate limiter:** sliding-window boundary — request at T-ε vs T+ε; quota exhaustion → 429.
- **Cache:** key construction, TTL, cache-hit vs cache-miss path, Postgres-fallback on Redis error.

### Integration tests (testcontainers Postgres + Redis; Soroban RPC/Horizon stubbed with wiremock)

- Seed fixture ledger+tx data → ingestion worker populates all tables.
- Re-run ingestion over the same range → row counts unchanged (idempotent).
- `GET /transactions/latest` returns newest-first, correct page sizes, correct `next_cursor`/`prev_cursor`.
- `GET /ledgers` same; `GET /tokens/top?window=7d` returns fixture-derived ranking; `GET /transfers?asset=X` filters correctly (classic + SEP-41).
- Redis **flush** mid-flight → endpoints still return correct data from Postgres; cache repopulates on next tick.
- Rate-limit: burst past quota → 429; after window → 200.
- Worker restart mid-range → resumes from watermark without gaps or dupes.
- Two workers compete → exactly one ingests (lock held), other idles.
- Upstream down (wiremock returns 503) → retry/backoff then circuit opens; other networks keep ingesting.

---

## Commit patterns

Branch: `phase/2/<slug>`.

- `feat(ingest): add horizon-ledger/classic-tx ingestion with idempotent upsert`
- `feat(ingest): add soroban-rpc invocation detail ingestion (p23-aware)`
- `feat(ingest): add entity snapshot path via getLedgerEntries`
- `feat(ingest): add sync watermark and worker lock in redis`
- `feat(ingest): add token_volume_stats rollup and sep-41 classification`
- `feat(ingest): add token_prices cache refresh from external feed`
- `feat(api): add latest-transactions and ledgers feed endpoints`
- `feat(api): add top-tokens and transfers feed endpoints`
- `feat(cache): add redis feed/entity caches with postgres fallback`
- `feat(api): add sliding-window rate limiting middleware`
- `feat(ingest): add retry/backoff and circuit breaker on upstreams`
- `test(ingest): cover decoding, idempotency, watermark, rollup, and drift`

Rules: stub fixtures live in the same commit as the decoder they test; wiremock fixtures are committed (never generated at test runtime from live net).

---

## Checklist

**Pre-merge (every PR):**
- [ ] fmt/clippy/unit/integration green
- [ ] Every feed endpoint paginated and rate-limited
- [ ] Redis keys documented (key pattern + TTL) in code or a `docs/` note matching DB doc §11
- [ ] No write path depends on Redis; Postgres is authoritative
- [ ] Fixtures committed; no live-network dependency in tests
- [ ] Price feed integration degrades to `NULL` USD, never an error
- [ ] OpenAPI spec includes the four feed endpoints

**Phase completion (Definition of Done):**
- [ ] Ingestion populates a full fixture ledger range correctly (call tree, state changes, events, fund flow, resource metrics)
- [ ] Re-ingestion provably idempotent (integration test green)
- [ ] All four feeds live, paginated, rate-limited, cache-backed
- [ ] Redis flush resilience proven by test
- [ ] Watermark/lock behavior verified for single- and multi-worker
- [ ] Upstream outage isolation verified (one network down, others healthy)
- [ ] `token_volume_stats` + `token_prices` rollup correct against fixtures
- [ ] P3 (explorer) has real data to render
