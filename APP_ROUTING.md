# Releeve App Routing And Domains

Releeve uses a split-domain product model.

- `releeve.xyz` is the public marketing website.
- `app.releeve.xyz` is the authenticated product application.
- `api.releeve.xyz` is the Platform API.
- `docs.releeve.xyz` is public documentation.
- `status.releeve.xyz` is service status.

Use `app.releeve.xyz` instead of `dashboard.releeve.xyz` because Releeve is not only a dashboard. The logged-in product includes home, simulator, virtual environments, explorer workflows, monitoring, alerts, debugger handoff, org/project settings, and later billing/admin surfaces.

The app root on `app.releeve.xyz` should resolve to the Home surface. In local development this is `/home`.

Primary app sections are real routes:

- `/home`
- `/simulator`
- `/virtual-environments`
- `/activity`
- `/alerts`
- `/wallets`
- `/contracts`
- `/docs`
- `/settings`
- `/explorer/:network`

`/dashboard` is legacy compatibility only. It should redirect to `/home`, and new code should not link to `/dashboard`.

The sidebar should navigate between pages, not swap large sections invisibly in place. The app shell may be shared, but each major section gets its own route so URLs are copyable, refresh-safe, and easy for support, docs, browser history, and future deep links.

The Home surface is a live overview. It shows latest ledgers and latest transactions, but it is not the paginated explorer. Pagination belongs on dedicated explorer/entity pages such as transaction, wallet/account, contract, and ledger views.
