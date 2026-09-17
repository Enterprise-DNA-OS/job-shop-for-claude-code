-- job-shop-for-claude-code: core schema.
-- A make-to-order engineering and fabrication shop: the quotes and the jobs,
-- the planned materials and what actually got issued (with heat numbers where
-- traceability demands them), the hours booked at cost and charge rates, the
-- work centres and their service clocks, the stock and the purchase orders,
-- and the invoices the billing run drafts, payment claims and retentions
-- included.
--
-- Runs unchanged on PGlite (embedded) and on Postgres / Supabase.
--
-- Money is in cents. Rates are captured onto every time entry and every issue
-- the day they happen, so a rate change never rewrites a running job. Job cost
-- is ONE view, v_job_cost, and everything that talks about money (the board,
-- WIP, billing, attention) reads it. Cost is materials issued plus hours at
-- cost rates plus received direct-to-job purchases; charge is the quote on a
-- fixed-price job and labour-at-charge plus materials-at-sell plus outwork at
-- cost on a time-and-materials job.

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- Staff --------------------------------------------------------------------
-- Estimator, tradespeople, storeman, the manager. Every hour booked captures
-- the person's cost and charge rates as they stood that day. weekly_hours is
-- capacity, read by the labour recovery view.

create table if not exists staff (
  id                uuid primary key default gen_random_uuid(),
  full_name         text not null,
  code              text,
  email             text,
  phone             text,
  role              text not null default 'tradesperson',  -- manager | estimator | tradesperson | storeman
  cost_rate_cents   bigint not null default 0,             -- what an hour costs the shop
  charge_rate_cents bigint not null default 0,             -- what an hour bills at
  weekly_hours      integer not null default 40,
  active            boolean not null default true,
  external_ref      text unique,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists staff_name_lower_idx on staff (lower(full_name));

-- Customers ------------------------------------------------------------------
-- account_type drives the CGA position on made goods. ppsr_registered_on is
-- the financing statement covering retention-of-title terms: goods delivered
-- on credit with no registration are what a liquidator takes (PPSA 1999).
-- on_stop is the credit hold; the CLI refuses new quotes to a stopped account.

create table if not exists customers (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  code               text,
  account_type       text not null default 'trade',   -- trade | consumer
  contact_name       text,
  email              text,
  phone              text,
  city               text,
  terms_days         integer not null default 20,
  credit_limit_cents bigint,
  on_stop            boolean not null default false,
  ppsr_registered_on date,
  status             text not null default 'active',  -- active | former
  note               text,
  external_ref       text unique,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists customers_name_lower_idx on customers (lower(name));

-- Suppliers ------------------------------------------------------------------

create table if not exists suppliers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  code           text,
  contact_name   text,
  email          text,
  phone          text,
  lead_time_days integer,
  note           text,
  external_ref   text unique,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists suppliers_name_lower_idx on suppliers (lower(name));

-- Work centres ------------------------------------------------------------------
-- The shop's own machines and bays: saw, machine shop, press brake, welding
-- bays, paint. Hours book against them, so loading is readable, and each one
-- carries a service clock (HSWA 2015 s 36; GRWM Regulations 2016: plant
-- maintained so it stays safe). An overdue clock is a compliance breach, not
-- a preference.

create table if not exists work_centres (
  id                      uuid primary key default gen_random_uuid(),
  code                    text not null,
  name                    text not null,
  weekly_capacity_hours   integer not null default 40,
  last_service_on         date,
  service_interval_months integer not null default 6,
  note                    text,
  external_ref            text unique,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create unique index if not exists work_centres_code_lower_idx on work_centres (lower(code));

-- Items: stock ------------------------------------------------------------------
-- Steel, plate, fasteners, bought-in parts, consumables. traceable means the
-- item needs a heat or certificate number when it goes onto a structural job
-- (AS/NZS 5131 traceability). unit_cost_cents is the latest landed cost;
-- sell_cents is the rate a time-and-materials job charges it at.

create table if not exists items (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null,
  description           text not null,
  kind                  text not null default 'material',  -- material | bought-in | consumable
  unit                  text not null default 'ea',        -- ea | m | kg | sheet | l
  on_hand               numeric(12,2) not null default 0,
  reorder_level         numeric(12,2) not null default 0,
  reorder_qty           numeric(12,2) not null default 0,
  unit_cost_cents       bigint not null default 0,
  sell_cents            bigint not null default 0,
  traceable             boolean not null default false,
  preferred_supplier_id uuid references suppliers(id) on delete set null,
  note                  text,
  external_ref          text unique,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists items_code_lower_idx on items (lower(code));

-- Jobs -----------------------------------------------------------------------
-- One row from quote to closed. Statuses:
--   quote       priced, with the customer
--   accepted    won, not started
--   in-progress on the floor
--   on-hold     stopped, with a reason in the notes
--   complete    made, awaiting invoice and pickup
--   closed      billed and done
--   lost        quoted, did not win
--
-- charge_basis fixed: the quote is the price. time-and-materials: hours at
-- charge rates plus materials at sell plus outwork at cost.
-- structural: issued materials need heat numbers (AS/NZS 5131).
-- construction_work: invoices should go out as payment claims (Construction
-- Contracts Act 2002).

create table if not exists jobs (
  id                uuid primary key default gen_random_uuid(),
  ref               text unique,
  customer_id       uuid not null references customers(id) on delete cascade,
  title             text not null,
  description       text,
  status            text not null default 'quote',   -- quote | accepted | in-progress | on-hold | complete | closed | lost
  charge_basis      text not null default 'fixed',   -- fixed | time-and-materials
  quoted_cents      bigint,
  quoted_on         date,
  won_on            date,
  started_on        date,
  promised_on       date,
  completed_on      date,
  closed_on         date,
  po_number         text,
  structural        boolean not null default false,
  construction_work boolean not null default false,
  estimator_id      uuid references staff(id) on delete set null,
  lost_reason       text,
  note              text,
  external_ref      text unique,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists jobs_customer_idx on jobs (customer_id);
create index if not exists jobs_status_idx on jobs (status);

-- Planned materials: what the estimate said the job would eat. Costs and sell
-- rates are captured at planning, so the estimate stands still while the
-- price list moves. Shortages are planned minus issued minus what the shelf
-- and the open orders can cover.

create table if not exists job_lines (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references jobs(id) on delete cascade,
  item_id         uuid not null references items(id) on delete cascade,
  qty_planned     numeric(12,2) not null,
  unit_cost_cents bigint not null,
  sell_cents      bigint not null,
  note            text,
  created_at      timestamptz not null default now(),
  unique (job_id, item_id)
);
create index if not exists job_lines_job_idx on job_lines (job_id);

-- Issues: stock actually drawn onto a job. The shelf goes down, the job cost
-- goes up, and on a structural job a traceable item does not issue without a
-- heat number. That refusal is the CLI's, and it is deliberate.

create table if not exists issues (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references jobs(id) on delete cascade,
  item_id         uuid not null references items(id) on delete cascade,
  qty             numeric(12,2) not null,
  unit_cost_cents bigint not null,
  sell_cents      bigint not null,
  heat_no         text,
  issued_on       date not null default current_date,
  issued_by       uuid references staff(id) on delete set null,
  note            text,
  created_at      timestamptz not null default now()
);
create index if not exists issues_job_idx on issues (job_id);
create index if not exists issues_item_idx on issues (item_id);

-- Time: hours booked to a job at a work centre. Rates captured per entry.
-- These rows are also the shop's time records (Employment Relations Act 2000
-- s 130 wants time records kept; a gap in them is on the attention list).

create table if not exists time_entries (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references jobs(id) on delete cascade,
  staff_id          uuid not null references staff(id) on delete cascade,
  work_centre_id    uuid references work_centres(id) on delete set null,
  worked_on         date not null default current_date,
  hours             numeric(6,2) not null,
  cost_rate_cents   bigint not null,
  charge_rate_cents bigint not null,
  note              text,
  created_at        timestamptz not null default now()
);
create index if not exists time_entries_job_idx on time_entries (job_id);
create index if not exists time_entries_staff_idx on time_entries (staff_id);
create index if not exists time_entries_date_idx on time_entries (worked_on);

-- Purchase orders --------------------------------------------------------------
-- Two kinds, decided by job_id. A stock PO (job_id null) replenishes the
-- shelf: receiving it moves on_hand up and refreshes the item's latest cost.
-- A direct-to-job PO (job_id set) is outwork and buy-ins for one job:
-- receiving it puts the cost straight onto that job and never touches stock.

create table if not exists purchase_orders (
  id           uuid primary key default gen_random_uuid(),
  ref          text unique,
  supplier_id  uuid not null references suppliers(id) on delete cascade,
  job_id       uuid references jobs(id) on delete set null,
  status       text not null default 'open',   -- open | received | cancelled
  ordered_on   date not null default current_date,
  expected_on  date,
  received_on  date,
  note         text,
  external_ref text unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists purchase_orders_supplier_idx on purchase_orders (supplier_id);
create index if not exists purchase_orders_job_idx on purchase_orders (job_id);

create table if not exists po_lines (
  id              uuid primary key default gen_random_uuid(),
  po_id           uuid not null references purchase_orders(id) on delete cascade,
  item_id         uuid references items(id) on delete set null,  -- null = outwork / a described service
  description     text not null,
  qty             numeric(12,2) not null default 1,
  unit_cost_cents bigint not null,
  created_at      timestamptz not null default now()
);
create index if not exists po_lines_po_idx on po_lines (po_id);

-- Invoices --------------------------------------------------------------------
-- Drafted by the billing run from v_job_cost. A person sends them; the
-- accounting system keeps the ledger. payment_claim marks an invoice served
-- as a payment claim under the Construction Contracts Act 2002; retention_*
-- tracks money the customer withholds and the date it falls due back.

create table if not exists invoices (
  id                    uuid primary key default gen_random_uuid(),
  number                text unique,
  job_id                uuid not null references jobs(id) on delete cascade,
  customer_id           uuid not null references customers(id) on delete cascade,
  issued_on             date not null default current_date,
  due_on                date,
  total_cents           bigint not null default 0,
  payment_claim         boolean not null default false,
  retention_cents       bigint not null default 0,
  retention_due_on      date,
  retention_received_on date,
  status                text not null default 'draft',   -- draft | sent | paid
  sent_on               date,
  paid_on               date,
  note                  text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists invoices_job_idx on invoices (job_id);
create index if not exists invoices_customer_idx on invoices (customer_id);

create table if not exists invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references invoices(id) on delete cascade,
  description  text not null,
  amount_cents bigint not null,
  created_at   timestamptz not null default now()
);
create index if not exists invoice_lines_invoice_idx on invoice_lines (invoice_id);

-- Notes and tasks ----------------------------------------------------------------

create table if not exists notes (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete cascade,
  job_id      uuid references jobs(id) on delete cascade,
  staff_id    uuid references staff(id) on delete set null,
  noted_on    date not null default current_date,
  channel     text not null default 'phone',   -- phone | email | floor | site | counter
  note        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists notes_customer_idx on notes (customer_id);
create index if not exists notes_job_idx on notes (job_id);

create table if not exists tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  customer_id uuid references customers(id) on delete cascade,
  job_id      uuid references jobs(id) on delete cascade,
  staff_id    uuid references staff(id) on delete set null,
  due_on      date,
  status      text not null default 'open',    -- open | done
  done_on     date,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- updated_at triggers ---------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['staff','customers','suppliers','work_centres','items','jobs','purchase_orders','invoices','tasks']
  loop
    execute format('drop trigger if exists %I on %I', t || '_updated_at', t);
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_updated_at', t);
  end loop;
end
$$;

-- ==============================================================================
-- Views: the questions a job shop asks every week, as SQL it can read.
-- ==============================================================================

-- THE money view. Every cost and charge conversation in the system reads this,
-- so the board, WIP, billing and attention can never disagree with each other.
create or replace view v_job_cost as
select
  j.id as job_id,
  j.ref,
  j.customer_id,
  j.title,
  j.status,
  j.charge_basis,
  j.quoted_cents,
  j.promised_on,
  j.completed_on,
  coalesce((select sum(round(i.qty * i.unit_cost_cents)) from issues i where i.job_id = j.id), 0)::bigint as material_cost_cents,
  coalesce((select sum(round(i.qty * i.sell_cents)) from issues i where i.job_id = j.id), 0)::bigint as material_sell_cents,
  coalesce((select sum(round(t.hours * t.cost_rate_cents)) from time_entries t where t.job_id = j.id), 0)::bigint as labour_cost_cents,
  coalesce((select sum(round(t.hours * t.charge_rate_cents)) from time_entries t where t.job_id = j.id), 0)::bigint as labour_charge_cents,
  coalesce((select sum(t.hours) from time_entries t where t.job_id = j.id), 0)::numeric(10,2) as labour_hours,
  coalesce((select sum(round(pl.qty * pl.unit_cost_cents)) from po_lines pl
            join purchase_orders po on po.id = pl.po_id
            where po.job_id = j.id and po.status = 'received'), 0)::bigint as outwork_cost_cents,
  coalesce((select sum(round(i.qty * i.unit_cost_cents)) from issues i where i.job_id = j.id), 0)::bigint
    + coalesce((select sum(round(t.hours * t.cost_rate_cents)) from time_entries t where t.job_id = j.id), 0)::bigint
    + coalesce((select sum(round(pl.qty * pl.unit_cost_cents)) from po_lines pl
                join purchase_orders po on po.id = pl.po_id
                where po.job_id = j.id and po.status = 'received'), 0)::bigint as total_cost_cents,
  -- what the job is worth to bill: the quote on fixed, the meter on T and M
  case when j.charge_basis = 'fixed' then coalesce(j.quoted_cents, 0)
       else coalesce((select sum(round(t.hours * t.charge_rate_cents)) from time_entries t where t.job_id = j.id), 0)::bigint
          + coalesce((select sum(round(i.qty * i.sell_cents)) from issues i where i.job_id = j.id), 0)::bigint
          + coalesce((select sum(round(pl.qty * pl.unit_cost_cents)) from po_lines pl
                      join purchase_orders po on po.id = pl.po_id
                      where po.job_id = j.id and po.status = 'received'), 0)::bigint
  end as charge_value_cents,
  coalesce((select sum(iv.total_cents) from invoices iv where iv.job_id = j.id), 0)::bigint as invoiced_cents,
  greatest(0,
    case when j.charge_basis = 'fixed' then coalesce(j.quoted_cents, 0)
         else coalesce((select sum(round(t.hours * t.charge_rate_cents)) from time_entries t where t.job_id = j.id), 0)::bigint
            + coalesce((select sum(round(i.qty * i.sell_cents)) from issues i where i.job_id = j.id), 0)::bigint
            + coalesce((select sum(round(pl.qty * pl.unit_cost_cents)) from po_lines pl
                        join purchase_orders po on po.id = pl.po_id
                        where po.job_id = j.id and po.status = 'received'), 0)::bigint
    end
    - coalesce((select sum(iv.total_cents) from invoices iv where iv.job_id = j.id), 0)::bigint
  )::bigint as uninvoiced_cents
from jobs j
where j.status not in ('lost');

-- The job board: everything won and not yet closed, with the two numbers a
-- workshop manager reads first: days late against the promise, and how much
-- of a fixed quote the cost has already eaten.
create or replace view v_job_board as
select
  jc.job_id,
  jc.ref,
  c.name as customer,
  c.on_stop,
  jc.title,
  jc.status,
  j.charge_basis,
  j.structural,
  j.construction_work,
  j.started_on,
  jc.promised_on,
  case when jc.status in ('accepted', 'in-progress', 'on-hold') and jc.promised_on is not null and jc.promised_on < current_date
       then current_date - jc.promised_on end as days_late,
  jc.quoted_cents,
  jc.total_cost_cents,
  case when j.charge_basis = 'fixed' and coalesce(jc.quoted_cents, 0) > 0
       then round(jc.total_cost_cents * 100.0 / jc.quoted_cents) end as quote_burnt_pct,
  jc.labour_hours,
  jc.invoiced_cents,
  jc.uninvoiced_cents,
  greatest(
    (select max(i.issued_on) from issues i where i.job_id = jc.job_id),
    (select max(t.worked_on) from time_entries t where t.job_id = jc.job_id)
  ) as last_activity_on
from v_job_cost jc
join jobs j on j.id = jc.job_id
join customers c on c.id = j.customer_id
where jc.status in ('accepted', 'in-progress', 'on-hold', 'complete');

-- Open quotes, oldest first, with the last time anyone spoke to the customer.
create or replace view v_quotes as
select
  j.id as job_id,
  j.ref,
  c.name as customer,
  j.title,
  j.quoted_cents,
  j.quoted_on,
  (current_date - j.quoted_on) as days_out,
  j.promised_on,
  coalesce(s.full_name, '') as estimator,
  (select max(n.noted_on) from notes n where n.job_id = j.id) as last_contact_on
from jobs j
join customers c on c.id = j.customer_id
left join staff s on s.id = j.estimator_id
where j.status = 'quote';

-- Stock: the shelf, what open jobs still plan to draw, what is on order, and
-- whether the free position has fallen through the reorder level.
create or replace view v_stock as
select
  it.id as item_id,
  it.code,
  it.description,
  it.kind,
  it.unit,
  it.on_hand,
  coalesce((select sum(greatest(0, jl.qty_planned - coalesce((select sum(i.qty) from issues i where i.job_id = jl.job_id and i.item_id = jl.item_id), 0)))
            from job_lines jl join jobs j on j.id = jl.job_id
            where jl.item_id = it.id and j.status in ('accepted', 'in-progress', 'on-hold')), 0)::numeric(12,2) as allocated,
  coalesce((select sum(pl.qty) from po_lines pl join purchase_orders po on po.id = pl.po_id
            where pl.item_id = it.id and po.status = 'open'), 0)::numeric(12,2) as on_order,
  (it.on_hand
   - coalesce((select sum(greatest(0, jl.qty_planned - coalesce((select sum(i.qty) from issues i where i.job_id = jl.job_id and i.item_id = jl.item_id), 0)))
               from job_lines jl join jobs j on j.id = jl.job_id
               where jl.item_id = it.id and j.status in ('accepted', 'in-progress', 'on-hold')), 0))::numeric(12,2) as free,
  it.reorder_level,
  it.reorder_qty,
  it.unit_cost_cents,
  it.sell_cents,
  it.traceable,
  s.name as preferred_supplier,
  (select min(po.expected_on) from po_lines pl join purchase_orders po on po.id = pl.po_id
   where pl.item_id = it.id and po.status = 'open') as next_delivery_on
from items it
left join suppliers s on s.id = it.preferred_supplier_id;

-- Shortages: per open job, planned material the shelf cannot cover, and
-- whether an open order is coming for it before the promise date. Each line
-- sees the shelf less what the OTHER open jobs still plan to draw, so a job
-- whose steel is already issued never reads as short.
create or replace view v_shortages as
select ref, customer, title, promised_on, item_code, item, unit,
       still_needed, on_hand, free, on_order, next_delivery_on,
       greatest(0, still_needed - greatest(0, on_hand - (allocated - still_needed)))::numeric(12,2) as short_qty
from (
  select
    j.ref,
    c.name as customer,
    j.title,
    j.promised_on,
    it.code as item_code,
    it.description as item,
    it.unit,
    (jl.qty_planned - coalesce((select sum(i.qty) from issues i where i.job_id = j.id and i.item_id = it.id), 0))::numeric(12,2) as still_needed,
    st.on_hand,
    st.allocated,
    st.free,
    st.on_order,
    st.next_delivery_on
  from job_lines jl
  join jobs j on j.id = jl.job_id
  join customers c on c.id = j.customer_id
  join items it on it.id = jl.item_id
  join v_stock st on st.item_id = it.id
  where j.status in ('accepted', 'in-progress', 'on-hold')
) s
where greatest(0, still_needed - greatest(0, on_hand - (allocated - still_needed))) > 0;

-- Work centre loading over the last 28 days, with the service clock beside it.
create or replace view v_loading as
select
  w.id as work_centre_id,
  w.code,
  w.name,
  w.weekly_capacity_hours,
  coalesce((select sum(t.hours) from time_entries t
            where t.work_centre_id = w.id and t.worked_on >= current_date - 28), 0)::numeric(10,2) as hours_28d,
  round(coalesce((select sum(t.hours) from time_entries t
                  where t.work_centre_id = w.id and t.worked_on >= current_date - 28), 0) * 100.0
        / nullif(w.weekly_capacity_hours * 4, 0)) as loading_pct,
  (w.last_service_on is null
   or w.last_service_on + (w.service_interval_months || ' months')::interval <= current_date::timestamp) as service_overdue,
  w.last_service_on,
  w.service_interval_months
from work_centres w;

-- Labour, the last 7 days: hours against capacity and the charge recovered.
create or replace view v_labour_week as
select
  s.id as staff_id,
  s.full_name,
  s.role,
  s.weekly_hours,
  coalesce((select sum(t.hours) from time_entries t
            where t.staff_id = s.id and t.worked_on > current_date - 7), 0)::numeric(10,2) as hours_7d,
  coalesce((select sum(round(t.hours * t.charge_rate_cents)) from time_entries t
            where t.staff_id = s.id and t.worked_on > current_date - 7), 0)::bigint as charge_7d_cents,
  round(coalesce((select sum(t.hours) from time_entries t
                  where t.staff_id = s.id and t.worked_on > current_date - 7), 0) * 100.0
        / nullif(s.weekly_hours, 0)) as recovery_pct,
  (select max(t.worked_on) from time_entries t where t.staff_id = s.id) as last_booked_on
from staff s
where s.active and s.role in ('tradesperson', 'storeman');

-- Aged debtors, retentions carried alongside.
create or replace view v_debtors as
select
  i.id as invoice_id,
  i.number,
  j.ref,
  c.id as customer_id,
  c.name as customer,
  i.issued_on,
  i.due_on,
  i.total_cents,
  i.retention_cents,
  i.payment_claim,
  i.status,
  i.sent_on,
  (current_date - i.due_on) as days_overdue,
  case
    when i.due_on >= current_date then 'current'
    when current_date - i.due_on <= 30 then '1 to 30'
    when current_date - i.due_on <= 60 then '31 to 60'
    when current_date - i.due_on <= 90 then '61 to 90'
    else 'over 90'
  end as bucket
from invoices i
join jobs j on j.id = i.job_id
join customers c on c.id = i.customer_id
where i.status <> 'paid';

-- Retentions receivable: money of ours a customer is holding, and when it
-- falls due back (Construction Contracts Act 2002, subpart 2A: it is held on
-- trust for us, and it does not come back unless somebody asks).
create or replace view v_retentions as
select
  i.number,
  j.ref,
  c.name as customer,
  i.retention_cents,
  i.retention_due_on,
  i.retention_received_on,
  case when i.retention_received_on is null and i.retention_due_on is not null and i.retention_due_on < current_date
       then current_date - i.retention_due_on end as days_overdue
from invoices i
join jobs j on j.id = i.job_id
join customers c on c.id = i.customer_id
where i.retention_cents > 0;

-- One customer, one line: owing plus the WIP on their open jobs is the real
-- exposure, and it is the number the credit limit is measured against.
create or replace view v_customer_position as
select
  c.id as customer_id,
  c.name as customer,
  c.account_type,
  c.on_stop,
  c.status,
  c.terms_days,
  c.credit_limit_cents,
  c.ppsr_registered_on,
  (select count(*) from jobs j where j.customer_id = c.id and j.status in ('accepted', 'in-progress', 'on-hold', 'complete')) as open_jobs,
  (select count(*) from jobs j where j.customer_id = c.id and j.status = 'quote') as open_quotes,
  (select count(*) from jobs j where j.customer_id = c.id) as all_jobs,
  coalesce((select sum(d.total_cents) from v_debtors d where d.customer_id = c.id), 0)::bigint as owing_cents,
  coalesce((select sum(jc.uninvoiced_cents) from v_job_cost jc
            where jc.customer_id = c.id and jc.status in ('accepted', 'in-progress', 'on-hold', 'complete')), 0)::bigint as wip_cents,
  coalesce((select sum(d.total_cents) from v_debtors d where d.customer_id = c.id), 0)::bigint
    + coalesce((select sum(jc.uninvoiced_cents) from v_job_cost jc
                where jc.customer_id = c.id and jc.status in ('accepted', 'in-progress', 'on-hold', 'complete')), 0)::bigint as exposure_cents,
  coalesce((select sum(i.total_cents) from invoices i where i.customer_id = c.id and i.status = 'paid'), 0)::bigint as lifetime_paid_cents,
  (select max(n.noted_on) from notes n where n.customer_id = c.id) as last_contact_on
from customers c;

-- Everything that wants a decision, one union, worst first. The top is what a
-- steel certifier or an inspector would find; the middle is money bleeding on
-- open jobs; the bottom is money and capacity asleep.
create or replace view v_attention as
-- A traceable item issued to a structural job with no heat number recorded.
select 'heat_missing' as reason, j.ref as label, c.name as customer, it.code as item,
       (current_date - i.issued_on) as days, null::bigint as amount_cents,
       it.description || ': issued ' || to_char(i.issued_on, 'YYYY-MM-DD') || ' to a structural job with no heat number (AS/NZS 5131 traceability)' as detail
from issues i
join jobs j on j.id = i.job_id
join customers c on c.id = j.customer_id
join items it on it.id = i.item_id
where j.structural and it.traceable and (i.heat_no is null or i.heat_no = '')
union all
-- A work centre past its service.
select 'plant_service_overdue', l.code, '', l.code,
       case when l.last_service_on is not null
            then (current_date - (l.last_service_on + (l.service_interval_months || ' months')::interval)::date) end,
       null::bigint,
       l.name || ': service ' || coalesce('overdue since ' || to_char((l.last_service_on + (l.service_interval_months || ' months')::interval)::date, 'YYYY-MM-DD'), 'never recorded') || ' (HSWA 2015 s 36; plant is maintained so it stays safe)'
from v_loading l
where l.service_overdue
union all
-- A fixed-price job that has eaten most of its quote and is not finished.
select 'quote_burnt', b.ref, b.customer, '',
       null::integer, b.total_cost_cents,
       b.title || ': cost is ' || b.quote_burnt_pct || '% of the quote and the job is ' || b.status || '. Decide now: variation, recover, or eat it knowingly.'
from v_job_board b
where b.quote_burnt_pct is not null and b.quote_burnt_pct >= 80 and b.status <> 'complete'
union all
-- A job past the date the customer was promised.
select 'job_late', b.ref, b.customer, '',
       b.days_late, b.uninvoiced_cents,
       b.title || ': promised ' || to_char(b.promised_on, 'YYYY-MM-DD') || ' and still ' || b.status
from v_job_board b
where b.days_late is not null and b.days_late > 0
union all
-- A job on the floor that nothing has been booked to for a week.
select 'job_stalled', b.ref, b.customer, '',
       (current_date - b.last_activity_on), null::bigint,
       b.title || ': in progress, nothing issued or booked since ' || to_char(b.last_activity_on, 'YYYY-MM-DD')
from v_job_board b
where b.status = 'in-progress'
  and b.last_activity_on is not null and b.last_activity_on <= current_date - 7
union all
-- Made, delivered or sitting on the floor finished, and not billed.
select 'complete_not_invoiced', b.ref, b.customer, '',
       (current_date - jc.completed_on), b.uninvoiced_cents,
       b.title || ': complete ' || to_char(jc.completed_on, 'YYYY-MM-DD') || ' with nothing drafted: run bill ' || b.ref
from v_job_board b
join v_job_cost jc on jc.job_id = b.job_id
where b.status = 'complete' and b.uninvoiced_cents > 0
union all
-- A shortage on a job promised inside a fortnight.
select 'shortage_blocking', s.ref, s.customer, s.item_code,
       case when s.promised_on is not null then (s.promised_on - current_date) end, null::bigint,
       s.item || ': short ' || s.short_qty || ' ' || s.unit ||
       case when s.next_delivery_on is null then ' and nothing on order'
            else ', order due ' || to_char(s.next_delivery_on, 'YYYY-MM-DD') end ||
       case when s.promised_on is not null then '; job promised ' || to_char(s.promised_on, 'YYYY-MM-DD') else '' end
from v_shortages s
where s.promised_on is null or s.promised_on <= current_date + 14
union all
-- A purchase order past its expected date.
select 'po_overdue', po.ref, sup.name, coalesce(j.ref, ''),
       (current_date - po.expected_on), (select sum(round(pl.qty * pl.unit_cost_cents)) from po_lines pl where pl.po_id = po.id)::bigint,
       'expected ' || to_char(po.expected_on, 'YYYY-MM-DD') || ' and not received' || case when j.ref is not null then '; it is holding ' || j.ref else '' end
from purchase_orders po
join suppliers sup on sup.id = po.supplier_id
left join jobs j on j.id = po.job_id
where po.status = 'open' and po.expected_on is not null and po.expected_on < current_date
union all
-- Stock through the reorder level with nothing on order.
select 'below_reorder', st.code, coalesce(st.preferred_supplier, ''), st.code,
       null::integer, null::bigint,
       st.description || ': free ' || st.free || ' ' || st.unit || ' against a reorder level of ' || st.reorder_level ||
       case when st.on_order > 0 then ' (' || st.on_order || ' on order)' else ' and nothing on order' end
from v_stock st
where st.free <= st.reorder_level and st.reorder_level > 0 and st.on_order = 0
union all
-- An invoice past its due date.
select 'invoice_overdue', d.number, d.customer, '',
       d.days_overdue, d.total_cents,
       'issued ' || to_char(d.issued_on, 'YYYY-MM-DD') || ', due ' || to_char(d.due_on, 'YYYY-MM-DD') || ' (' || d.bucket || ' days)'
from v_debtors d
where d.status = 'sent' and d.due_on < current_date
union all
-- A draft invoice never sent.
select 'invoice_draft', d.number, d.customer, '',
       (current_date - d.issued_on), d.total_cents,
       'drafted ' || to_char(d.issued_on, 'YYYY-MM-DD') || ' and never sent'
from v_debtors d
where d.status = 'draft' and d.issued_on <= current_date - 7
union all
-- Retention money due back and not received.
select 'retention_due', r.number, r.customer, r.ref,
       r.days_overdue, r.retention_cents,
       'retention due back ' || to_char(r.retention_due_on, 'YYYY-MM-DD') || ' and not received. Claim it: it is your money, held on trust (CCA 2002 subpart 2A).'
from v_retentions r
where r.days_overdue is not null and r.days_overdue > 0
union all
-- An invoice on construction work that did not go out as a payment claim.
select 'payment_claim_missing', i.number, c.name, j.ref,
       (current_date - i.issued_on), i.total_cents,
       'construction work invoiced without a payment claim (CCA 2002 ss 20 and 22: a valid claim starts the clock the Act enforces)'
from invoices i
join jobs j on j.id = i.job_id
join customers c on c.id = i.customer_id
where j.construction_work and not i.payment_claim and i.status <> 'paid'
union all
-- Exposure past the credit limit.
select 'over_credit_limit', cp.customer, cp.customer, '',
       null::integer, cp.exposure_cents,
       'owing plus WIP is past the credit limit of ' || to_char(cp.credit_limit_cents / 100.0, 'FM$999,999,990')
from v_customer_position cp
where cp.credit_limit_cents is not null and cp.exposure_cents > cp.credit_limit_cents
union all
-- Real money on credit with no PPSR registration behind the ROT terms.
select 'ppsr_unregistered', cp.customer, cp.customer, '',
       null::integer, cp.owing_cents,
       'owes ' || to_char(cp.owing_cents / 100.0, 'FM$999,999,990') || ' with no PPSR financing statement recorded: retention-of-title terms are worth nothing unregistered (PPSA 1999)'
from v_customer_position cp
where cp.account_type = 'trade' and cp.owing_cents >= 1000000 and cp.ppsr_registered_on is null
union all
-- A tradesperson with no time booked for three-plus days while the floor is busy.
select 'timesheet_gap', lw.full_name, '', '',
       (current_date - lw.last_booked_on), null::bigint,
       'no time booked since ' || coalesce(to_char(lw.last_booked_on, 'YYYY-MM-DD'), 'ever') || ' while jobs are in progress. The time record is a legal record (Employment Relations Act 2000 s 130), and unbooked hours are unrecovered hours.'
from v_labour_week lw
where lw.role = 'tradesperson'
  and exists (select 1 from jobs j where j.status = 'in-progress')
  and (lw.last_booked_on is null or lw.last_booked_on <= current_date - 3)
union all
-- A quote sitting out cold.
select 'quote_stale', q.ref, q.customer, '',
       q.days_out, q.quoted_cents,
       q.title || ': out ' || q.days_out || ' days, last contact ' || coalesce(to_char(q.last_contact_on, 'YYYY-MM-DD'), 'never') || '. Ring them or lose it.'
from v_quotes q
where q.days_out >= 14
  and (q.last_contact_on is null or q.last_contact_on <= current_date - 14)
union all
-- A task past its date.
select 'task_overdue', t.title, coalesce(c.name, ''), '',
       (current_date - t.due_on), null::bigint,
       'due ' || to_char(t.due_on, 'YYYY-MM-DD')
from tasks t left join customers c on c.id = t.customer_id
where t.status = 'open' and t.due_on < current_date;
