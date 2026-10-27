-- BallMill Ops v3: product specs + whiteness, QC hold, invoice / e-way bill on dispatch, spares and consumables,
-- downtime / handover / dust logs, photos, and functions that are safe to replay from the offline queue.
-- Run AFTER schema.sql and migration_v2.sql. Safe to re-run (but do not re-run v2 afterwards without re-running v3).

-- ================= Lab results, specs, QC hold =================
alter table batches add column if not exists whiteness_pct numeric(5,2);
alter table batches add column if not exists tested_on date;
alter table batches add column if not exists qc_hold boolean not null default false;
alter table batches add column if not exists hold_reason text;

-- Default spec per grade; an order can override any of them (null = use the grade's).
alter table grades add column if not exists spec_min_sio2 numeric(6,3);
alter table grades add column if not exists spec_max_fe2o3 numeric(6,4);
alter table grades add column if not exists spec_max_moisture numeric(5,2);
alter table grades add column if not exists spec_min_whiteness numeric(5,2);
alter table orders add column if not exists spec_min_sio2 numeric(6,3);
alter table orders add column if not exists spec_max_fe2o3 numeric(6,4);
alter table orders add column if not exists spec_max_moisture numeric(5,2);
alter table orders add column if not exists spec_min_whiteness numeric(5,2);

create or replace function protect_qc_hold() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null and not has_role('{admin,supervisor}'::app_role[]) then
    if tg_op = 'INSERT' and (new.qc_hold or new.hold_reason is not null) then
      raise exception 'Only a supervisor or admin can put a batch on hold';
    elsif tg_op = 'UPDATE' and (new.qc_hold is distinct from old.qc_hold or new.hold_reason is distinct from old.hold_reason) then
      raise exception 'Only a supervisor or admin can put a batch on hold or release it';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists protect_qc_hold on batches;
create trigger protect_qc_hold before insert or update on batches for each row execute function protect_qc_hold();

-- ================= Dispatch documents, photos, shifts =================
alter table weighments add column if not exists invoice_no text;
alter table weighments add column if not exists eway_bill_no text;
alter table weighments add column if not exists transporter text;
alter table weighments add column if not exists lr_no text;
alter table weighments add column if not exists photo_paths text[];
alter table maintenance_logs add column if not exists photo_paths text[];
alter table mill_runs add column if not exists shift text check (shift in ('A', 'B', 'C'));

-- The weighbridge role can no longer enter a loose dispatch weighment (they must scan bags on the Dispatch tab).
-- Admin and supervisor keep it for rare bulk (unbagged) loads.
drop policy if exists "ins" on weighments;
create policy "ins" on weighments for insert to authenticated
  with check (has_role('{admin,supervisor}'::app_role[]) or (has_role('{weighbridge}'::app_role[]) and type <> 'dispatch'));

-- ================= Spares and consumables =================
create table if not exists spare_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('grinding_media', 'filter_bag', 'lubricant', 'liner_resin', 'electrical', 'other')),
  unit text not null default 'nos',
  reorder_level numeric(12,2) not null default 0,
  location text,
  notes text,
  active boolean not null default true,
  created_at timestamptz default now()
);
create unique index if not exists spare_items_name_idx on spare_items (lower(name));

create table if not exists spare_moves (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references spare_items(id),
  moved_at timestamptz not null default now(),
  kind text not null check (kind in ('in', 'out', 'adjust')),
  qty numeric(12,2) not null,
  mill_id uuid references mills(id),
  supplier text,
  ref_no text,
  notes text,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz default now(),
  check ((kind in ('in', 'out') and qty > 0) or (kind = 'adjust' and qty <> 0))
);
create index if not exists spare_moves_item_idx on spare_moves (item_id, moved_at desc);

