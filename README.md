# BallMill Ops

Operations-only ERP for the ball mill plant: orders, weighments, mill runs, batches, numbered QR bags,
dispatch by scanning, maintenance, resin lining wear, roles with PINs and an audit trail. No finance.

## Set up (new project)
1. Supabase SQL editor: run `schema.sql`, then `migration_v2.sql`.
2. Authentication > Users > Add user, for each person: email `username@ops.local`, password = their PIN
   (6+ characters), tick "Auto Confirm User". The FIRST user created becomes admin.
3. Open the app, sign in with just `username` and PIN. Admin gives others a role under Team.
4. Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (anon key only). Redeploy after changing.

## Upgrading the live app
1. Run `migration_v2.sql` in the Supabase SQL editor (safe to re-run). Your oldest existing user becomes admin,
   other existing users become Pending until an admin assigns a role.
2. Push this code to GitHub; Render rebuilds automatically. Existing admin can still sign in with their full email.

## Roles
Admin: everything, including delete, Team and Audit. Supervisor: orders, masters, edits. Weighbridge: weighments and dispatch.
Operator: mill runs, batches, packing bags. Maintenance: assets, schedules, logs, lining. Viewer: read only.
Permissions are enforced in the database (row level security), the tabs just follow them.

## Bags and QR
Bag numbers look like `NG-261027-0042` (IST date + running number). The QR holds only the bag number.
Phone camera scanning needs https (Render is). A USB barcode scanner also works: click the bag box and scan.
