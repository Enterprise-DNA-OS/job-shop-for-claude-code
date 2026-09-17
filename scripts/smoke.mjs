#!/usr/bin/env node
// End-to-end smoke test on a throwaway embedded database.
// Runs migrate, seed, then every CLI command that matters, and asserts on the JSON.
// Passes on Windows and Linux. No network, no Postgres install.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(path.join(tmpdir(), 'shop-smoke-'));
const env = { ...process.env, DATA_DIR: dataDir };
delete env.DATABASE_URL; // the smoke test always runs embedded

let step = 0;
function run(label, args, { json = true, expectFail = false } = {}) {
  step++;
  const argv = [path.join(root, 'scripts', args[0]), ...args.slice(1), ...(json ? ['--json'] : [])];
  const res = spawnSync(process.execPath, argv, { cwd: root, env, encoding: 'utf8' });
  const ok = expectFail ? res.status !== 0 : res.status === 0;
  if (!ok) {
    console.error(`\nFAIL step ${step} (${label}): exit ${res.status}\n--- stdout\n${res.stdout}\n--- stderr\n${res.stderr}`);
    process.exit(1);
  }
  console.log(`  ok  ${String(step).padStart(2)}  ${label}`);
  if (!json || expectFail) return { stdout: res.stdout, stderr: res.stderr };
  try {
    return JSON.parse(res.stdout);
  } catch {
    console.error(`\nFAIL step ${step} (${label}): output is not JSON\n${res.stdout}\n${res.stderr}`);
    process.exit(1);
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`\nFAIL assertion: ${msg}`);
    process.exit(1);
  }
}

const n = (v) => Number(v ?? 0);

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// Local date, the same way the CLI computes "today". Never UTC: New Zealand is a day ahead of it.
const todayIso = (() => {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
})();