create or replace function trg_spare_nonneg() returns trigger
language plpgsql security definer set search_path = public as $$
declare cur numeric; delta numeric;
begin
  delta := case new.kind when 'in' then new.qty when 'out' then -new.qty else new.qty end;
  if delta < 0 then
    select coalesce(sum(case kind when 'in' then qty when 'out' then -qty else qty end), 0) into cur
      from spare_moves where item_id = new.item_id;
    if cur + delta < 0 then raise exception 'Not enough stock: only % on hand', cur; end if;
  end if;
  return new;
end $$;
drop trigger if exists spare_nonneg on spare_moves;
create trigger spare_nonneg before insert on spare_moves for each row execute function trg_spare_nonneg();

create or replace view spare_stock with (security_invoker = true) as
select i.*,
       coalesce(sum(case m.kind when 'in' then m.qty when 'out' then -m.qty else m.qty end), 0) as on_hand
from spare_items i
left join spare_moves m on m.item_id = i.id
group by i.id;

-- ================= Plant log: downtime, handover notes, dust and fines =================
create table if not exists downtime (
  id uuid primary key default gen_random_uuid(),
  mill_id uuid not null references mills(id),
  started_at timestamptz not null,
  ended_at timestamptz,
  reason text not null check (reason in ('power_cut', 'breakdown', 'no_material', 'cleaning', 'changeover', 'other')),
  notes text,
  hours numeric(8,2) generated always as
    (case when ended_at is null then null else round(extract(epoch from (ended_at - started_at)) / 3600.0, 2) end) stored,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz default now()
);
create index if not exists downtime_start_idx on downtime (started_at desc);

create table if not exists shift_notes (
  id uuid primary key default gen_random_uuid(),
  noted_at timestamptz not null default now(),
  shift text check (shift in ('A', 'B', 'C')),
  notes text not null,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz default now()
);

create table if not exists dust_logs (
  id uuid primary key default gen_random_uuid(),
  logged_on date not null default (now() at time zone 'Asia/Kolkata')::date,
  source text not null check (source in ('cyclone', 'bag_filter', 'floor_sweep', 'other')),
  mill_id uuid references mills(id),
  qty_kg numeric(10,2) not null check (qty_kg > 0),
  disposition text not null default 'recycled' check (disposition in ('recycled', 'sold', 'dumped')),
  notes text,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz default now()
);

-- Used by the alert script so the same alert is not sent twice (only the service key touches it).
create table if not exists alert_log (key text primary key, sent_at timestamptz default now());
alter table alert_log enable row level security;

-- ================= Functions (idempotent, so the offline queue can safely retry them) =================

-- N bags with individual weights (jumbo bags), numbers generated by the server.
create or replace function create_bags_weights(p_batch uuid, p_type text, p_weights numeric[])
returns setof bags
language plpgsql security definer set search_path = public as $$
declare w numeric; n int; d text := to_char(now() at time zone 'Asia/Kolkata', 'YYMMDD');
begin
  if not has_role('{admin,supervisor,operator}'::app_role[]) then raise exception 'Not allowed'; end if;
  if coalesce(array_length(p_weights, 1), 0) not between 1 and 500 then raise exception 'Between 1 and 500 bags at a time'; end if;
  foreach w in array p_weights loop
    n := next_counter('bag-' || d);
    return query
      insert into bags (bag_no, batch_id, bag_type, weight_kg)
      values ('NG-' || d || '-' || lpad(n::text, 4, '0'), p_batch, p_type, w)
      returning *;
  end loop;
end $$;

-- Hand out a block of bag numbers for a device that may go offline.
create or replace function reserve_bag_numbers(p_count int) returns json
language plpgsql security definer set search_path = public as $$
declare d text := to_char(now() at time zone 'Asia/Kolkata', 'YYMMDD'); last_n int;
begin
  if not has_role('{admin,supervisor,operator}'::app_role[]) then raise exception 'Not allowed'; end if;
  if p_count < 1 or p_count > 2000 then raise exception 'Reserve between 1 and 2000 numbers'; end if;
  insert into counters (key, value) values ('bag-' || d, p_count)
  on conflict (key) do update set value = counters.value + p_count
  returning value into last_n;
  return json_build_object('day', d, 'first', last_n - p_count + 1, 'last', last_n);
