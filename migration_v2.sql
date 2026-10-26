-- BallMill Ops v2: roles/PINs, audit trail, batches, numbered bags, automatic order status.
-- Run AFTER schema.sql, in the Supabase SQL editor. Safe to re-run.

-- ================= Roles =================
do $$ begin
  create type app_role as enum ('pending','admin','supervisor','weighbridge','operator','maintenance','viewer');
exception when duplicate_object then null; end $$;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  full_name text,
  role app_role not null default 'pending',
  active boolean not null default true,
  created_at timestamptz default now()
);

-- The very first user becomes admin; everyone after starts as 'pending' until an admin assigns a role.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, username, full_name, role)
  values (new.id, lower(split_part(new.email, '@', 1)), split_part(new.email, '@', 1),
          case when exists (select 1 from profiles) then 'pending'::app_role else 'admin'::app_role end)
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Existing users (created before this migration): oldest becomes admin, others pending.
insert into profiles (id, username, full_name, role)
select u.id, lower(split_part(u.email, '@', 1)), split_part(u.email, '@', 1),
       case when u.id = (select id from auth.users order by created_at limit 1)
            then 'admin'::app_role else 'pending'::app_role end
from auth.users u
on conflict do nothing;

create or replace function app_role_of() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active
$$;

create or replace function has_role(roles app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(app_role_of() = any(roles), false)
$$;

create or replace function protect_last_admin() returns trigger
language plpgsql as $$
begin
  if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active)
     and not exists (select 1 from profiles where role = 'admin' and active and id <> old.id) then
    raise exception 'Cannot remove the last active admin';
  end if;
  return new;
end $$;
drop trigger if exists protect_last_admin on profiles;
create trigger protect_last_admin before update on profiles
  for each row execute function protect_last_admin();

-- ================= Extra columns =================
alter table weighments add column if not exists created_by uuid references profiles(id) on delete set null default auth.uid();
alter table orders     add column if not exists created_by uuid references profiles(id) on delete set null default auth.uid();
alter table mill_runs  add column if not exists created_by uuid references profiles(id) on delete set null default auth.uid();
alter table mill_runs  add column if not exists order_id uuid references orders(id);
alter table mill_runs  add column if not exists kwh_start numeric(12,1);
alter table mill_runs  add column if not exists kwh_end numeric(12,1);
alter table mill_runs  add column if not exists kwh_used numeric(12,1) generated always as (kwh_end - kwh_start) stored;
alter table mills      add column if not exists min_safe_thickness_mm numeric(6,1);

-- ================= Counters, batch + bag numbers =================
create table if not exists counters (key text primary key, value int not null default 0);
alter table counters enable row level security;  -- no policies: only the functions below touch it

create or replace function next_counter(p_key text) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  insert into counters (key, value) values (p_key, 1)
  on conflict (key) do update set value = counters.value + 1
  returning value into v;
  return v;
end $$;

create or replace function next_batch_no() returns text
language sql security definer set search_path = public as $$
  select 'B-' || to_char(now() at time zone 'Asia/Kolkata', 'YYMMDD') || '-' ||
         lpad(next_counter('batch-' || to_char(now() at time zone 'Asia/Kolkata', 'YYMMDD'))::text, 2, '0')
$$;

-- ================= Batches & bags =================
create table if not exists batches (
  id uuid primary key default gen_random_uuid(),
  batch_no text unique not null default next_batch_no(),
  mill_id uuid references mills(id),
  mill_run_id uuid references mill_runs(id),
  grade_id uuid references grades(id),
  inbound_lot_no text,
  produced_on date default (now() at time zone 'Asia/Kolkata')::date,
  sio2_pct numeric(6,3),
  fe2o3_pct numeric(6,4),
  moisture_pct numeric(5,2),
  lab_report_url text,
  notes text,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz default now()
);

create table if not exists bags (
  id uuid primary key default gen_random_uuid(),
  bag_no text unique not null,
  batch_id uuid not null references batches(id),
  bag_type text not null check (bag_type in ('bag','jumbo')),
  weight_kg numeric(10,2) not null check (weight_kg > 0),
  packed_at timestamptz default now(),
  packed_by uuid references profiles(id) on delete set null default auth.uid(),
  status text not null default 'in_stock' check (status in ('in_stock','dispatched','rejected')),
  order_id uuid references orders(id),
  dispatch_weighment_id uuid references weighments(id),
  dispatched_at timestamptz
);
create index if not exists bags_batch_idx on bags (batch_id);
create index if not exists bags_status_idx on bags (status);
create index if not exists bags_order_idx on bags (order_id);