console.log(`smoke: data dir ${dataDir}`);
try {
  run('migrate', ['migrate.mjs'], { json: false });
  run('migrate again (idempotent)', ['migrate.mjs'], { json: false });
  run('seed', ['seed.mjs'], { json: false });
  run('seed again (idempotent)', ['seed.mjs'], { json: false });

  // ---- the board --------------------------------------------------------------

  const board = run('jobs', ['shop.mjs', 'jobs']);
  assert(board.length === 8, `eight open jobs (${board.length})`);
  const platform = board.find((b) => b.ref === 'J-1201');
  assert(n(platform.quote_burnt_pct) === 82 && platform.status === 'in-progress', 'the platform job has eaten 82% of its quote, unfinished');
  assert(n(platform.days_late) === 3, 'and it is 3 days past the promise');
  assert(board.some((b) => b.on_stop && b.status === 'on-hold'), 'the stopped account shows with its job on hold');

  const job = run('job card', ['shop.mjs', 'job', 'J-1200']);
  assert(job.job.customer_name === 'Kahu Structural Builders Ltd', 'resolved by ref');
  assert(job.plan.length === 4, 'four planned material lines');
  assert(job.issues.some((i) => i.code === 'SHS-100' && !i.heat_no), 'the SHS issue with no heat number shows');
  assert(n(job.cost.invoiced_cents) === 2000000, 'the progress claim is on the card');

  const byTitle = run('job by partial title', ['shop.mjs', 'job', 'mezzanine']);
  assert(byTitle.job.ref === 'J-1200', 'the mezzanine resolves to J-1200');

  const noSuch = run('an unknown job exits 1', ['shop.mjs', 'job', 'no such thing anywhere'], { json: false, expectFail: true });
  assert(/No job matches/.test(noSuch.stderr), 'and says so plainly');

  const ambiguous = run('an ambiguous match exits 1 and lists candidates', ['shop.mjs', 'job', 'platform'], { json: false, expectFail: true });
  assert(/matches \d+ job records/.test(ambiguous.stderr), 'with the candidates listed');

  const quotes = run('quotes', ['shop.mjs', 'quotes']);
  assert(quotes.quotes.length === 3, `three open quotes (${quotes.quotes.length})`);
  assert(quotes.quotes.some((q) => q.ref === 'J-1208' && n(q.days_out) === 20), 'the arena harrow quote is 20 days out');
  assert(n(quotes.last_365.lost) === 1, 'one lost job in the year');

  // ---- the floor and the shelf -----------------------------------------------------

  const shortages = run('shortages', ['shop.mjs', 'shortages']);
  assert(shortages.length === 1, `one shortage (${shortages.length})`);
  assert(shortages[0].ref === 'J-1203' && shortages[0].item_code === 'PL-10' && n(shortages[0].short_qty) === 4, 'the shade structures are short 4 sheets of 10mm plate');
  assert(shortages[0].next_delivery_on, 'and the open order shows its date');

  const stock = run('stock', ['shop.mjs', 'stock']);
  assert(stock.length === 17, `seventeen items (${stock.length})`);
  const lowStock = run('stock --short', ['shop.mjs', 'stock', '--short']);
  assert(lowStock.length === 2, `two items at or under reorder (${lowStock.length})`);
  assert(lowStock.some((s) => s.code === 'WIRE-09' && n(s.on_order) === 0), 'the MIG wire has nothing coming');
  assert(lowStock.some((s) => s.code === 'PL-10' && n(s.on_order) === 8), 'the plate is covered by the open order');

  const loading = run('loading', ['shop.mjs', 'loading']);
  assert(loading.length === 5, 'five work centres');
  assert(loading.some((l) => l.code === 'BRK' && l.service_overdue), 'the press brake service is overdue');

  const labour = run('labour', ['shop.mjs', 'labour']);
  const marcus = labour.find((l) => l.full_name === 'Marcus Fifita');
  assert(n(marcus.recovery_pct) === 15, `Marcus recovered 15% of his week (${marcus.recovery_pct})`);

  // ---- the money --------------------------------------------------------------------

  const wip = run('wip', ['shop.mjs', 'wip']);
  assert(n(wip.wip_cents) === 2662700, `WIP agrees to the cent ($26,627 = ${wip.wip_cents})`);
  assert(n(wip.to_bill_cents) === 9538700, `and so does left-to-bill ($95,387 = ${wip.to_bill_cents})`);

  const costing = run('costing', ['shop.mjs', 'costing']);
  assert(!costing.some((c) => c.status === 'closed'), 'open costing hides closed jobs');
  const costingAll = run('costing --all', ['shop.mjs', 'costing', '--all']);
  assert(costingAll.some((c) => c.ref === 'J-1215'), 'costing --all carries the closed gantry job');

  const debtors = run('debtors', ['shop.mjs', 'debtors']);
  assert(debtors.some((d) => d.number === 'INV-3002' && n(d.days_overdue) === 40), 'the 40 day overdue invoice shows');
  assert(debtors.some((d) => d.status === 'draft'), 'so does the draft that never went out');

  const retentions = run('retentions', ['shop.mjs', 'retentions']);
  assert(retentions.some((r) => r.number === 'INV-3005' && n(r.days_overdue) === 14), 'the $2,150 retention is 14 days overdue');

  const customers = run('customers', ['shop.mjs', 'customers']);
  assert(customers.length === 12, `twelve customers (${customers.length})`);
  const wd = customers.find((c) => c.customer === 'Waikato Dairy Services Ltd');
  assert(n(wd.exposure_cents) === 4240000 && n(wd.exposure_cents) > n(wd.credit_limit_cents), 'Waikato Dairy is over its limit');
  assert(!wd.ppsr_registered_on, 'with no PPSR registration behind the money');

  const custCard = run('customer card', ['shop.mjs', 'customer', 'Southbridge']);
  assert(custCard.customer.name === 'Southbridge Sheds & Barns Ltd', 'resolved by partial name');
  assert(custCard.jobs.length === 1 && custCard.jobs[0].status === 'complete', 'with its finished job');

  // ---- attention and compliance ---------------------------------------------------

  const attention = run('attention', ['shop.mjs', 'attention']);
  assert(attention.length === 19, `the attention list is loud (${attention.length})`);
  for (const reason of ['heat_missing', 'plant_service_overdue', 'quote_burnt', 'job_late', 'shortage_blocking',
    'po_overdue', 'job_stalled', 'complete_not_invoiced', 'invoice_overdue', 'payment_claim_missing',
    'retention_due', 'invoice_draft', 'over_credit_limit', 'ppsr_unregistered', 'below_reorder',
    'timesheet_gap', 'quote_stale', 'task_overdue']) {
    assert(attention.some((a) => a.reason === reason), `attention carries ${reason}`);
  }
  assert(attention.filter((a) => a.reason === 'invoice_overdue').length === 2, 'both overdue invoices show');

  const compliance = run('compliance', ['shop.mjs', 'compliance']);
  assert(compliance.length === 6, 'six rules in the book');
  assert(compliance.every((r) => r.breaches.length > 0), 'every rule breached in the seed, deliberately');
  const oneRule = run('one compliance rule', ['shop.mjs', 'compliance', 'ppsr-rot']);
  assert(oneRule.length === 1 && oneRule[0].breaches.length === 1, 'run one rule on its own');

  run('stats', ['shop.mjs', 'stats']);

  // ---- a job, end to end -----------------------------------------------------------

  run('add a customer', ['shop.mjs', 'add', 'customer', 'Totally Solid Builders Ltd', '--type=trade', '--contact=Ari Vercoe', '--limit=15000']);

  const stopped = run('quoting a stopped account is refused', ['shop.mjs', 'job', 'quote', 'Frankton', '--title=Test ramp', '--value=1000'], { json: false, expectFail: true });
  assert(/ON STOP/.test(stopped.stderr), 'and the refusal names the stop');

  const quoted = run('quote a structural construction job', ['shop.mjs', 'job', 'quote', 'Totally Solid',
    '--title=Portal frame carport', '--value=3600', '--structural', '--construction', `--promised=${addDays(todayIso, 21)}`, '--by=Priya']);
  const ref = quoted.ref;
  assert(/^J-\d+$/.test(ref), `the job ref is minted (${ref})`);

  const cannotBill = run('billing a quote is refused', ['shop.mjs', 'bill', ref], { json: false, expectFail: true });
  assert(/is quote/.test(cannotBill.stderr), 'a quote does not bill');

  run('win it', ['shop.mjs', 'job', 'won', ref, '--po=TSB-9']);
  run('plan the beam', ['shop.mjs', 'plan', ref, 'UB-200', '4']);
  run('start it', ['shop.mjs', 'job', 'start', ref]);

  const noHeat = run('issuing traceable steel without a heat number is refused', ['shop.mjs', 'issue', ref, 'UB-200', '4'], { json: false, expectFail: true });
  assert(/AS\/NZS 5131/.test(noHeat.stderr), 'and the refusal cites the standard');
  run('issue it with the heat number', ['shop.mjs', 'issue', ref, 'UB-200', '4', '--heat=H9001-2', '--by=Lena']);
  run('book time to it', ['shop.mjs', 'time', ref, 'Dylan', '6', '--centre=WLD']);

  const noProgress = run('a progress bill needs an amount', ['shop.mjs', 'bill', ref], { json: false, expectFail: true });
  assert(/--amount= or --percent=/.test(noProgress.stderr), 'the refusal says what to give');

  const claim1 = run('progress claim, half, 5% retention, no payment claim', ['shop.mjs', 'bill', ref, '--percent=50', '--retention=5%', '--no-payment-claim']);
  assert(n(claim1.total_cents) === 180000 && n(claim1.retention_cents) === 9000, 'half the contract sum, retention computed');
  assert(claim1.payment_claim === false, 'the flag turns the payment claim off');
  run('send it', ['shop.mjs', 'invoice', 'sent', claim1.number]);
  run('it gets paid', ['shop.mjs', 'invoice', 'paid', claim1.number]);

  const early = run('closing over unbilled money is refused', ['shop.mjs', 'job', 'close', ref], { json: false, expectFail: true });
  assert(/still has .* to bill/.test(early.stderr), 'the balance blocks the close');

  run('finish it', ['shop.mjs', 'job', 'done', ref]);
  const balance = run('the balance bills itself', ['shop.mjs', 'bill', ref]);
  assert(n(balance.total_cents) === 180000, 'the other half');
  assert(balance.payment_claim === true, 'and construction work drafts as a payment claim by default');

  run('close it', ['shop.mjs', 'job', 'close', ref]);
  const noTime = run('time cannot book to a closed job', ['shop.mjs', 'time', ref, 'Dylan', '2'], { json: false, expectFail: true });
  assert(/is closed/.test(noTime.stderr), 'the record is sealed');

  // ---- T and M billing off the meter ------------------------------------------------

  const tmBill = run('bill the truck deck off the meter', ['shop.mjs', 'bill', 'J-1202']);
  assert(n(tmBill.total_cents) === 180600, `labour at charge plus materials at sell (${tmBill.total_cents})`);
  const tmEmpty = run('billing it again finds nothing', ['shop.mjs', 'bill', 'J-1202'], { json: false, expectFail: true });
  assert(/Nothing unbilled/.test(tmEmpty.stderr), 'the meter moved onto the invoice');

  // ---- purchasing ---------------------------------------------------------------------

  const po = run('raise a stock PO', ['shop.mjs', 'po', 'raise', 'Waikato Steel', `--expected=${addDays(todayIso, 3)}`]);
  const emptyReceive = run('receiving an empty PO is refused', ['shop.mjs', 'po', 'receive', po.ref], { json: false, expectFail: true });
  assert(/has no lines/.test(emptyReceive.stderr), 'lines first');
  run('add the wire', ['shop.mjs', 'po', 'add', po.ref, 'WIRE-09', '12', '120']);
  run('receive it', ['shop.mjs', 'po', 'receive', po.ref]);
  const wire = run('the shelf went up', ['shop.mjs', 'item', 'WIRE-09']);
  assert(n(wire.position.on_hand) === 14, `two spools became fourteen (${wire.position.on_hand})`);
  assert(n(wire.item.unit_cost_cents) === 12000, 'and the latest cost landed on the item');

  const outworkPo = run('raise a direct-to-job PO', ['shop.mjs', 'po', 'raise', 'Galv Services', '--job=J-1207']);
  run('add the galvanising', ['shop.mjs', 'po', 'add', outworkPo.ref, 'Hot dip galvanising, trailer chassis', '1', '450']);
  run('receive it onto the job', ['shop.mjs', 'po', 'receive', outworkPo.ref]);
  const trailer = run('the job cost carries the outwork', ['shop.mjs', 'job', 'J-1207']);
  assert(n(trailer.cost.outwork_cost_cents) === 45000, 'outwork on the trailer job');

  // ---- fix the compliance story, watch the book improve ----------------------------------

  const wrongClaim = run('an invoice already sent plain cannot become a claim', ['shop.mjs', 'invoice', 'claim', 'INV-3001'], { json: false, expectFail: true });
  assert(/stays plain/.test(wrongClaim.stderr), 'a claim is made when it is served, not after');

  run('the missing mill cert turns up', ['shop.mjs', 'heat', 'J-1200', 'SHS-100', 'H2288-11']);
  run('the press brake gets serviced', ['shop.mjs', 'centre', 'service', 'BRK']);
  run('the council draft becomes a payment claim', ['shop.mjs', 'invoice', 'claim', 'INV-3003']);
  run('the retention comes back', ['shop.mjs', 'retention', 'received', 'INV-3005']);
  run('the PPSR registration goes on', ['shop.mjs', 'ppsr', 'Waikato Dairy', '--registered=today']);
  run('Marcus books his day', ['shop.mjs', 'time', 'J-1200', 'Marcus', '8', '--centre=WLD']);

  const complianceAfter = run('the compliance book comes clean', ['shop.mjs', 'compliance']);
  const failing = complianceAfter.filter((r) => r.breaches.length).map((r) => r.key);
  assert(failing.length === 0, `every rule now passes (still failing: ${failing.join(',') || 'none'})`);

  // ---- import --------------------------------------------------------------------------

  const customersCsv = path.join(dataDir, 'customers.csv');
  const itemsCsv = path.join(dataDir, 'items.csv');
  const jobsCsv = path.join(dataDir, 'jobs.csv');
  const suppliersCsv = path.join(dataDir, 'suppliers.csv');
  writeFileSync(customersCsv, [
    'Customer Code,Customer,Contact,Email,Phone,City,Payment Terms',
    'KOW001,"Kowhai Builders Ltd",Tim Rapana,tim@kowhai.example.nz,07 555 0301,Hamilton,20',
    'PAP001,"Piopio Farm Equipment Ltd",Jo Craddock,jo@piopiofarm.example.nz,07 555 0302,Piopio,14',
    'WDS001,"Waikato Dairy Services Ltd",Karen Mulder,accounts@waikatodairy.example.nz,07 555 0501,Hamilton,20',
  ].join('\n'));
  writeFileSync(itemsCsv, [
    'Item Code,Description,Unit,On Hand,Reorder Level,Std Cost,Sell Price',
    'PL-16,"16mm plate 2.4x1.2",sheet,4,1,495,760',
    'FL-50,"50x6 flat bar",m,90,15,9.20,16',
  ].join('\n'));
  writeFileSync(jobsCsv, [
    'Job No,Customer,Description,Order Date,Required Date,Completed Date,Order Value',
    `8801,"Kowhai Builders Ltd","Balustrade panels x12",${addDays(todayIso, -10)},${addDays(todayIso, 20)},,7200`,
    `8750,"Piopio Farm Equipment Ltd","Bale feeder repair",${addDays(todayIso, -60)},${addDays(todayIso, -50)},${addDays(todayIso, -48)},1850`,
  ].join('\n'));
  writeFileSync(suppliersCsv, [
    'Supplier,Contact,Phone',
    '"King Country Gases Ltd",Mel Tioke,07 555 0709',
  ].join('\n'));

  const dry = run('import dry run writes nothing', ['shop.mjs', 'import', 'ostendo', `--customers=${customersCsv}`, `--items=${itemsCsv}`, `--jobs=${jobsCsv}`, `--suppliers=${suppliersCsv}`, '--dry-run']);
  assert(n(dry.customers) === 2 && n(dry.customers_updated) === 1, 'the dry run counts customers');
  assert(n(dry.items) === 1 && n(dry.items_updated) === 1 && n(dry.jobs) === 2 && n(dry.suppliers) === 1, 'and items, jobs and suppliers');

  const imported = run('import for real', ['shop.mjs', 'import', 'ostendo', `--customers=${customersCsv}`, `--items=${itemsCsv}`, `--jobs=${jobsCsv}`, `--suppliers=${suppliersCsv}`]);
  assert(n(imported.customers) === 2 && n(imported.jobs) === 2, 'and the real run does it');

  const kowhai = run('the imported job reads back', ['shop.mjs', 'customer', 'Kowhai']);
  assert(kowhai.jobs.length === 1 && kowhai.jobs[0].status === 'accepted', 'the open job landed accepted');
  const piopio = run('the finished import landed closed', ['shop.mjs', 'customer', 'Piopio']);
  assert(piopio.jobs[0].status === 'closed', 'with its dates');

  const reimport = run('re-importing updates rather than duplicating', ['shop.mjs', 'import', 'ostendo', `--customers=${customersCsv}`, `--jobs=${jobsCsv}`]);
  assert(n(reimport.customers) === 0 && n(reimport.customers_updated) === 3 && n(reimport.jobs) === 0 && n(reimport.jobs_updated) === 2, 'the second run creates nothing new');

  const missingFile = run('a missing import file fails loudly', ['shop.mjs', 'import', 'csv', `--customers=${path.join(dataDir, 'not-there.csv')}`], { json: false, expectFail: true });
  assert(/No customers file/.test(missingFile.stderr), 'it exits non zero rather than importing nothing quietly');

  // ---- export --------------------------------------------------------------------------

  const outFile = path.join(dataDir, 'dump.json');
  const dump = run('export', ['shop.mjs', 'export', `--out=${outFile}`]);
  assert(existsSync(outFile), 'the export file is on disk');
  const parsed = JSON.parse(readFileSync(outFile, 'utf8'));
  assert(parsed.customers.length === n(dump.counts.customers), 'the counts match the file');
  assert(parsed.time_entries.length === n(dump.counts.time_entries), 'time entries included');

  // ---- the branded HTML ------------------------------------------------------------------

  const views = run('npm run view', ['view.mjs'], { json: false });
  assert(/views[\\/]shop\.html/.test(views.stdout) && /views[\\/]money\.html/.test(views.stdout), 'both views rendered');
  const shopHtml = readFileSync(path.join(root, 'views', 'shop.html'), 'utf8');
  assert(shopHtml.includes('Needs a decision') && shopHtml.includes('Shortages'), 'the shop view has its sections');
  assert(shopHtml.includes('The job board') && shopHtml.includes('Work centres'), 'and the rest of the shop');
  const moneyHtml = readFileSync(path.join(root, 'views', 'money.html'), 'utf8');
  assert(moneyHtml.includes('Work in progress') && moneyHtml.includes('Retentions'), 'the money view has its sections');

  const docs = run('npm run docs', ['docs.mjs'], { json: false });
  assert(/invoice/.test(docs.stdout), 'the invoices rendered');
  assert(/quote/.test(docs.stdout), 'the quote drafts rendered');
  assert(/job-traveller/.test(docs.stdout), 'the job travellers rendered');
  assert(/job-cost-report/.test(docs.stdout), 'the job cost reports rendered');

  // ---- the human readable side --------------------------------------------------------------

  run('jobs (text)', ['shop.mjs', 'jobs'], { json: false });
  run('job (text)', ['shop.mjs', 'job', 'J-1201'], { json: false });
  run('quotes (text)', ['shop.mjs', 'quotes'], { json: false });
  run('shortages (text)', ['shop.mjs', 'shortages'], { json: false });
  run('stock (text)', ['shop.mjs', 'stock'], { json: false });
  run('item (text)', ['shop.mjs', 'item', 'PL-10'], { json: false });
  run('loading (text)', ['shop.mjs', 'loading'], { json: false });
  run('labour (text)', ['shop.mjs', 'labour'], { json: false });
  run('po (text)', ['shop.mjs', 'po', '--all'], { json: false });
  run('suppliers (text)', ['shop.mjs', 'suppliers'], { json: false });
  run('wip (text)', ['shop.mjs', 'wip'], { json: false });
  run('costing (text)', ['shop.mjs', 'costing', '--all'], { json: false });
  run('invoices (text)', ['shop.mjs', 'invoices', '--all'], { json: false });
  run('invoice (text)', ['shop.mjs', 'invoice', 'INV-3004'], { json: false });
  run('retentions (text)', ['shop.mjs', 'retentions'], { json: false });
  run('debtors (text)', ['shop.mjs', 'debtors'], { json: false });
  run('customers (text)', ['shop.mjs', 'customers'], { json: false });
  run('customer (text)', ['shop.mjs', 'customer', 'Kahu'], { json: false });
  run('staff (text)', ['shop.mjs', 'staff'], { json: false });
  run('attention (text)', ['shop.mjs', 'attention'], { json: false });
  run('compliance (text)', ['shop.mjs', 'compliance'], { json: false });
  run('tasks (text)', ['shop.mjs', 'tasks', '--all'], { json: false });
  run('stats (text)', ['shop.mjs', 'stats'], { json: false });
  run('help', ['shop.mjs', 'help'], { json: false });
  run('an unknown command exits 1', ['shop.mjs', 'nonsense'], { json: false, expectFail: true });

  console.log(`\n${step} checks, PASS`);
} finally {
  if (existsSync(dataDir)) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // Windows can hold the handle briefly; a leftover temp dir is harmless.
    }
  }
}
