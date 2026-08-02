# Phase 1 — Platform Skeleton (Auth, Org, Members, Projects, Access Tokens)

**Status:** Planned.
**Depends on:** Phase 0.
**Goal:** The **complete** identity + authorization layer from `../02-Releeve-API-Design.md` §1–§4 — including the auth surface the original plan under-specified: email verification, OAuth, rotating refresh tokens, logout/revocation, and password reset/change. Flat permissions, pagination on every list endpoint, and a permission middleware every later phase reuses.

---

## Features added in this phase

### Auth & identity (`releeve-api`)

- `POST /api/v1/auth/signup` — creates user **and** auto-creates the personal Organization (unnamed, `is_personal=true`) in one transaction. Issues an email-verification token (hashed at rest, TTL 24h) and enqueues the verification email. Account exists immediately but is flagged unverified.
- `POST /api/v1/auth/login` — password login (argon2 verify). Returns access + refresh tokens. Unverified accounts **may** sign in (read-only) but mutations are gated by the permission middleware (below).
- `POST /api/v1/auth/verify` — body `{ token }`; marks `email_verified=true`, `email_verified_at=now()`, consumes the token. Missing/expired/consumed token → 400 with a clear code.
- `POST /api/v1/auth/resend-verification` — body `{ email }`; issues a fresh token. Rate-limited per user/email/IP (60s cooldown) via the Redis rate-limiter.
- `POST /api/v1/auth/token/refresh` — **rotating refresh**: validates the presented refresh token against `refresh_tokens`, issues a new access+refresh pair, sets `consumed_at` + `replaced_by` on the old row. **Reuse detection:** presenting an already-consumed token is a security event → reject and revoke the whole chain (`revoked_at` on all rows sharing `user_id` + issuing chain). Access token short-lived JWT (15m); refresh 30d, sliding, single-use.
- `POST /api/v1/auth/logout` — revokes the current refresh token (`revoked_at`) and invalidates the Redis session. Idempotent.
- `POST /api/v1/auth/token/revoke` — body `{ refresh_token }`; revoke a specific token ("log out this device").
- `POST /api/v1/auth/forgot-password` — body `{ email }`; issues a password-reset token (hashed at rest, TTL 1h), emails the link. **Always returns success for a known-email request; unknown emails get the same response** (no user enumeration).
- `POST /api/v1/auth/reset-password` — body `{ token, new_password }`; consumes token, sets new password, bumps `password_changed_at` **and revokes all outstanding refresh tokens** for the user.
- `POST /api/v1/auth/oauth/{provider}/start` — body `{ redirect_uri }`; returns `{ auth_url, state }`. `state` is random, stored in Redis (TTL 10m), verified on callback. Providers: `github`, `google` (config: client id/secret per provider).
- `GET /api/v1/auth/oauth/{provider}/callback?code=&state=` — exchanges code for provider identity (token exchange + userinfo via the provider API). Account resolution: existing account with a verified matching email → **link** (`user_oauth_accounts`, `UNIQUE(user_id, provider)`); OAuth-only if no password hash → hybrid convert on later password set; otherwise **auto-provision** a new user (verified, since provider email is trusted) + personal org, same as signup. Issues the token pair.
- `GET /api/v1/me` — current user profile.
- `PATCH /api/v1/me` — update `{ name, username, avatar_url }`; `username` uniqueness enforced (409 on conflict).
- `POST /api/v1/me/password` — change password `{ current_password, new_password }`; bumps `password_changed_at`, revokes outstanding refresh tokens. OAuth-only accounts → 400.
- `GET /api/v1/me/organizations` — list orgs the user belongs to.
- **Email delivery (`releeve-api` mailer module):** SMTP via `lettre` (config: host/port/username/password/from). Transactional templates: verification, password reset, welcome. **In testcontainers tests, SMTP is replaced by a mailpit container** (capture + assert the email was sent and contains the right link) or the mailer is a trait with an in-memory fake. Never sent against real SMTP in CI.
- **Token hygiene rules (enforced everywhere):** raw tokens stored only hashed (SHA-256); JWT access tokens are signed, never stored; no token/password ever logged; Redis stores only opaque ids (token row id), never raw secrets.

