#!/usr/bin/env node
// Loads supabase/seed.sql: Matai Engineering, a fictional Hamilton fabrication
// and machining shop with 6 staff, 12 customers, 5 work centres, 17 stock
// items, 16 jobs from quote to closed, purchase orders and five invoices.
// Every row has a derived id and inserts with ON CONFLICT DO NOTHING, so
// re-running it is harmless.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';

export async function seed(db) {
  const sql = readFileSync(path.join(REPO_ROOT, 'supabase', 'seed.sql'), 'utf8');
  await db.exec(sql);
  const [c] = await db.query(`
    select (select count(*) from staff)           as staff,
           (select count(*) from customers)       as customers,
           (select count(*) from suppliers)       as suppliers,
           (select count(*) from work_centres)    as work_centres,
           (select count(*) from items)           as items,
           (select count(*) from jobs)            as jobs,
           (select count(*) from job_lines)       as job_lines,
           (select count(*) from issues)          as issues,
           (select count(*) from time_entries)    as time_entries,
           (select count(*) from purchase_orders) as purchase_orders,
           (select count(*) from invoices)        as invoices,
           (select count(*) from notes)           as notes,
           (select count(*) from tasks)           as tasks
  `);
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const db = await getDb();
  try {
    const n = await seed(db);
    console.log(
      `seed: ${n.staff} staff, ${n.customers} customers, ${n.suppliers} suppliers, ${n.work_centres} work centres, ` +
        `${n.items} items, ${n.jobs} jobs (${n.job_lines} planned lines, ${n.issues} issues, ${n.time_entries} time entries), ` +
        `${n.purchase_orders} purchase orders, ${n.invoices} invoices, ${n.notes} notes, ${n.tasks} tasks`,
    );
  } finally {
    await db.close();
  }
}
