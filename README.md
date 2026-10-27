# BallMill Ops (Nova Geo Resources)

Operations-only ERP for the ball mill plant: orders, weighments, mill runs, batches and lab results, QR-labelled bags, dispatch with invoice / e-way bill, maintenance, resin lining, spares, plant log. Finance stays in the separate ERP. React + Vite + Supabase, hosted on Render.

## 1. Database (Supabase > SQL editor), run in this order
1. `schema.sql` (only on a brand-new project)
2. `migration_v2.sql` (roles, audit trail, batches, bags, dispatch)
3. `migration_v3.sql` (spec checks, invoice/e-way, spares, plant log, offline helpers, photos bucket)

Each migration can be re-run safely. Then in Authentication > Providers > Email turn **off** "Confirm email". The first person to sign up becomes **admin**; give the admin a long password (12+ characters), not a short PIN.

## 2. Render
Static Site. Build command `npm install && npm run build`, publish directory `dist`. Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Redeploy after changing them.

## 3. Install on phones (works offline)
- Android / Chrome: open the site, menu > Install app (or the "Install app" button in the side menu).
- iPhone / Safari: Share > Add to Home Screen.
Open the app once with signal so it can save itself and your lists on the phone.

## 4. What works with no signal
Saved on the device and sent automatically when signal returns: weighments, mill runs, packing bags, dispatch, maintenance "mark done", logs, downtime, notes, dust, stock movements. Bag numbers come from a block reserved while online, and the bag list is cached so scanning works offline.
Needs a connection: editing or deleting existing records, creating batches, photos, reports, team admin. The pill at the top shows Online / Offline and how many entries are waiting.

## 5. Daily backup and Telegram alerts (GitHub Actions)
Put this folder in a **private** GitHub repo. Repo > Settings > Secrets and variables > Actions, add:
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Supabase > Project settings > API, the service_role key; never put it in Render or the app),
`TELEGRAM_BOT_TOKEN` (create a bot with @BotFather), `TELEGRAM_CHAT_ID` (message the bot, then open `https://api.telegram.org/bot<token>/getUpdates`).
- `backup.yml` runs daily and keeps the JSON backup as a downloadable artifact for 30 days.
- `alerts.yml` runs every 30 min: overdue maintenance, orders past due, low spares, QC holds, breakdowns, lining repair/relining, mill down over 2 h, and an 8 am IST summary. Each alert is sent once.
Test locally: `npm run test:tools`. Run by hand: Actions tab > pick workflow > Run workflow.

## 6. Roles
admin, supervisor, weighbridge, operator, maintenance, viewer. Dispatch weighments are made only through the Dispatch page (admin, supervisor, weighbridge). QC hold is set by admin or supervisor and blocks dispatch of that batch.