### Access tokens (API keys for programmatic/CI use)

- `GET/POST/DELETE /api/v1/{org}/access-tokens`; raw token returned once at creation, only its hash stored (`access_tokens.token_hash`); `manage_access_tokens` gated; DELETE sets `revoked_at` (soft revoke).

### Organizations, Members, Projects

- `GET/PATCH/DELETE /api/v1/{org}`, `POST /api/v1/organizations` (additional org, plan-gated stub → 501 until P6 or a config flag).
- Members (`organization_members`, flat permissions): invite, list, patch permissions, delete; `manage_members` gated.
- Projects: `GET/POST /api/v1/{org}/projects`, project `GET/PATCH/DELETE`, `POST .../transfer` (gated by `create_projects` on the destination org).
- **Permission middleware:** per-request `{org}` resolution + flat permission bitmask; **adds the email-verified gate** — creating a project/org or managing members requires `email_verified=true` (403 `email_unverified` code). `manage_fork_sessions` column present and checked (no behavior yet — reserved for P5).
- **Pagination live on all list endpoints**: members, access-tokens, orgs, projects — `limit` 20/50/100 (default 20), `next_cursor`/`prev_cursor` via Phase 0 cursor utils, backed by keyset indexes.
- Redis-backed session/refresh cache (`releeve:session:*`, `releeve:refresh:*`) for fast auth checks + instant revocation. **Canonical state is Postgres** (`refresh_tokens`); a Redis flush only costs a cache miss.

---

## Testing

### Unit tests

- **Password hashing:** argon2 hash/verify round-trip; wrong password → auth error; hash cost parameters validated.
- **Email verification:** token issue → hash stored (raw never persisted); verify marks user verified and consumes token; expired/consumed/malformed token → 400; resend respects cooldown.
- **Password reset:** token issue/consume; reset sets new password and **revokes all outstanding refresh tokens**; unknown email and known email produce identical responses; expired token rejected.
- **Refresh rotation:** refresh issues a new pair and consumes the old row; **reuse of a consumed token is rejected and revokes the chain**; revoked token rejected; expired token rejected; refresh after password change (`password_changed_at` bump) rejected.
- **OAuth:** `start` returns state + provider URL and stores state with TTL; callback with bad/missing `state` → 400; code exchange error → 502 with no partial user; linking (existing verified email) creates exactly one `user_oauth_accounts` row (UNIQUE enforced); new-provider auto-provision creates user + personal org atomically; duplicate link → 409.
- **Signup:** personal org auto-creation (org + membership row with owner defaults, `is_personal=true`, unnamed) **and** verification token + email dispatch; rollback on any failure (org must not exist if email dispatch fails).
- **Permissions:** the flat matrix — every permission enum value maps to exactly one middleware decision; `email_unverified` gate blocks project/org creation but allows sign-in + read.
- **Access tokens:** raw token never persisted (only hash); `token_hash` lookup; revoked token rejected.
- **Pagination:** list queries return correct `limit`, `next_cursor`/`prev_cursor`; cursor round-trips to the right offset (keyset, not OFFSET).
- **Org rename:** renaming a personal org flips it to visible-org semantics with no schema change.

### Integration tests (testcontainers Postgres + Redis; SMTP via mailpit container or faked mailer)