end $$;

-- Bags whose numbers were reserved earlier (created offline). All or nothing; a repeat raises unique_violation.
create or replace function create_bags_numbered(p_batch uuid, p_type text, p_weights numeric[], p_bag_nos text[])
returns setof bags
language plpgsql security definer set search_path = public as $$
declare i int;
begin
  if not has_role('{admin,supervisor,operator}'::app_role[]) then raise exception 'Not allowed'; end if;
  if array_length(p_weights, 1) is distinct from array_length(p_bag_nos, 1) then raise exception 'Weights and bag numbers do not match'; end if;
  for i in 1..array_length(p_bag_nos, 1) loop
    if p_bag_nos[i] !~ '^NG-[0-9]{6}-[0-9]{4,}$' then raise exception 'Bad bag number %', p_bag_nos[i]; end if;
    return query
      insert into bags (bag_no, batch_id, bag_type, weight_kg)
      values (p_bag_nos[i], p_batch, p_type, p_weights[i])
      returning *;
  end loop;
end $$;

-- Dispatch a truck. p_id (made on the device) makes a retry harmless. Bags on QC hold are refused.
drop function if exists dispatch_bags(uuid, text, numeric, numeric, text[], text);
create or replace function dispatch_bags(
  p_order uuid, p_vehicle text, p_gross numeric, p_tare numeric, p_bag_nos text[],
  p_notes text default null, p_id uuid default null, p_invoice text default null,
  p_eway text default null, p_transporter text default null, p_lr text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare wid uuid := coalesce(p_id, gen_random_uuid()); bad text; held text;
begin
  if not has_role('{admin,supervisor,weighbridge}'::app_role[]) then raise exception 'Not allowed'; end if;
  if p_id is not null and exists (select 1 from weighments where id = p_id) then return p_id; end if;
  if p_gross is null or p_tare is null or p_gross < p_tare then raise exception 'Gross must be >= tare'; end if;
  select string_agg(x, ', ') into bad
    from unnest(p_bag_nos) x
   where not exists (select 1 from bags b where b.bag_no = x and b.status = 'in_stock');
  if bad is not null then raise exception 'Unknown or not in stock: %', bad; end if;
  select string_agg(distinct bt.batch_no, ', ') into held
    from bags b join batches bt on bt.id = b.batch_id
   where b.bag_no = any(p_bag_nos) and bt.qc_hold;
  if held is not null then raise exception 'On QC hold, cannot dispatch: %', held; end if;

  insert into weighments (id, type, vehicle_no, gross_kg, tare_kg, order_id, grade_id, notes,
                          invoice_no, eway_bill_no, transporter, lr_no)
  values (wid, 'dispatch', p_vehicle, p_gross, p_tare, p_order,
          (select o.grade_id from orders o where o.id = p_order), p_notes,
          nullif(trim(p_invoice), ''), nullif(trim(p_eway), ''), nullif(trim(p_transporter), ''), nullif(trim(p_lr), ''));

  update bags set status = 'dispatched', order_id = p_order, dispatch_weighment_id = wid, dispatched_at = now()
   where bag_no = any(p_bag_nos);
  return wid;
end $$;

-- Fill in or correct invoice / e-way bill details after loading.
create or replace function set_dispatch_docs(p_id uuid, p_invoice text, p_eway text, p_transporter text, p_lr text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('{admin,supervisor,weighbridge}'::app_role[]) then raise exception 'Not allowed'; end if;
  update weighments set invoice_no = nullif(trim(p_invoice), ''), eway_bill_no = nullif(trim(p_eway), ''),
                        transporter = nullif(trim(p_transporter), ''), lr_no = nullif(trim(p_lr), '')
   where id = p_id and type = 'dispatch';
  if not found then raise exception 'Dispatch not found'; end if;
end $$;

-- "Mark done" on a maintenance schedule: log + reset the schedule in one step.
create or replace function mark_maintenance_done(
  p_schedule uuid, p_done_by text, p_mill_hours numeric,
  p_done_at timestamptz default now(), p_id uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare lid uuid := coalesce(p_id, gen_random_uuid()); a uuid; t text;
begin
  if not has_role('{admin,supervisor,maintenance}'::app_role[]) then raise exception 'Not allowed'; end if;
  if p_id is not null and exists (select 1 from maintenance_logs where id = p_id) then return p_id; end if;
  select asset_id, task into a, t from maintenance_schedules where id = p_schedule;
  if not found then raise exception 'Schedule not found'; end if;
  insert into maintenance_logs (id, asset_id, schedule_id, done_at, type, description, done_by)
  values (lid, a, p_schedule, p_done_at, 'preventive', t, p_done_by);
  update maintenance_schedules set last_done_at = p_done_at, last_done_hours = p_mill_hours where id = p_schedule;
  return lid;
end $$;

do $$
declare f text;
begin
  for f in select unnest(array[
    'create_bags_weights(uuid, text, numeric[])',
    'reserve_bag_numbers(int)',
    'create_bags_numbered(uuid, text, numeric[], text[])',
    'dispatch_bags(uuid, text, numeric, numeric, text[], text, uuid, text, text, text, text)',
    'set_dispatch_docs(uuid, text, text, text, text)',
    'mark_maintenance_done(uuid, text, numeric, timestamptz, uuid)'])
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ================= Audit + row level security for the new tables =================
do $$
declare t text;
begin
  for t in select unnest(array['spare_items', 'spare_moves', 'downtime', 'shift_notes', 'dust_logs'])
  loop
    execute format('drop trigger if exists audit_%1$s on %1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on %1$I for each row execute function log_audit()', t);
  end loop;
end $$;

do $$
declare r record;
begin
  for r in select * from (values
    ('spare_items', '{admin,supervisor,maintenance}',                '{admin,supervisor,maintenance}'),
    ('spare_moves', '{admin,supervisor,maintenance,operator}',       '{admin,supervisor}'),
    ('downtime',    '{admin,supervisor,operator,maintenance}',       '{admin,supervisor,operator,maintenance}'),
    ('shift_notes', '{admin,supervisor,weighbridge,operator,maintenance}', '{admin,supervisor}'),
    ('dust_logs',   '{admin,supervisor,operator}',                   '{admin,supervisor,operator}')
  ) as v(tbl, ins, upd)
  loop
    execute format('alter table %I enable row level security', r.tbl);
    execute format('drop policy if exists "read" on %I', r.tbl);
    execute format('drop policy if exists "ins" on %I', r.tbl);
    execute format('drop policy if exists "upd" on %I', r.tbl);
    execute format('drop policy if exists "del" on %I', r.tbl);
    execute format('create policy "read" on %I for select to authenticated using (has_role(%L))', r.tbl, '{admin,supervisor,weighbridge,operator,maintenance,viewer}');
    execute format('create policy "ins" on %I for insert to authenticated with check (has_role(%L))', r.tbl, r.ins);
    execute format('create policy "upd" on %I for update to authenticated using (has_role(%L)) with check (has_role(%L))', r.tbl, r.upd, r.upd);
    execute format('create policy "del" on %I for delete to authenticated using (has_role(%L))', r.tbl, '{admin}');
  end loop;
end $$;

-- ================= Photo storage (private bucket, signed links) =================
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('photos', 'photos', false) on conflict (id) do nothing;
    drop policy if exists "photos read" on storage.objects;
    drop policy if exists "photos upload" on storage.objects;
    drop policy if exists "photos delete" on storage.objects;
    create policy "photos read" on storage.objects for select to authenticated
      using (bucket_id = 'photos' and has_role('{admin,supervisor,weighbridge,operator,maintenance,viewer}'::app_role[]));
    create policy "photos upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'photos' and has_role('{admin,supervisor,weighbridge,operator,maintenance}'::app_role[]));
    create policy "photos delete" on storage.objects for delete to authenticated
      using (bucket_id = 'photos' and has_role('{admin}'::app_role[]));
  end if;
end $$;
