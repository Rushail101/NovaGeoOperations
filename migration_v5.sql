-- BallMill Ops v5: in-house lab reports (enter, approve, print, upload), public batch certificate behind the bag QR,
-- lab role. Run AFTER migration_v5a_lab_role.sql (separately). Safe to re-run.

-- The lab role can see everything a viewer can; it writes only where a policy names it (lab reports).
create or replace function has_role(roles app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(app_role_of() = any(roles) or (app_role_of() = 'lab' and 'viewer' = any(roles)), false)
$$;

-- ================= Lab reports =================
create sequence if not exists lab_report_seq;
grant usage, select on sequence lab_report_seq to authenticated;

create table if not exists lab_reports (
  id uuid primary key default gen_random_uuid(),
  report_no text unique not null default ('LR-' || to_char(now() at time zone 'Asia/Kolkata', 'YYMMDD') || '-' || lpad(nextval('lab_report_seq')::text, 4, '0')),
  batch_id uuid not null references batches(id),
  lab_name text not null default 'Nova Geo in-house lab',
  sample_ref text,
  sampled_at timestamptz,
  tested_on date not null default (now() at time zone 'Asia/Kolkata')::date,
  tested_by text,
  sio2_pct numeric(6,3),
  fe2o3_pct numeric(6,4),
  al2o3_pct numeric(6,3),
  tio2_pct numeric(6,3),
  cao_pct numeric(6,3),
  loi_pct numeric(6,3),
  moisture_pct numeric(5,2),
  whiteness_pct numeric(5,2),
  d50_um numeric(7,2),
  d97_um numeric(7,2),
  residue_pct numeric(6,3),
  bulk_density numeric(6,3),
  remarks text,
  doc_paths text[],                         -- uploaded report from an outside lab, or supporting scans
  status text not null default 'draft' check (status in ('draft', 'approved')),
  approved_by uuid references profiles(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz default now()
);
create index if not exists lab_reports_batch_idx on lab_reports (batch_id, tested_on desc);

create or replace function trg_lab_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare uname text;
begin
  if tg_op = 'INSERT' then
    if new.status = 'approved' then
      if has_role('{admin,supervisor}'::app_role[]) then new.approved_by := auth.uid(); new.approved_at := now();
      else new.status := 'draft'; end if;
    end if;
    if new.tested_by is null then
      select coalesce(full_name, username) into uname from profiles where id = auth.uid();
      new.tested_by := uname;
    end if;
    return new;
  end if;
  if new.batch_id <> old.batch_id then raise exception 'A report cannot be moved to another batch'; end if;
  if old.status = 'approved' and not has_role('{admin}'::app_role[]) then
    raise exception 'Approved reports are locked. Ask an admin to reopen it.';
  end if;
  if new.status = 'approved' and old.status <> 'approved' then
    if not has_role('{admin,supervisor}'::app_role[]) then raise exception 'Only a supervisor or admin can approve a lab report'; end if;
    new.approved_by := auth.uid(); new.approved_at := now();
  elsif new.status = 'draft' then
    new.approved_by := null; new.approved_at := null;
  end if;
  return new;
end $$;
drop trigger if exists lab_guard on lab_reports;
create trigger lab_guard before insert or update on lab_reports for each row execute function trg_lab_guard();

-- The newest approved report of a batch fills the batch's lab values (used by spec checks and certificates).
create or replace function trg_lab_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare b uuid := coalesce(new.batch_id, old.batch_id); r lab_reports;
begin
  select * into r from lab_reports where batch_id = b and status = 'approved' order by tested_on desc, created_at desc limit 1;
  if found then
    update batches set sio2_pct = coalesce(r.sio2_pct, sio2_pct), fe2o3_pct = coalesce(r.fe2o3_pct, fe2o3_pct),
                       moisture_pct = coalesce(r.moisture_pct, moisture_pct), whiteness_pct = coalesce(r.whiteness_pct, whiteness_pct),
                       tested_on = r.tested_on
     where id = b;
  end if;
  return null;
end $$;
drop trigger if exists lab_sync on lab_reports;
create trigger lab_sync after insert or update or delete on lab_reports for each row execute function trg_lab_sync();

drop trigger if exists audit_lab_reports on lab_reports;
create trigger audit_lab_reports after insert or update or delete on lab_reports for each row execute function log_audit();

alter table lab_reports enable row level security;
drop policy if exists "read" on lab_reports;
drop policy if exists "ins" on lab_reports;
drop policy if exists "upd" on lab_reports;
drop policy if exists "del" on lab_reports;
create policy "read" on lab_reports for select to authenticated using (has_role('{admin,supervisor,weighbridge,operator,maintenance,lab,viewer}'::app_role[]));
create policy "ins" on lab_reports for insert to authenticated with check (has_role('{admin,supervisor,lab}'::app_role[]));
create policy "upd" on lab_reports for update to authenticated using (has_role('{admin,supervisor,lab}'::app_role[])) with check (has_role('{admin,supervisor,lab}'::app_role[]));
create policy "del" on lab_reports for delete to authenticated using (has_role('{admin}'::app_role[]));

-- ================= Public certificate behind the bag QR =================
-- Each batch gets a random token. The QR on a bag holds the bag number plus this token, so numbers cannot be guessed.
alter table batches add column if not exists cert_token text not null default substr(md5(random()::text || clock_timestamp()::text), 1, 12);
create unique index if not exists batches_cert_token_idx on batches (cert_token);

-- Returns only product and quality data (no customer, order, supplier, mill or lot). Null if the number/token do not match.
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
  select * into r from lab_reports where batch_id = b.id and status = 'approved' order by tested_on desc, created_at desc limit 1;
  return json_build_object(
    'company', 'Nova Geo Resources', 'bag_no', bag.bag_no, 'bag_type', bag.bag_type, 'weight_kg', bag.weight_kg, 'packed_at', bag.packed_at,
    'batch_no', b.batch_no, 'produced_on', b.produced_on, 'grade', g.name, 'mesh', m.mesh,
    'sio2_pct', b.sio2_pct, 'fe2o3_pct', b.fe2o3_pct, 'moisture_pct', b.moisture_pct, 'whiteness_pct', b.whiteness_pct, 'tested_on', b.tested_on,
    'limits', json_build_object(
      'min_sio2', coalesce(m.spec_min_sio2, g.spec_min_sio2), 'max_fe2o3', coalesce(m.spec_max_fe2o3, g.spec_max_fe2o3),
      'max_moisture', coalesce(m.spec_max_moisture, g.spec_max_moisture), 'min_whiteness', coalesce(m.spec_min_whiteness, g.spec_min_whiteness)),
    'report', case when r.id is null then null else json_build_object(
      'report_no', r.report_no, 'lab_name', r.lab_name, 'tested_on', r.tested_on,
      'al2o3_pct', r.al2o3_pct, 'tio2_pct', r.tio2_pct, 'cao_pct', r.cao_pct, 'loi_pct', r.loi_pct,
      'd50_um', r.d50_um, 'd97_um', r.d97_um, 'residue_pct', r.residue_pct, 'bulk_density', r.bulk_density) end);
end $$;
revoke execute on function public_bag_certificate(text, text) from public;
grant execute on function public_bag_certificate(text, text) to anon, authenticated;

-- ================= Uploads: let the lab role upload report files =================
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    drop policy if exists "photos upload" on storage.objects;
    create policy "photos upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'photos' and has_role('{admin,supervisor,weighbridge,operator,maintenance,lab}'::app_role[]));
  end if;
end $$;
