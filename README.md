# PayForFortune

Game top-up storefront (Free Fire diamonds by default, editable from the admin
panel) using CashTap Checkout for payment.

## Local setup

```bash
npm install
cp .env.example .env   # fill in your CashTap keys and admin password
npm start
```

Visit `http://localhost:3000` for the storefront and `http://localhost:3000/admin`
for the admin panel (Basic Auth using `ADMIN_USER` / `ADMIN_PASSWORD`).

## Environment variables

| Var | Description |
| --- | --- |
| `CASHTAP_SECRET_KEY` | Secret key from CashTap Developers -> API Settings |
| `CASHTAP_WEBHOOK_SECRET` | Signing secret from the webhook endpoint you create in CashTap |
| `BASE_URL` | Public URL of this deployment (used for checkout redirect URLs) |
| `ADMIN_USER` / `ADMIN_PASSWORD` | Login for `/admin` |
| `PORT` | Defaults to 3000 |

## Deploying

1. Push this repo to GitHub.
2. Create a Render Web Service pointing at the repo (`npm install` build command,
   `npm start` start command).
3. Set the environment variables above in Render's dashboard (never commit real
   secrets to the repo).
4. Once deployed, set `BASE_URL` to the Render URL and add a webhook endpoint in
   CashTap pointing at `<BASE_URL>/webhooks/cashtap`, subscribed to
   `checkout.session.completed`, `checkout.session.expired`,
   `checkout.session.failed`.

## Admin panel

- Edit brand name, game name, and packages (id/name/price) — no redeploy needed,
  changes are saved to `data/config.json`.
- **Orders** tab: every checkout session with its live status.
- **Customers** tab: orders grouped by email with pending/completed/failed counts.
- Manually mark an order "fulfilled" once you've delivered the top-up.
