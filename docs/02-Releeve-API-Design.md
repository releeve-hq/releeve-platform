# Releeve — Platform API Design

**Status:** Living document. Covers the platform API (explorer, monitoring, org/project/member management). The simulation engine's own internal API is designed separately in `04-Releeve-Simulation-Engine.md` and integrates here through the reserved endpoints marked **[SIM-HOOK]** below — those routes are stubbed now, implemented once the fork-core is proven standalone (per the phased build plan).

**Style:** REST, JSON, resource-oriented, modeled closely on Tenderly's own API shape (`{account}/{project}/...` scoping) since that pattern is well-proven for this exact product category and matches the Organization → Project hierarchy already decided.

**Base path convention:** `/api/v1/{org_slug}/{project_slug}/...` for project-scoped resources; `/api/v1/{org_slug}/...` for org-scoped resources; `/api/v1/me/...` for the authenticated user.

**Pagination (applies to every list endpoint below):** page size is chosen with `?limit=` — allowed values `20` (default), `50`, `100`. Movement between pages uses an opaque, keyset-based cursor (`?cursor=`) so both **Next** and **Prev** work: every list response carries `pagination.next_cursor` and `pagination.prev_cursor`. Omit `cursor` for the first page; use `prev_cursor` to walk back. Lists default to newest-first unless a specific endpoint says otherwise.

```json
{
  "data": [ /* items, at most `limit` */ ],
  "pagination": {
    "limit": 20,
    "next_cursor": "eyJzb3J0IjoiMjAyNi0wNy0zMVQwOTozMDowMFoiLCJpZCI6InV1aWQifQ==",
    "prev_cursor": null
  }
}
```

Cursor semantics: cursors are opaque to clients — they encode the last-seen sort key + a stable id (never an offset), so pages don't shift when new rows arrive. A `limit` outside `20|50|100` is clamped to the nearest allowed value.

---

## 1. Auth & Identity

