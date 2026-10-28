-- v6: QC by lot or by bag, 1 kg QC pouches, standard maintenance checklist, and an upload-storage re-check.
-- Safe to run more than once. Run after migration_v5.sql.

-- ================= Lab reports can belong to one bag (its own test) as well as to a lot =================
alter table lab_reports add column if not exists bag_id uuid references bags(id) on delete set null;
create index if not exists lab_reports_bag_idx on lab_reports (bag_id) where bag_id is not null;

create or replace function trg_lab_bag_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.bag_id is not null and not exists (select 1 from bags where id = new.bag_id and batch_id = new.batch_id) then
    raise exception 'That bag does not belong to the selected lot';
  end if;
  return new;
end $$;
drop trigger if exists lab_bag_check on lab_reports;
create trigger lab_bag_check before insert or update on lab_reports for each row execute function trg_lab_bag_check();

-- Only lot-level reports (no bag) fill the lot's values; a single bag's test stays on that bag.
create or replace function trg_lab_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare b uuid := coalesce(new.batch_id, old.batch_id); r lab_reports;
begin
  select * into r from lab_reports where batch_id = b and bag_id is null and status = 'approved' order by tested_on desc, created_at desc limit 1;
  if found then
    update batches set sio2_pct = coalesce(r.sio2_pct, sio2_pct), fe2o3_pct = coalesce(r.fe2o3_pct, fe2o3_pct),
                       moisture_pct = coalesce(r.moisture_pct, moisture_pct), whiteness_pct = coalesce(r.whiteness_pct, whiteness_pct),
                       tested_on = r.tested_on
     where id = b;
  end if;
  return null;
end $$;

-- ================= 1 kg QC pouches: same serial number as the bag =================
create table if not exists qc_samples (
  id uuid primary key default gen_random_uuid(),
  sample_no text not null unique,                       -- identical to the bag number
  bag_id uuid not null unique references bags(id) on delete cascade,
  batch_id uuid not null references batches(id) on delete cascade,
  pouch_kg numeric(6,3) not null default 1,
  location text,                                        -- shelf / box where it is kept
  status text not null default 'retained' check (status in ('retained', 'used', 'discarded')),
  notes text,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz default now()
);
create index if not exists qc_samples_batch_idx on qc_samples (batch_id);

drop trigger if exists audit_qc_samples on qc_samples;
create trigger audit_qc_samples after insert or update or delete on qc_samples for each row execute function log_audit();

alter table qc_samples enable row level security;
drop policy if exists "read" on qc_samples;
drop policy if exists "ins" on qc_samples;
drop policy if exists "upd" on qc_samples;
drop policy if exists "del" on qc_samples;
create policy "read" on qc_samples for select to authenticated using (has_role('{admin,supervisor,weighbridge,operator,maintenance,lab,viewer}'::app_role[]));
create policy "ins" on qc_samples for insert to authenticated with check (has_role('{admin,supervisor,operator,lab}'::app_role[]));
create policy "upd" on qc_samples for update to authenticated using (has_role('{admin,supervisor,operator,lab}'::app_role[])) with check (has_role('{admin,supervisor,operator,lab}'::app_role[]));
create policy "del" on qc_samples for delete to authenticated using (has_role('{admin}'::app_role[]));