-- Create N numbered bags in one go. Numbers look like NG-261026-0042 (IST date + running no.).
create or replace function create_bags(p_batch uuid, p_type text, p_weight numeric, p_count int)
returns setof bags
language plpgsql security definer set search_path = public as $$
declare i int; n int; d text := to_char(now() at time zone 'Asia/Kolkata', 'YYMMDD');
begin
  if not has_role('{admin,supervisor,operator}'::app_role[]) then raise exception 'Not allowed'; end if;
  if p_count < 1 or p_count > 500 then raise exception 'Count must be between 1 and 500'; end if;
  for i in 1..p_count loop
    n := next_counter('bag-' || d);
    return query
      insert into bags (bag_no, batch_id, bag_type, weight_kg)
      values ('NG-' || d || '-' || lpad(n::text, 4, '0'), p_batch, p_type, p_weight)
      returning *;
  end loop;
end $$;

-- Dispatch a truck: one weighbridge record + mark the scanned bags as dispatched, atomically.
create or replace function dispatch_bags(p_order uuid, p_vehicle text, p_gross numeric, p_tare numeric,
                                         p_bag_nos text[], p_notes text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare wid uuid; bad text;
begin
  if not has_role('{admin,supervisor,weighbridge}'::app_role[]) then raise exception 'Not allowed'; end if;
  if p_gross is null or p_tare is null or p_gross < p_tare then raise exception 'Gross must be >= tare'; end if;
  select string_agg(x, ', ') into bad
    from unnest(p_bag_nos) x
   where not exists (select 1 from bags b where b.bag_no = x and b.status = 'in_stock');
  if bad is not null then raise exception 'Unknown or not in stock: %', bad; end if;

  insert into weighments (type, vehicle_no, gross_kg, tare_kg, order_id, grade_id, notes)
  values ('dispatch', p_vehicle, p_gross, p_tare, p_order,
          (select o.grade_id from orders o where o.id = p_order), p_notes)
  returning id into wid;

  update bags set status = 'dispatched', order_id = p_order,
                  dispatch_weighment_id = wid, dispatched_at = now()
   where bag_no = any(p_bag_nos);
  return wid;
end $$;

revoke execute on function create_bags(uuid, text, numeric, int) from public, anon;
revoke execute on function dispatch_bags(uuid, text, numeric, numeric, text[], text) from public, anon;
grant execute on function create_bags(uuid, text, numeric, int) to authenticated;
grant execute on function dispatch_bags(uuid, text, numeric, numeric, text[], text) to authenticated;

-- ================= Automatic order status =================
create or replace function sync_one_order(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
declare q numeric; st order_status; tot numeric;
begin
  if p_order is null then return; end if;
  select qty_kg, status into q, st from orders where id = p_order;
  if not found or st = 'cancelled' then return; end if;
  select coalesce(sum(net_kg), 0) into tot from weighments where order_id = p_order and type = 'dispatch';
  update orders set status = case
      when tot >= q then 'dispatched'::order_status
      when tot > 0 then 'partially_dispatched'::order_status
      when st in ('partially_dispatched', 'dispatched') then 'open'::order_status
      else st end
   where id = p_order;
end $$;

create or replace function trg_sync_order_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then perform sync_one_order(new.order_id); end if;
  if tg_op in ('UPDATE', 'DELETE') then perform sync_one_order(old.order_id); end if;
  return null;
end $$;
drop trigger if exists sync_order_status on weighments;
create trigger sync_order_status after insert or update or delete on weighments
  for each row execute function trg_sync_order_status();

-- Deleting a dispatch record releases its bags back to stock.
create or replace function trg_release_bags() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update bags set status = 'in_stock', order_id = null, dispatch_weighment_id = null, dispatched_at = null
   where dispatch_weighment_id = old.id;
  return old;
end $$;
drop trigger if exists release_bags on weighments;
create trigger release_bags before delete on weighments
  for each row execute function trg_release_bags();

-- A mill run logged against an open order moves it to "in production".
create or replace function trg_run_marks_order() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.order_id is not null then
    update orders set status = 'in_production' where id = new.order_id and status = 'open';
  end if;
  return null;
end $$;
drop trigger if exists run_marks_order on mill_runs;
create trigger run_marks_order after insert or update on mill_runs
  for each row execute function trg_run_marks_order();

-- ================= Views =================
create or replace view stock_summary with (security_invoker = true) as
select
  coalesce((select sum(net_kg) from weighments where type = 'inbound'), 0)    as inbound_kg,
  coalesce((select sum(net_kg) from weighments where type = 'mill_feed'), 0)  as fed_kg,
  coalesce((select sum(output_kg) from mill_runs), 0)                         as produced_kg,
  coalesce((select sum(weight_kg) from bags where status <> 'rejected'), 0)   as packed_kg,
  coalesce((select sum(weight_kg) from bags where status = 'in_stock'), 0)    as packed_in_stock_kg,
  coalesce((select count(*) from bags where status = 'in_stock'), 0)          as bags_in_stock,
  coalesce((select sum(net_kg) from weighments where type = 'dispatch'), 0)   as dispatched_kg,
  coalesce((select sum(weight_kg) from bags where status = 'dispatched'), 0)  as dispatched_bags_kg;

alter view order_progress set (security_invoker = true);
alter view mill_total_hours set (security_invoker = true);

-- ================= Audit trail =================
create table if not exists audit_log (
  id bigint generated always as identity primary key,
  at timestamptz default now(),
  user_id uuid,
  user_name text,
  table_name text,
  row_id text,
  action text,
  old_data jsonb,
  new_data jsonb
);
create index if not exists audit_log_at_idx on audit_log (at desc);

create or replace function log_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare uname text; rid text;
begin
  select coalesce(full_name, username) into uname from profiles where id = auth.uid();
  if tg_op = 'DELETE' then rid := old.id::text; else rid := new.id::text; end if;
  insert into audit_log (user_id, user_name, table_name, row_id, action, old_data, new_data)
  values (auth.uid(), uname, tg_table_name, rid, tg_op,
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return null;
end $$;

do $$
declare t text;
begin
  for t in select unnest(array['mills','customers','suppliers','grades','orders','weighments','mill_runs',
      'assets','maintenance_schedules','maintenance_logs','lining_inspections','batches','bags','profiles'])
  loop
    execute format('drop trigger if exists audit_%1$s on %1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on %1$I for each row execute function log_audit()', t);
  end loop;
end $$;

-- ================= Row level security =================
alter table profiles enable row level security;
alter table audit_log enable row level security;
alter table batches enable row level security;
alter table bags enable row level security;

drop policy if exists "profiles read" on profiles;
drop policy if exists "profiles admin update" on profiles;
create policy "profiles read" on profiles for select to authenticated
  using (id = auth.uid() or has_role('{admin,supervisor,weighbridge,operator,maintenance,viewer}'));
create policy "profiles admin update" on profiles for update to authenticated
  using (has_role('{admin}')) with check (has_role('{admin}'));

drop policy if exists "audit admin read" on audit_log;
create policy "audit admin read" on audit_log for select to authenticated using (has_role('{admin}'));

-- Everyone with a role can read. Insert/update per table below. Delete is admin only.
do $$
declare r record;
begin
  for r in select * from (values
    ('mills',                '{admin,supervisor}',                          '{admin,supervisor}'),
    ('customers',            '{admin,supervisor}',                          '{admin,supervisor}'),
    ('suppliers',            '{admin,supervisor}',                          '{admin,supervisor}'),
    ('grades',               '{admin,supervisor}',                          '{admin,supervisor}'),
    ('orders',               '{admin,supervisor}',                          '{admin,supervisor}'),
    ('weighments',           '{admin,supervisor,weighbridge}',              '{admin,supervisor}'),
    ('mill_runs',            '{admin,supervisor,operator}',                 '{admin,supervisor,operator}'),
    ('assets',               '{admin,supervisor,maintenance}',              '{admin,supervisor,maintenance}'),
    ('maintenance_schedules','{admin,supervisor,maintenance}',              '{admin,supervisor,maintenance}'),
    ('maintenance_logs',     '{admin,supervisor,maintenance,operator}',     '{admin,supervisor,maintenance}'),
    ('lining_inspections',   '{admin,supervisor,maintenance}',              '{admin,supervisor,maintenance}'),
    ('batches',              '{admin,supervisor,operator}',                 '{admin,supervisor,operator}'),
    ('bags',                 '{}',                                          '{admin,supervisor}')
  ) as v(tbl, ins, upd)
  loop
    execute format('alter table %I enable row level security', r.tbl);
    execute format('drop policy if exists "auth all" on %I', r.tbl);
    execute format('drop policy if exists "read" on %I', r.tbl);
    execute format('drop policy if exists "ins" on %I', r.tbl);
    execute format('drop policy if exists "upd" on %I', r.tbl);
    execute format('drop policy if exists "del" on %I', r.tbl);
    execute format('create policy "read" on %I for select to authenticated using (has_role(%L))',
                   r.tbl, '{admin,supervisor,weighbridge,operator,maintenance,viewer}');
    execute format('create policy "ins" on %I for insert to authenticated with check (has_role(%L))', r.tbl, r.ins);
    execute format('create policy "upd" on %I for update to authenticated using (has_role(%L)) with check (has_role(%L))',
                   r.tbl, r.upd, r.upd);
    execute format('create policy "del" on %I for delete to authenticated using (has_role(%L))', r.tbl, '{admin}');
  end loop;
end $$;
