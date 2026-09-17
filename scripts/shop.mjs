#!/usr/bin/env node
// job-shop-for-claude-code: the one CLI. Claude Code slash commands call this;
// so can you.
//
//   node scripts/shop.mjs <command> [args] [--flags] [--json]
//
// Run with no arguments (or `help`) for the command list.
//
// This system records what a make-to-order engineering shop runs on every
// week: the quotes and the jobs, the planned materials and what actually got
// issued (heat numbers where traceability demands them), the hours booked at
// captured cost and charge rates, the work centres and their service clocks,
// the stock, the purchase orders, and the billing run that drafts invoices,
// payment claims and retentions included. It sends nothing, pays nothing and
// talks to no accounting system on its own: invoices are drafted here and a
// person sends them.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick } from './lib/csv.mjs';
import { table, money, isoDate, short, truncate, heading, bar } from './lib/format.mjs';

// ---------------------------------------------------------------------------
// Argument parsing

const BOOL_FLAGS = new Set([
  'json', 'help', 'all', 'dry-run', 'force', 'short', 'no-payment-claim', 'write-off',
]);

function parseArgv(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      flags.help = true;
      continue;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let name;
      let value;
      if (eq > -1) {
        name = a.slice(2, eq);
        value = a.slice(eq + 1);
      } else {
        name = a.slice(2);
        const next = argv[i + 1];
        if (BOOL_FLAGS.has(name) || next === undefined || next.startsWith('--')) value = true;
        else value = argv[++i];
      }
      flags[name] = value;
    } else {
      args.push(a);
    }
  }
  return { args, flags };
}

class CliError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

const num = (v) => Number(v ?? 0);
const str = (v) => (v === true || v === undefined || v === null ? '' : String(v));

// ---------------------------------------------------------------------------
// Dates, money, quantities

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDate(v, what = 'date') {
  if (!v || v === true) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const lower = s.toLowerCase();
  if (lower === 'today') return today();
  if (lower === 'yesterday') return addDays(today(), -1);
  if (lower === 'tomorrow') return addDays(today(), 1);
  // New Zealand and Australian exports write DD/MM/YYYY, so the first number
  // is the day unless the second one is too big to be a month.
  const slash = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const [day, month] = b > 12 ? [b, a] : [a, b];
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new CliError(`"${v}" is not a ${what}. Use YYYY-MM-DD.`);
  return isoDate(d);
}

function parseMoney(v) {
  if (v === undefined || v === null || v === '' || v === true) return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  if (Number.isNaN(n)) throw new CliError(`"${v}" is not an amount.`);
  return Math.round(n * 100);
}

function parseQty(v, what = 'quantity') {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  if (!Number.isFinite(n)) throw new CliError(`"${v}" is not a ${what}.`);
  return n;
}

function parseHours(v) {
  if (v === undefined || v === null || v === true) throw new CliError('How many hours?');
  const s = String(v).trim();
  const clock = s.match(/^(\d{1,2}):(\d{2})$/);   // 2:30
  if (clock) return Number(clock[1]) + Number(clock[2]) / 60;
  const hm = s.match(/^(\d+(?:\.\d+)?)h(?:(\d{1,2})m?)?$/i);  // 2h, 2h15
  if (hm) return Number(hm[1]) + (hm[2] ? Number(hm[2]) / 60 : 0);
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > 24) throw new CliError(`"${v}" is not a number of hours. Use 2.5, 2:30 or 2h30.`);
  return n;
}

// ---------------------------------------------------------------------------
// Lookups: full id, first 4+ characters of an id, exact code or ref or name,
// then contains. One hit wins. Several hits list the candidates and exit 1.

const RESOLVERS = {
  customer: {
    from: 'customers c',
    cols: 'c.*',
    exact: "lower(c.name) = lower($1) or lower(coalesce(c.code, '')) = lower($1) or lower(coalesce(c.email, '')) = lower($1)",
    fuzzy: 'c.name ilike $1 or c.contact_name ilike $1',
    label: (r) => `${r.name} (${r.account_type}${r.on_stop ? ', ON STOP' : ''})`,
    order: 'c.name',
    listing: 'customers',
  },
  staff: {
    from: 'staff c',
    cols: 'c.*',
    exact: "lower(c.full_name) = lower($1) or lower(coalesce(c.code, '')) = lower($1)",
    fuzzy: 'c.full_name ilike $1',
    label: (r) => `${r.full_name} (${r.role})`,
    order: 'c.full_name',
    listing: 'staff',
  },
  supplier: {
    from: 'suppliers c',
    cols: 'c.*',
    exact: "lower(c.name) = lower($1) or lower(coalesce(c.code, '')) = lower($1)",
    fuzzy: 'c.name ilike $1 or c.contact_name ilike $1',
    label: (r) => r.name,
    order: 'c.name',
    listing: 'suppliers',
  },
  item: {
    from: 'items c',
    cols: 'c.*',
    exact: "lower(c.code) = lower($1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.code ilike $1 or c.description ilike $1',
    label: (r) => `${r.code}  ${r.description} (${r.on_hand} ${r.unit} on hand)`,
    order: 'c.code',
    listing: 'stock',
  },
  centre: {
    from: 'work_centres c',
    cols: 'c.*',
    exact: 'lower(c.code) = lower($1) or lower(c.name) = lower($1)',
    fuzzy: 'c.code ilike $1 or c.name ilike $1',
    label: (r) => `${r.code}  ${r.name}`,
    order: 'c.code',
    listing: 'loading',
  },
  job: {
    from: 'jobs c join customers cu on cu.id = c.customer_id',
    cols: 'c.*, cu.name as customer_name, cu.account_type, cu.on_stop, cu.terms_days',
    exact: "lower(coalesce(c.ref, '')) = lower($1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.ref ilike $1 or cu.name ilike $1 or c.title ilike $1',
    label: (r) => `${r.ref}  ${r.customer_name}: ${truncate(r.title, 38)} (${r.status})`,
    order: 'c.created_at desc',
    listing: 'jobs',
  },
  invoice: {
    from: 'invoices c join customers cu on cu.id = c.customer_id join jobs j on j.id = c.job_id',
    cols: 'c.*, cu.name as customer_name, j.ref as job_ref, j.construction_work',
    exact: "lower(coalesce(c.number, '')) = lower($1)",
    fuzzy: 'c.number ilike $1 or cu.name ilike $1 or j.ref ilike $1',
    label: (r) => `${r.number}  ${r.customer_name} ${money(r.total_cents)} (${r.status})`,
    order: 'c.issued_on desc',
    listing: 'invoices --all',
  },
  po: {
    from: 'purchase_orders c join suppliers s on s.id = c.supplier_id left join jobs j on j.id = c.job_id',
    cols: 'c.*, s.name as supplier_name, j.ref as job_ref',
    exact: "lower(coalesce(c.ref, '')) = lower($1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: "c.ref ilike $1 or s.name ilike $1 or coalesce(c.note, '') ilike $1",
    label: (r) => `${r.ref}  ${r.supplier_name}${r.job_ref ? ' for ' + r.job_ref : ''} (${r.status})`,
    order: 'c.ordered_on desc',
    listing: 'po',
  },
  task: {
    from: 'tasks c left join customers cu on cu.id = c.customer_id',
    cols: 'c.*, cu.name as customer_name',
    exact: 'lower(c.title) = lower($1)',
    fuzzy: 'c.title ilike $1 or cu.name ilike $1',
    label: (r) => `${short(r.id)}  ${truncate(r.title, 50)} (${r.status})`,
    order: 'c.due_on',
    listing: 'tasks --all',
  },
};

const ID_RE = /^[0-9a-f]{4,8}(-[0-9a-f-]*)?$/i;

async function resolve(db, kind, q, { optional = false } = {}) {
  const spec = RESOLVERS[kind];
  q = String(q ?? '').trim();
  if (!q || q === 'true') {
    if (optional) return null;
    throw new CliError(`Give me a ${kind} name, code or id.`);
  }
  const select = `select ${spec.cols} from ${spec.from}`;
  let rows = [];
  if (ID_RE.test(q)) {
    rows = await db.query(`${select} where c.id::text like $1 order by ${spec.order}`, [q.toLowerCase() + '%']);
    if (rows.length === 1) return rows[0];
  }
  if (!rows.length && spec.exact !== 'false') rows = await db.query(`${select} where ${spec.exact} order by ${spec.order}`, [q]);
  if (rows.length === 1) return rows[0];
  if (!rows.length) rows = await db.query(`${select} where ${spec.fuzzy} order by ${spec.order}`, [`%${q}%`]);
  if (rows.length === 1) return rows[0];
  if (!rows.length) {
    if (optional) return null;
    throw new CliError(`No ${kind} matches "${q}". Run \`${spec.listing}\` to see what exists.`);
  }
  throw new CliError(
    `"${q}" matches ${rows.length} ${kind} records. Use a code, an id, or a longer name:\n` +
      rows.map((r) => `  ${short(r.id)}  ${spec.label(r)}`).join('\n'),
  );
}

