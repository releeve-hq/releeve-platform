# Releeve — Database Schema

**Status:** Living document. Companion to `02-Releeve-API-Design.md`. Written in SQL-ish DDL (Postgres-flavored — reasonable default; not committing to a specific engine here) for clarity; adapt syntax to whatever's actually chosen.

**Guiding principle repeated throughout:** every table that will eventually need to relate to a simulation/fork result is designed with that foreign key **present from day one**, nullable, unused until the simulation engine ships. This avoids retrofitting migrations later — the note from the product overview ("Contract and Account both link to simulation") is handled by pointing both at one shared `simulation_runs` table, not by duplicating the concept per entity.

---

## 1. Identity & Organization Layer

```sql
CREATE TABLE users (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email              TEXT UNIQUE,
    username           TEXT UNIQUE,              -- optional public handle; NULL until set
    password_hash      TEXT,                     -- NULL for passwordless OAuth-only accounts
    avatar_url         TEXT,
    email_verified     BOOLEAN DEFAULT false,
    email_verified_at  TIMESTAMPTZ,
    password_changed_at TIMESTAMPTZ,             -- bump to invalidate outstanding refresh tokens
    created_at         TIMESTAMPTZ DEFAULT now(),
    updated_at         TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE user_oauth_accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider        TEXT NOT NULL,
    provider_id     TEXT NOT NULL,
    access_token    TEXT,
    refresh_token   TEXT,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(provider, provider_id),
    UNIQUE(user_id, provider)                     -- one linked identity per user per provider
);

-- Email verification tokens. One-time use, short-lived, hashed at rest.
-- users.email_verified / email_verified_at are the source of truth; this table
-- only tracks outstanding (unconsumed) tokens. expired_at is checked on use.
CREATE TABLE email_verification_tokens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL,                   -- SHA-256 of the raw token sent in email
    expires_at   TIMESTAMPTZ NOT NULL,
    consumed_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_email_verification_user ON email_verification_tokens(user_id);
CREATE INDEX idx_email_verification_expires ON email_verification_tokens(expires_at);

-- Password reset tokens. One-time use, short-lived, hashed at rest.
CREATE TABLE password_reset_tokens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    consumed_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_password_reset_user ON password_reset_tokens(user_id);

-- Refresh tokens. DURABLE in Postgres (never only in Redis — Redis is not a
-- source of truth, DB schema §11). Rotation: each refresh issues a new token
-- and marks the old one consumed. Revocation: logout / password change / admin
-- revokes outstanding rows. Redis `releeve:refresh:{token_id}` remains as a
-- fast-path cache of the DB row for hot auth checks.
CREATE TABLE refresh_tokens (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash     TEXT NOT NULL UNIQUE,          -- SHA-256 of the raw refresh token
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ NOT NULL,
    consumed_at    TIMESTAMPTZ,                   -- set on rotation (single-use)
    revoked_at     TIMESTAMPTZ,                   -- set on logout / password change
    replaced_by    UUID REFERENCES refresh_tokens(id),  -- the rotated-in token
    user_agent     TEXT,
    ip_address     TEXT
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_expiry ON refresh_tokens(expires_at);
```

---

## 2. Projects

