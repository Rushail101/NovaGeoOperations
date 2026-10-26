-- Ball Mill Operations ERP — Supabase schema (operations only, no finance)
-- Run in Supabase SQL editor.

create extension if not exists "pgcrypto";

-- ---------- Masters ----------
create table mills (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,              -- e.g. 'Mill 1', 'Mill 2'
  lining_type text default 'Resin + road metal',
  active boolean default true,
  created_at timestamptz default now()
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  address text,
  created_at timestamptz default now()
);

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  source_location text,                    -- quarry / mine
  created_at timestamptz default now()
);

create table grades (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,               -- e.g. '200 mesh A grade'
  mesh text,
  notes text
);

-- ---------- Orders ----------
create type order_status as enum ('open','in_production','ready','partially_dispatched','dispatched','cancelled');

create table orders (
  id uuid primary key default gen_random_uuid(),
  order_no text unique not null,
  customer_id uuid references customers(id) not null,
  grade_id uuid references grades(id) not null,
  qty_kg numeric(12,2) not null check (qty_kg > 0),
  due_date date,
  status order_status default 'open',
  notes text,
  created_at timestamptz default now()
);

-- ---------- Weighments ----------
create type weighment_type as enum ('inbound','mill_feed','dispatch');

create table weighments (
  id uuid primary key default gen_random_uuid(),
  weighed_at timestamptz default now(),
  type weighment_type not null,
  vehicle_no text,
  gross_kg numeric(12,2),
  tare_kg numeric(12,2),
  net_kg numeric(12,2) generated always as (gross_kg - tare_kg) stored,
  supplier_id uuid references suppliers(id),   -- inbound
  order_id uuid references orders(id),         -- dispatch
  mill_id uuid references mills(id),           -- mill_feed
  grade_id uuid references grades(id),
  lot_no text,
  notes text,
  created_at timestamptz default now(),
  check (gross_kg is null or tare_kg is null or gross_kg >= tare_kg)
);
create index on weighments (type, weighed_at desc);
create index on weighments (order_id);

-- ---------- Production runs (drives run-hours) ----------
create table mill_runs (
  id uuid primary key default gen_random_uuid(),
  mill_id uuid references mills(id) not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  feed_kg numeric(12,2),
  output_kg numeric(12,2),
  grade_id uuid references grades(id),
  operator text,
  notes text,
  hours numeric(8,2) generated always as
    (case when ended_at is null then null
          else round(extract(epoch from (ended_at - started_at))/3600.0, 2) end) stored
);
create index on mill_runs (mill_id, started_at desc);

-- ---------- Maintenance ----------
create type asset_kind as enum ('mill_lining','motor','gearbox','bearing','bag_filter','cyclone','fan','conveyor','other');

create table assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind asset_kind not null,
  mill_id uuid references mills(id),
  notes text,
  active boolean default true
);

-- Recurring schedules: by run-hours of the mill and/or calendar days
create table maintenance_schedules (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references assets(id) on delete cascade,
  task text not null,                      -- 'Grease bearings', 'Clean bag filter'
  every_hours numeric(8,1),
  every_days int,
  last_done_at timestamptz,
  last_done_hours numeric(10,1),
  check (every_hours is not null or every_days is not null)
);

create table maintenance_logs (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references assets(id) not null,
  schedule_id uuid references maintenance_schedules(id),
  done_at timestamptz default now(),
  type text check (type in ('preventive','breakdown','inspection')) default 'preventive',
  description text,
  downtime_hours numeric(8,2),
  done_by text,
  created_at timestamptz default now()
);

-- Resin lining inspections
create table lining_inspections (
  id uuid primary key default gen_random_uuid(),
  mill_id uuid references mills(id) not null,
  inspected_at date default current_date,
  mill_hours_at_inspection numeric(10,1),
  min_thickness_mm numeric(6,1),
  avg_thickness_mm numeric(6,1),
  cracks boolean default false,
  debonded_area_pct numeric(5,1),          -- hollow-sounding / lifted patches
  stone_loss_noted boolean default false,  -- road metal pieces pulling out
  iron_contamination_noted boolean default false, -- shell exposed / rust stains in powder
  condition text check (condition in ('good','watch','repair_soon','relining_needed')) default 'good',
  notes text,
  photo_urls text[]
);

-- ---------- Views ----------
create view mill_total_hours as
select mill_id, coalesce(sum(hours),0) as total_hours from mill_runs group by mill_id;

create view order_progress as
select o.id, o.order_no, o.qty_kg,
       coalesce(sum(w.net_kg),0) as dispatched_kg,
       o.qty_kg - coalesce(sum(w.net_kg),0) as pending_kg
from orders o
left join weighments w on w.order_id = o.id and w.type = 'dispatch'
group by o.id;

-- Maintenance "due" status is computed in the app from maintenance_schedules + mill_total_hours.

-- ---------- Security: authenticated users only ----------
do $$
declare t text;
begin
  for t in select unnest(array['mills','customers','suppliers','grades','orders','weighments',
    'mill_runs','assets','maintenance_schedules','maintenance_logs','lining_inspections'])
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "auth all" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

insert into mills (name) values ('Mill 1'), ('Mill 2');
