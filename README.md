# BallMill Ops (Nova Geo Resources)

Operations-only ERP for the ball mill plant: orders, weighments, mill runs, batches and lab results, QR-labelled bags, dispatch with invoice / e-way bill, maintenance, resin lining, spares, plant log. Finance stays in the separate ERP. React + Vite + Supabase, hosted on Render.

## 1. Database (Supabase > SQL editor), run in this order
1. `schema.sql` (only on a brand-new project)
2. `migration_v2.sql` (roles, audit trail, batches, bags, dispatch)
3. `migration_v3.sql` (spec checks, invoice/e-way, spares, plant log, offline helpers, photos bucket)
4. `migration_v4.sql` (mesh sizes, inbound/outbound paperwork, licences, vehicles, stock counts)
5. `migration_v5a_lab_role.sql` (adds the lab role). **Run this alone, as its own query**, then:
6. `migration_v5.sql` (lab reports, public bag certificate)
7. `migration_v6.sql` (QC by bag, 1 kg pouches, standard maintenance checklist, upload storage re-check)
8. `migration_v7.sql` (links to the finance ERP)
9. `migration_v8.sql` (washing plant, mineral stock account, worker health, monitoring, incidents, statutory returns)

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
admin, supervisor, weighbridge, operator, maintenance, lab, viewer. Dispatch weighments are made only through the Dispatch page (admin, supervisor, weighbridge). QC hold is set by admin or supervisor and blocks dispatch of that batch.

## 7. Mesh sizes
Masters > Grades holds the product family (for example "A grade"); Masters > Mesh sizes holds its sizes (200, 325, 500...). Orders, mill runs and batches choose the grade, then the mesh. Limits can be set per grade, per mesh, or per order (order wins, then mesh, then grade). Dispatch warns if a bag's mesh differs from the order's.
If your grades are currently named like "200 mesh A grade", rename them to "A grade": the migration turned the old mesh value into a mesh row, so the label would otherwise read "200 mesh A grade - 200 mesh".

## 8. Paperwork
- Inbound weighment: supplier invoice no./date, transit permit no./quantity/validity, e-way bill, and uploads (PDF or photo, up to 8 MB). The app flags a load when net weight differs from the permit quantity by more than the limit (Masters > Settings, admin only, default 3%) or when the permit had expired.
- Outbound: invoice and e-way numbers at dispatch, files attached from the Dispatch list ("Attach files") or Weighments > Papers.
- Weighments missing papers show on the dashboard and in the Compliance report; Telegram flags them a day after weighing.
- Masters > Suppliers holds the mining lease number and expiry, Masters > Licences the plant approvals; both alert at 30 days, 7 days and when expired. Masters > Vehicles remembers usual tare weights. Plant log > Stock count records physical counts against system stock.
Uploads need signal; the numbers and weights can be saved offline and files attached later.

## 9. Lab reports and bag QR certificates
- QC > Lab reports: enter results from your own lab, or upload a PDF/photo from an outside lab (or both on one report). A lab technician saves it as a draft, an admin or supervisor approves it, and it is then locked (only admin can reopen).
- The newest approved report for a batch fills that batch's SiO2, Fe2O3, moisture, whiteness and test date automatically. Removing or reopening the last approved report does not revert those batch values.
- "Report PDF" on any row makes a Certificate of Analysis against the grade/mesh/order limits.
- Bag labels now carry a QR that opens `/#/c/<bag>/<token>`: a public page (no login) showing product, batch, lab results and a PDF download. It shows no customer, order or supplier details, and shows "under review" for batches on QC hold. **Reprint labels** to get the new QR; old labels still scan inside the app.

## 10. Users tab (Team)
Admin > Team: add people (username, name, role, PIN), change roles, reset a PIN, block or unblock. This needs one edge function:
1. Supabase dashboard > Edge Functions > create a function named `admin-users`, paste `supabase/functions/admin-users/index.ts`, deploy with **Verify JWT OFF** (browsers cannot pass the check on the preflight request; the function verifies the admin itself).
2. Nothing else to configure: it uses the project's own service key. Only active admins can call it.
Until it is deployed, the page still lets you change roles of people who signed up themselves; Add person, Reset PIN and Block will say the function is not set up.

## 11. Tabs (v6)
Dashboard (raw material, shipped out, in stock, plus what needs attention) / Orders / Shipments (inbound quartz, outbound goods with bag scan and weighbridge comparison) / QC (lots, lab reports, 1 kg pouches, PDF reports) / Bags (stock in and out, packing, trace) / Plant Logs (mill runs, mill feed, downtime, handover notes, dust, stock counts) / Maintenance (due list, log, schedules, assets, mill lining) / Spares / Masters / Team / Audit.
Each role only sees the tabs it needs; admin, supervisor and viewer see all.