```sql
-- One primitive for both "personal account" and "organization" — see Overview §6.
-- is_personal=true, unnamed, auto-created on signup; becomes a visible "org"
-- the moment it's renamed or a second member is added. No migration needed.
CREATE TABLE organizations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL,
  name            TEXT,                      -- NULL until explicitly renamed
  is_personal     BOOLEAN NOT NULL DEFAULT true,
  plan_tier       TEXT NOT NULL DEFAULT 'free',  -- denormalized view of the active subscription (populated in P6, §8.5)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Flat permission model — no named-role hierarchy. One row per member, permissions
-- as a bitmask (P1 middleware reads this per request; a membership row is required
-- for ANY {org}-scoped access). Bit positions (documented, stable, never reused):
--   bit 0 = create_projects, bit 1 = update_projects, bit 2 = delete_projects,
--   bit 3 = manage_members,  bit 4 = manage_access_tokens, bit 5 = manage_billing,
--   bit 6 = manage_fork_sessions (inert until P5)
CREATE TABLE organization_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permissions     SMALLINT NOT NULL DEFAULT 0,     -- bitmask, see above
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX idx_org_members_user ON organization_members(user_id);

-- API keys for programmatic/CI use. The raw token is shown once at creation;
-- only its SHA-256 hash is stored. id doubles as the token_id in auth headers
-- and Redis session keys. DELETE is a soft revoke (revoked_at).
CREATE TABLE access_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  token_hash      TEXT NOT NULL UNIQUE,
  created_by      UUID NOT NULL REFERENCES users(id),
  revoked_at      TIMESTAMPTZ,
  last_used_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_access_tokens_org ON access_tokens(organization_id);
CREATE INDEX idx_access_tokens_hash ON access_tokens(token_hash);

CREATE TABLE projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug            TEXT NOT NULL,
  name            TEXT NOT NULL,
  network         TEXT NOT NULL DEFAULT 'testnet', -- mainnet | testnet | futurenet — default scope for this project's monitored entities
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);
```

---

## 3. Destinations (Account-scoped and Project-scoped)

```sql
-- Account-scoped: Email, Slack, Telegram, Discord, Sentry, PagerDuty (reusable across all projects in org)
CREATE TABLE account_destinations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('email','slack','telegram','discord','sentry','pagerduty')),
  config          JSONB NOT NULL,            -- e.g. { "webhook_url": "...", "channel": "#alerts" }
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Project-scoped: Webhooks (v1), Actions (v2, reserved)
CREATE TABLE project_destinations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type              TEXT NOT NULL CHECK (type IN ('webhook','action')),  -- 'action' reserved for v2
  url               TEXT,                    -- webhook only
  signing_secret    TEXT,                    -- webhook only, HMAC SHA256 key
  timeout_seconds   INTEGER NOT NULL DEFAULT 5,
  max_retries       INTEGER NOT NULL DEFAULT 5,
  config            JSONB,                   -- 'action' type config, v2
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE destination_deliveries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id      UUID NOT NULL,          -- polymorphic: account_destinations.id or project_destinations.id
  destination_scope    TEXT NOT NULL CHECK (destination_scope IN ('account','project')),
  event_type          TEXT NOT NULL CHECK (event_type IN ('test','alert_fired')),
  alert_id            UUID REFERENCES alerts(id),  -- NULL for test events
  status              TEXT NOT NULL CHECK (status IN ('success','failed','pending','retry','skipped')),
  attempt             INTEGER NOT NULL DEFAULT 1,
  response_code       INTEGER,
  sent_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 4. Tags

```sql
CREATE TABLE tags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  color           TEXT,
  UNIQUE (project_id, name)
);

-- polymorphic attachment: a tag can apply to a wallet or a contract
CREATE TABLE tag_attachments (
  tag_id          UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('wallet','contract')),
  entity_id       UUID NOT NULL,             -- references wallets.id or contracts.id depending on entity_type
  PRIMARY KEY (tag_id, entity_type, entity_id)
);
```

---

## 5. Explorer Entities — Cached/Tracked Chain Data

These tables cache real chain data pulled via Soroban RPC / Horizon for entities a project actively tracks. Public lookups (untracked addresses) can bypass this cache and hit RPC directly, or populate it lazily — implementation detail, not a schema concern.

```sql
CREATE TABLE wallets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  address         TEXT NOT NULL,             -- G... (Stellar account) or C... in edge cases
  network         TEXT NOT NULL,
  last_synced_at  TIMESTAMPTZ,
  UNIQUE (project_id, address)
  -- Deliberately NO nft_holdings, NO multichain_assets columns — dropped per Overview §9
);