async function nextRef(db, tbl, col, prefix, start) {
  const rows = await db.query(`select ${col} as v from ${tbl} where ${col} like '${prefix}-%'`);
  let max = start;
  for (const r of rows) {
    const n = Number(String(r.v).slice(prefix.length + 1));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}-${max + 1}`;
}

// ---------------------------------------------------------------------------
// Output

let JSON_MODE = false;
function out(json, text) {
  if (JSON_MODE) console.log(JSON.stringify(json, null, 2));
  else console.log(typeof text === 'function' ? text() : text);
}

async function jobCost(db, jobId) {
  const rows = await db.query('select * from v_job_cost where job_id = $1', [jobId]);
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// The compliance rule book. Sources and fixes live in docs/compliance.md; the
// SQL here and the words there change together (that is what /customise is for).

const RULES = [
  {
    key: 'traceability',
    title: 'A heat number on every traceable item issued to a structural job',
    source: 'AS/NZS 5131 (structural steelwork fabrication and erection: traceability of material to test certificates); MBIE and SCNZ steel fabricator certification guidance expects it',
    fix: 'Find the cert in the delivery paperwork and record it: the issue is in the record, add the heat with `issue` next time or note the cert against the job now. If the cert cannot be found, tell the engineer before the steel is buried in the build.',
    sql: `select j.ref, c.name as customer, it.code, it.description, i.qty, i.issued_on
          from issues i
          join jobs j on j.id = i.job_id
          join customers c on c.id = j.customer_id
          join items it on it.id = i.item_id
          where j.structural and it.traceable and (i.heat_no is null or i.heat_no = '')`,
  },
  {
    key: 'plant-maintenance',
    title: 'Every work centre inside its service interval',
    source: 'Health and Safety at Work Act 2015 s 36 (primary duty), with the General Risk and Workplace Management Regulations 2016 behind it: plant is maintained so it stays safe. Guarding and interlocks get checked at service.',
    fix: 'Book the service, then `centre service <code>` with the date. The interval is per centre: change it if your regime differs.',
    sql: `select l.code, l.name, l.last_service_on, l.service_interval_months
          from v_loading l where l.service_overdue`,
  },
  {
    key: 'payment-claims',
    title: 'Construction work invoiced as a payment claim',
    source: 'Construction Contracts Act 2002 ss 20 and 22: a valid payment claim identifies the work and the amount and states it is made under the Act. Serve one and the payer must respond with a payment schedule or pay; skip it and you have an ordinary unpaid bill with none of the Act behind it.',
    fix: 'Draft bills on construction jobs as payment claims (`bill` does this by default when the job is flagged construction). For the one that already went out plain, issue the next claim properly.',
    sql: `select i.number, c.name as customer, j.ref, i.total_cents / 100.0 as total, i.issued_on, i.status
          from invoices i
          join jobs j on j.id = i.job_id
          join customers c on c.id = i.customer_id
          where j.construction_work and not i.payment_claim and i.status <> 'paid'`,
  },
  {
    key: 'retentions',
    title: 'Retention money claimed when it falls due',
    source: 'Construction Contracts Act 2002 subpart 2A: retention money withheld from you must be held on trust by the withholder. It is your money, and it famously does not come back unless somebody asks on the day it falls due.',
    fix: 'Invoice or write for the retention the week it falls due, then `retention received <number>` when it lands.',
    sql: `select r.number, r.customer, r.ref, r.retention_cents / 100.0 as retention, r.retention_due_on, r.days_overdue
          from v_retentions r
          where r.days_overdue is not null and r.days_overdue > 0`,
  },
  {
    key: 'ppsr-rot',
    title: 'A PPSR financing statement behind retention-of-title terms on real money',
    source: 'Personal Property Securities Act 1999: retention-of-title terms in your conditions of sale are a security interest. Unregistered, the goods you supplied on credit belong to the liquidator the day the customer folds. The check flags trade accounts owing $10,000 or more with no registration recorded.',
    fix: 'Register the financing statement at ppsr.govt.nz against the customer, then record it: `customer` shows the field, `add customer` and imports set it with --ppsr=.',
    sql: `select cp.customer, cp.owing_cents / 100.0 as owing, cp.credit_limit_cents / 100.0 as credit_limit
          from v_customer_position cp
          where cp.account_type = 'trade' and cp.owing_cents >= 1000000 and cp.ppsr_registered_on is null`,
  },
  {
    key: 'time-records',
    title: 'Time records complete while the floor is busy',
    source: 'Employment Relations Act 2000 s 130: an employer keeps wages and time records. Here the time entries are that record, and they are also the job costing: an unbooked hour is both a record-keeping gap and margin quietly leaking off a job.',
    fix: 'Book the missing days with honest dates: `time <job> <person> <hours> --on=`. If someone was off, that is fine; the flag clears the day they book again.',
    sql: `select lw.full_name, lw.last_booked_on, lw.hours_7d
          from v_labour_week lw
          where lw.role = 'tradesperson'
            and exists (select 1 from jobs j where j.status = 'in-progress')
            and (lw.last_booked_on is null or lw.last_booked_on <= current_date - 3)`,
  },
];

// ---------------------------------------------------------------------------
// Commands

const commands = {};

commands.help = async () => {
  console.log(`job-shop-for-claude-code: the quotes, the jobs, the floor, the steel and the money.

  The board
    jobs [--all]                       every open job: promise dates, quote burnt, the money
    job <ref>                          one job in full: plan, issues, hours, orders, invoices
    quotes                             open quotes, oldest first, with last contact
    job quote <customer> --title= [--value=] [--basis=fixed|tm] [--promised=] [--structural] [--construction] [--by=]
    job won <ref> [--po=] [--promised=]   |   job lost <ref> --reason=
    job start <ref> | job hold <ref> | job done <ref> [--on=] | job close <ref>

  The floor
    plan <ref> <item> <qty>            planned material onto a job (captures rates)
    issue <ref> <item> <qty> [--heat=] [--by=]   stock onto a job (heat no required on structural)
    heat <ref> <item> <number>         backfill a heat number when the cert turns up
    time <ref> <person> <hours> [--centre=] [--on=] [--note=]
    shortages                          planned material the shelf cannot cover
    loading                            work centre hours and service clocks
    centre service <code> [--on=]      record a work centre service
    labour                             the last 7 days: hours, recovery, gaps

  Stock and buying
    stock [--short] | item <code>      the shelf: on hand, allocated, on order, free
    stock set <item> <qty> --reason=   stocktake correction
    po                                 open purchase orders
    po raise <supplier> [--job=] [--expected=] [--note=]
    po add <ref> <item|"description"> <qty> <unit-cost>
    po receive <ref> [--on=] | po cancel <ref>

  The money
    bill <ref> [--amount=|--percent=] [--retention=5%|--retention=1000 --retention-due=] [--no-payment-claim]
    wip                                cost sitting in open jobs against what is billed
    costing [--all]                    every job: cost, charge, invoiced, margin
    invoices [--all] | invoice <number> | invoice sent|paid <number> [--on=] | invoice claim <number>
    retentions | retention received <number> [--on=]
    debtors                            aged debtors

  The desk
    customers | customer <name>        accounts, exposure (owing plus WIP), history
    staff | suppliers | add customer|staff|item|supplier|centre ...
    stop <customer> | unstop <customer> | ppsr <customer> [--registered=]
    log <ref|customer> "<note>" [--channel=] [--by=]
    tasks [--all] | task add "<title>" [--customer=] [--due=] | task done <match>
    attention                          everything that wants a decision, worst first
    compliance [rule]                  the six rules, run against the records
    stats                              the whole shop in one block
    import ostendo|csv --customers= --items= --jobs= [--suppliers=] [--dry-run]
    export [--out=]

  Every command takes --json. Matching is forgiving: codes, partial names, id prefixes.`);
};

// ---- the board --------------------------------------------------------------

commands.jobs = async (db, args, flags) => {
  const rows = await db.query(
    `select * from v_job_board order by case status when 'in-progress' then 0 when 'accepted' then 1 when 'on-hold' then 2 else 3 end, promised_on nulls last`);
  let all = rows;
  if (flags.all) {
    const rest = await db.query(
      `select j.ref, c.name as customer, j.title, j.status, j.quoted_cents, j.closed_on, j.lost_reason
       from jobs j join customers c on c.id = j.customer_id where j.status in ('closed', 'lost', 'quote') order by j.created_at desc`);
    all = { open: rows, rest };
  }
  out(all, () => heading(`The job board (${rows.length} open)`) + '\n' + table(rows, [
    { key: 'ref', label: 'Ref' },
    { key: 'customer', label: 'Customer', width: 26, format: (v, r) => v + (r.on_stop ? ' [STOP]' : '') },
    { key: 'title', label: 'Job', width: 34 },
    { key: 'status', label: 'Status' },
    { key: 'promised_on', label: 'Promised', format: (v, r) => (v ? isoDate(v) + (r.days_late ? ` (${r.days_late}d LATE)` : '') : 'open') },
    { key: 'quoted_cents', label: 'Quoted', align: 'right', format: (v, r) => (r.charge_basis === 'fixed' ? money(v) : 'T&M') },
    { key: 'total_cost_cents', label: 'Cost', align: 'right', format: (v) => (num(v) ? money(v) : '') },
    { key: 'quote_burnt_pct', label: 'Burnt', align: 'right', format: (v) => (v == null ? '' : `${v}%`) },
    { key: 'labour_hours', label: 'Hours', align: 'right', format: (v) => (num(v) ? v : '') },
    { key: 'uninvoiced_cents', label: 'To bill', align: 'right', format: (v) => (num(v) ? money(v) : '') },
  ]) + '\n\n  Burnt is cost against a fixed quote. Anything at 80%+ and unfinished is on `attention`.');
};
commands.board = commands.jobs;

commands.quotes = async (db) => {
  const rows = await db.query('select * from v_quotes order by days_out desc');
  const won = await db.query(
    `select count(*) filter (where status not in ('quote', 'lost'))::int as won,
            count(*) filter (where status = 'lost')::int as lost
     from jobs where quoted_on >= current_date - 365`);
  out({ quotes: rows, last_365: won[0] }, () => heading(`Open quotes (${rows.length})`) + '\n' + table(rows, [
    { key: 'ref', label: 'Ref' },
    { key: 'customer', label: 'Customer', width: 28 },
    { key: 'title', label: 'Job', width: 34 },
    { key: 'quoted_cents', label: 'Value', align: 'right', format: (v) => money(v) },
    { key: 'quoted_on', label: 'Quoted', format: isoDate },
    { key: 'days_out', label: 'Days out', align: 'right' },
    { key: 'last_contact_on', label: 'Last contact', format: (v) => isoDate(v) || 'never' },
    { key: 'estimator', label: 'By' },
  ]) + `\n\n  Won ${won[0].won}, lost ${won[0].lost} in the last year. A quote out 14 days with no contact is on \`attention\`.`);
};

async function jobCard(db, j) {
  const cost = await jobCost(db, j.id);
  const plan = await db.query(
    `select jl.*, it.code, it.description, it.unit,
            coalesce((select sum(i.qty) from issues i where i.job_id = jl.job_id and i.item_id = jl.item_id), 0) as issued_qty
     from job_lines jl join items it on it.id = jl.item_id where jl.job_id = $1 order by it.code`, [j.id]);
  const iss = await db.query(
    `select i.*, it.code, it.description, it.unit, s.full_name as by_whom
     from issues i join items it on it.id = i.item_id left join staff s on s.id = i.issued_by
     where i.job_id = $1 order by i.issued_on desc`, [j.id]);
  const hours = await db.query(
    `select t.worked_on, s.full_name, w.code as centre, t.hours, t.charge_rate_cents, t.note
     from time_entries t join staff s on s.id = t.staff_id left join work_centres w on w.id = t.work_centre_id
     where t.job_id = $1 order by t.worked_on desc limit 15`, [j.id]);
  const pos = await db.query(
    `select po.ref, s.name as supplier, po.status, po.expected_on, po.received_on,
            (select sum(round(pl.qty * pl.unit_cost_cents)) from po_lines pl where pl.po_id = po.id)::bigint as value_cents
     from purchase_orders po join suppliers s on s.id = po.supplier_id where po.job_id = $1 order by po.ordered_on`, [j.id]);
  const invs = await db.query('select * from invoices where job_id = $1 order by issued_on', [j.id]);
  const noteRows = await db.query(
    `select n.*, s.full_name as by_whom from notes n left join staff s on s.id = n.staff_id
     where n.job_id = $1 order by n.noted_on desc limit 8`, [j.id]);
  return { job: j, cost, plan, issues: iss, time: hours, purchase_orders: pos, invoices: invs, notes: noteRows };
}

commands.job = async (db, args, flags) => {
  const sub = args[0];
  if (sub === 'quote') return commands['job-quote'](db, args.slice(1), flags);
  if (sub === 'won') return commands['job-won'](db, args.slice(1), flags);
  if (sub === 'lost') return commands['job-lost'](db, args.slice(1), flags);
  if (sub === 'start') return commands['job-start'](db, args.slice(1), flags);
  if (sub === 'hold') return commands['job-hold'](db, args.slice(1), flags);
  if (sub === 'done') return commands['job-done'](db, args.slice(1), flags);
  if (sub === 'close') return commands['job-close'](db, args.slice(1), flags);
  const j = await resolve(db, 'job', args.join(' '));
  const card = await jobCard(db, j);
  out(card, () => {
    const c = card.cost;
    let t = heading(`${j.ref}  ${j.customer_name} (${j.status.toUpperCase()})`);
    t += `\n  ${j.title}${j.po_number ? ` | their PO ${j.po_number}` : ''}`;
    if (j.description) t += `\n  ${j.description}`;
    t += `\n  ${j.charge_basis === 'fixed' ? `fixed price ${money(j.quoted_cents)}` : 'time and materials'}${j.structural ? ' | STRUCTURAL: heat numbers required' : ''}${j.construction_work ? ' | construction work: bills go out as payment claims' : ''}`;
    t += `\n  quoted ${isoDate(j.quoted_on) || 'n/a'}${j.won_on ? ` | won ${isoDate(j.won_on)}` : ''}${j.started_on ? ` | started ${isoDate(j.started_on)}` : ''}${j.promised_on ? ` | promised ${isoDate(j.promised_on)}` : ''}${j.completed_on ? ` | complete ${isoDate(j.completed_on)}` : ''}${j.closed_on ? ` | closed ${isoDate(j.closed_on)}` : ''}`;
    if (c) {
      t += `\n  cost: materials ${money(c.material_cost_cents)} + labour ${money(c.labour_cost_cents)} (${c.labour_hours}h) + outwork ${money(c.outwork_cost_cents)} = ${money(c.total_cost_cents)}`;
      t += `\n  money: worth ${money(c.charge_value_cents)} | invoiced ${money(c.invoiced_cents)} | left to bill ${money(c.uninvoiced_cents)}`;
      if (j.charge_basis === 'fixed' && num(j.quoted_cents) > 0) t += ` | cost is ${Math.round(num(c.total_cost_cents) * 100 / num(j.quoted_cents))}% of the quote`;
    }
    if (j.note) t += `\n  note: ${j.note}`;
    if (j.lost_reason) t += `\n  lost: ${j.lost_reason}`;
    if (card.plan.length) t += '\n' + heading('Planned materials') + '\n' + table(card.plan, [
      { key: 'code', label: 'Code' },
      { key: 'description', label: 'Item', width: 32 },
      { key: 'qty_planned', label: 'Planned', align: 'right' },
      { key: 'issued_qty', label: 'Issued', align: 'right' },
      { key: 'unit', label: 'Unit' },
      { key: 'note', label: 'Note', width: 30 },
    ]);
    if (card.issues.length) t += '\n' + heading('Issued') + '\n' + table(card.issues, [
      { key: 'issued_on', label: 'Date', format: isoDate },
      { key: 'code', label: 'Code' },
      { key: 'description', label: 'Item', width: 30 },
      { key: 'qty', label: 'Qty', align: 'right' },
      { key: 'heat_no', label: 'Heat', format: (v) => v || (j.structural ? 'MISSING' : '') },
      { key: 'by_whom', label: 'By' },
    ]);
    if (card.time.length) t += '\n' + heading('Time') + '\n' + table(card.time, [
      { key: 'worked_on', label: 'Date', format: isoDate },
      { key: 'full_name', label: 'Who' },
      { key: 'centre', label: 'Centre' },
      { key: 'hours', label: 'Hours', align: 'right' },
      { key: 'note', label: 'Note', width: 36 },
    ]);
    if (card.purchase_orders.length) t += '\n' + heading('Purchase orders') + '\n' + table(card.purchase_orders, [
      { key: 'ref', label: 'Ref' },
      { key: 'supplier', label: 'Supplier', width: 26 },
      { key: 'status', label: 'Status' },
      { key: 'expected_on', label: 'Expected', format: (v, r) => (r.status === 'open' && v && isoDate(v) < today() ? `${isoDate(v)} OVERDUE` : isoDate(v)) },
      { key: 'value_cents', label: 'Value', align: 'right', format: (v) => money(v) },
    ]);
    if (card.invoices.length) t += '\n' + heading('Invoices') + '\n' + table(card.invoices, [
      { key: 'number', label: 'Number' },
      { key: 'issued_on', label: 'Issued', format: isoDate },
      { key: 'total_cents', label: 'Total', align: 'right', format: (v) => money(v) },
      { key: 'payment_claim', label: 'Claim', format: (v) => (v ? 'payment claim' : '') },
      { key: 'retention_cents', label: 'Retention', align: 'right', format: (v) => (num(v) ? money(v) : '') },
      { key: 'status', label: 'Status' },
    ]);
    if (card.notes.length) t += '\n' + heading('Notes') + '\n' + table(card.notes, [
      { key: 'noted_on', label: 'Date', format: isoDate },
      { key: 'by_whom', label: 'Who' },
      { key: 'note', label: 'Note', width: 70 },
    ]);
    return t;
  });
};