## 12. QC pouches and bag-level reports
- QC > Pouches: pick a lot and create a 1 kg pouch record for every bag (same serial number as the bag), or one bag at a time. Pouch labels carry the same QR as the bag.
- QC > Lab reports: choose a lot and optionally a bag. A report with a bag selected shows on that bag's QR page; a lot report fills the lot's values and is shown for all other bags of the lot.
- QC > Reports: PDFs named with the lot and bag numbers (lot certificate, bag certificate, register of all lots).

## 13. Maintenance checklist
migration_v6.sql loads about 50 standard checks (mills, motors, gearboxes, bearings, bag filter, cyclone, fan, conveyors, magnetic separator, packing, weighbridge, compressor, panels) with usual intervals. Maintenance > Due: enter the date each was last done and the next date appears; tasks without a date show "set date" and are not counted as overdue. Change intervals under Schedules.

## 14. If files do not save with a weighment
Team > Check file uploads tests the storage bucket step by step and says what to fix. Usual fix: run migration_v4.sql and migration_v6.sql in the Supabase SQL editor, and check Storage shows a "photos" bucket.
Add person and Reset PIN need the `admin-users` function (Supabase rejects fake emails on normal sign-up). If Add person shows a CORS error, open the function in Supabase and switch Verify JWT off, then redeploy. Block/Unblock work without it.

## 15. Finance link (read-only)
Lets the ops app read suppliers, customers and purchases from the finance ERP's Supabase project. It never writes to finance, and only these three tables are readable.
1. In the **ops** Supabase project: Edge Functions > create `finance-link`, paste `supabase/functions/finance-link/index.ts`, deploy with **Verify JWT OFF**.
2. Edge Functions > Secrets: add `FINANCE_URL` (finance project URL) and `FINANCE_KEY` (finance project's service_role key). The key stays on the server.
3. Run `migration_v7.sql` in the ops SQL editor.
4. Masters > Finance link: link or import suppliers and customers (matched by name, then remembered by finance ID).
5. On an inbound weighment, pick the supplier, then the finance purchase/bill. The form shows billed vs received tonnes, and Shipments > Inbound shows a Purchase check table (red when the difference is over the permit limit, default 3%). A bill split over several trucks is added up.
The finance app now has a `customers` table (finance script `002_compliance.sql`), so importing customers works once that script has run there. Sales invoices also live in finance now (`sales_invoices`); the invoice number at dispatch is still typed here, and a picker can be added to this function later.

## 16. Washing plant and compliance (v8)
Run `migration_v8.sql`. Then:
- **Plant Logs › Washing plant**: one entry per shift with raw quartz fed, washed quartz out, rejects (mud, clay,
  fines to the pond), water used and recycled, power. Shows recovery %, water and power per tonne. Works offline.
  Out more than in (with 5% allowance) is refused.
- **Masters › Settings**: set the Mineral Dealer Licence number and the date from which mill feed is taken from
  the washed heap (`washing_tracked_from`; before it, mill feed counts against the raw yard).
- **Compliance** (new page):
  - *Overview*: one checklist of everything an inspector or auditor looks at (licences, returns due, document
    gaps on loads, negative stock, worker medicals, respirators, monitoring above limits, unreported incidents).
  - *Mineral account*: the daily account the Mineral Dealer rules ask for (received, fed to washing / mills,
    washed out, powder made, despatched, opening and closing stock of raw, washed and powder, rejects), with
    gaps flagged (no permit, over-permit loads, dispatch without invoice / transit pass / e-way bill).
    Download as PDF (with the receipt and despatch lists) or CSV for the AD Mines return.
  - *Returns & dates*: recurring duties (mineral return, Form V environment statement, hazardous waste return,
    dust monitoring, factory annual return, weighbridge stamping, CEIG, fire, mock drill), pre-filled with a starter
    list. "Mark done" records the acknowledgement and moves the due date forward. Licences are listed too; a
    checklist of standard licences is added to Masters › Licences (fill the numbers and dates).
  - *Workers & health*: silica-exposure register. Each worker's area, exposure, respirator issue, training and
    medical schedule; medical exams (X-ray, lung function, fit / unfit, silicosis suspected). **Medical details
    are visible only to admins and supervisors**; viewers see only who is due.
  - *Monitoring*: workplace dust and free silica, stack, ambient air, noise, wash water, groundwater, with limits;
    results above the limit are flagged.
  - *Incidents*: injuries, near misses, dangerous occurrences, with root cause and corrective action. Every role
    can report (also offline); serious ones not reported to the authority are flagged.
- **Dispatch** documents now take the mineral transit pass number.
- The Telegram alerts also warn about returns falling due, overdue medicals and unreported serious incidents.
- Dashboard shows raw and washed stock separately and the compliance items that need action.
- Tests: `node tools/test-mineral.mjs` checks the stock account maths and the document checks.

The forms, due dates and frequencies in the starter list follow the usual Telangana / Andhra Pradesh practice;
confirm them with your AD Mines office, pollution board consent order and Factories inspector, and edit them under
Compliance › Returns & dates.