CREATE TABLE contracts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  address                 TEXT NOT NULL,     -- C...
  network                 TEXT NOT NULL,
  contract_type           TEXT NOT NULL DEFAULT 'contract' CHECK (contract_type IN ('contract','upgradeable_contract')),
  deployment_tx_hash      TEXT,
  deployment_timestamp    TIMESTAMPTZ,
  verification_status     TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('verified','unverified')),
  verification_type       TEXT,              -- public | private
  verified_at             TIMESTAMPTZ,
  rust_version            TEXT,
  soroban_sdk_version     TEXT,
  wasm_target             TEXT,
  opt_level               TEXT,
  wasm_opt_applied        BOOLEAN,
  debug_symbols_present   BOOLEAN NOT NULL DEFAULT false,  -- surfaced from simulation engine's DWARF pipeline once built
  current_wasm_hash       TEXT,
  last_synced_at          TIMESTAMPTZ,
  UNIQUE (project_id, address)
);

-- upgrade/proxy history — watches update_current_contract_wasm invocations
CREATE TABLE contract_wasm_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id     UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  wasm_hash       TEXT NOT NULL,
  tx_hash         TEXT NOT NULL,             -- the update_current_contract_wasm invocation that made this active
  effective_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE contract_source (
  contract_id             UUID PRIMARY KEY REFERENCES contracts(id) ON DELETE CASCADE,
  source_archive_url      TEXT,              -- pointer to stored source, not inlined here
  compiler_settings       JSONB,
  spec_xdr                TEXT,              -- Soroban contract spec (interface), base64
  creation_wasm_ref       TEXT,              -- pointer to blob storage
  deployed_wasm_ref       TEXT,
  source_map_ref          TEXT,              -- DWARF-derived source map, NULL until simulation engine's mapping pipeline exists
  source_map_status       TEXT NOT NULL DEFAULT 'not_available' CHECK (source_map_status IN ('not_available','pending','available'))
);

-- Contract source verification. A verification job takes a submitted source
-- archive + toolchain metadata, recompiles, and diffs the produced WASM hash
-- against the deployed contract's WASM. Status transitions:
--   submitted -> compiling -> verified | failed
-- Each attempt is a row so retries and failure reasons are visible.
-- contracts.verification_status is the denormalized "current" view.
CREATE TABLE contract_verifications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id           UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  submitted_by          UUID NOT NULL REFERENCES users(id),
  visibility            TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public','private')),
  status                TEXT NOT NULL DEFAULT 'submitted'
                        CHECK (status IN ('submitted','compiling','verified','failed')),
  source_archive_url    TEXT NOT NULL,        -- pointer to the submitted source bundle
  rust_version          TEXT,
  soroban_sdk_version   TEXT,
  wasm_target           TEXT,
  opt_level             TEXT,
  wasm_opt_applied      BOOLEAN,
  -- produced by the verification pipeline (Phase 2 ingest infra, Phase 3 UI):
  built_wasm_hash       TEXT,                 -- matches contracts.current_wasm_hash on success
  failure_reason        TEXT,                 -- human-readable compile/diff failure detail
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ
);
CREATE INDEX idx_contract_verifications_contract ON contract_verifications(contract_id, created_at DESC);
```

---

## 6. Transactions & Ledgers — Cached Real Chain Data

Real, already-happened transactions/ledgers, fetched via `getTransaction` / `getLedgerEntries` / Horizon and cached for fast repeated access (recall the RPC retention-window limit of 24h–7 days confirmed during research — this cache is also the practical answer to needing data older than that window, alongside considering Hubble for deep history later).

```sql
CREATE TABLE ledgers (
  sequence                BIGINT PRIMARY KEY,
  network                 TEXT NOT NULL,
  hash                    TEXT NOT NULL,
  parent_hash             TEXT,
  transaction_count       INTEGER,
  size_bytes              INTEGER,
  timestamp               TIMESTAMPTZ NOT NULL,
  base_operation_fee      NUMERIC,
  base_reserve            NUMERIC,
  total_cpu_instructions  BIGINT,
  resource_limit          BIGINT
  -- Deliberately NO blobs column — no Stellar equivalent (Overview §3.1.1)
);

