-- v8: washing plant, mineral stock account (Telangana / AP Mineral Dealer rules), worker health (silica),
-- environment & workplace monitoring, incidents, statutory returns. Safe to run more than once.
-- Run after migration_v7.sql.

-- ================= Washing plant =================
create table if not exists washing_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null default (now() at time zone 'Asia/Kolkata')::date,
  shift text check (shift in ('A', 'B', 'C')),
  hours numeric(5,2) check (hours is null or (hours >= 0 and hours <= 24)),
  feed_kg numeric(12,2) not null check (feed_kg > 0),          -- raw quartz taken from the yard
  washed_kg numeric(12,2) not null check (washed_kg >= 0),     -- clean quartz out (to the washed stock)
  rejects_kg numeric(12,2) not null default 0 check (rejects_kg >= 0),  -- mud, clay, fines to the pond / dump
  water_used_kl numeric(10,2),
  water_recycled_kl numeric(10,2),
  kwh numeric(10,1),
  supplier_id uuid references suppliers(id),
  lot_no text,
  operator text,
  notes text,
  recovery_pct numeric(6,2) generated always as (case when feed_kg > 0 then round(washed_kg * 100 / feed_kg, 2) end) stored,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz default now(),
  check (washed_kg + rejects_kg <= feed_kg * 1.05)   -- out cannot exceed in (5% allowance for moisture)
);
create index if not exists washing_runs_date_idx on washing_runs (run_date desc);

