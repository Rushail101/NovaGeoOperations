-- BallMill Ops v5, step 1 of 2: add the "lab" role. Run this ALONE first (SQL editor > Run),
-- then run migration_v5.sql in a second run. (Postgres cannot use a new enum value in the same run that adds it.)
alter type app_role add value if not exists 'lab';