CREATE TABLE transactions (
  hash                TEXT PRIMARY KEY,
  network             TEXT NOT NULL,
  ledger_sequence     BIGINT REFERENCES ledgers(sequence),
  status              TEXT NOT NULL CHECK (status IN ('success','failed')),
  source_account      TEXT NOT NULL,
  operation_type      TEXT NOT NULL,          -- payment | invoke_host_function | manage_offer | set_trust_line_flags | ...
  fee_charged         NUMERIC,
  sequence_number     TEXT,
  application_order   INTEGER,
  timestamp           TIMESTAMPTZ NOT NULL,
  -- resource usage, confirmed real fields from diagnostic core_metrics events
  cpu_instructions    BIGINT,
  memory_bytes        BIGINT,
  invoke_time_nsecs   BIGINT,
  disk_read_bytes     BIGINT,
  write_bytes         BIGINT,
  max_rw_key_byte     INTEGER,
  max_rw_data_byte    INTEGER,
  raw_result_meta_xdr TEXT,                    -- keep raw XDR for re-parsing if decoding logic changes
  raw_envelope_xdr    TEXT
);

CREATE TABLE tx_call_tree_nodes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_hash             TEXT NOT NULL REFERENCES transactions(hash) ON DELETE CASCADE,
  parent_node_id      UUID REFERENCES tx_call_tree_nodes(id),  -- NULL = root call
  contract_id         TEXT NOT NULL,
  function_name       TEXT NOT NULL,
  args                JSONB NOT NULL,           -- typed ScVal args, already decoded — no selector-hash lookup needed
  return_value        JSONB,
  depth               INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tx_state_changes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_hash             TEXT NOT NULL REFERENCES transactions(hash) ON DELETE CASCADE,
  caused_by_node_id   UUID REFERENCES tx_call_tree_nodes(id),
  entry_type          TEXT NOT NULL CHECK (entry_type IN ('contract_data','account','trustline','offer')),
  entry_key           TEXT NOT NULL,
  value_before         JSONB,
  value_after          JSONB
);

CREATE TABLE tx_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_hash             TEXT NOT NULL REFERENCES transactions(hash) ON DELETE CASCADE,
  contract_id         TEXT NOT NULL,
  topics              JSONB NOT NULL,           -- structured, natively typed
  data                JSONB NOT NULL
);

CREATE TABLE tx_fund_flow_edges (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_hash             TEXT NOT NULL REFERENCES transactions(hash) ON DELETE CASCADE,
  from_address        TEXT NOT NULL,
  to_address          TEXT NOT NULL,
  asset               TEXT NOT NULL,            -- "XLM" or "CODE:ISSUER" or SEP-41 contract id
  amount              NUMERIC NOT NULL
);

CREATE TABLE tx_comments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_hash             TEXT NOT NULL REFERENCES transactions(hash) ON DELETE CASCADE,
  target_type         TEXT NOT NULL CHECK (target_type IN ('call_node','state_change','event')),
  target_id           UUID NOT NULL,
  priority             TEXT CHECK (priority IN ('high','medium','low')),
  author_user_id      UUID NOT NULL REFERENCES users(id),
  body                TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

### 6.1 Network-wide feeds (latest blocks, latest transactions, top tokens, token transfers)

The **latest ledgers** and **latest transactions** feeds read straight from `ledgers` / `transactions` ordered by `sequence` / `timestamp` — no extra tables, just the composite ordering indexes in §9. The **token transfers** feed reads `tx_fund_flow_edges` (per-transaction transfer edges), joined to `transactions` for ordering. The **top tokens** feed is a maintained rolling aggregate over `tx_fund_flow_edges`, refreshed by the ingestion pipeline on a schedule; the top-N ranking is then cached in Redis (§11):