-- Mill feed comes from washed stock from this date (before it, straight from the raw yard)
insert into plant_settings (key, value) values ('washing_tracked_from', to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD'))
on conflict (key) do nothing;
insert into plant_settings (key, value) values ('mineral_state', 'Telangana') on conflict (key) do nothing;
insert into plant_settings (key, value) values ('mdl_no', '') on conflict (key) do nothing;

-- Stock counts can also cover the washed-quartz heap
alter table stock_counts drop constraint if exists stock_counts_location_check;
alter table stock_counts add constraint stock_counts_location_check check (location in ('raw_yard', 'washed_yard', 'unpacked_powder', 'packed_bags'));

-- Transit pass for dispatches (processed mineral leaving the premises)
alter table weighments add column if not exists transit_pass_no text;

-- Same as set_dispatch_docs, plus the mineral transit pass number
create or replace function set_dispatch_docs(p_id uuid, p_invoice text, p_eway text, p_transporter text, p_lr text, p_transit text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('{admin,supervisor,weighbridge}'::app_role[]) then raise exception 'Not allowed'; end if;
  update weighments set invoice_no = nullif(trim(p_invoice), ''), eway_bill_no = nullif(trim(p_eway), ''),
                        transporter = nullif(trim(p_transporter), ''), lr_no = nullif(trim(p_lr), ''),
                        transit_pass_no = nullif(trim(p_transit), '')
   where id = p_id and type = 'dispatch';
  if not found then raise exception 'Dispatch not found'; end if;
end $$;
revoke execute on function set_dispatch_docs(uuid, text, text, text, text, text) from public, anon;
grant execute on function set_dispatch_docs(uuid, text, text, text, text, text) to authenticated;

-- Washing equipment can be maintained like any other asset
do $$ begin
  alter type asset_kind add value if not exists 'washer';
  alter type asset_kind add value if not exists 'screen';
  alter type asset_kind add value if not exists 'pump';
exception when others then raise notice 'asset kinds not extended: %', sqlerrm;
end $$;

-- ================= Workers and health (silica exposure) =================
create table if not exists workers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  emp_code text,
  area text not null default 'mill' check (area in ('mill', 'packing', 'washing', 'lab', 'weighbridge', 'maintenance', 'office', 'other')),
  exposure text not null default 'high' check (exposure in ('high', 'medium', 'low')),
  phone text,
  joined_on date,
  left_on date,
  medical_every_months int not null default 12 check (medical_every_months between 1 and 36),
  respirator_issued_on date,
  training_on date,
  notes text,
  created_at timestamptz default now()
);

-- Medical records are personal health data: only admin and supervisor can read them.
create table if not exists worker_medicals (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references workers(id) on delete cascade,
  exam_on date not null,
  kind text not null default 'periodic' check (kind in ('pre_employment', 'periodic', 'exit', 'special')),
  doctor text,
  chest_xray text check (chest_xray in ('normal', 'abnormal', 'not_done')),
  lung_function text check (lung_function in ('normal', 'reduced', 'not_done')),
  result text not null default 'fit' check (result in ('fit', 'fit_with_restrictions', 'unfit', 'refer')),
  silicosis_suspected boolean not null default false,
  notes text,
  doc_paths text[],
  created_at timestamptz default now()
);
create index if not exists worker_medicals_worker_idx on worker_medicals (worker_id, exam_on desc);

-- Date of a worker's last medical, without any clinical detail. Viewers can't read worker_medicals,
-- but they still need to see who is due, so this one date is exposed through a checked function.
create or replace function worker_last_exam(p_worker uuid) returns date
language sql stable security definer set search_path = public as $$
  select case when has_role('{admin,supervisor,viewer}') then (select max(exam_on) from worker_medicals where worker_id = p_worker) end
$$;
revoke execute on function worker_last_exam(uuid) from public, anon;
grant execute on function worker_last_exam(uuid) to authenticated;

drop view if exists worker_health_status;
create view worker_health_status with (security_invoker = true) as
select w.*,
  d.last_exam_on,
  m.result as last_result,                       -- null for viewers (no access to medical details)
  m.silicosis_suspected as last_silicosis,
  case when w.left_on is not null then null
       when d.last_exam_on is null then coalesce(w.joined_on, (now() at time zone 'Asia/Kolkata')::date)
       else (d.last_exam_on + make_interval(months => w.medical_every_months))::date end as next_exam_due
from workers w
cross join lateral (select worker_last_exam(w.id) as last_exam_on) d
left join lateral (select result, silicosis_suspected from worker_medicals x where x.worker_id = w.id order by exam_on desc limit 1) m on true;

-- ================= Environment / workplace monitoring =================
create table if not exists env_monitoring (
  id uuid primary key default gen_random_uuid(),
  sampled_on date not null,
  kind text not null check (kind in ('workplace_dust', 'free_silica', 'stack', 'ambient_air', 'noise', 'effluent', 'groundwater', 'other')),
  location text,
  parameter text not null,          -- e.g. 'Respirable dust', 'PM10', 'Free silica %'
  result numeric,
  unit text,
  limit_value numeric,
  lab text,
  report_no text,
  next_due date,
  notes text,
  doc_paths text[],
  exceeded boolean generated always as (result is not null and limit_value is not null and result > limit_value) stored,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz default now()
);
create index if not exists env_monitoring_date_idx on env_monitoring (sampled_on desc);

-- ================= Accidents, near misses, dangerous occurrences =================
create table if not exists incidents (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  kind text not null check (kind in ('injury', 'near_miss', 'dangerous_occurrence', 'environmental', 'fire', 'other')),
  severity text not null default 'minor' check (severity in ('minor', 'serious', 'fatal', 'none')),
  area text,
  worker_id uuid references workers(id) on delete set null,
  person text,
  description text not null,
  immediate_action text,
  root_cause text,
  corrective_action text,
  days_lost numeric(5,1) default 0,
  reported_to_authority boolean not null default false,
  reported_on date,
  closed boolean not null default false,
  doc_paths text[],
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz default now()
);

-- ================= Statutory returns and recurring duties (plant side) =================
create table if not exists statutory_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  authority text,
  frequency text not null default 'yearly' check (frequency in ('monthly', 'quarterly', 'half_yearly', 'yearly', 'once')),
  next_due date not null,
  last_done_on date,
  last_ref text,
  remind_days int not null default 15,
  notes text,
  active boolean not null default true,
  created_at timestamptz default now()
);
create unique index if not exists statutory_items_title_idx on statutory_items (lower(title));

