# Releeve Explorer Architecture

Releeve Explorer is intentionally low-cost. It is not a full archival Stellar explorer at launch. It gives builders quick, in-product visibility into recent ledgers, transactions, wallets/accounts, contracts, and investigation context without paying to store all chain history from genesis.

## Data Sources

- Horizon for recent ledger and classic transaction ingestion.
- Soroban RPC for contract invocation detail, entity snapshots, and simulation-adjacent data.
- External explorers for deep archival cases outside our indexed window.

## Storage Model

PostgreSQL is the source of truth for indexed rows: ledgers, transactions, token events/transfers when decoded, entity snapshots, investigation annotations, tracked wallets/contracts, and Fork Core simulation references.

Redis is a cache and coordination layer only: feed caches, rate limits, ingestion watermarks/locks, and live-feed acceleration. If Redis is unavailable, public Explorer reads should fall back to PostgreSQL where possible.

## Low-Cost Feed Model

The Home page fetches only the latest small feed, currently 10 ledgers and 10 transactions. It refreshes visually through Server-Sent Events and also has a one-minute polling fallback. Home should not expose pagination controls.

Dedicated explorer/entity pages use paginated HTTP feed endpoints:

- `GET /api/v1/explorer/:network/ledgers?limit=10|20|50|100&cursor=...`
- `GET /api/v1/explorer/:network/transactions/latest?limit=10|20|50|100&cursor=...`

Pagination is cursor-based, not offset-based. Cursors encode the last seen sort key so pages do not shift when new ledgers or transactions arrive.

## Caching And Live Updates

Hot public feeds are cached in Redis:

- latest ledgers and transactions: about 10 seconds
- slower aggregates/rankings: about 60 seconds

The live home feed uses `GET /api/v1/explorer/:network/live`, emits the SSE event `explorer.feed`, sends an immediate snapshot, and updates about once per minute.

## Long-History Strategy

Releeve should not try to store full Stellar history from day one. For older data, use configured Horizon/RPC providers when available, link to mature external explorers for archival inspection, and persist only rows that become product-relevant: tracked wallets/contracts, saved investigations, alerts, simulations, and bookmarked transactions.

The commodity explorer is not the moat. Releeve's product value is the context around chain data: simulator handoff, debugger/source verification handoff, alerts, saved investigations, team comments/bookmarks, project-scoped tracking, and Fork Core simulation/reconciliation evidence.

## Private Simulation Boundary

The authenticated application calls Platform only. Platform authorizes the user and project, then forwards environment and simulation commands to private Fork Core with a short-lived service assertion. Fork Core is never exposed to the browser and never holds user signing keys.

For local end-to-end simulation testing, configure the `FORK_CORE_*` values in `backend/.env` and start Fork Core's API and worker. The committed `backend/.env.example` documents the required connection and assertion settings; the private key and Fork Core public-key manifest must be a matching Ed25519 pair.