commands['job-quote'] = async (db, args, flags) => {
  const cust = await resolve(db, 'customer', args.join(' ') || str(flags.customer));
  if (cust.on_stop && !flags.force) {
    throw new CliError(`${cust.name} is ON STOP. Settle the account or take a deliberate decision: --force with a --note, and it goes in the record.`);
  }
  const title = str(flags.title);
  if (!title) throw new CliError('Every job has a title: --title="Mezzanine floor steelwork".');
  const basis = str(flags.basis) === 'tm' || str(flags.basis) === 'time-and-materials' ? 'time-and-materials' : 'fixed';
  const value = flags.value !== undefined ? parseMoney(flags.value) : null;
  if (basis === 'fixed' && !value) throw new CliError('A fixed-price quote needs a --value=. For charge-as-it-runs work use --basis=tm.');
  const by = flags.by ? await resolve(db, 'staff', str(flags.by)) : null;
  const ref = await nextRef(db, 'jobs', 'ref', 'J', 1199);
  const [j] = await db.query(
    `insert into jobs (ref, customer_id, title, description, status, charge_basis, quoted_cents, quoted_on, promised_on, structural, construction_work, estimator_id, note)
     values ($1, $2, $3, $4, 'quote', $5, $6, current_date, $7, $8, $9, $10, $11) returning id`,
    [ref, cust.id, title, str(flags.description) || null, basis, value, parseDate(flags.promised, 'promised date'),
     Boolean(flags.structural), Boolean(flags.construction), by?.id || null, str(flags.note) || null]);
  if (cust.on_stop) await db.query('insert into notes (customer_id, job_id, noted_on, channel, note) values ($1, $2, current_date, $3, $4)',
    [cust.id, j.id, 'counter', `Quoted with the account ON STOP, --force used: ${str(flags.note) || 'no note given'}`]);
  out({ ref, job_id: j.id, customer: cust.name, basis, quoted_cents: value },
    `  quoted ${ref} for ${cust.name}: "${title}" ${basis === 'fixed' ? money(value) : 'time and materials'}.\n  Next: plan the materials (plan ${ref} <item> <qty>), and job won ${ref} when they say yes.`);
};

commands['job-won'] = async (db, args, flags) => {
  const j = await resolve(db, 'job', args[0]);
  if (j.status !== 'quote') throw new CliError(`${j.ref} is ${j.status}; only a quote gets won.`);
  const promised = parseDate(flags.promised, 'promised date') || (j.promised_on ? isoDate(j.promised_on) : null);
  await db.query("update jobs set status = 'accepted', won_on = current_date, promised_on = $1, po_number = coalesce(nullif($2, ''), po_number) where id = $3",
    [promised, str(flags.po), j.id]);
  out({ ref: j.ref, status: 'accepted', promised_on: promised },
    `  ${j.ref} won.${promised ? ` Promised ${promised}.` : ' No promise date recorded: set one, late is measured against it.'}\n  Next: job start ${j.ref} when it hits the floor.`);
};

commands['job-lost'] = async (db, args, flags) => {
  const j = await resolve(db, 'job', args[0]);
  if (j.status !== 'quote') throw new CliError(`${j.ref} is ${j.status}; only a quote gets lost.`);
  const reason = str(flags.reason);
  if (!reason) throw new CliError('Losing is data: --reason="price" or whatever it really was.');
  await db.query("update jobs set status = 'lost', lost_reason = $1 where id = $2", [reason, j.id]);
  out({ ref: j.ref, status: 'lost' }, `  ${j.ref} lost: ${reason}`);
};

commands['job-start'] = async (db, args, flags) => {
  const j = await resolve(db, 'job', args[0]);
  if (!['accepted', 'on-hold'].includes(j.status)) throw new CliError(`${j.ref} is ${j.status}; only an accepted or on-hold job starts.`);
  const onDate = parseDate(flags.on, 'start date') || today();
  await db.query("update jobs set status = 'in-progress', started_on = coalesce(started_on, $1) where id = $2", [onDate, j.id]);
  out({ ref: j.ref, status: 'in-progress' }, `  ${j.ref} on the floor from ${onDate}. Book time and issues as they happen: the costing is only as honest as the floor is.`);
};

commands['job-hold'] = async (db, args, flags) => {
  const j = await resolve(db, 'job', args[0]);
  if (!['accepted', 'in-progress'].includes(j.status)) throw new CliError(`${j.ref} is ${j.status}; only an accepted or in-progress job goes on hold.`);
  await db.query("update jobs set status = 'on-hold' where id = $1", [j.id]);
  if (flags.note) await db.query('insert into notes (customer_id, job_id, noted_on, channel, note) values ($1, $2, current_date, $3, $4)',
    [j.customer_id, j.id, 'floor', `On hold: ${str(flags.note)}`]);
  out({ ref: j.ref, status: 'on-hold' }, `  ${j.ref} on hold.${flags.note ? '' : ' A hold with no note is a mystery in a month: log why.'}`);
};

commands['job-done'] = async (db, args, flags) => {
  const j = await resolve(db, 'job', args[0]);
  if (j.status !== 'in-progress') throw new CliError(`${j.ref} is ${j.status}; only an in-progress job completes.`);
  const onDate = parseDate(flags.on, 'completion date') || today();
  const unissued = await db.query(
    `select it.code, (jl.qty_planned - coalesce((select sum(i.qty) from issues i where i.job_id = jl.job_id and i.item_id = jl.item_id), 0)) as remaining
     from job_lines jl join items it on it.id = jl.item_id
     where jl.job_id = $1
       and jl.qty_planned > coalesce((select sum(i.qty) from issues i where i.job_id = jl.job_id and i.item_id = jl.item_id), 0)`, [j.id]);
  await db.query("update jobs set status = 'complete', completed_on = $1 where id = $2", [onDate, j.id]);
  const warn = unissued.length
    ? `\n  Planned but never issued: ${unissued.map((u) => `${u.code} (${u.remaining})`).join(', ')}. If the floor used it, issue it now or the costing is wrong.`
    : '';
  out({ ref: j.ref, status: 'complete', completed_on: onDate, unissued },
    `  ${j.ref} complete ${onDate}. Next: bill ${j.ref}. A finished job with nothing drafted goes on \`attention\`.${warn}`);
};

commands['job-close'] = async (db, args, flags) => {
  const j = await resolve(db, 'job', args[0]);
  if (j.status === 'closed') throw new CliError(`${j.ref} is already closed.`);
  const c = await jobCost(db, j.id);
  if (num(c?.uninvoiced_cents) > 0 && !flags['write-off']) {
    throw new CliError(`${j.ref} still has ${money(c.uninvoiced_cents)} to bill. Run \`bill ${j.ref}\` first: closed jobs do not get billed later. Writing it off is a deliberate call: --write-off --reason="why".`);
  }
  const openPos = await db.query("select ref from purchase_orders where job_id = $1 and status = 'open'", [j.id]);
  if (openPos.length) throw new CliError(`${j.ref} has open purchase orders (${openPos.map((p) => p.ref).join(', ')}). Receive or cancel them first, or the job cost is missing money.`);
  if (flags['write-off']) {
    const reason = str(flags.reason);
    if (!reason) throw new CliError('A write-off has a why: --reason="goodwill on the rework".');
    await db.query('insert into notes (customer_id, job_id, noted_on, channel, note) values ($1, $2, current_date, $3, $4)',
      [j.customer_id, j.id, 'counter', `Closed with ${money(c?.uninvoiced_cents)} written off: ${reason}`]);
  }
  await db.query("update jobs set status = 'closed', closed_on = current_date, completed_on = coalesce(completed_on, current_date) where id = $1", [j.id]);
  out({ ref: j.ref, status: 'closed' }, `  ${j.ref} closed.`);
};

// ---- the floor -----------------------------------------------------------------

commands.plan = async (db, args) => {
  const j = await resolve(db, 'job', args[0]);
  if (['closed', 'lost'].includes(j.status)) throw new CliError(`${j.ref} is ${j.status}.`);
  const it = await resolve(db, 'item', args[1]);
  const qty = parseQty(args[2]);
  if (qty <= 0) throw new CliError('Plan a positive quantity.');
  await db.query(
    `insert into job_lines (job_id, item_id, qty_planned, unit_cost_cents, sell_cents)
     values ($1, $2, $3, $4, $5)
     on conflict (job_id, item_id) do update set qty_planned = $3`,
    [j.id, it.id, qty, it.unit_cost_cents, it.sell_cents]);
  const st = await db.query('select * from v_stock where item_id = $1', [it.id]);
  const s = st[0];
  const shortNote = s && Number(s.free) < 0
    ? ` The shelf cannot cover it (free ${s.free} ${it.unit}${num(s.on_order) ? `, ${s.on_order} on order` : ', nothing on order'}): see shortages.`
    : '';
  out({ ref: j.ref, item: it.code, qty_planned: qty },
    `  planned ${qty} ${it.unit} of ${it.code} onto ${j.ref} at today's rates.${shortNote}`);
};