- `POST /api/v1/auth/signup` — creates a user **and** auto-creates their personal Organization (unnamed internally, behaves as personal account — see Overview §6). Email verification required (token emailed); account usable in a read-only/basic state until verified.
- `POST /api/v1/auth/login` — password login. Returns `{ access_token, refresh_token, user_id }`. Fails with a soft "email not verified" signal when `email_verified=false` (same error shape, distinct code).
- `POST /api/v1/auth/token/refresh` — **rotating** refresh: body `{ refresh_token }` (or HTTP-only cookie). Issues a new access+refresh pair, marks the old refresh token consumed (`consumed_at`), sets `replaced_by`. Reuse of a consumed token is rejected (rotation-reuse detection — a leaked token can't be replayed after the first refresh). Redis fast-path is advisory; Postgres `refresh_tokens` is canonical.
- `POST /api/v1/auth/logout` — revoke the current refresh token + invalidate Redis sessions. Idempotent.
- `POST /api/v1/auth/token/revoke` — body `{ refresh_token }`; revoke a specific token (e.g. "log out this device").
- `POST /api/v1/auth/verify` — body `{ token }`; confirms email (sets `email_verified`, `email_verified_at`, consumes token).
- `POST /api/v1/auth/resend-verification` — body `{ email }`; re-issues a verification token. **Rate-limited** (per user/email/IP — see §1.1).
- `POST /api/v1/auth/forgot-password` — body `{ email }`; issues a one-time password-reset token by email. Always returns success if the account exists (no user enumeration).
- `POST /api/v1/auth/reset-password` — body `{ token, new_password }`; consumes token, sets new password, bumps `password_changed_at` (revokes all outstanding refresh tokens).
- `POST /api/v1/auth/oauth/{provider}/start` — body `{ redirect_uri }`; returns `{ auth_url, state }` for `provider ∈ { github, google }` (v1 set; others addable later). CSRF `state` is stored (Redis, short TTL) and verified on callback.
- `GET /api/v1/auth/oauth/{provider}/callback?code=&state=` — exchanges code for provider identity; **links** to an existing account when the provider email matches (or when signed-in and linking), otherwise auto-provisions a new user. Issues the same token pair as login. See §1.1.
- `GET /api/v1/me` — current user profile (id, email, username, avatar_url, email_verified, created_at).
- `PATCH /api/v1/me` — update `{ name, username, avatar_url }`. `username` unique; conflict → 409.
- `POST /api/v1/me/password` — change password: body `{ current_password, new_password }`. Validates current password; bumps `password_changed_at` (revokes outstanding refresh tokens); OAuth-only accounts (no `password_hash`) → 400.
- `GET /api/v1/me/organizations` — list orgs the user belongs to

### 1.1 Auth semantics that must be consistent everywhere

- **Token storage:** raw access/refresh/verify/reset tokens are only ever returned once and only ever stored **hashed** (SHA-256) in Postgres. Never logged, never in Redis as the raw value.
- **Access token:** short-lived JWT (15m default). **Refresh token:** opaque, longer-lived (30d default, sliding), single-use, revocable, persisted in `refresh_tokens` (DB schema §1). Rotation + reuse detection as above.
- **Revocation points:** logout, explicit revoke, password change/reset, admin/user account actions. On each, mark `revoked_at`/`consumed_at` and delete the Redis session key.
- **Email verification gating:** a verified account is not required to *sign in*, but unverified accounts cannot create projects/orgs or run mutations (P1 enforces at the permission middleware layer). Verification token TTL 24h; resend cooldown ~60s.
- **OAuth account linking:** matching on verified provider email; if the email is already registered with a password, the provider link is added to that account (user may be prompted to confirm). A `UNIQUE(user_id, provider)` constraint in the schema prevents duplicate links.
- **Password reset / OAuth:** reset links sent by email regardless of how the account was created; if the account is OAuth-only (no `password_hash`), reset **sets** a password (converts to a hybrid account).

**Access tokens** (API keys, for programmatic/CI use — e.g., correctness-regression CI checks against the fork-core per the simulation doc):
- `GET /api/v1/{org_slug}/access-tokens` — paginated (`limit`, `cursor`)
- `POST /api/v1/{org_slug}/access-tokens` — requires `manage_access_tokens` permission
- `DELETE /api/v1/{org_slug}/access-tokens/{token_id}` — revoke (soft delete / `revoked_at`)

---

## 2. Organizations

- `GET /api/v1/{org_slug}`
- `PATCH /api/v1/{org_slug}` — rename (this is the moment an auto-created personal org becomes visibly "an org" to the user; no schema change occurs)
- `POST /api/v1/organizations` — explicitly create an additional org (gated by plan tier)
- `DELETE /api/v1/{org_slug}`

### 2.1 Members

Flat permission model — no named-role hierarchy, permissions are individually togglable per member (mirrors the confirmed Tenderly pattern):

- `GET /api/v1/{org_slug}/members` — paginated (`limit`, `cursor`)
- `POST /api/v1/{org_slug}/members/invite` — body: `{ email, permissions: [...] }`
- `PATCH /api/v1/{org_slug}/members/{member_id}` — body: `{ permissions: [...] }`. Requires `manage_members`.
- `DELETE /api/v1/{org_slug}/members/{member_id}`

**Permission enum** (see Overview §6 for rationale):
```
create_projects
update_projects
delete_projects
manage_members
manage_access_tokens
manage_billing
manage_fork_sessions   // Releeve-specific — gates who can run mutation/impersonation
```

### 2.2 Account-scoped Destinations

Reusable across every project in the org (Email, Slack, Telegram, Discord, Sentry, PagerDuty):

- `GET /api/v1/{org_slug}/destinations` — paginated (`limit`, `cursor`)
- `POST /api/v1/{org_slug}/destinations` — body: `{ type: "slack" | "email" | "telegram" | "discord" | "sentry" | "pagerduty", config: {...} }`
- `PATCH /api/v1/{org_slug}/destinations/{destination_id}`
- `DELETE /api/v1/{org_slug}/destinations/{destination_id}`
- `POST /api/v1/{org_slug}/destinations/{destination_id}/test`

### 2.3 Billing

- `GET /api/v1/{org_slug}/billing`
- `PATCH /api/v1/{org_slug}/billing/plan`

---

## 3. Projects

- `GET /api/v1/{org_slug}/projects` — paginated (`limit`, `cursor`)
- `POST /api/v1/{org_slug}/projects` — requires `create_projects`
- `GET /api/v1/{org_slug}/{project_slug}`
- `PATCH /api/v1/{org_slug}/{project_slug}` — requires `update_projects`
- `DELETE /api/v1/{org_slug}/{project_slug}` — requires `delete_projects`
- `POST /api/v1/{org_slug}/{project_slug}/transfer` — move project to a different org the user has `create_projects` on (mirrors Tenderly's transfer pattern; supported because Organization is a single schema, not two divergent entity types)

### 3.1 Project-scoped Destinations

- `GET /api/v1/{org_slug}/{project_slug}/destinations` — paginated (`limit`, `cursor`)
- `POST /api/v1/{org_slug}/{project_slug}/destinations` — body includes `type: "webhook"` (v1) or `"action"` (v2, reserved)
- `PATCH /api/v1/{org_slug}/{project_slug}/destinations/{destination_id}`
- `DELETE /api/v1/{org_slug}/{project_slug}/destinations/{destination_id}`
- `POST /api/v1/{org_slug}/{project_slug}/destinations/{destination_id}/test` — body: `{ tx_hash }` **or [SIM-HOOK]** `{ simulation_id }` (test against a real historical tx, or — Releeve enhancement over Tenderly — a simulated fork result)

**Webhook config shape:**
```json
{
  "type": "webhook",
  "url": "https://...",
  "signing_secret": "auto-generated, HMAC SHA256",
  "timeout_seconds": 5,
  "max_retries": 5
}
```
Delivery record shape (see DB schema doc for storage):
```json
{
  "id": "...",
  "destination_id": "...",
  "event_type": "TEST | ALERT_FIRED",
  "status": "success | failed | pending | retry | skipped",
  "attempt": 1,
  "response_code": 200,
  "sent_at": "...",
  "signature": "hmac_sha256(secret + payload + timestamp)"
}
```

---

## 4. Tags

Lightweight grouping, independent of Project membership, usable as an Alert Target (§7):

- `GET /api/v1/{org_slug}/{project_slug}/tags` — paginated (`limit`, `cursor`)
- `POST /api/v1/{org_slug}/{project_slug}/tags` — body: `{ name, color? }`
- `POST /api/v1/{org_slug}/{project_slug}/tags/{tag_id}/attach` — body: `{ entity_type: "wallet" | "contract", entity_id }`
- `DELETE /api/v1/{org_slug}/{project_slug}/tags/{tag_id}/detach/{entity_id}`

---

## 5. Explorer — Core Entities

All four entity types support two access modes, matching the confirmed Tenderly pattern:
- **Public lookup** — any address/hash/ledger is viewable read-only without being added to a project (`GET /api/v1/explorer/...`, no project scope).
- **Project-tracked** — added to a project for tagging, alerting, and simulation history (`GET /api/v1/{org_slug}/{project_slug}/...`).

### 5.1 Transactions

- `GET /api/v1/explorer/{network}/tx/{hash}` — public lookup
- `GET /api/v1/{org_slug}/{project_slug}/transactions?address=&contract=&function=&type=&since=&until=&limit=&cursor=` — newest-first, paginated (`limit`, `cursor`)

**Response shape** (fields sourced directly from confirmed Soroban RPC `getTransaction` structure):
```json
{
  "hash": "...",
  "network": "mainnet | testnet | futurenet",
  "status": "success | failed",
  "ledger": 3860074,
  "timestamp": "...",
  "source_account": "G...",
  "operation_type": "payment | invoke_host_function | manage_offer | set_trust_line_flags | ...",
  "fee_charged": "300",
  "sequence_number": "...",
  "application_order": 1,
  "resource_usage": {
    "cpu_instructions": 27627988,
    "memory_bytes": 1466596,
    "invoke_time_nsecs": 3032477,
    "disk_read_bytes": 0,
    "write_bytes": 292,
    "max_rw_key_byte": 88,
    "max_rw_data_byte": 152
  },
  "call_tree": [ /* nested invocation structure — see §5.1.1 */ ],
  "state_changes": [ /* before/after per ledger entry — see §5.1.2 */ ],
  "events": [ /* structured contract events — see §5.1.3 */ ],
  "fund_flow": [ /* directed graph edges — see §5.1.4 */ ]
}
```

#### 5.1.1 Call tree node shape
```json
{
  "contract_id": "C...",
  "function_name": "transfer",
  "args": [ { "type": "Address", "value": "G..." }, { "type": "I128", "value": "5000000000" } ],
  "children": [ /* recursive — cross-contract calls */ ]
}
```
Note: Soroban args are natively typed (`ScVal`), unlike EVM calldata — no selector-hash decoding step is required to populate this structure.

#### 5.1.2 State change shape
```json
{
  "entry_type": "contract_data | account | trustline | offer",
  "key": "...",
  "before": { /* raw or decoded value */ },
  "after": { /* raw or decoded value */ },
  "caused_by_call": "reference into call_tree node"
}
```

#### 5.1.3 Event shape
```json
{
  "contract_id": "C...",
  "topics": [ { "type": "Symbol", "value": "set_authorized" }, { "type": "Address", "value": "G..." } ],
  "data": { "type": "Bool", "value": true }
}
```

#### 5.1.4 Fund flow edge shape
```json
{ "from": "G...", "to": "G...", "asset": "USDC:G...", "amount": "500.0000000" }
```

- `GET /api/v1/explorer/{network}/tx/{hash}/search?q=...&scope=all|from|to|function|contract|file|comment|metric` — trace search, scopes confirmed from Tenderly's own search UI, adapted: `opcode` dropped (nothing displayed to search), `metric` added (Soroban-specific — search by resource metric name, e.g. `cpu_insn`)
- `POST /api/v1/{org_slug}/{project_slug}/transactions/{hash}/comments` — trace annotation, body: `{ target: {type, id}, text }`
- `POST /api/v1/{org_slug}/{project_slug}/transactions/{hash}/priority` — body: `{ target: {type, id}, level: "high" | "medium" | "low" }`

**[SIM-HOOK]** `GET /api/v1/{org_slug}/{project_slug}/transactions/{hash}/simulations` — list of fork-core replay runs based on this real transaction. Reserved, implemented once fork-core exists.

### 5.2 Accounts (Wallets)

- `GET /api/v1/explorer/{network}/account/{address}` — public lookup
- `GET /api/v1/{org_slug}/{project_slug}/accounts` — project-tracked accounts, paginated (`limit`, `cursor`)
- `GET /api/v1/{org_slug}/{project_slug}/accounts/{address}`
- `GET /api/v1/{org_slug}/{project_slug}/accounts/{address}/transactions?type=payments|invocations|trustline_offer|token_transfers&limit=&cursor=` — paginated (`limit`, `cursor`)
- `POST /api/v1/{org_slug}/{project_slug}/accounts` — add to project, body: `{ address, tags? }`

**Response shape:**
```json
{
  "address": "G...",
  "xlm_balance": "1234.5670000",
  "usd_value": "236.62",
  "token_holdings": [ { "asset": "USDC:G...", "balance": "...", "usd_value": "..." } ],
  "tags": ["prod-liquidator", "..."]
}
```
(No NFT holdings, no Multichain assets tab — deliberately dropped, see Overview §9.)

**[SIM-HOOK]** `GET /api/v1/{org_slug}/{project_slug}/accounts/{address}/simulations` — reserved.

### 5.3 Contracts

- `GET /api/v1/explorer/{network}/contract/{address}` — public lookup
- `GET /api/v1/{org_slug}/{project_slug}/contracts` — project-tracked contracts, paginated (`limit`, `cursor`)
- `GET /api/v1/{org_slug}/{project_slug}/contracts/{address}`
- `POST /api/v1/{org_slug}/{project_slug}/contracts` — add to project, body: `{ address, tags? }`
- `GET /api/v1/{org_slug}/{project_slug}/contracts/{address}/transactions` — paginated (`limit`, `cursor`)
- `GET /api/v1/{org_slug}/{project_slug}/contracts/{address}/events?type=&from_ledger=&to_ledger=&limit=&cursor=` — paginated (`limit`, `cursor`)
- `GET /api/v1/{org_slug}/{project_slug}/contracts/{address}/source` — returns Source / Compiler Settings / Spec (interface) / Creation WASM / Deployed WASM / **Source Map** (populated only once the DWARF pipeline from the simulation doc exists — until then returns `null` with a `status: "not_available"` field)
- `GET /api/v1/{org_slug}/{project_slug}/contracts/{address}/upgrades` — WASM hash history, for proxy/upgrade detection (watches `update_current_contract_wasm` invocations)
- `POST /api/v1/{org_slug}/{project_slug}/contracts/{address}/call` — Read/Write panel: body `{ function_name, args }`, query param `mode=simulate|run` (run = actually submit; simulate = dry-run via real `simulateTransaction`, **not** the fork-core — this is unmutated, real-state simulation, distinct from the fork-core's hypothetical-state simulation)

**Response shape (header fields):**
```json
{
  "address": "C...",
  "type": "contract | upgradeable_contract",
  "xlm_balance": "...",
  "deployment": { "tx_hash": "...", "timestamp": "..." },
  "verification": { "status": "verified | unverified", "type": "public | private", "timestamp": "..." },
  "toolchain": {
    "rust_version": "...",
    "soroban_sdk_version": "...",
    "wasm_target": "wasm32-unknown-unknown",
    "opt_level": "z",
    "wasm_opt_applied": true,
    "debug_symbols_present": false
  },
  "tags": ["..."]
}
```

**[SIM-HOOK]** `GET /api/v1/{org_slug}/{project_slug}/contracts/{address}/simulations` — reserved, primary landing spot for fork-core output (see companion doc §"Integration").

**Contract source verification** (submission + status — the missing half of the Source tab; DB tables `contract_verifications` + `contracts.verification_*`):
- `POST /api/v1/{org_slug}/{project_slug}/contracts/{address}/verify` — submit source for verification. Body: `{ visibility: "public"|"private", source_archive_url, toolchain: { rust_version, soroban_sdk_version, wasm_target, opt_level, wasm_opt_applied } }`. Kicks off an async verification job (recompile submitted source → diff produced WASM hash against `contracts.current_wasm_hash`). Returns `{ verification_id, status: "submitted" }`; response `202 Accepted`.
- `GET /api/v1/{org_slug}/{project_slug}/contracts/{address}/verifications` — paginated attempt history (each `contract_verifications` row: status `submitted|compiling|verified|failed`, `built_wasm_hash`, `failure_reason`, timestamps).
- `GET /api/v1/{org_slug}/{project_slug}/contracts/{address}/source` — as above; `verification.status` reflects the latest attempt (unverified until a verified attempt exists).

### 5.4 Ledgers

- `GET /api/v1/explorer/{network}/ledger/{sequence}`
- `GET /api/v1/explorer/{network}/ledger/latest`
- `GET /api/v1/explorer/{network}/ledgers` — latest ledgers (blocks) feed, newest-first, paginated (`limit`, `cursor`)

**Response shape:**
```json
{
  "sequence": 3860074,
  "hash": "...",
  "parent_hash": "...",
  "transaction_count": 6,
  "size_bytes": 167059,
  "timestamp": "...",
  "base_operation_fee": "0.00001",
  "base_reserve": "0.5",
  "aggregate_resource_usage": {
    "total_cpu_instructions": "...",
    "resource_limit": "...",
    "percent_used": 58
  }
}
```
(No `blobs` field — deliberately dropped, no Stellar equivalent.)

### 5.5 Network Feeds (public, cacheable — power in-app dashboards)

These feeds drive Releeve's own dashboard/home surfaces (latest activity, top tokens, recent transfers) so the product has immediate context without leaving the app. They are **public** (no project scope), **Redis-backed** (DB schema §11), and served as single-purpose, paginated surfaces — deliberately **not** a general-purpose browsing explorer (Overview §7). All follow the shared pagination envelope (`limit` 20/50/100, cursor Next/Prev), newest-first.

- `GET /api/v1/explorer/{network}/transactions/latest` — latest transactions feed; items are Transaction summaries (§5.1)
- `GET /api/v1/explorer/{network}/ledgers` — latest ledgers (blocks) feed (§5.4)
- `GET /api/v1/explorer/{network}/tokens/top?window=24h|7d|30d` — top tokens by rolling volume; item shape:

```json
{ "asset": "USDC:G...", "volume": "...", "usd_volume": "...", "tx_count": 0, "active_accounts": 0 }
```

- `GET /api/v1/explorer/{network}/transfers?asset=&window=` — token-transfer feed; items are fund-flow edges (§5.1.4) plus a `timestamp`

Data flow: RPC/Horizon/BigQuery → Postgres ingestion (`ledgers`, `transactions`, `token_volume_stats`) → Redis cache → API. A Redis flush never breaks these endpoints — the cache is advisory freshness, Postgres is the fallback.

---

## 6. Monitoring & Alerts

Composable expression model (adopted intentionally over 12 hardcoded templates — see Overview §5):

- `GET /api/v1/{org_slug}/{project_slug}/alerts` — paginated (`limit`, `cursor`)
- `POST /api/v1/{org_slug}/{project_slug}/alerts`
- `PATCH /api/v1/{org_slug}/{project_slug}/alerts/{alert_id}`
- `DELETE /api/v1/{org_slug}/{project_slug}/alerts/{alert_id}`
- `GET /api/v1/{org_slug}/{project_slug}/alerts/{alert_id}/history` — firing log, paginated (`limit`, `cursor`)

**Alert body shape:**
```json
{
  "name": "Blend liquidation state-change",
  "target": {
    "type": "address | network | project | tag",
    "value": "..."
  },
  "expressions": [
    { "type": "function_call", "params": { "function_name": "liquidate" } },
    { "type": "blocklisted_callers", "params": { "addresses": ["G..."] } }
  ],
  "match_logic": "all | any",
  "destinations": ["destination_id_1", "destination_id_2"]
}
```

**Expression type enum** (full mapping and adaptation notes in Overview §5):
```
successful_transaction
failed_transaction
tx_error
function_call
function_params
event_emitted
event_parameter
token_transfer
allowlisted_callers
blocklisted_callers
balance_change
transaction_value
state_change          // params: { contract_id, storage_key, condition: threshold|percentage|criteria|any_change }
view_function          // params: { contract_id, function_name, poll_interval_seconds, condition } — NOTE: incurs real simulateTransaction polling cost, not event-driven
no_action              // params: { contract_id, inactivity_window }
token_transfer_matcher
```
`sandwich_transaction` intentionally **not included** — deferred pending dedicated research into Stellar's mempool/consensus model (Overview §5, §9).

---

## 7. Reserved / Stubbed Simulation Endpoints (implemented per companion doc)

These routes are defined now so the platform's data model and UI don't need retrofitting later, but return `501 Not Implemented` (or are simply absent from the router) until the fork-core is built and proven standalone per the phased plan in `04-Releeve-Simulation-Engine.md`.

- `POST /api/v1/{org_slug}/{project_slug}/simulations` — body: `{ base_ledger?, contract_id, function_name, args, overrides: [{ type: "balance"|"storage", target, value }], impersonate?: "G..." }`
- `GET /api/v1/{org_slug}/{project_slug}/simulations?contract_id=&impersonated_address=&sender_address=` — simulation history, newest-first, paginated (`limit`, `cursor`); powers both the Contract and Account Simulations tabs (same underlying records, different filter — DB schema §8)
- `GET /api/v1/{org_slug}/{project_slug}/simulations/{simulation_id}` — same response shape as a Transaction (§5.1), since the intent is to reuse the identical Transaction-detail UI, just fed from simulated data
- `POST /api/v1/{org_slug}/{project_slug}/simulations/{simulation_id}/fork` — [v1.5+] promote a one-shot simulation into a persistent, named fork environment (State Sync territory — explicitly post-MVP per companion doc)

**Linkage points to remember when implementing (flagged per your explicit note that Contract and Account both connect to simulation):**
- Contract detail page's Simulations tab (`§5.3`) is fed by `GET .../simulations?contract_id=...`
- Account detail page's Simulations tab (`§5.2`) is fed by `GET .../simulations?impersonated_address=... OR sender_address=...`
- Both are the *same underlying simulation record*, just filtered by a different foreign key — do not model these as two separate simulation types in the DB (see DB schema doc §"Fork Sessions / Simulation Runs").
