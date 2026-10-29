-- v7: link to the finance ERP (read-only). Safe to run more than once. Run after migration_v6.sql.
alter table suppliers add column if not exists finance_id bigint;
alter table customers add column if not exists finance_id bigint;
alter table customers add column if not exists gstin text;
alter table customers add column if not exists state text;
create unique index if not exists suppliers_finance_idx on suppliers (finance_id) where finance_id is not null;
create unique index if not exists customers_finance_idx on customers (finance_id) where finance_id is not null;

-- An inbound load can point at the finance purchase it belongs to (finance purchases.id), to check the billed tonnes.
alter table weighments add column if not exists finance_purchase_id bigint;
create index if not exists weighments_fin_purchase_idx on weighments (finance_purchase_id) where finance_purchase_id is not null;
