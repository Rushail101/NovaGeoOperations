-- BallMill Ops v4: mesh sizes per grade, inbound/outbound paperwork (supplier invoice, transit permit, uploads),
-- supplier lease + plant licence expiry, vehicle list, physical stock counts.
-- Run AFTER schema.sql, migration_v2.sql and migration_v3.sql. Safe to re-run.

-- ================= Mesh sizes under a grade =================
create table if not exists grade_meshes (
  id uuid primary key default gen_random_uuid(),
  grade_id uuid not null references grades(id) on delete cascade,
  mesh text not null,                       -- e.g. '200', '325', '-100 +200'
  notes text,
  active boolean not null default true,
  -- optional limits for this mesh; empty = use the grade's limits
  spec_min_sio2 numeric(6,3),
  spec_max_fe2o3 numeric(6,4),
  spec_max_moisture numeric(5,2),
  spec_min_whiteness numeric(5,2),
  created_at timestamptz default now(),
  unique (grade_id, mesh)
);

alter table orders add column if not exists mesh_id uuid references grade_meshes(id);
alter table batches add column if not exists mesh_id uuid references grade_meshes(id);
alter table mill_runs add column if not exists mesh_id uuid references grade_meshes(id);

-- Carry over the single "mesh" text that grades used to have
insert into grade_meshes (grade_id, mesh)
select id, trim(mesh) from grades where nullif(trim(mesh), '') is not null
on conflict (grade_id, mesh) do nothing;
update orders o set mesh_id = m.id from grade_meshes m where m.grade_id = o.grade_id and o.mesh_id is null
  and (select count(*) from grade_meshes x where x.grade_id = o.grade_id) = 1;
update batches o set mesh_id = m.id from grade_meshes m where m.grade_id = o.grade_id and o.mesh_id is null
  and (select count(*) from grade_meshes x where x.grade_id = o.grade_id) = 1;
update mill_runs o set mesh_id = m.id from grade_meshes m where m.grade_id = o.grade_id and o.mesh_id is null
  and (select count(*) from grade_meshes x where x.grade_id = o.grade_id) = 1;

create or replace function trg_mesh_matches_grade() returns trigger
language plpgsql as $$
declare g uuid;
begin
  if new.mesh_id is not null then
    select grade_id into g from grade_meshes where id = new.mesh_id;
    if g is distinct from new.grade_id then raise exception 'That mesh size belongs to a different grade'; end if;
  end if;
  return new;
end $$;
do $$
declare t text;
begin
  for t in select unnest(array['orders', 'batches', 'mill_runs']) loop
    execute format('drop trigger if exists mesh_matches_grade on %I', t);
    execute format('create trigger mesh_matches_grade before insert or update of grade_id, mesh_id on %I for each row execute function trg_mesh_matches_grade()', t);
  end loop;
end $$;

-- ================= Inbound / outbound paperwork =================
alter table weighments add column if not exists supplier_invoice_no text;
alter table weighments add column if not exists supplier_invoice_date date;
alter table weighments add column if not exists permit_no text;
alter table weighments add column if not exists permit_qty_kg numeric(12,2);
alter table weighments add column if not exists permit_valid_until date;
alter table weighments add column if not exists doc_paths text[];

alter table suppliers add column if not exists lease_no text;
alter table suppliers add column if not exists lease_valid_until date;
alter table suppliers add column if not exists doc_paths text[];

create table if not exists plant_settings (key text primary key, value text not null);
insert into plant_settings (key, value) values ('permit_variance_pct', '3') on conflict (key) do nothing;

create table if not exists licences (
  id uuid primary key default gen_random_uuid(),
  name text not null,                       -- e.g. 'Consent to operate (pollution board)'
  licence_no text,
  issued_by text,
  valid_until date,
  notes text,
  doc_paths text[],
  created_at timestamptz default now()
);

create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  vehicle_no text not null,
  default_tare_kg numeric(12,2),
  transporter text,
  notes text,
  created_at timestamptz default now()
);
create unique index if not exists vehicles_no_idx on vehicles (upper(replace(vehicle_no, ' ', '')));

create table if not exists stock_counts (
  id uuid primary key default gen_random_uuid(),
  counted_on date not null default (now() at time zone 'Asia/Kolkata')::date,
  location text not null check (location in ('raw_yard', 'unpacked_powder', 'packed_bags')),
  system_kg numeric(12,2) not null,
  counted_kg numeric(12,2) not null check (counted_kg >= 0),
  diff_kg numeric(12,2) generated always as (counted_kg - system_kg) stored,
  notes text,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz default now()
);

-- Attach uploaded files to a weighment (also used by the weighbridge, who cannot edit weighments directly).
create or replace function add_weighment_docs(p_id uuid, p_paths text[])
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('{admin,supervisor,weighbridge}'::app_role[]) then raise exception 'Not allowed'; end if;
  update weighments w set doc_paths = (select array_agg(distinct x) from unnest(coalesce(w.doc_paths, '{}') || coalesce(p_paths, '{}')) x)
   where w.id = p_id and w.type in ('inbound', 'dispatch');
  if not found then raise exception 'Weighment not found'; end if;
end $$;

-- Fill in or correct the paperwork of an inbound load after weighing.
create or replace function set_inbound_docs(
  p_id uuid, p_invoice_no text, p_invoice_date date, p_permit_no text, p_permit_qty numeric, p_permit_valid date, p_eway text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('{admin,supervisor,weighbridge}'::app_role[]) then raise exception 'Not allowed'; end if;
  update weighments set supplier_invoice_no = nullif(trim(p_invoice_no), ''), supplier_invoice_date = p_invoice_date,
         permit_no = nullif(trim(p_permit_no), ''), permit_qty_kg = p_permit_qty, permit_valid_until = p_permit_valid,
         eway_bill_no = nullif(trim(p_eway), '')
   where id = p_id and type = 'inbound';
  if not found then raise exception 'Inbound weighment not found'; end if;
end $$;

do $$
declare f text;
begin
  for f in select unnest(array[
    'add_weighment_docs(uuid, text[])',
    'set_inbound_docs(uuid, text, date, text, numeric, date, text)'])
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ================= Audit + row level security =================
do $$
declare t text;
begin
  for t in select unnest(array['grade_meshes', 'licences', 'vehicles', 'stock_counts'])
  loop
    execute format('drop trigger if exists audit_%1$s on %1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on %1$I for each row execute function log_audit()', t);
  end loop;
end $$;

do $$
declare r record;
begin
  for r in select * from (values
    ('grade_meshes',   '{admin,supervisor}',                       '{admin,supervisor}'),
    ('licences',       '{admin,supervisor}',                       '{admin,supervisor}'),
    ('vehicles',       '{admin,supervisor,weighbridge}',           '{admin,supervisor,weighbridge}'),
    ('stock_counts',   '{admin,supervisor,operator}',              '{admin,supervisor}'),
    ('plant_settings', '{admin}',                                  '{admin}')
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

-- Allow PDFs and photos up to 8 MB in the private bucket (skipped if the storage schema differs)
do $$
begin
  update storage.buckets set file_size_limit = 8388608,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] where id = 'photos';
exception when others then
  raise notice 'bucket limits not set: %', sqlerrm;
end $$;
