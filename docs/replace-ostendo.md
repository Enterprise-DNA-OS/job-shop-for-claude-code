# Moving off Ostendo

One command brings the business across: customers, suppliers, stock items and the job history. This page says which exports to make, what maps where, and what deliberately does not come over.

## What you pay Ostendo for, structurally

Ostendo is licensed per concurrent user (an upfront licence per user), with an annual licence renewal fee of 20% of list price from the second year, sold and implemented through partners, sitting on top of your accounting system. Leaving it does not touch your accounting system: that stays exactly where it is, and this repo drafts invoices for a person to send and reconcile there, the same as before.

## Step 1: export from Ostendo

Ostendo's grids and reports export to CSV (File, or right-click a grid, Export). Make four files:

1. **Customers.** The customer list grid: Customer, Customer Code, Contact, Email, Phone, City, Payment Terms.
2. **Suppliers.** The supplier list: Supplier, Contact, Phone, Email.
3. **Items.** The inventory items grid: Item Code, Description, Unit, Qty On Hand, Reorder Level, Std Cost, Sell Price.
4. **Jobs.** The job orders list: Job No, Customer, Description, Order Date, Required Date, Completed Date, Order Value.

Column names do not need to match exactly: the importer reads the common variants (`Customer` or `Customer Name`, `Std Cost` or `Unit Cost`, `Required Date` or `Due Date`, and so on), and dates in DD/MM/YYYY come in correctly.

## Step 2: dry run, then run

```bash
npm run shop -- import ostendo --customers=customers.csv --suppliers=suppliers.csv --items=items.csv --jobs=jobs.csv --dry-run
npm run shop -- import ostendo --customers=customers.csv --suppliers=suppliers.csv --items=items.csv --jobs=jobs.csv
```

The dry run prints exactly what would be created, updated and skipped, and writes nothing. Import customers before (or with) jobs, or the jobs skip with a message saying so. Re-running is safe: existing records update instead of duplicating, keyed on names, codes and the original job numbers.

## What maps

| Ostendo | Here |
|---|---|
| Customers, codes, contacts, terms | `customers` |
| Suppliers | `suppliers` |
| Inventory items, on hand, reorder levels, costs, sell prices | `items` |
| Job orders with their dates and values | `jobs` (open ones land `accepted`, finished ones land `closed`) |
| Job history by customer | on the customer card the moment it lands |

## What deliberately does not come over

- **Heat numbers and material certificates.** The old system saying a cert existed is not a cert. Issues recorded here from day one carry their heat numbers, and `/compliance` lists any structural work that is missing one. Keep the old certificates filed; they cover the old work.
- **Work centre service records.** Walk the floor once with the service book and record real dates: `add centre`, then `centre service <code> --on=`. Most shops find at least one machine past its interval on that walk, which is the argument for the walk.
- **Open-job costing.** Hours and materials already spent inside Ostendo stay as Ostendo's numbers; bill the old system's WIP out of the old system. Jobs still running at cutover: import them, then `plan` the remaining materials and book time from cutover day. Costing here starts honest instead of inheriting numbers nobody can check.
- **BOMs and assembly structures.** A job shop's real BOM is the planned lines on each job, which capture today's costs when you `plan`. Standard assemblies you make repeatedly: describe one to Claude Code and it will add a template command for it.
- **Invoices and the ledger.** Your accounting system keeps every invoice Ostendo ever raised. Nothing here rewrites history; new invoices are drafted here and sent by a person, same as always.

## Cutover, in practice

1. Import on a Friday. Dry run, run, then read `customers`, `stock` and `jobs --all` back and spot-check ten records against Ostendo.
2. Walk the racks and the floor over the weekend: heat numbers on the steel that is mid-job (`heat` backfills them), service dates on the centres, a `stock set --reason="cutover count"` for anything the count disagrees on.
3. Monday morning, the floor books time here (`time`), the store issues here (`issue`), and `/attention` runs at smoko.
4. Run both systems in parallel for one billing cycle if it helps the office sleep; the export is always there (`export` dumps everything to JSON).