- `signup` → user created, personal org + membership created atomically, verification email captured by mailpit (link present); **signup with failing email send → full rollback** (no org row).
- `verify` flow: signup → hit the emailed link → `GET /me` shows `email_verified=true`; re-verify → 400 (consumed).
- `login` → token pair; `GET /me` returns user; unverified user can sign in but `POST /projects` → 403 `email_unverified`; after verify → 200.
- `refresh` → new access+refresh; **reuse the old refresh token → 401 + the chain revoked**; `logout` → refresh no longer valid; `revoke` of a specific token → that token invalid, others still valid.
- `forgot-password` → email captured; unknown email → same 200 response, no email. `reset-password` → login with old password fails, new works; all previous refresh tokens rejected.
- `oauth/start` + `callback`: provider stub (wiremock) returns identity; **linking** case attaches to the existing account; **provision** case creates a new user+org; bad `state` → 400.
- `PATCH /me` username conflict → 409; `POST /me/password` wrong current → 401; correct → old refresh tokens invalidated.
- Access-token CRUD: create (only hash in DB), authenticate a request with the raw token, delete → token no longer works.
- Permission enforcement end-to-end: member without `can_update_projects` → `PATCH project` → 403; with it → 200.
- Member invite → appears in `GET /members`; patch permissions → next request reflects change; delete member → access revoked.
- Project create/read/update/delete/transfer, incl. transfer to an org the user lacks `create_projects` on → 403.
- Pagination on `GET /members`, `GET /projects`, `GET /access-tokens`: `limit=20` returns ≤20; walk forward with `next_cursor`, walk back with `prev_cursor`; `limit=1000` clamped to 100.
- Unauthenticated request → 401; revoked session/refresh token → 401.

---

## Commit patterns

Branch: `phase/1/<slug>`.

- `feat(auth): add signup with personal-org auto-creation and verification email`
- `feat(auth): add email verification and resend (rate-limited)`
- `feat(auth): add login and rotating refresh with reuse detection`
- `feat(auth): add logout and token revoke`
- `feat(auth): add forgot/reset password with token lifecycle`
- `feat(auth): add oauth start/callback for github and google`
- `feat(auth): add profile update and password change endpoints`
- `feat(mail): add smtp mailer with transactional templates`
- `feat(api): add org and project CRUD with permission gating`
- `feat(api): add member invite/patch/delete with flat permissions`
- `feat(api): add access-token management (hash at rest)`
- `feat(core): wire pagination into list queries via keyset cursors`
- `feat(api): add permission middleware with email-verified gate`
- `feat(api): add redis session cache and revocation`
- `test(auth): cover verify, oauth, rotation, revoke, reset, and permission matrix`

Rules (same as P0): tests in the same commit as the feature; migration changes alongside their consumers; `clippy -D warnings` clean; `.sqlx/` offline data regenerated with any new query.

---

## Checklist

**Pre-merge (every PR):**
- [ ] fmt/clippy/unit/integration green (P0 CI jobs)
- [ ] New route covered by an integration test; 401/403 paths tested
- [ ] Auth never logs or returns a raw token/password
- [ ] Refresh rotation + reuse-detection tested; logout/revoke tested
- [ ] Verify/resend/forgot/reset/oauth flows tested (mailpit or faked mailer)
- [ ] Pagination response includes `next_cursor` + `prev_cursor`
- [ ] OpenAPI spec updated
- [ ] `.env.example` updated (JWT secret, token TTLs, SMTP, OAuth client ids)

**Phase completion (Definition of Done):**
- [ ] Signup→verify→login→authed-request→refresh→logout(revoke) happy path works end to end
- [ ] OAuth sign-in works for both providers, including account linking
- [ ] Password reset/change flows work and revoke outstanding refresh tokens
- [ ] Flat permission model enforced on every P1 route; no route without a permission check
- [ ] Email-verified gate enforced on mutations
- [ ] All P1 list endpoints paginated (20/50/100, next/prev)
- [ ] Personal-org auto-creation verified atomic (incl. rollback on email failure)
- [ ] `manage_fork_sessions` column plumbed into the middleware (inert until P5)
- [ ] P2 can start: ingestion/feeds auth is already in place