-- Marks an item done and moves its due date forward by its frequency
create or replace function mark_statutory_done(p_id uuid, p_done date, p_ref text) returns statutory_items
language plpgsql security invoker set search_path = public as $$
declare r statutory_items;
begin
  update statutory_items set
    last_done_on = p_done, last_ref = nullif(p_ref, ''),
    next_due = case frequency
      when 'monthly' then (next_due + interval '1 month')::date
      when 'quarterly' then (next_due + interval '3 months')::date
      when 'half_yearly' then (next_due + interval '6 months')::date
      when 'yearly' then (next_due + interval '1 year')::date
      else next_due end,
    active = frequency <> 'once'
  where id = p_id returning * into r;
  if r.id is null then raise exception 'Not found or not allowed'; end if;
  return r;
end $$;
revoke execute on function mark_statutory_done(uuid, date, text) from public, anon;
grant execute on function mark_statutory_done(uuid, date, text) to authenticated;

-- Starting list (edit dates to match your consents and licences; nothing is overwritten on re-run)
do $$
declare y int := extract(year from now() at time zone 'Asia/Kolkata')::int;
        m date := date_trunc('month', now() at time zone 'Asia/Kolkata')::date;
begin
  insert into statutory_items (title, authority, frequency, next_due, notes) values
    ('Mineral dealer monthly stock & transit return', 'Mines & Geology (AD Mines)', 'monthly', (m + interval '1 month' + interval '9 days')::date,
       'Daily account of mineral procured, fed to plant, recovered and despatched. Export from Compliance › Mineral account. Confirm the form and due day with your AD Mines office.'),
    ('Environment statement (Form V)', 'State Pollution Control Board', 'yearly', make_date(case when now() < make_date(y, 9, 30) then y else y + 1 end, 9, 30),
       'Environment (Protection) Rules, rule 14: for the year ending 31 March.'),
    ('Hazardous waste annual return (Form 4) — used oil, filters', 'State Pollution Control Board', 'yearly', make_date(case when now() < make_date(y, 6, 30) then y else y + 1 end, 6, 30),
       'Gearbox / compressor used oil is hazardous waste. Needed if you hold the authorisation.'),
    ('Workplace dust & free silica monitoring', 'Factories / OSH', 'half_yearly', (m + interval '1 month')::date,
       'Respirable dust and free silica at mill, packing and washing areas by an approved lab. Record results under Compliance › Monitoring.'),
    ('Stack / bag filter emission monitoring', 'State Pollution Control Board', 'half_yearly', (m + interval '1 month')::date, 'As per consent conditions.'),
    ('Factory annual return', 'Factories Department', 'yearly', make_date(case when now() < make_date(y, 1, 31) then y else y + 1 end, 1, 31), 'Check the form and date under the state rules (OSH Code).'),
    ('Weighbridge verification & stamping', 'Legal Metrology', 'yearly', (m + interval '2 months')::date, 'Keep the certificate at the weighbridge.'),
    ('Electrical installation inspection (HT)', 'Electrical Inspectorate (CEIG)', 'yearly', (m + interval '2 months')::date, ''),
    ('Fire extinguisher refill / inspection', 'Fire safety', 'yearly', (m + interval '3 months')::date, ''),
    ('Mock drill & first-aid training', 'Factories / OSH', 'half_yearly', (m + interval '2 months')::date, '')
  on conflict do nothing;
end $$;

-- Standard licences to keep valid (only names; fill numbers and dates in Masters › Licences)
insert into licences (name, issued_by, notes)
select v.name, v.by, 'Added by the v8 checklist: fill in the number, validity and upload the copy.'
from (values
  ('Mineral Dealer Licence (MDL)', 'Mines & Geology Dept'),
  ('Consent to Operate: Air Act', 'State Pollution Control Board'),
  ('Consent to Operate: Water Act', 'State Pollution Control Board'),
  ('Hazardous waste authorisation', 'State Pollution Control Board'),
  ('Factory licence', 'Factories Department'),
  ('Groundwater / borewell permission', 'Groundwater Department'),
  ('Fire NOC', 'Fire Services'),
  ('Weighbridge stamping certificate', 'Legal Metrology'),
  ('HT electrical safety certificate', 'Electrical Inspectorate')
) as v(name, by)
where not exists (select 1 from licences l where lower(l.name) = lower(v.name));