```sql
CREATE TABLE token_volume_stats (
  network          TEXT NOT NULL,
  asset            TEXT NOT NULL,            -- "XLM" | "CODE:ISSUER" | SEP-41 contract id
  window_start     TIMESTAMPTZ NOT NULL,     -- 24h / 7d / 30d bucket start
  window_seconds   INTEGER NOT NULL,
  volume           NUMERIC NOT NULL DEFAULT 0,
  usd_volume       NUMERIC,
  tx_count         BIGINT NOT NULL DEFAULT 0,
  active_accounts  BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (network, asset, window_start, window_seconds)
);
```

All four feeds are paginated (`limit` 20/50/100, cursor Next/Prev — API doc §5.5) and served from Redis with Postgres as fallback; these tables are the durable layer, never skipped.

**USD price dependency** (feeds `usd_volume`, account/contract `usd_value`): Stellar has no native price oracle; USD figures come from an external price feed (exchanges / oracle aggregators). Results are cached here — **never** fetched per request, and a missing/expired price is a `NULL` USD field, never a failed request (illiquid tokens legitimately lack prices, Overview §3.1):

```sql
CREATE TABLE token_prices (
  network      TEXT NOT NULL,
  asset        TEXT NOT NULL,              -- "XLM" | "CODE:ISSUER" | SEP-41 contract id
  price_usd    NUMERIC NOT NULL,
  source       TEXT NOT NULL,              -- which feed/provider produced this quote
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (network, asset)
);
```

This table is a cache of an external system of record, owned by the same ingestion pipeline that refreshes `token_volume_stats`. See P2 for the feed integration contract.

---

## 7. Alerts

```sql
CREATE TABLE alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  target_type     TEXT NOT NULL CHECK (target_type IN ('address','network','project','tag')),
  target_value    TEXT,                       -- NULL when target_type = 'project'
  match_logic     TEXT NOT NULL DEFAULT 'all' CHECK (match_logic IN ('all','any')),
  enabled         BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alert_expressions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id        UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  expression_type TEXT NOT NULL CHECK (expression_type IN (
    'successful_transaction','failed_transaction','tx_error','function_call','function_params',
    'event_emitted','event_parameter','token_transfer','allowlisted_callers','blocklisted_callers',
    'balance_change','transaction_value','state_change','view_function','no_action','token_transfer_matcher'
    -- 'sandwich_transaction' deliberately excluded — see Overview §5, §9
  )),
  params          JSONB NOT NULL              -- shape varies per type, see API design doc §6
);

CREATE TABLE alert_destinations (
  alert_id             UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  destination_id       UUID NOT NULL,          -- polymorphic
  destination_scope    TEXT NOT NULL CHECK (destination_scope IN ('account','project')),
  PRIMARY KEY (alert_id, destination_id, destination_scope)
);

CREATE TABLE alert_firings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id        UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  tx_hash         TEXT REFERENCES transactions(hash),  -- NULL if fired from a simulation (see §8)
  simulation_id   UUID REFERENCES simulation_runs(id), -- NULL if fired from a real transaction
  fired_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (tx_hash IS NOT NULL OR simulation_id IS NOT NULL)
);
```

---

## 8. Simulation Engine Linkage (schema reserved now, populated once fork-core ships)

**This is the section directly addressing your note: Contract and Wallet(Account) both link to simulation — modeled here as one shared table with two nullable foreign keys, not two separate simulation concepts.** Full engine design (what actually produces these rows) is in the companion doc; this schema section defines *how the platform stores and relates to* that output.