commands.issue = async (db, args, flags) => {
  const j = await resolve(db, 'job', args[0]);
  if (['closed', 'lost', 'quote'].includes(j.status)) throw new CliError(`${j.ref} is ${j.status}; issue stock to a won job.`);
  const it = await resolve(db, 'item', args[1]);
  const qty = parseQty(args[2]);
  if (qty <= 0) throw new CliError('Issue a positive quantity.');
  const heat = str(flags.heat);
  if (j.structural && it.traceable && !heat) {
    throw new CliError(`${j.ref} is a structural job and ${it.code} is traceable material: the issue needs --heat=<heat or cert number> (AS/NZS 5131 traceability). The number is on the mill certificate that came with the steel.`);
  }
  const by = flags.by ? await resolve(db, 'staff', str(flags.by)) : null;
  const onDate = parseDate(flags.on, 'issue date') || today();
  await db.query(
    `insert into issues (job_id, item_id, qty, unit_cost_cents, sell_cents, heat_no, issued_on, issued_by, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [j.id, it.id, qty, it.unit_cost_cents, it.sell_cents, heat || null, onDate, by?.id || null, str(flags.note) || null]);
  await db.query('update items set on_hand = on_hand - $1 where id = $2', [qty, it.id]);
  const [after] = await db.query('select on_hand from items where id = $1', [it.id]);
  out({ ref: j.ref, item: it.code, qty, heat_no: heat || null, on_hand: after.on_hand },
    `  issued ${qty} ${it.unit} of ${it.code} to ${j.ref}${heat ? ` (heat ${heat})` : ''}. ${after.on_hand} ${it.unit} left on the shelf.${Number(after.on_hand) <= Number(it.reorder_level) && Number(it.reorder_level) > 0 ? ' That is through the reorder level: raise a PO.' : ''}`);
};

commands.heat = async (db, args) => {
  // The mill cert turns up after the steel went to the floor: backfill it.
  const j = await resolve(db, 'job', args[0]);
  const it = await resolve(db, 'item', args[1]);
  const heat = str(args[2]);
  if (!heat) throw new CliError('heat <job> <item> <heat or cert number>');
  const rows = await db.query(
    "update issues set heat_no = $1 where job_id = $2 and item_id = $3 and (heat_no is null or heat_no = '') returning id",
    [heat, j.id, it.id]);
  if (!rows.length) throw new CliError(`No issue of ${it.code} on ${j.ref} is missing a heat number.`);
  out({ ref: j.ref, item: it.code, heat_no: heat, updated: rows.length },
    `  heat ${heat} recorded on ${rows.length} issue(s) of ${it.code} on ${j.ref}. Honest backfills only: the number comes off the mill certificate.`);
};

commands.ppsr = async (db, args, flags) => {
  const c = await resolve(db, 'customer', args.join(' '));
  const onDate = parseDate(flags.registered === true || !flags.registered ? 'today' : flags.registered, 'registration date');
  await db.query('update customers set ppsr_registered_on = $1 where id = $2', [onDate, c.id]);
  out({ customer: c.name, ppsr_registered_on: onDate },
    `  ${c.name}: PPSR financing statement recorded as registered ${onDate}. Retention of title now means something in an insolvency.`);
};

commands.time = async (db, args, flags) => {
  const j = await resolve(db, 'job', args[0]);
  if (['closed', 'lost', 'quote'].includes(j.status)) throw new CliError(`${j.ref} is ${j.status}; time books to a won, open job.`);
  const person = await resolve(db, 'staff', args[1]);
  const hours = parseHours(args[2]);
  const centre = flags.centre ? await resolve(db, 'centre', str(flags.centre)) : null;
  const onDate = parseDate(flags.on, 'work date') || today();
  await db.query(
    `insert into time_entries (job_id, staff_id, work_centre_id, worked_on, hours, cost_rate_cents, charge_rate_cents, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [j.id, person.id, centre?.id || null, onDate, hours, person.cost_rate_cents, person.charge_rate_cents, str(flags.note) || null]);
  let svc = '';
  if (centre) {
    const [l] = await db.query('select service_overdue from v_loading where work_centre_id = $1', [centre.id]);
    if (l?.service_overdue) svc = ` NOTE: ${centre.code} is past its service (see compliance plant-maintenance).`;
  }
  out({ ref: j.ref, who: person.full_name, hours, worked_on: onDate },
    `  ${hours}h booked to ${j.ref} for ${person.full_name}${centre ? ` at ${centre.code}` : ''} on ${onDate}.${svc}`);
};

commands.shortages = async (db) => {
  const rows = await db.query('select * from v_shortages order by promised_on nulls last, ref');
  out(rows, () => heading(`Shortages (${rows.length})`) + '\n' + table(rows, [
    { key: 'ref', label: 'Job' },
    { key: 'customer', label: 'Customer', width: 24 },
    { key: 'promised_on', label: 'Promised', format: isoDate },
    { key: 'item_code', label: 'Code' },
    { key: 'item', label: 'Item', width: 28 },
    { key: 'still_needed', label: 'Needed', align: 'right' },
    { key: 'free', label: 'Free', align: 'right' },
    { key: 'short_qty', label: 'Short', align: 'right' },
    { key: 'on_order', label: 'On order', align: 'right', format: (v) => (num(v) ? v : '') },
    { key: 'next_delivery_on', label: 'Due in', format: (v) => isoDate(v) || 'NOTHING COMING' },
  ]) + '\n\n  Anything short with nothing coming: po raise <supplier>, po add, and tell the customer now, not on the promise date.');
};

commands.loading = async (db) => {
  const rows = await db.query('select * from v_loading order by code');
  out(rows, () => heading('Work centres, last 28 days') + '\n' + table(rows, [
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Centre', width: 24 },
    { key: 'hours_28d', label: 'Hours', align: 'right' },
    { key: 'loading_pct', label: 'Loading', align: 'right', format: (v) => (v == null ? '' : `${v}%`) },
    { key: 'loading_pct', label: '', format: (v) => bar(v) },
    { key: 'last_service_on', label: 'Serviced', format: isoDate },
    { key: 'service_overdue', label: 'Service', format: (v) => (v ? 'OVERDUE' : 'ok') },
  ]) + '\n\n  An overdue service is a compliance item (HSWA 2015 s 36), not a preference: centre service <code> when it is done.');
};
commands.centres = commands.loading;

commands.centre = async (db, args, flags) => {
  if (args[0] !== 'service') throw new CliError('centre service <code> [--on=]');
  const c = await resolve(db, 'centre', args[1]);
  const onDate = parseDate(flags.on, 'service date') || today();
  await db.query('update work_centres set last_service_on = $1 where id = $2', [onDate, c.id]);
  out({ centre: c.code, last_service_on: onDate }, `  ${c.code} ${c.name}: service recorded ${onDate} (next due in ${c.service_interval_months} months).`);
};

commands.labour = async (db) => {
  const rows = await db.query('select * from v_labour_week order by full_name');
  out(rows, () => heading('Labour, last 7 days') + '\n' + table(rows, [
    { key: 'full_name', label: 'Who' },
    { key: 'role', label: 'Role' },
    { key: 'hours_7d', label: 'Booked', align: 'right' },
    { key: 'weekly_hours', label: 'Capacity', align: 'right' },
    { key: 'recovery_pct', label: 'Recovery', align: 'right', format: (v) => (v == null ? '' : `${v}%`) },
    { key: 'charge_7d_cents', label: 'Charge value', align: 'right', format: (v) => (num(v) ? money(v) : '') },
    { key: 'last_booked_on', label: 'Last booked', format: (v) => isoDate(v) || 'never' },
  ]) + '\n\n  Unbooked hours are unrecovered hours, and the time record is a legal record (ERA 2000 s 130).');
};

// ---- stock and buying -----------------------------------------------------------

commands.stock = async (db, args, flags) => {
  if (args[0] === 'set') {
    const it = await resolve(db, 'item', args[1]);
    const qty = parseQty(args[2]);
    const reason = str(flags.reason);
    if (!reason) throw new CliError('A stocktake correction has a why: --reason="stocktake 30 June" or what really happened.');
    await db.query('update items set on_hand = $1, note = $2 where id = $3',
      [qty, `${isoDate(new Date())} on_hand set to ${qty}: ${reason}`, it.id]);
    return out({ item: it.code, on_hand: qty }, `  ${it.code} on hand set to ${qty} ${it.unit}: ${reason}`);
  }
  let rows = await db.query('select * from v_stock order by code');
  if (flags.short) rows = rows.filter((r) => Number(r.free) <= Number(r.reorder_level) && Number(r.reorder_level) > 0);
  out(rows, () => heading(`Stock (${rows.length}${flags.short ? ' at or under reorder' : ''})`) + '\n' + table(rows, [
    { key: 'code', label: 'Code' },
    { key: 'description', label: 'Item', width: 32 },
    { key: 'unit', label: 'Unit' },
    { key: 'on_hand', label: 'On hand', align: 'right' },
    { key: 'allocated', label: 'Allocated', align: 'right', format: (v) => (num(v) ? v : '') },
    { key: 'free', label: 'Free', align: 'right' },
    { key: 'on_order', label: 'On order', align: 'right', format: (v) => (num(v) ? v : '') },
    { key: 'reorder_level', label: 'Reorder', align: 'right', format: (v, r) => (num(v) ? v + (Number(r.free) <= Number(v) && num(r.on_order) === 0 ? ' LOW' : '') : '') },
    { key: 'unit_cost_cents', label: 'Cost', align: 'right', format: (v) => money(v) },
    { key: 'traceable', label: 'Cert', format: (v) => (v ? 'heat no' : '') },
  ]));
};

commands.item = async (db, args) => {
  const it = await resolve(db, 'item', args[0]);
  const [st] = await db.query('select * from v_stock where item_id = $1', [it.id]);
  const iss = await db.query(
    `select i.issued_on, j.ref, c.name as customer, i.qty, i.heat_no from issues i
     join jobs j on j.id = i.job_id join customers c on c.id = j.customer_id
     where i.item_id = $1 order by i.issued_on desc limit 12`, [it.id]);
  const orders = await db.query(
    `select po.ref, s.name as supplier, po.status, po.expected_on, pl.qty, pl.unit_cost_cents
     from po_lines pl join purchase_orders po on po.id = pl.po_id join suppliers s on s.id = po.supplier_id
     where pl.item_id = $1 order by po.ordered_on desc limit 8`, [it.id]);
  out({ item: it, position: st, issues: iss, orders }, () => {
    let t = heading(`${it.code}  ${it.description}`);
    t += `\n  ${it.kind}, per ${it.unit} | cost ${money(it.unit_cost_cents)} | sell ${money(it.sell_cents)}${it.traceable ? ' | traceable: heat number on structural jobs' : ''}`;
    t += `\n  on hand ${st.on_hand} | allocated ${st.allocated} | free ${st.free} | on order ${st.on_order}${st.next_delivery_on ? ` (due ${isoDate(st.next_delivery_on)})` : ''}`;
    t += `\n  reorder at ${it.reorder_level}, order ${it.reorder_qty}${st.preferred_supplier ? ` from ${st.preferred_supplier}` : ''}`;
    if (it.note) t += `\n  note: ${it.note}`;
    if (iss.length) t += '\n' + heading('Recent issues') + '\n' + table(iss, [
      { key: 'issued_on', label: 'Date', format: isoDate },
      { key: 'ref', label: 'Job' },
      { key: 'customer', label: 'Customer', width: 26 },
      { key: 'qty', label: 'Qty', align: 'right' },
      { key: 'heat_no', label: 'Heat' },
    ]);
    if (orders.length) t += '\n' + heading('Orders') + '\n' + table(orders, [
      { key: 'ref', label: 'PO' },
      { key: 'supplier', label: 'Supplier', width: 26 },
      { key: 'status', label: 'Status' },
      { key: 'expected_on', label: 'Expected', format: isoDate },
      { key: 'qty', label: 'Qty', align: 'right' },
      { key: 'unit_cost_cents', label: 'Cost', align: 'right', format: (v) => money(v) },
    ]);
    return t;
  });
};

commands.po = async (db, args, flags) => {
  const sub = args[0];
  if (sub === 'raise') {
    const sup = await resolve(db, 'supplier', args.slice(1).join(' '));
    const j = flags.job ? await resolve(db, 'job', str(flags.job)) : null;
    const ref = await nextRef(db, 'purchase_orders', 'ref', 'PO', 499);
    await db.query(
      'insert into purchase_orders (ref, supplier_id, job_id, ordered_on, expected_on, note) values ($1, $2, $3, current_date, $4, $5)',
      [ref, sup.id, j?.id || null, parseDate(flags.expected, 'expected date'), str(flags.note) || null]);
    return out({ ref, supplier: sup.name, job: j?.ref || null },
      `  ${ref} raised on ${sup.name}${j ? ` for ${j.ref} (cost lands on the job at receipt)` : ' (stock: the shelf goes up at receipt)'}.\n  Next: po add ${ref} <item|"description"> <qty> <unit-cost>.`);
  }
  if (sub === 'add') {
    const po = await resolve(db, 'po', args[1]);
    if (po.status !== 'open') throw new CliError(`${po.ref} is ${po.status}.`);
    const what = args[2];
    const qty = parseQty(args[3]);
    const cost = parseMoney(args[4]);
    if (qty <= 0 || cost < 0) throw new CliError('po add <ref> <item|"description"> <qty> <unit-cost>');
    const it = await resolve(db, 'item', what, { optional: true });
    await db.query('insert into po_lines (po_id, item_id, description, qty, unit_cost_cents) values ($1, $2, $3, $4, $5)',
      [po.id, it?.id || null, it ? it.description : what, qty, cost]);
    return out({ ref: po.ref, item: it?.code || null, description: it ? it.description : what, qty, unit_cost_cents: cost },
      `  ${po.ref}: ${qty} x ${it ? it.code : `"${what}"`} at ${money(cost)}.${it ? '' : ' (No stock item matched, so it lands as outwork or a described service.)'}`);
  }
  if (sub === 'receive') {
    const po = await resolve(db, 'po', args[1]);
    if (po.status !== 'open') throw new CliError(`${po.ref} is ${po.status}.`);
    const onDate = parseDate(flags.on, 'received date') || today();
    const lines = await db.query('select * from po_lines where po_id = $1', [po.id]);
    if (!lines.length) throw new CliError(`${po.ref} has no lines. po add first, or po cancel it.`);
    for (const l of lines) {
      if (l.item_id && !po.job_id) {
        await db.query('update items set on_hand = on_hand + $1, unit_cost_cents = $2 where id = $3', [l.qty, l.unit_cost_cents, l.item_id]);
      }
    }
    await db.query("update purchase_orders set status = 'received', received_on = $1 where id = $2", [onDate, po.id]);
    const total = lines.reduce((a, l) => a + Math.round(Number(l.qty) * num(l.unit_cost_cents)), 0);
    return out({ ref: po.ref, received_on: onDate, total_cents: total },
      `  ${po.ref} received ${onDate}: ${money(total)}${po.job_id ? ` onto ${po.job_ref}'s cost` : ' into stock, shelf and latest costs updated'}.`);
  }
  if (sub === 'cancel') {
    const po = await resolve(db, 'po', args[1]);
    if (po.status !== 'open') throw new CliError(`${po.ref} is ${po.status}.`);
    await db.query("update purchase_orders set status = 'cancelled' where id = $1", [po.id]);
    return out({ ref: po.ref, status: 'cancelled' }, `  ${po.ref} cancelled.`);
  }
  const rows = await db.query(
    `select po.ref, s.name as supplier, j.ref as job, po.ordered_on, po.expected_on, po.status,
            (select sum(round(pl.qty * pl.unit_cost_cents)) from po_lines pl where pl.po_id = po.id)::bigint as value_cents,
            po.note
     from purchase_orders po join suppliers s on s.id = po.supplier_id left join jobs j on j.id = po.job_id
     ${flags.all ? '' : "where po.status = 'open'"} order by po.expected_on nulls last`);
  out(rows, () => heading(`Purchase orders (${rows.length}${flags.all ? '' : ' open'})`) + '\n' + table(rows, [
    { key: 'ref', label: 'Ref' },
    { key: 'supplier', label: 'Supplier', width: 28 },
    { key: 'job', label: 'Job' },
    { key: 'ordered_on', label: 'Ordered', format: isoDate },
    { key: 'expected_on', label: 'Expected', format: (v, r) => (v ? isoDate(v) + (r.status === 'open' && isoDate(v) < today() ? ' OVERDUE' : '') : '') },
    { key: 'value_cents', label: 'Value', align: 'right', format: (v) => (v == null ? '' : money(v)) },
    { key: 'note', label: 'Note', width: 34 },
  ]));
};

commands.suppliers = async (db) => {
  const rows = await db.query('select * from suppliers order by name');
  out(rows, () => heading(`Suppliers (${rows.length})`) + '\n' + table(rows, [
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Supplier', width: 30 },
    { key: 'contact_name', label: 'Contact' },
    { key: 'phone', label: 'Phone' },
    { key: 'lead_time_days', label: 'Lead', align: 'right', format: (v) => (v == null ? '' : `${v}d`) },
  ]));
};

// ---- the money -----------------------------------------------------------------

commands.bill = async (db, args, flags) => {
  const j = await resolve(db, 'job', args[0]);
  if (['quote', 'lost', 'closed'].includes(j.status)) throw new CliError(`${j.ref} is ${j.status}; bill a won, open job.`);
  const c = await jobCost(db, j.id);
  let amount;
  const lines = [];
  if (flags.amount !== undefined) {
    amount = parseMoney(flags.amount);
    lines.push({ description: `${j.title}: ${str(flags.description) || 'progress claim'}`, amount_cents: amount });
  } else if (flags.percent !== undefined) {
    if (j.charge_basis !== 'fixed') throw new CliError('--percent only makes sense on a fixed price. On time and materials, bill the meter (no flag) or a --amount.');
    const pct = Number(str(flags.percent).replace('%', ''));
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw new CliError('--percent is 1 to 100.');
    amount = Math.round(num(j.quoted_cents) * pct / 100);
    lines.push({ description: `${j.title}: progress claim, ${pct}% of the contract sum`, amount_cents: amount });
  } else if (j.charge_basis === 'fixed') {
    if (j.status !== 'complete') throw new CliError(`${j.ref} is not complete. A progress claim needs --amount= or --percent=; the balance bills itself at completion.`);
    amount = num(c.uninvoiced_cents);
    if (!amount) throw new CliError(`Nothing left to bill on ${j.ref}.`);
    lines.push({ description: `${j.title}${num(c.invoiced_cents) ? ': balance of the contract sum' : ''}`, amount_cents: amount });
  } else {
    amount = num(c.uninvoiced_cents);
    if (!amount) throw new CliError(`Nothing unbilled on ${j.ref}.`);
    if (num(c.labour_charge_cents)) lines.push({ description: `Labour, ${c.labour_hours} hours`, amount_cents: num(c.labour_charge_cents) });
    if (num(c.material_sell_cents)) lines.push({ description: 'Materials', amount_cents: num(c.material_sell_cents) });
    if (num(c.outwork_cost_cents)) lines.push({ description: 'Outwork and bought-in services', amount_cents: num(c.outwork_cost_cents) });
    if (num(c.invoiced_cents)) lines.push({ description: 'Less previously invoiced', amount_cents: -num(c.invoiced_cents) });
  }
  if (amount <= 0) throw new CliError(`Nothing to bill on ${j.ref}.`);

  let retention = 0;
  if (flags.retention !== undefined) {
    const rs = str(flags.retention);
    retention = rs.endsWith('%') ? Math.round(amount * Number(rs.slice(0, -1)) / 100) : parseMoney(rs);
    if (!Number.isFinite(retention) || retention < 0 || retention >= amount) throw new CliError('--retention is a percentage like 5% or an amount smaller than the bill.');
  }
  const paymentClaim = j.construction_work && !flags['no-payment-claim'];
  const number = await nextRef(db, 'invoices', 'number', 'INV', 2999);
  const issued = today();
  const [inv] = await db.query(
    `insert into invoices (number, job_id, customer_id, issued_on, due_on, total_cents, payment_claim, retention_cents, retention_due_on, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft') returning id`,
    [number, j.id, j.customer_id, issued, addDays(issued, num(j.terms_days) || 20), amount, paymentClaim, retention,
     parseDate(flags['retention-due'], 'retention due date')]);
  for (const l of lines) {
    await db.query('insert into invoice_lines (invoice_id, description, amount_cents) values ($1, $2, $3)', [inv.id, l.description, l.amount_cents]);
  }
  out({ number, ref: j.ref, customer: j.customer_name, total_cents: amount, payment_claim: paymentClaim, retention_cents: retention, status: 'draft' },
    `  ${number} drafted for ${j.ref} (${j.customer_name}): ${money(amount)}${retention ? `, retention ${money(retention)}` : ''}${paymentClaim ? ', as a PAYMENT CLAIM under the Construction Contracts Act 2002' : ''}.\n  It is a DRAFT. Render it with npm run docs, send it yourself, then \`invoice sent ${number}\`.`);
};

commands.wip = async (db) => {
  const rows = await db.query(
    `select jc.ref, c.name as customer, jc.title, jc.status, jc.total_cost_cents, jc.invoiced_cents,
            greatest(0, jc.total_cost_cents - jc.invoiced_cents)::bigint as cost_not_billed_cents,
            jc.uninvoiced_cents
     from v_job_cost jc join customers c on c.id = jc.customer_id
     where jc.status in ('accepted', 'in-progress', 'on-hold', 'complete')
     order by cost_not_billed_cents desc, jc.ref`);
  const wip = rows.reduce((a, r) => a + num(r.cost_not_billed_cents), 0);
  const toBill = rows.reduce((a, r) => a + num(r.uninvoiced_cents), 0);
  out({ jobs: rows, wip_cents: wip, to_bill_cents: toBill }, () => heading(`Work in progress (${rows.length} open jobs)`) + '\n' + table(rows, [
    { key: 'ref', label: 'Ref' },
    { key: 'customer', label: 'Customer', width: 26 },
    { key: 'title', label: 'Job', width: 32 },
    { key: 'status', label: 'Status' },
    { key: 'total_cost_cents', label: 'Cost in job', align: 'right', format: (v) => (num(v) ? money(v) : '') },
    { key: 'invoiced_cents', label: 'Invoiced', align: 'right', format: (v) => (num(v) ? money(v) : '') },
    { key: 'cost_not_billed_cents', label: 'Cost unbilled', align: 'right', format: (v) => (num(v) ? money(v) : '') },
    { key: 'uninvoiced_cents', label: 'Left to bill', align: 'right', format: (v) => (num(v) ? money(v) : '') },
  ]) + `\n\n  WIP (cost sitting in open jobs, not yet billed): ${money(wip)}. Left to bill across the board: ${money(toBill)}.\n  This is the month-end number the accountant asks for, live, any day of the month.`);
};

commands.costing = async (db, args, flags) => {
  const rows = await db.query(
    `select jc.*, c.name as customer,
            (jc.charge_value_cents - jc.total_cost_cents)::bigint as margin_cents,
            case when jc.charge_value_cents > 0 then round((jc.charge_value_cents - jc.total_cost_cents) * 100.0 / jc.charge_value_cents) end as margin_pct
     from v_job_cost jc join customers c on c.id = jc.customer_id
     where ($1 or jc.status in ('accepted', 'in-progress', 'on-hold', 'complete'))
       and jc.status <> 'quote'
     order by margin_pct nulls last`, [Boolean(flags.all)]);
  out(rows, () => heading(`Job costing (${rows.length}${flags.all ? ', closed included' : ' open'})`) + '\n' + table(rows, [
    { key: 'ref', label: 'Ref' },
    { key: 'customer', label: 'Customer', width: 24 },
    { key: 'title', label: 'Job', width: 30 },
    { key: 'status', label: 'Status' },
    { key: 'material_cost_cents', label: 'Materials', align: 'right', format: (v) => (num(v) ? money(v) : '') },
    { key: 'labour_hours', label: 'Hours', align: 'right', format: (v) => (num(v) ? v : '') },
    { key: 'labour_cost_cents', label: 'Labour', align: 'right', format: (v) => (num(v) ? money(v) : '') },
    { key: 'outwork_cost_cents', label: 'Outwork', align: 'right', format: (v) => (num(v) ? money(v) : '') },
    { key: 'total_cost_cents', label: 'Cost', align: 'right', format: (v) => (num(v) ? money(v) : '') },
    { key: 'charge_value_cents', label: 'Worth', align: 'right', format: (v) => (num(v) ? money(v) : '') },
    { key: 'margin_cents', label: 'Margin', align: 'right', format: (v) => money(v) },
    { key: 'margin_pct', label: '%', align: 'right', format: (v) => (v == null ? '' : `${v}%`) },
  ]) + '\n\n  Margin is charge value less cost, before overhead. The jobs at the top of this list are the ones to re-quote next time.');
};
commands['job-costing'] = commands.costing;

commands.invoices = async (db, args, flags) => {
  const rows = await db.query(
    `select i.number, j.ref, c.name as customer, i.issued_on, i.due_on, i.total_cents, i.payment_claim, i.retention_cents, i.status
     from invoices i join jobs j on j.id = i.job_id join customers c on c.id = i.customer_id
     ${flags.all ? '' : "where i.status <> 'paid'"} order by i.issued_on desc`);
  out(rows, () => heading(`Invoices (${rows.length}${flags.all ? '' : ' open'})`) + '\n' + table(rows, [
    { key: 'number', label: 'Number' },
    { key: 'ref', label: 'Job' },
    { key: 'customer', label: 'Customer', width: 28 },
    { key: 'issued_on', label: 'Issued', format: isoDate },
    { key: 'due_on', label: 'Due', format: isoDate },
    { key: 'total_cents', label: 'Total', align: 'right', format: (v) => money(v) },
    { key: 'payment_claim', label: 'Claim', format: (v) => (v ? 'PC' : '') },
    { key: 'retention_cents', label: 'Retention', align: 'right', format: (v) => (num(v) ? money(v) : '') },
    { key: 'status', label: 'Status' },
  ]));
};

commands.invoice = async (db, args, flags) => {
  const sub = args[0];
  if (sub === 'claim') {
    // A draft on construction work that missed the flag: mark it before it is served.
    const inv = await resolve(db, 'invoice', args[1]);
    if (inv.status !== 'draft') throw new CliError(`${inv.number} is ${inv.status}. A claim is made when it is served; an invoice already sent plain stays plain, and the next one goes out properly.`);
    if (!inv.construction_work) throw new CliError(`${inv.job_ref} is not flagged as construction work.`);
    await db.query('update invoices set payment_claim = true where id = $1', [inv.id]);
    return out({ number: inv.number, payment_claim: true },
      `  ${inv.number} will go out as a PAYMENT CLAIM under the Construction Contracts Act 2002. Render it fresh with npm run docs before sending.`);
  }
  if (sub === 'sent' || sub === 'paid') {
    const inv = await resolve(db, 'invoice', args[1]);
    const onDate = parseDate(flags.on, 'date') || today();
    if (sub === 'sent') await db.query("update invoices set status = 'sent', sent_on = $1 where id = $2", [onDate, inv.id]);
    else await db.query("update invoices set status = 'paid', paid_on = $1 where id = $2", [onDate, inv.id]);
    return out({ number: inv.number, status: sub, on: onDate }, `  ${inv.number} marked ${sub} ${onDate}.${sub === 'paid' && num(inv.retention_cents) ? ` Retention of ${money(inv.retention_cents)} is still out there: retentions watches it.` : ''}`);
  }
  const inv = await resolve(db, 'invoice', args.join(' '));
  const lines = await db.query('select * from invoice_lines where invoice_id = $1 order by created_at', [inv.id]);
  out({ invoice: inv, lines }, () => {
    let t = heading(`${inv.number}  ${inv.customer_name} (${inv.status.toUpperCase()})`);
    t += `\n  job ${inv.job_ref} | issued ${isoDate(inv.issued_on)} | due ${isoDate(inv.due_on)}${inv.sent_on ? ` | sent ${isoDate(inv.sent_on)}` : ''}${inv.paid_on ? ` | paid ${isoDate(inv.paid_on)}` : ''}`;
    if (inv.payment_claim) t += '\n  A PAYMENT CLAIM under the Construction Contracts Act 2002.';
    if (num(inv.retention_cents)) t += `\n  retention ${money(inv.retention_cents)}${inv.retention_due_on ? `, due back ${isoDate(inv.retention_due_on)}` : ''}${inv.retention_received_on ? `, received ${isoDate(inv.retention_received_on)}` : ''}`;
    t += '\n' + table(lines, [
      { key: 'description', label: 'Line', width: 66 },
      { key: 'amount_cents', label: 'Amount', align: 'right', format: (v) => money(v) },
    ]);
    t += `\n  Total ${money(inv.total_cents)}`;
    if (inv.status === 'draft') t += '\n  A DRAFT: render with npm run docs, send it yourself, then `invoice sent`.';
    return t;
  });
};

commands.retentions = async (db) => {
  const rows = await db.query('select * from v_retentions order by retention_due_on nulls last');
  const held = rows.filter((r) => !r.retention_received_on).reduce((a, r) => a + num(r.retention_cents), 0);
  out(rows, () => heading(`Retentions (${rows.length})`) + '\n' + table(rows, [
    { key: 'number', label: 'Invoice' },
    { key: 'ref', label: 'Job' },
    { key: 'customer', label: 'Customer', width: 28 },
    { key: 'retention_cents', label: 'Held', align: 'right', format: (v) => money(v) },
    { key: 'retention_due_on', label: 'Due back', format: (v) => isoDate(v) || 'no date set' },
    { key: 'retention_received_on', label: 'Received', format: isoDate },
    { key: 'days_overdue', label: 'Overdue', align: 'right', format: (v) => (v ? `${v}d` : '') },
  ]) + `\n\n  ${money(held)} of your money is being held. It is trust money (CCA 2002 subpart 2A), and it comes back to the people who ask.`);
};

commands.retention = async (db, args, flags) => {
  if (args[0] !== 'received') throw new CliError('retention received <invoice number> [--on=]');
  const inv = await resolve(db, 'invoice', args[1]);
  if (!num(inv.retention_cents)) throw new CliError(`${inv.number} carries no retention.`);
  const onDate = parseDate(flags.on, 'received date') || today();
  await db.query('update invoices set retention_received_on = $1 where id = $2', [onDate, inv.id]);
  out({ number: inv.number, retention_received_on: onDate }, `  ${inv.number}: retention of ${money(inv.retention_cents)} received ${onDate}.`);
};

commands.debtors = async (db) => {
  const rows = await db.query('select * from v_debtors order by days_overdue desc');
  out(rows, () => heading(`Debtors (${rows.length})`) + '\n' + table(rows, [
    { key: 'number', label: 'Number' },
    { key: 'customer', label: 'Customer', width: 28 },
    { key: 'ref', label: 'Job' },
    { key: 'total_cents', label: 'Total', align: 'right', format: (v) => money(v) },
    { key: 'payment_claim', label: 'Claim', format: (v) => (v ? 'PC' : '') },
    { key: 'status', label: 'Status' },
    { key: 'due_on', label: 'Due', format: isoDate },
    { key: 'bucket', label: 'Aged', format: (v, r) => (r.status === 'draft' ? 'NOT SENT' : v) },
  ]) + '\n\n  An overdue payment claim has the Act behind it; an overdue plain invoice has your phone voice. Chase accordingly.');
};

// ---- the desk ---------------------------------------------------------------------

commands.staff = async (db) => {
  const rows = await db.query('select * from staff where active order by full_name');
  out(rows, () => heading(`Staff (${rows.length})`) + '\n' + table(rows, [
    { key: 'code', label: 'Code' },
    { key: 'full_name', label: 'Name' },
    { key: 'role', label: 'Role' },
    { key: 'cost_rate_cents', label: 'Cost/h', align: 'right', format: (v) => money(v) },
    { key: 'charge_rate_cents', label: 'Charge/h', align: 'right', format: (v) => money(v) },
    { key: 'weekly_hours', label: 'Hours/wk', align: 'right' },
  ]));
};

commands.customers = async (db, args, flags) => {
  const rows = await db.query(
    `select cp.*, c.city, c.contact_name from v_customer_position cp join customers c on c.id = cp.customer_id
     where cp.status = 'active' or $1 order by cp.exposure_cents desc, cp.customer`, [Boolean(flags.all)]);
  out(rows, () => heading(`Customers (${rows.length})`) + '\n' + table(rows, [
    { key: 'customer', label: 'Customer', width: 30, format: (v, r) => v + (r.on_stop ? ' [STOP]' : '') },
    { key: 'account_type', label: 'Type' },
    { key: 'open_jobs', label: 'Jobs', align: 'right', format: (v) => (num(v) ? v : '') },
    { key: 'open_quotes', label: 'Quotes', align: 'right', format: (v) => (num(v) ? v : '') },
    { key: 'owing_cents', label: 'Owing', align: 'right', format: (v) => (num(v) ? money(v) : '') },
    { key: 'wip_cents', label: 'WIP', align: 'right', format: (v) => (num(v) ? money(v) : '') },
    { key: 'exposure_cents', label: 'Exposure', align: 'right', format: (v) => (num(v) ? money(v) : '') },
    { key: 'credit_limit_cents', label: 'Limit', align: 'right', format: (v, r) => (v == null ? '' : money(v) + (num(r.exposure_cents) > num(v) ? ' OVER' : '')) },
    { key: 'ppsr_registered_on', label: 'PPSR', format: (v, r) => (v ? isoDate(v) : num(r.owing_cents) >= 1000000 ? 'NOT REGISTERED' : '') },
  ]));
};

commands.customer = async (db, args) => {
  const c = await resolve(db, 'customer', args.join(' '));
  const [pos] = await db.query('select * from v_customer_position where customer_id = $1', [c.id]);
  const jobsRows = await db.query(
    `select j.ref, j.title, j.status, j.quoted_cents, j.promised_on, j.closed_on from jobs j
     where j.customer_id = $1 order by j.created_at desc limit 15`, [c.id]);
  const invs = await db.query('select * from v_debtors where customer_id = $1 order by days_overdue desc', [c.id]);
  const noteRows = await db.query(
    `select n.*, s.full_name as by_whom from notes n left join staff s on s.id = n.staff_id
     where n.customer_id = $1 order by n.noted_on desc limit 8`, [c.id]);
  const openTasks = await db.query("select * from tasks where customer_id = $1 and status = 'open' order by due_on", [c.id]);
  out({ customer: c, position: pos, jobs: jobsRows, owing: invs, notes: noteRows, tasks: openTasks }, () => {
    let t = heading(`${c.name}${c.on_stop ? '  [ON STOP]' : ''}`);
    t += `\n  ${c.account_type} account | ${c.contact_name || ''} ${c.phone || ''} ${c.email || ''} | ${c.city || ''}`;
    t += `\n  terms ${c.terms_days} days | limit ${c.credit_limit_cents == null ? 'none set' : money(c.credit_limit_cents)} | owing ${money(pos?.owing_cents)} + WIP ${money(pos?.wip_cents)} = exposure ${money(pos?.exposure_cents)}${c.credit_limit_cents != null && num(pos?.exposure_cents) > num(c.credit_limit_cents) ? ' OVER THE LIMIT' : ''}`;
    t += `\n  PPSR financing statement: ${c.ppsr_registered_on ? `registered ${isoDate(c.ppsr_registered_on)}` : 'not registered' + (num(pos?.owing_cents) >= 1000000 ? ' and they owe five figures (PPSA 1999: register it)' : '')}`;
    t += `\n  lifetime paid ${money(pos?.lifetime_paid_cents)} | last contact ${isoDate(pos?.last_contact_on) || 'never'}`;
    if (c.note) t += `\n  note: ${c.note}`;
    if (jobsRows.length) t += '\n' + heading('Jobs') + '\n' + table(jobsRows, [
      { key: 'ref', label: 'Ref' },
      { key: 'status', label: 'Status' },
      { key: 'title', label: 'Job', width: 36 },
      { key: 'quoted_cents', label: 'Value', align: 'right', format: (v) => (v == null ? 'T&M' : money(v)) },
      { key: 'promised_on', label: 'Promised', format: isoDate },
      { key: 'closed_on', label: 'Closed', format: isoDate },
    ]);
    if (invs.length) t += '\n' + heading('Owing') + '\n' + table(invs, [
      { key: 'number', label: 'Number' },
      { key: 'total_cents', label: 'Total', align: 'right', format: (v) => money(v) },
      { key: 'status', label: 'Status' },
      { key: 'due_on', label: 'Due', format: isoDate },
      { key: 'bucket', label: 'Aged', format: (v, r) => (r.status === 'draft' ? 'NOT SENT' : v) },
    ]);
    if (noteRows.length) t += '\n' + heading('Notes') + '\n' + table(noteRows, [
      { key: 'noted_on', label: 'Date', format: isoDate },
      { key: 'channel', label: 'Via' },
      { key: 'by_whom', label: 'Who' },
      { key: 'note', label: 'Note', width: 64 },
    ]);
    if (openTasks.length) t += '\n' + heading('Open tasks') + '\n' + table(openTasks, [
      { key: 'title', label: 'Task', width: 50 },
      { key: 'due_on', label: 'Due', format: isoDate },
    ]);
    return t;
  });
};

commands.add = async (db, args, flags) => {
  const kind = args[0];
  if (kind === 'customer') {
    const name = args[1];
    if (!name) throw new CliError('add customer "<name>" [--type=trade|consumer] [--contact=] [--email=] [--phone=] [--city=] [--terms=20] [--limit=] [--ppsr=]');
    const type = str(flags.type) || 'trade';
    if (!['trade', 'consumer'].includes(type)) throw new CliError('--type is trade or consumer.');
    const [r] = await db.query(
      `insert into customers (name, account_type, contact_name, email, phone, city, terms_days, credit_limit_cents, ppsr_registered_on)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [name, type, str(flags.contact) || null, str(flags.email) || null, str(flags.phone) || null, str(flags.city) || null,
       flags.terms !== undefined ? Number(flags.terms) : 20, flags.limit !== undefined ? parseMoney(flags.limit) : null,
       parseDate(flags.ppsr, 'PPSR registration date')]);
    return out({ customer_id: r.id, name }, `  customer added: ${name} (${type}).${flags.ppsr ? '' : ' If they will owe real money on retention-of-title terms, register on ppsr.govt.nz and record it.'}`);
  }
  if (kind === 'staff') {
    const name = args[1];
    if (!name) throw new CliError('add staff "<name>" [--role=tradesperson|estimator|storeman|manager] [--cost=42] [--charge=95] [--hours=40] [--code=]');
    const [r] = await db.query(
      'insert into staff (full_name, role, code, email, phone, cost_rate_cents, charge_rate_cents, weekly_hours) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id',
      [name, str(flags.role) || 'tradesperson', str(flags.code) || null, str(flags.email) || null, str(flags.phone) || null,
       parseMoney(flags.cost), parseMoney(flags.charge), flags.hours !== undefined ? Number(flags.hours) : 40]);
    return out({ staff_id: r.id, name }, `  staff added: ${name}. Rates are captured onto every hour they book from now.`);
  }
  if (kind === 'item') {
    const code = args[1];
    const desc = args[2];
    if (!code || !desc) throw new CliError('add item <code> "<description>" [--kind=material|bought-in|consumable] [--unit=ea] [--cost=] [--sell=] [--on-hand=] [--reorder=] [--reorder-qty=] [--traceable] [--supplier=]');
    const sup = flags.supplier ? await resolve(db, 'supplier', str(flags.supplier)) : null;
    const [r] = await db.query(
      `insert into items (code, description, kind, unit, on_hand, reorder_level, reorder_qty, unit_cost_cents, sell_cents, traceable, preferred_supplier_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [code, desc, str(flags.kind) || 'material', str(flags.unit) || 'ea',
       flags['on-hand'] !== undefined ? parseQty(flags['on-hand']) : 0,
       flags.reorder !== undefined ? parseQty(flags.reorder) : 0,
       flags['reorder-qty'] !== undefined ? parseQty(flags['reorder-qty']) : 0,
       parseMoney(flags.cost), parseMoney(flags.sell), flags.traceable !== undefined, sup?.id || null]);
    return out({ item_id: r.id, code }, `  item added: ${code} ${desc}.${flags.traceable !== undefined ? ' Traceable: issues to structural jobs will demand a heat number.' : ''}`);
  }
  if (kind === 'supplier') {
    const name = args[1];
    if (!name) throw new CliError('add supplier "<name>" [--contact=] [--email=] [--phone=] [--lead=3] [--code=]');
    const [r] = await db.query('insert into suppliers (name, code, contact_name, email, phone, lead_time_days) values ($1, $2, $3, $4, $5, $6) returning id',
      [name, str(flags.code) || null, str(flags.contact) || null, str(flags.email) || null, str(flags.phone) || null,
       flags.lead !== undefined ? Number(flags.lead) : null]);
    return out({ supplier_id: r.id, name }, `  supplier added: ${name}.`);
  }
  if (kind === 'centre') {
    const code = args[1];
    const name = args[2];
    if (!code || !name) throw new CliError('add centre <code> "<name>" [--capacity=40] [--interval=6] [--serviced=]');
    const [r] = await db.query(
      'insert into work_centres (code, name, weekly_capacity_hours, service_interval_months, last_service_on) values ($1, $2, $3, $4, $5) returning id',
      [code, name, flags.capacity !== undefined ? Number(flags.capacity) : 40,
       flags.interval !== undefined ? Number(flags.interval) : 6, parseDate(flags.serviced, 'service date')]);
    return out({ centre_id: r.id, code }, `  work centre added: ${code} ${name}. The service clock starts now: record services or it goes on the compliance list.`);
  }
  throw new CliError('add customer|staff|item|supplier|centre ...');
};

commands.stop = async (db, args, flags) => {
  const c = await resolve(db, 'customer', args.join(' '));
  await db.query('update customers set on_stop = true where id = $1', [c.id]);
  await db.query('insert into notes (customer_id, noted_on, channel, note) values ($1, current_date, $2, $3)',
    [c.id, 'phone', `Account put ON STOP.${flags.note ? ' ' + str(flags.note) : ''}`]);
  out({ customer: c.name, on_stop: true }, `  ${c.name} is ON STOP. New quotes refuse; open jobs stay visible on the board.`);
};

commands.unstop = async (db, args) => {
  const c = await resolve(db, 'customer', args.join(' '));
  await db.query('update customers set on_stop = false where id = $1', [c.id]);
  out({ customer: c.name, on_stop: false }, `  ${c.name} is trading again.`);
};

commands.log = async (db, args, flags) => {
  const target = args[0];
  const note = args[1];
  if (!target || !note) throw new CliError('log <ref|customer> "what happened" [--channel=phone|email|floor|site|counter] [--by=] [--on=]');
  const by = flags.by ? await resolve(db, 'staff', str(flags.by)) : null;
  const onDate = parseDate(flags.on, 'note date') || today();
  const channel = str(flags.channel) || 'phone';
  const j = await resolve(db, 'job', target, { optional: true });
  if (j) {
    await db.query('insert into notes (customer_id, job_id, staff_id, noted_on, channel, note) values ($1, $2, $3, $4, $5, $6)',
      [j.customer_id, j.id, by?.id || null, onDate, channel, note]);
    return out({ ref: j.ref, noted_on: onDate }, `  noted on ${j.ref} (${j.customer_name}).`);
  }
  const c = await resolve(db, 'customer', target);
  await db.query('insert into notes (customer_id, staff_id, noted_on, channel, note) values ($1, $2, $3, $4, $5)',
    [c.id, by?.id || null, onDate, channel, note]);
  out({ customer: c.name, noted_on: onDate }, `  noted on ${c.name}.`);
};

commands.tasks = async (db, args, flags) => {
  const rows = await db.query(
    `select t.*, c.name as customer, j.ref from tasks t
     left join customers c on c.id = t.customer_id left join jobs j on j.id = t.job_id
     ${flags.all ? '' : "where t.status = 'open'"} order by t.due_on nulls last`);
  out(rows, () => heading(`Tasks (${rows.length}${flags.all ? '' : ' open'})`) + '\n' + table(rows, [
    { key: 'title', label: 'Task', width: 52 },
    { key: 'customer', label: 'Customer', width: 24 },
    { key: 'ref', label: 'Job' },
    { key: 'due_on', label: 'Due', format: (v) => (v ? isoDate(v) + (isoDate(v) < today() ? ' OVERDUE' : '') : '') },
    { key: 'status', label: 'Status' },
  ]));
};

commands.task = async (db, args, flags) => {
  const sub = args[0];
  if (sub === 'add') {
    const title = args[1];
    if (!title) throw new CliError('task add "<title>" [--customer=] [--job=] [--due=] [--by=] [--note=]');
    const c = flags.customer ? await resolve(db, 'customer', str(flags.customer)) : null;
    const j = flags.job ? await resolve(db, 'job', str(flags.job)) : null;
    const by = flags.by ? await resolve(db, 'staff', str(flags.by)) : null;
    await db.query('insert into tasks (title, customer_id, job_id, staff_id, due_on, note) values ($1, $2, $3, $4, $5, $6)',
      [title, c?.id || j?.customer_id || null, j?.id || null, by?.id || null, parseDate(flags.due, 'due date'), str(flags.note) || null]);
    return out({ title }, `  task added: ${title}`);
  }
  if (sub === 'done') {
    const t = await resolve(db, 'task', args.slice(1).join(' '));
    const onDate = parseDate(flags.on, 'done date') || today();
    await db.query("update tasks set status = 'done', done_on = $1 where id = $2", [onDate, t.id]);
    return out({ task: t.title, done_on: onDate }, `  done: ${t.title}`);
  }
  throw new CliError('task add|done ...');
};

// ---- attention, compliance, stats ------------------------------------------------

const ATTENTION_ORDER = [
  'heat_missing', 'plant_service_overdue', 'quote_burnt', 'job_late', 'shortage_blocking', 'po_overdue',
  'job_stalled', 'complete_not_invoiced', 'invoice_overdue', 'payment_claim_missing', 'retention_due',
  'invoice_draft', 'over_credit_limit', 'ppsr_unregistered', 'below_reorder', 'timesheet_gap',
  'quote_stale', 'task_overdue',
];
const ATTENTION_LABEL = {
  heat_missing: 'NO HEAT NUMBER, STRUCTURAL', plant_service_overdue: 'Work centre service overdue',
  quote_burnt: 'Quote nearly eaten', job_late: 'Past the promise date', shortage_blocking: 'Short of material',
  po_overdue: 'PO overdue', job_stalled: 'Job gone quiet', complete_not_invoiced: 'Finished, not billed',
  invoice_overdue: 'Invoice overdue', payment_claim_missing: 'No payment claim on construction work',
  retention_due: 'Retention due back', invoice_draft: 'Draft never sent', over_credit_limit: 'Over the credit limit',
  ppsr_unregistered: 'Owing five figures, no PPSR', below_reorder: 'Through the reorder level',
  timesheet_gap: 'Time not booked', quote_stale: 'Quote going cold', task_overdue: 'Task overdue',
};

commands.attention = async (db) => {
  const rows = await db.query('select * from v_attention');
  rows.sort((a, b) => ATTENTION_ORDER.indexOf(a.reason) - ATTENTION_ORDER.indexOf(b.reason) || num(b.days) - num(a.days));
  out(rows, () => {
    const counts = {};
    for (const r of rows) counts[r.reason] = (counts[r.reason] || 0) + 1;
    let t = heading(`Needs attention (${rows.length})`);
    t += '\n  ' + Object.entries(counts).map(([k, n]) => `${ATTENTION_LABEL[k] || k}: ${n}`).join('  |  ');
    t += '\n\n' + table(rows, [
      { key: 'reason', label: 'What', format: (v) => ATTENTION_LABEL[v] || v },
      { key: 'label', label: 'Record', width: 20 },
      { key: 'customer', label: 'Customer', width: 24 },
      { key: 'item', label: 'Code' },
      { key: 'days', label: 'Days', align: 'right' },
      { key: 'amount_cents', label: 'Value', align: 'right', format: (v) => (num(v) ? money(v) : '') },
      { key: 'detail', label: 'Detail', width: 64 },
    ]);
    return t;
  });
};

commands.compliance = async (db, args) => {
  const only = args[0];
  const rules = only ? RULES.filter((r) => r.key === only || r.key.startsWith(only)) : RULES;
  if (!rules.length) throw new CliError(`No rule "${only}". Rules: ${RULES.map((r) => r.key).join(', ')}`);
  const results = [];
  for (const r of rules) {
    const breaches = await db.query(r.sql);
    results.push({ key: r.key, title: r.title, source: r.source, fix: r.fix, breaches });
  }
  out(results, () => {
    let t = heading('Compliance, checked against the records');
    for (const r of results) {
      t += `\n\n  ${r.breaches.length ? 'BREACH' : '  ok  '}  ${r.key}: ${r.title}`;
      t += `\n          ${r.source}`;
      if (r.breaches.length) {
        for (const b of r.breaches) {
          t += `\n          - ${Object.values(b).filter((v) => v !== null && v !== '').map((v) => (v instanceof Date ? isoDate(v) : v)).join(' | ')}`;
        }
        t += `\n          fix: ${r.fix}`;
      }
    }
    t += '\n\n  The rule book with sources is docs/compliance.md. It is your rule book, not legal advice: edit it and these checks together.';
    return t;
  });
};

commands.stats = async (db) => {
  const [c] = await db.query(`
    select (select count(*) from v_job_board) as open_jobs,
           (select count(*) from v_job_board where status = 'in-progress') as on_the_floor,
           (select count(*) from v_quotes) as open_quotes,
           (select coalesce(sum(quoted_cents), 0) from v_quotes) as quote_value_cents,
           (select coalesce(sum(greatest(0, total_cost_cents - invoiced_cents)), 0) from v_job_cost
            where status in ('accepted', 'in-progress', 'on-hold', 'complete')) as wip_cents,
           (select coalesce(sum(uninvoiced_cents), 0) from v_job_cost
            where status in ('accepted', 'in-progress', 'on-hold', 'complete')) as to_bill_cents,
           (select coalesce(sum(total_cents), 0) from v_debtors where status = 'sent') as owing_cents,
           (select coalesce(sum(retention_cents), 0) from v_retentions where retention_received_on is null) as retentions_out_cents,
           (select coalesce(sum(hours), 0) from time_entries where worked_on > current_date - 7) as hours_7d,
           (select count(*) from v_attention) as attention
  `);
  const stats = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
  out(stats, () => heading('The shop') + `
  jobs: ${stats.open_jobs} open, ${stats.on_the_floor} on the floor | quotes out: ${stats.open_quotes} worth ${money(stats.quote_value_cents)}
  money: WIP ${money(stats.wip_cents)} | left to bill ${money(stats.to_bill_cents)} | owed ${money(stats.owing_cents)} | retentions out ${money(stats.retentions_out_cents)}
  floor: ${stats.hours_7d} hours booked in 7 days
  attention items: ${stats.attention}`);
};

// ---- import / export --------------------------------------------------------------

function readCsvFile(file, what) {
  if (!file || file === true) return null;
  const p = path.resolve(String(file));
  if (!existsSync(p)) throw new CliError(`No ${what} file at ${p}.`);
  return parseCsv(readFileSync(p, 'utf8'));
}

commands.import = async (db, args, flags) => {
  const source = args[0] || 'csv';
  if (!['ostendo', 'csv'].includes(source)) throw new CliError('import ostendo|csv --customers= --items= --jobs= [--suppliers=] [--dry-run]');
  const dry = Boolean(flags['dry-run']);
  const customersCsv = readCsvFile(flags.customers, 'customers');
  const suppliersCsv = readCsvFile(flags.suppliers, 'suppliers');
  const itemsCsv = readCsvFile(flags.items, 'items');
  const jobsCsv = readCsvFile(flags.jobs, 'jobs');
  if (!customersCsv && !suppliersCsv && !itemsCsv && !jobsCsv) {
    throw new CliError('Give at least one of --customers=, --suppliers=, --items=, --jobs= (CSV exports; see docs/replace-ostendo.md).');
  }

  const counts = { customers: 0, customers_updated: 0, suppliers: 0, suppliers_updated: 0, items: 0, items_updated: 0, jobs: 0, jobs_updated: 0, skipped: [] };
  const seenCustomers = new Set();

  if (customersCsv) {
    for (const row of customersCsv) {
      const name = pick(row, 'Customer', 'Customer Name', 'Name');
      if (!name) { counts.skipped.push('customer row with no name'); continue; }
      const code = pick(row, 'Customer Code', 'Code', 'Account Code');
      seenCustomers.add(name.toLowerCase());
      if (code) seenCustomers.add(code.toLowerCase());
      const existing = await db.query('select id from customers where lower(name) = lower($1) or (coalesce($2, \'\') <> \'\' and lower(coalesce(code, \'\')) = lower($2))', [name, code || '']);
      const fields = [pick(row, 'Contact', 'Contact Name'), pick(row, 'Email', 'Email Address'), pick(row, 'Phone', 'Phone No'), pick(row, 'City', 'Town', 'Suburb')];
      if (existing.length) {
        counts.customers_updated++;
        if (!dry) await db.query(
          `update customers set code = coalesce(nullif($2, ''), code), contact_name = coalesce(nullif($3, ''), contact_name),
             email = coalesce(nullif($4, ''), email), phone = coalesce(nullif($5, ''), phone), city = coalesce(nullif($6, ''), city)
           where id = $1`, [existing[0].id, code, ...fields]);
      } else {
        counts.customers++;
        if (!dry) await db.query(
          `insert into customers (name, code, contact_name, email, phone, city, terms_days)
           values ($1, nullif($2, ''), nullif($3, ''), nullif($4, ''), nullif($5, ''), nullif($6, ''), $7)`,
          [name, code, ...fields, Number(pick(row, 'Payment Terms', 'Terms')) || 20]);
      }
    }
  }

  if (suppliersCsv) {
    for (const row of suppliersCsv) {
      const name = pick(row, 'Supplier', 'Supplier Name', 'Name');
      if (!name) { counts.skipped.push('supplier row with no name'); continue; }
      const existing = await db.query('select id from suppliers where lower(name) = lower($1)', [name]);
      if (existing.length) {
        counts.suppliers_updated++;
      } else {
        counts.suppliers++;
        if (!dry) await db.query('insert into suppliers (name, code, contact_name, email, phone) values ($1, nullif($2, \'\'), nullif($3, \'\'), nullif($4, \'\'), nullif($5, \'\'))',
          [name, pick(row, 'Supplier Code', 'Code'), pick(row, 'Contact', 'Contact Name'), pick(row, 'Email'), pick(row, 'Phone')]);
      }
    }
  }

  if (itemsCsv) {
    for (const row of itemsCsv) {
      const code = pick(row, 'Item Code', 'Code', 'Item');
      const desc = pick(row, 'Description', 'Item Description');
      if (!code || !desc) { counts.skipped.push(`item row missing Item Code or Description (${code || desc || 'blank'})`); continue; }
      const existing = await db.query('select id from items where lower(code) = lower($1)', [code]);
      const vals = [
        pick(row, 'Unit', 'UOM', 'Unit of Measure') || 'ea',
        Number(pick(row, 'On Hand', 'Qty On Hand', 'Quantity On Hand', 'In Stock') || 0),
        Number(pick(row, 'Reorder Level', 'Min Stock', 'Minimum') || 0),
        Math.round(Number(pick(row, 'Std Cost', 'Standard Cost', 'Unit Cost', 'Cost') || 0) * 100),
        Math.round(Number(pick(row, 'Sell Price', 'Price', 'Unit Price', 'Sell') || 0) * 100),
      ];
      if (existing.length) {
        counts.items_updated++;
        if (!dry) await db.query(
          `update items set unit = $2, on_hand = $3, reorder_level = $4,
             unit_cost_cents = case when $5 > 0 then $5 else unit_cost_cents end,
             sell_cents = case when $6 > 0 then $6 else sell_cents end
           where id = $1`, [existing[0].id, ...vals]);
      } else {
        counts.items++;
        if (!dry) await db.query(
          'insert into items (code, description, unit, on_hand, reorder_level, unit_cost_cents, sell_cents) values ($1, $2, $3, $4, $5, $6, $7)',
          [code, desc, ...vals]);
      }
    }
  }

  if (jobsCsv) {
    for (const row of jobsCsv) {
      const jobNo = pick(row, 'Job No', 'Job Number', 'Order No', 'Job');
      const custName = pick(row, 'Customer', 'Customer Name', 'Customer Code');
      const title = pick(row, 'Description', 'Job Description', 'Title') || `Imported job ${jobNo}`;
      if (!jobNo || !custName) { counts.skipped.push(`job row missing Job No or Customer (${jobNo || 'blank'})`); continue; }
      const cust = await db.query('select id from customers where lower(name) = lower($1) or lower(coalesce(code, \'\')) = lower($1)', [custName]);
      if (!cust.length && !seenCustomers.has(custName.toLowerCase())) { counts.skipped.push(`${jobNo}: customer "${custName}" not found (import customers first)`); continue; }
      const existing = await db.query('select id from jobs where external_ref = $1', [`import:${jobNo}`]);
      if (existing.length) { counts.jobs_updated++; continue; }
      counts.jobs++;
      if (dry) continue;
      const created = parseDate(pick(row, 'Order Date', 'Created', 'Start Date') || null, 'order date');
      const due = parseDate(pick(row, 'Required Date', 'Due Date', 'Promised Date') || null, 'required date');
      const done = parseDate(pick(row, 'Completed Date', 'Finished Date', 'Closed Date') || null, 'completed date');
      const value = Math.round(Number(pick(row, 'Order Value', 'Quoted', 'Value', 'Total') || 0) * 100) || null;
      const ref = await nextRef(db, 'jobs', 'ref', 'J', 1199);
      await db.query(
        `insert into jobs (ref, customer_id, title, status, charge_basis, quoted_cents, quoted_on, won_on, started_on, promised_on, completed_on, closed_on, external_ref)
         values ($1, $2, $3, $4, $5, $6, $7, $7, $7, $8, $9, $9, $10)`,
        [ref, cust[0].id, title, done ? 'closed' : 'accepted', value ? 'fixed' : 'time-and-materials', value,
         created || today(), due, done, `import:${jobNo}`]);
    }
  }

  out({ dry_run: dry, ...counts }, () => {
    let t = `  ${dry ? 'DRY RUN, nothing written' : 'imported'}: ` +
      `${counts.customers} customers (+${counts.customers_updated} updated), ${counts.suppliers} suppliers (+${counts.suppliers_updated} updated), ` +
      `${counts.items} items (+${counts.items_updated} updated), ${counts.jobs} jobs (+${counts.jobs_updated} already here).`;
    if (counts.skipped.length) t += `\n  skipped:\n    ${counts.skipped.join('\n    ')}`;
    t += '\n  Heat numbers, work centre services and open-job costing do NOT import: walk the racks once with the certs in front of you, and book time from cutover day (docs/replace-ostendo.md says why).';
    return t;
  });
};

commands.export = async (db, args, flags) => {
  const tables = ['staff', 'customers', 'suppliers', 'work_centres', 'items', 'jobs', 'job_lines', 'issues', 'time_entries', 'purchase_orders', 'po_lines', 'invoices', 'invoice_lines', 'notes', 'tasks'];
  const dump = {};
  const counts = {};
  for (const t of tables) {
    dump[t] = await db.query(`select * from ${t} order by created_at`);
    counts[t] = dump[t].length;
  }
  const file = path.resolve(str(flags.out) || path.join(REPO_ROOT, 'exports', `shop-export-${today()}.json`));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(dump, (k, v) => (v instanceof Date ? isoDate(v) : v), 2));
  out({ file, counts }, `  exported ${Object.values(counts).reduce((a, b) => a + b, 0)} rows to ${file}`);
};

// ---------------------------------------------------------------------------
// Main

const { args: ARGS, flags: FLAGS } = parseArgv(process.argv.slice(2));
JSON_MODE = Boolean(FLAGS.json);
const cmd = ARGS[0] || 'help';

const db = cmd === 'help' ? null : await getDb();
try {
  const fn = commands[cmd];
  if (!fn) {
    console.error(`[shop] unknown command "${cmd}". Run \`node scripts/shop.mjs help\`.`);
    process.exit(1);
  }
  await fn(db, ARGS.slice(1), FLAGS);
} catch (e) {
  if (e instanceof CliError) {
    console.error(`[shop] ${e.message}`);
    process.exit(e.code);
  }
  throw e;
} finally {
  if (db) await db.close();
}