-- Make a pouch record for every given bag that has none. Returns the number created.
create or replace function create_qc_samples(p_bag_ids uuid[], p_location text default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not has_role('{admin,supervisor,operator,lab}'::app_role[]) then raise exception 'Not allowed'; end if;
  insert into qc_samples (sample_no, bag_id, batch_id, location)
  select b.bag_no, b.id, b.batch_id, nullif(trim(p_location), '') from bags b where b.id = any(p_bag_ids)
  on conflict (bag_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function create_qc_samples(uuid[], text) from public, anon;
grant execute on function create_qc_samples(uuid[], text) to authenticated;

-- ================= Public certificate: a bag's own approved report wins over its lot's =================
create or replace function public_bag_certificate(p_bag_no text, p_token text) returns json
language plpgsql stable security definer set search_path = public as $$
declare bag bags; b batches; g grades; m grade_meshes; r lab_reports;
begin
  select * into bag from bags where bag_no = upper(trim(p_bag_no));
  if not found then return null; end if;
  select * into b from batches where id = bag.batch_id;
  if b.cert_token is distinct from p_token then return null; end if;
  if b.qc_hold then
    return json_build_object('held', true, 'company', 'Nova Geo Resources', 'bag_no', bag.bag_no);
  end if;
  select * into g from grades where id = b.grade_id;
  select * into m from grade_meshes where id = b.mesh_id;
  select * into r from lab_reports where batch_id = b.id and status = 'approved' and (bag_id is null or bag_id = bag.id)
   order by (bag_id is not null) desc, tested_on desc, created_at desc limit 1;   -- this bag's own test first, then the lot's
  return json_build_object(
    'company', 'Nova Geo Resources', 'bag_no', bag.bag_no, 'bag_type', bag.bag_type, 'weight_kg', bag.weight_kg, 'packed_at', bag.packed_at,
    'batch_no', b.batch_no, 'produced_on', b.produced_on, 'grade', g.name, 'mesh', m.mesh,
    'sio2_pct', coalesce(r.sio2_pct, b.sio2_pct), 'fe2o3_pct', coalesce(r.fe2o3_pct, b.fe2o3_pct),
    'moisture_pct', coalesce(r.moisture_pct, b.moisture_pct), 'whiteness_pct', coalesce(r.whiteness_pct, b.whiteness_pct),
    'tested_on', coalesce(r.tested_on, b.tested_on),
    'limits', json_build_object(
      'min_sio2', coalesce(m.spec_min_sio2, g.spec_min_sio2), 'max_fe2o3', coalesce(m.spec_max_fe2o3, g.spec_max_fe2o3),
      'max_moisture', coalesce(m.spec_max_moisture, g.spec_max_moisture), 'min_whiteness', coalesce(m.spec_min_whiteness, g.spec_min_whiteness)),
    'report', case when r.id is null then null else json_build_object(
      'report_no', r.report_no, 'lab_name', r.lab_name, 'tested_on', r.tested_on,
      'al2o3_pct', r.al2o3_pct, 'tio2_pct', r.tio2_pct, 'cao_pct', r.cao_pct, 'loi_pct', r.loi_pct,
      'd50_um', r.d50_um, 'd97_um', r.d97_um, 'residue_pct', r.residue_pct, 'bulk_density', r.bulk_density,
      'for_this_bag', r.bag_id is not null) end);
end $$;
revoke execute on function public_bag_certificate(text, text) from public;
grant execute on function public_bag_certificate(text, text) to anon, authenticated;

-- ================= Standard maintenance checklist (only added where a task of that name does not exist yet) =================
create or replace function seed_maintenance_task(p_asset text, p_kind asset_kind, p_mill uuid, p_task text, p_days int, p_hours numeric default null)
returns void language plpgsql as $$
declare a uuid;
begin
  select id into a from assets where name = p_asset limit 1;
  if a is null then insert into assets (name, kind, mill_id) values (p_asset, p_kind, p_mill) returning id into a; end if;
  if not exists (select 1 from maintenance_schedules where asset_id = a and task = p_task) then
    insert into maintenance_schedules (asset_id, task, every_days, every_hours) values (a, p_task, p_days, p_hours);
  end if;
end $$;

do $$
declare m record; n text;
begin
  for m in select id, name from mills loop
    n := m.name;
    perform seed_maintenance_task(n || ' - lining and shell', 'mill_lining', m.id, 'Inspect resin lining: lifting, cracks, thickness at the thinnest point', 30);
    perform seed_maintenance_task(n || ' - lining and shell', 'mill_lining', m.id, 'Check shell bolts and liner fasteners for tightness and leaks', 14);
    perform seed_maintenance_task(n || ' - lining and shell', 'mill_lining', m.id, 'Check grinding media (road metal) level and top up', 7);
    perform seed_maintenance_task(n || ' - main motor', 'motor', m.id, 'Check motor temperature, noise and vibration', 7);
    perform seed_maintenance_task(n || ' - main motor', 'motor', m.id, 'Grease motor bearings', 90);
    perform seed_maintenance_task(n || ' - main motor', 'motor', m.id, 'Clean motor cooling fins and check terminal tightness', 90);
    perform seed_maintenance_task(n || ' - main motor', 'motor', m.id, 'Insulation (megger) test of motor', 180);
    perform seed_maintenance_task(n || ' - gearbox', 'gearbox', m.id, 'Check gearbox oil level and look for leaks', 7);
    perform seed_maintenance_task(n || ' - gearbox', 'gearbox', m.id, 'Clean gearbox breather', 30);
    perform seed_maintenance_task(n || ' - gearbox', 'gearbox', m.id, 'Change gearbox oil and clean magnetic plug', 180);
    perform seed_maintenance_task(n || ' - trunnion bearings', 'bearing', m.id, 'Grease main bearings and check bearing temperature', 7);
    perform seed_maintenance_task(n || ' - trunnion bearings', 'bearing', m.id, 'Check bearing oil / seals for leaks', 30);
    perform seed_maintenance_task(n || ' - pinion and girth gear', 'other', m.id, 'Lubricate open gear (pinion and girth gear)', 7);
    perform seed_maintenance_task(n || ' - pinion and girth gear', 'other', m.id, 'Check gear alignment, backlash and tooth wear', 90);
  end loop;
end $$;

select seed_maintenance_task('Bag filter', 'bag_filter', null, 'Check differential pressure and compressed air pulse', 7);
select seed_maintenance_task('Bag filter', 'bag_filter', null, 'Empty the dust hopper / check rotary valve', 7);
select seed_maintenance_task('Bag filter', 'bag_filter', null, 'Inspect filter bags and cages for holes or dust leaks', 30);
select seed_maintenance_task('Bag filter', 'bag_filter', null, 'Replace filter bags', 365);
select seed_maintenance_task('Cyclone', 'cyclone', null, 'Inspect cyclone for wear and blockage', 30);
select seed_maintenance_task('Blower / ID fan', 'fan', null, 'Check fan belts, vibration and impeller cleanliness', 30);
select seed_maintenance_task('Blower / ID fan', 'fan', null, 'Grease fan bearings', 90);
select seed_maintenance_task('Conveyors and elevator', 'conveyor', null, 'Check belt / chain tension and alignment', 14);
select seed_maintenance_task('Conveyors and elevator', 'conveyor', null, 'Lubricate rollers, chains and bearings', 30);
select seed_maintenance_task('Conveyors and elevator', 'conveyor', null, 'Clear spilled powder around conveyors', 7);
select seed_maintenance_task('Magnetic separator', 'other', null, 'Clean magnets and check for iron pick-up', 7);
select seed_maintenance_task('Packing machine', 'other', null, 'Clean packing machine and check seals', 7);
select seed_maintenance_task('Packing machine', 'other', null, 'Check packing scale with test weights', 30);
select seed_maintenance_task('Weighbridge', 'other', null, 'Clean weighbridge pit and check load cells / junction box', 30);
select seed_maintenance_task('Weighbridge', 'other', null, 'Calibrate with test weights', 90);
select seed_maintenance_task('Weighbridge', 'other', null, 'Legal Metrology verification and stamping', 365);
select seed_maintenance_task('Air compressor', 'other', null, 'Drain moisture and check compressor oil level', 7);
select seed_maintenance_task('Air compressor', 'other', null, 'Clean or replace compressor air filter', 30);
select seed_maintenance_task('Electrical panels', 'other', null, 'Tighten connections and thermal-scan panels', 180);
select seed_maintenance_task('Electrical panels', 'other', null, 'Check earthing and fire extinguishers', 180);

-- ================= Uploads: re-assert the storage bucket and policies =================
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('photos', 'photos', false) on conflict (id) do nothing;
    drop policy if exists "photos read" on storage.objects;
    drop policy if exists "photos upload" on storage.objects;
    drop policy if exists "photos delete" on storage.objects;
    create policy "photos read" on storage.objects for select to authenticated
      using (bucket_id = 'photos' and has_role('{admin,supervisor,weighbridge,operator,maintenance,lab,viewer}'::app_role[]));
    create policy "photos upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'photos' and has_role('{admin,supervisor,weighbridge,operator,maintenance,lab}'::app_role[]));
    create policy "photos delete" on storage.objects for delete to authenticated
      using (bucket_id = 'photos' and has_role('{admin}'::app_role[]));
  end if;
end $$;