```sql
CREATE TABLE simulation_runs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- linkage points — a simulation is always ABOUT a contract, and optionally
  -- involves impersonating or acting as a specific account
  contract_id           UUID REFERENCES contracts(id),
  impersonated_wallet_id UUID REFERENCES wallets(id),   -- NULL if no impersonation used
  sender_wallet_id      UUID REFERENCES wallets(id),    -- the real or impersonated caller

  base_ledger_sequence  BIGINT NOT NULL,        -- which real ledger height this fork snapshot was taken from
  function_name         TEXT NOT NULL,
  args                  JSONB NOT NULL,

  overrides             JSONB NOT NULL DEFAULT '[]', -- [{ "type": "balance"|"storage", "target": "...", "value": "..." }]
  auth_impersonation    BOOLEAN NOT NULL DEFAULT false,
  timestamp_override    TIMESTAMPTZ,             -- fast-forward/rewind, mirrors erst's --timestamp

  status                TEXT NOT NULL CHECK (status IN ('pending','success','failed','error')),

  -- SAME shape as a real transaction's result data — deliberately reuses
  -- the tx_call_tree_nodes / tx_state_changes / tx_events / resource-usage
  -- pattern rather than inventing a parallel schema, since the whole point
  -- is that the UI treats simulated and real results identically.
  cpu_instructions      BIGINT,
  memory_bytes          BIGINT,
  disk_read_bytes       BIGINT,
  write_bytes           BIGINT,

  created_by            UUID NOT NULL REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- correctness-oracle bookkeeping (see simulation doc's verification strategy):
  -- for an UNMUTATED replay used as a regression check, this records whether
  -- it matched the real getTransaction result it was diffed against.
  is_verification_run   BOOLEAN NOT NULL DEFAULT false,
  matched_real_result   BOOLEAN,                -- NULL unless is_verification_run = true

  -- populated only once State Sync / persistent environments ship (v1.5+, P6);
  -- nullable, reserved from day one per the no-retrofitting principle
  fork_environment_id   UUID REFERENCES fork_environments(id)
);

CREATE TABLE simulation_call_tree_nodes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id       UUID NOT NULL REFERENCES simulation_runs(id) ON DELETE CASCADE,
  parent_node_id      UUID REFERENCES simulation_call_tree_nodes(id),
  contract_id         TEXT NOT NULL,
  function_name       TEXT NOT NULL,
  args                JSONB NOT NULL,
  return_value        JSONB,
  depth               INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE simulation_state_changes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id       UUID NOT NULL REFERENCES simulation_runs(id) ON DELETE CASCADE,
  caused_by_node_id   UUID REFERENCES simulation_call_tree_nodes(id),
  entry_type          TEXT NOT NULL,
  entry_key           TEXT NOT NULL,
  value_before         JSONB,
  value_after          JSONB,
  is_override          BOOLEAN NOT NULL DEFAULT false  -- true = this was a user-supplied cheatcode, not a natural execution result
);

CREATE TABLE simulation_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id       UUID NOT NULL REFERENCES simulation_runs(id) ON DELETE CASCADE,
  contract_id         TEXT NOT NULL,
  topics              JSONB NOT NULL,
  data                JSONB NOT NULL
);

-- Reserved for v1.5+, explicitly NOT built at MVP (see simulation doc):
-- a named, persistent environment that many simulation_runs can belong to,
-- with State Sync keeping it live-updated against real mainnet.
CREATE TABLE fork_environments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  base_ledger_sequence  BIGINT NOT NULL,
  state_sync_enabled    BOOLEAN NOT NULL DEFAULT false,
  is_public             BOOLEAN NOT NULL DEFAULT false,   -- exposes a read-only shareable view, mirrors Tenderly's public Virtual TestNet explorer
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Why this shape, explicitly:**
- `simulation_runs.contract_id` is never null — every simulation is fundamentally about one contract invocation. This is what powers the Contract page's Simulations tab (`GET .../contracts/{address}/simulations` filters `WHERE contract_id = ...`).
- `sender_wallet_id` and `impersonated_wallet_id` are separately nullable because a simulation can be run as yourself (no impersonation) or as someone else (auth bypass) — both cases still populate `sender_wallet_id` (who it executes *as*), only `impersonated_wallet_id` distinguishes "this wasn't really you." This is what powers the Account page's Simulations tab, filtered by either column depending on what the user is looking at ("simulations run BY me" vs. "simulations that impersonated ME").
- The `simulation_*` tables intentionally mirror `tx_*` tables field-for-field where possible — this isn't duplication for its own sake, it's what lets the frontend render both with **one shared component**, satisfying the "same Transaction-detail-page UI, fed by either data source" goal from the product overview.

---

## 8.5 Billing & Plan Tiering (reserved — schema present from day one, populated in P6)

Same "reserve now, populate later" principle as `simulation_*`. P6 (`phases/phase6.md`) is when these get real data and the provider abstraction lands; defining the tables now means P6 is a pure feature phase with zero schema retrofit. `organizations.plan_tier` remains the fast denormalized view.

```sql
CREATE TABLE plans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key               TEXT NOT NULL UNIQUE,        -- 'free' | 'pro' | 'team' | ...
  name              TEXT NOT NULL,
  price_monthly_usd NUMERIC,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  features          JSONB NOT NULL DEFAULT '{}'  -- capability flags consumed by the tier-gating matrix
);