-- ================= Mineral account: daily totals by movement =================
-- One row per day with every movement in kg. The app builds the running stock from these.
create or replace view mineral_daily with (security_invoker = true) as
with since as (select coalesce((select value from plant_settings where key = 'washing_tracked_from'), '2100-01-01')::date as d),
mv as (
  select (weighed_at at time zone 'Asia/Kolkata')::date as day,
         case when type = 'inbound' then net_kg else 0 end as raw_in,
         case when type = 'mill_feed' and (weighed_at at time zone 'Asia/Kolkata')::date <  (select d from since) then net_kg else 0 end as raw_to_mill,
         case when type = 'mill_feed' and (weighed_at at time zone 'Asia/Kolkata')::date >= (select d from since) then net_kg else 0 end as washed_to_mill,
         0::numeric as raw_to_wash, 0::numeric as washed_out, 0::numeric as wash_rejects,
         0::numeric as powder_made, case when type = 'dispatch' then net_kg else 0 end as dispatched, 0::numeric as dust_dumped
  from weighments where net_kg is not null
  union all
  select run_date, 0, 0, 0, feed_kg, washed_kg, rejects_kg, 0, 0, 0 from washing_runs
  union all
  select (coalesce(ended_at, started_at) at time zone 'Asia/Kolkata')::date, 0, 0, 0, 0, 0, 0, coalesce(output_kg, 0), 0, 0 from mill_runs
  union all
  select logged_on, 0, 0, 0, 0, 0, 0, 0, 0, qty_kg from dust_logs where disposition = 'dumped'
)
select day,
  sum(raw_in) raw_in_kg, sum(raw_to_wash) raw_to_wash_kg, sum(raw_to_mill) raw_to_mill_kg,
  sum(washed_out) washed_out_kg, sum(wash_rejects) wash_rejects_kg, sum(washed_to_mill) washed_to_mill_kg,
  sum(powder_made) powder_made_kg, sum(dispatched) dispatched_kg, sum(dust_dumped) dust_dumped_kg
from mv group by day;

-- ================= Row level security + audit =================
do $$
declare r record;
begin
  for r in select * from (values
    ('washing_runs',     '{admin,supervisor,operator}',            '{admin,supervisor,operator}',  '{admin,supervisor,weighbridge,operator,maintenance,viewer}'),
    ('workers',          '{admin,supervisor}',                     '{admin,supervisor}',           '{admin,supervisor,viewer}'),
    ('worker_medicals',  '{admin,supervisor}',                     '{admin,supervisor}',           '{admin,supervisor}'),
    ('env_monitoring',   '{admin,supervisor}',                     '{admin,supervisor}',           '{admin,supervisor,weighbridge,operator,maintenance,viewer}'),
    ('incidents',        '{admin,supervisor,operator,maintenance,weighbridge}', '{admin,supervisor}', '{admin,supervisor,weighbridge,operator,maintenance,viewer}'),
    ('statutory_items',  '{admin,supervisor}',                     '{admin,supervisor}',           '{admin,supervisor,viewer}')
  ) as v(tbl, ins, upd, rd)
  loop
    execute format('alter table %I enable row level security', r.tbl);
    execute format('drop policy if exists "read" on %I', r.tbl);
    execute format('drop policy if exists "ins" on %I', r.tbl);
    execute format('drop policy if exists "upd" on %I', r.tbl);
    execute format('drop policy if exists "del" on %I', r.tbl);
    execute format('create policy "read" on %I for select to authenticated using (has_role(%L))', r.tbl, r.rd);
    execute format('create policy "ins" on %I for insert to authenticated with check (has_role(%L))', r.tbl, r.ins);
    execute format('create policy "upd" on %I for update to authenticated using (has_role(%L)) with check (has_role(%L))', r.tbl, r.upd, r.upd);
    execute format('create policy "del" on %I for delete to authenticated using (has_role(%L))', r.tbl, '{admin}');
    execute format('drop trigger if exists audit_%1$s on %1$I', r.tbl);
    execute format('create trigger audit_%1$s after insert or update or delete on %1$I for each row execute function log_audit()', r.tbl);
  end loop;
end $$;