CREATE TABLE subscriptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id           UUID NOT NULL REFERENCES plans(id),
  status            TEXT NOT NULL CHECK (status IN ('trialing','active','past_due','canceled')),
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  provider          TEXT,                        -- 'stripe' | 'opencollective' | null (manual)
  provider_subscription_id TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_subscriptions_org ON subscriptions(organization_id);

CREATE TABLE billing_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,                 -- 'plan_changed' | 'payment_succeeded' | 'payment_failed' | 'invoice_created' | ...
  provider        TEXT,
  provider_event_id TEXT,
  payload         JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_billing_events_org ON billing_events(organization_id, created_at DESC);
```

---

## 9. Indexes (non-exhaustive, the load-bearing ones)

```sql
CREATE INDEX idx_transactions_source_account ON transactions(source_account);
CREATE INDEX idx_transactions_ledger ON transactions(ledger_sequence);
CREATE INDEX idx_tx_call_tree_contract ON tx_call_tree_nodes(contract_id);
CREATE INDEX idx_simulation_runs_contract ON simulation_runs(contract_id);
CREATE INDEX idx_simulation_runs_sender ON simulation_runs(sender_wallet_id);
CREATE INDEX idx_simulation_runs_impersonated ON simulation_runs(impersonated_wallet_id);
CREATE INDEX idx_alert_firings_alert ON alert_firings(alert_id, fired_at DESC);
CREATE INDEX idx_wallets_address ON wallets(address);
CREATE INDEX idx_contracts_address ON contracts(address);

-- auth token lookups (hash lookup on use; user-scoped scans on revoke/password change)
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_email_verification_user ON email_verification_tokens(user_id);
CREATE INDEX idx_password_reset_user ON password_reset_tokens(user_id);

-- alert evaluation: same (alert, tx) never fires twice — backing index + partial unique guard
CREATE UNIQUE INDEX uq_alert_firing_dedupe ON alert_firings(alert_id, tx_hash) WHERE simulation_id IS NULL;

-- pagination & feed ordering — keyset cursors encode a sort key + a stable id,
-- so these composite indexes back both cursor movement and the "latest X" feeds
CREATE INDEX idx_transactions_network_time ON transactions(network, timestamp DESC, hash);
CREATE INDEX idx_ledgers_network_seq ON ledgers(network, sequence DESC);
CREATE INDEX idx_tx_events_contract ON tx_events(contract_id, id);
CREATE INDEX idx_tx_fund_flow_asset ON tx_fund_flow_edges(asset, tx_hash);
CREATE INDEX idx_token_volume_window ON token_volume_stats(network, window_start DESC, volume DESC);
CREATE INDEX idx_wallets_network_address ON wallets(network, address);
CREATE INDEX idx_contracts_network_address ON contracts(network, address);
CREATE INDEX idx_token_prices_lookup ON token_prices(network, asset, updated_at DESC);
```

---

## 10. Explicit Non-Goals in This Schema (matching product decisions)

- No `nft_holdings` or `nft_collections` tables — no stable Soroban NFT standard yet (Overview §9).
- No `multichain_assets` table — solves an EVM-fragmentation problem Stellar doesn't have.
- No `blobs` column on `ledgers` — no Stellar equivalent.
- No per-opcode trace table (e.g., no `tx_opcode_steps`) — deliberately not displaying that granularity; `tx_call_tree_nodes` + `tx_state_changes` is the correct altitude for Soroban.
- No `account_abstraction_authorizations` table — Stellar never had the EOA/contract split this patches.

---

## 11. Redis — Caching & Hot-Path Layer

Postgres is the system of record. Redis is an auxiliary cache/queue for hot read paths and high-frequency operational state. **Nothing in Redis is the source of truth for survivable data** — every key is safely rebuildable from Postgres or from RPC/Horizon, and a Redis flush degrades latency, never correctness.

### 11.1 Where Redis is used, and why it belongs there

| Concern | Redis key pattern | Why Redis (not Postgres) | Freshness / TTL |
|---|---|---|---|
| Network feed cache | `releeve:feeds:latest_ledgers:{network}`, `releeve:feeds:latest_transactions:{network}`, `releeve:feeds:top_tokens:{network}:{window}`, `releeve:feeds:transfers:{network}:{window}` | Same feed served to every user on every dashboard load; building it per-request from Postgres/RPC is wasteful. Built once per refresh tick, served many times. | TTL ~5–15s (ledgers/transactions), ~60s (top tokens/transfers) |
| Ledger header cache | `releeve:ledger:{network}:{seq}` | Headers are immutable once closed and re-read constantly (block detail, parent links). Perfect TTL cache, can never go stale. | Long TTL, LRU-bounded |
| Transaction detail cache | `releeve:tx:{network}:{hash}` | Decoded tx + call tree is expensive to rebuild and re-read on every explorer visit. | TTL 1–24h; invalidate on decode-version bump |
| Account / contract profile cache | `releeve:account:{network}:{addr}`, `releeve:contract:{network}:{addr}` | Balances/holdings/metadata change at ledger cadence, not per-request. | TTL 5–30s, or invalidate on `last_synced_at` change |
| Top-token aggregate cache | `releeve:tokens:top:{network}:{window}` | Precomputed ranking from `token_volume_stats` (§6.1). | TTL 60s+ |
| Rate limiting / quota | `releeve:ratelimit:{scope}:{key}` | Public explorer endpoints can trigger upstream RPC calls; enforce per-IP / per-access-token / per-quota limits cheaply with sliding-window counters. | Sliding window |
| Session / refresh-token cache | `releeve:session:{token_id}`, `releeve:refresh:{token_id}` | Fast auth checks and instant revocation without a Postgres hit per request. **Cache only** — the durable, canonical row is `refresh_tokens` in Postgres; a Redis flush must not invalidate valid refresh tokens (it would log everyone out). | Session TTL; DB is canonical |
| Webhook delivery queue + dedupe | `releeve:delivery:queue`, `releeve:delivery:{id}:lock`, `releeve:delivery:{id}:seen` | At-least-once fan-out with retry (max 5) without hammering `destination_deliveries`; the `seen` key prevents double-send on retry. The DB row stays the source of truth for delivery status. | Job TTL; DB is canonical |
| Sync worker coordination | `releeve:sync:watermark:{network}`, `releeve:sync:lock:{network}` | Single-writer marker so exactly one ingestion worker owns a ledger range. Watermark is a cache of a monotonically increasing value, rebuildable by `max(sequence)`. | Volatile |

**Invalidation rule:** cache entries are keyed off Postgres truth — a change to `updated_at` / `last_synced_at` on the source row, or a new ledger/tx arriving past the sync watermark, is the trigger to refresh or drop the corresponding key. Never write-through from a request handler as the source of truth.
