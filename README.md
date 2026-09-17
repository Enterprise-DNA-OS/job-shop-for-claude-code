<h1 align="center">Job Shop for Claude Code</h1>

<p align="center">
  <strong>The open-source manufacturing job shop system that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Or installed and run for you.
</p>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#compliance-checked-against-the-data">Compliance</a> &bull;
  <a href="#ten-questions-ostendo-cannot-answer">Ten questions</a> &bull;
  <a href="#instead-of-ostendo">Instead of Ostendo</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Job Shop for Claude Code does the job you pay Ostendo for, as a Postgres database and a set of Claude Code commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) and ask for what you want in plain language. It runs the right query, and it can answer questions the vendor's report menu cannot.

It is built for a make-to-order engineering shop: the quotes and the jobs, the planned materials and what actually got issued (with heat numbers where traceability demands them), the hours booked at captured cost and charge rates, the work centres and their service clocks, the stock and the purchase orders, and the billing run that drafts invoices with payment claims and retentions handled properly. The words are the words a workshop already uses.

**Nothing sends, pays or talks to an accounting system on its own.** Invoices are drafted here and a person sends them; your accounting system keeps the ledger. The gates are real, though: traceable steel does not issue to a structural job without a heat number, a job does not close over unbilled money, and construction work bills as a payment claim by default.

```
/attention                        everything that wants a decision, worst first
/jobs                             the board: promise dates, quote burnt, what is left to bill
/quotes                           open quotes going cold, and the win rate
/shortages                        planned material the shelf cannot cover, against promise dates
/wip                              cost sitting in open jobs: the month-end number, live
/job-costing                      what every job really cost against what it billed
/loading                          work centre hours and the service clocks
/labour                           hours booked against capacity, and who stopped filling in time
/bill                             progress claims, balances, the T&M meter; payment claims by default
/retentions                       your money being held, and when to ask for it back
/compliance                       six rules from the Acts and the standards, run against your records
/weekly-review                    the Monday review, written from three commands
```

Job cost is one view, `v_job_cost`, and everything that talks about money reads it: the board, WIP, billing and the attention list can never disagree with each other. Rates are captured onto every hour and every issue the day they happen, so a rate change never rewrites a running job.

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your data sits in plain Postgres tables you own. Any tool can read them. No export request, no API project, no access ending when a licence does.
- No per-user licence, no annual renewal fee, no implementation project. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/job-shop-for-claude-code.git
cd job-shop-for-claude-code
npm install
npm run demo
```

`npm run demo` creates the database, loads Matai Engineering (a demo Hamilton fabrication shop with 16 jobs: a length of SHS issued to a structural mezzanine with no heat number, a press brake 100 days past its service, a stainless platform at 82% of its fixed quote and 3 days late, a job complete 12 days with $9,200 not billed, a shade structure short 4 sheets of plate, a $2,150 retention nobody claimed, and a customer over its limit owing five figures with no PPSR registration), then prints the board, the shortages, the attention list and the compliance check.

Then open the folder in Claude Code and type:

```
/attention
```

Try `/jobs`, `/shortages`, `/wip`, `/job-costing`, `/loading`, `job J-1201`. When you are ready for real data, delete `.data/` and start with `/import`, or add records one at a time with `add customer`, `add item`, `add centre`.

Fill in the "Who this is for" block in [CLAUDE.md](CLAUDE.md) so drafts come out in your company's voice, and put your name and colours in [brand.json](brand.json) so the invoices, quotes, travellers and cost reports carry them.

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee. The estimator, the floor and the owner each clone the repo, point at the same `DATABASE_URL`, and work in their own Claude Code.

## The commands

| Command | What it does |
|---|---|
| `/attention` | Everything that wants a decision, worst first: missing heat numbers, overdue services, quotes being eaten, money asleep. |
| `/jobs` | The board: every open job, days late against the promise, quote burnt, hours, what is left to bill. |
| `/job` | One job in full: plan against issued, hours, orders, invoices, notes, margin position. |
| `/quotes` | Open quotes oldest first, last contact, and the year's win rate. |
| `/quote` | The counter flow: register the quote, plan materials at today's rates, draft the quotation document. |
| `/win` | A quote landed: won, promised, onto the floor, with the record straight from hour one. |
| `/issue` | Stock onto a job. Structural jobs demand heat numbers; the refusal is the point. |
| `/time` | Hours to a job at a work centre, captured rates, honest dates. |
| `/shortages` | Planned material the shelf cannot cover, with what is coming and when, against the promise date. |
| `/stock` | The shelf: on hand, allocated, free, on order, reorder trouble. |
| `/purchasing` | POs: stock orders feed the shelf; direct-to-job orders land cost on the job at receipt. |
| `/wip` | Cost sitting in open jobs against what is billed. The month-end number, live. |
| `/job-costing` | What every job really cost against what it billed. The re-quoting conversation. |
| `/loading` | Work centre hours, capacity and the service clocks. |
| `/labour` | Hours against capacity by person, recovery, timesheet gaps. |
| `/bill` | Progress claims, balances at completion, the T&M meter. Payment claims and retentions done properly. |
| `/debtors` | Aged debtors, and the difference between chasing a payment claim and a plain invoice. |
| `/retentions` | Money of yours being held, when it falls due, what is overdue for the asking. |
| `/customer` | One account's whole relationship: exposure (owing plus WIP), PPSR position, jobs, notes. |
| `/log` | Conversations and decisions onto the record. The disputes read it later. |
| `/weekly-review` | The Monday review, written from three commands. |
| `/compliance` | Six rules from the Acts and the standards, run against your records, each with its source. |
| `/import` | Bring the business across from Ostendo or any system that exports CSV. |
| `/draft-quote` | The quotation document from the job's own scope and materials, into `docs-out/`. |
| `/draft-overdue-letter` | The chasing letter, from the record, into `drafts/`. |
| `/customise` | Add a field, rename things, change a rule, in plain language. Writes and applies the migration. |
| `/new-view` | Add a read-only HTML dashboard from a description. |

Everything the commands do, the CLI does: `npm run shop -- help`. Any command takes `--json`.

### Documents and views, in your brand

```bash
npm run docs    # tax invoices (payment claim statement included), quotes, job travellers, job cost reports
npm run view    # the shop and the money, as read-only HTML dashboards
```

Both read [brand.json](brand.json), so your company's name, logo and colours are one file away. Documents land in `docs-out/`, views in `views/`. Print either to PDF from the browser. `/new-view` adds a view, `documents.json` adds a document.

## Compliance, checked against the data

`/compliance` runs the rules in [docs/compliance.md](docs/compliance.md) against your records and reports what is breached. Each rule cites its source, and the CLI enforces the sharpest ones at the gate: `issue` refuses traceable steel onto a structural job without a heat number, and `bill` drafts construction work as a payment claim unless told otherwise.

1. A heat number on every traceable item issued to a structural job (AS/NZS 5131 traceability).
2. Every work centre inside its service interval (HSWA 2015 s 36; GRWM Regulations 2016).
3. Construction work invoiced as a payment claim (Construction Contracts Act 2002 ss 20 and 22).
4. Retention money claimed when it falls due (CCA 2002 subpart 2A: it is your money, held on trust).
5. A PPSR financing statement behind retention-of-title terms on real money (PPSA 1999).
6. Time records complete while the floor is busy (Employment Relations Act 2000 s 130).

The Australian equivalents (the model WHS plant duties, the security of payment Acts state by state, PPS leases under the 2009 Act) are in the same file, at a high level, with the parts to read. Nothing there is legal advice. It is the rule book you point the system at, and you change it to match your operation.

## Ten questions Ostendo cannot answer

Every one of these is answered by the demo data today. Yours will be different, and that is the point.

1. Which fixed-price jobs have eaten more than 80% of their quote and are still on the floor, and what decision does each one need today?
2. What steel went onto structural jobs this year with no heat number recorded, and which customer's site is it on?
3. What is our real WIP right now: cost sitting in open jobs that no invoice covers, job by job?
4. Which quotes have been out more than two weeks with no contact, and what are they worth together?
5. What did every job for one customer actually earn after materials, hours and outwork, and should their next quote be higher?
6. Which retentions fall due in the next 60 days, and which are already overdue for the asking?
7. Whose timesheets have gaps this week, and what would those unbooked hours have billed?
8. Which work centre is the bottleneck this month, and which one is idle while it is also overdue for its service?
9. Which customers' exposure (owing plus WIP) is past their limit, and which of them owe five figures with no PPSR registration behind our terms?
10. Which materials keep going short against promise dates, and which supplier's lead time is really to blame?

## Your first hour: ten things to ask for

Open the folder in Claude Code and say these in your own words. Each one changes the system to fit your shop.

1. "Load our customer list, our stock items with our codes and costs, and our people with their charge-out rates."
2. "Put our logo and colours on the invoices, quotes and travellers, and change the company name to ours."
3. "Our work centres are Saw, Bay 1, Bay 2, CNC, Paint. Set them up with their real capacities and last service dates."
4. "We hold 10% retention up to $10,000 on commercial work. Make that the default on payment claims."
5. "Add a drawing number field to jobs, and put it on the traveller and the quote."
6. "Add a rule to `/compliance`: no welder books time to a structural job unless their qualification date is on file."
7. "Our quotes expire after 30 days. Add that to the quote document and flag expired ones."
8. "We are in Queensland. Rebuild the compliance file on the WHS Regulations and the BIF Act."
9. "Build me a Friday page per tradesperson: their hours this week, the jobs they touched, what they recovered."
10. "Write me a command that drafts the variation letter when a fixed job passes 80% of quote, from the hours and issues that pushed it over."

`/customise` writes the migration, applies it, updates every command that touches the change, and runs the tests.

## Instead of Ostendo

Export your customers, suppliers, items and job list as CSV, run one command, and the business comes with you. Step by step, with what maps and what deliberately does not: [docs/replace-ostendo.md](docs/replace-ostendo.md).

```bash
npm run shop -- import ostendo --customers=customers.csv --items=items.csv --jobs=jobs.csv --dry-run
npm run shop -- import ostendo --customers=customers.csv --items=items.csv --jobs=jobs.csv
```

MYOB Advanced, Katana, MRPeasy and any other system that exports CSV go through the same command with `csv`.

Heat numbers, work centre services and open-job costing deliberately do not import: the old system saying a cert existed is not a cert. You walk the racks once with the paperwork in front of you, book time from cutover day, and `/compliance` lists exactly what is still unverified. Most shops find at least one surprise on that walk, which is the argument for the walk.

## Architecture

```
job-shop-for-claude-code/
  CLAUDE.md                              how the company wants this run (routing table + house rules)
  brand.json                             your name, logo and colours on every document and view
  views.json                             the HTML dashboards npm run view renders
  documents.json                         the paperwork npm run docs renders
  .claude/commands/                      the slash commands
  scripts/shop.mjs                       the CLI the commands drive
  scripts/view.mjs                       read-only HTML dashboards from the SQL views
  scripts/docs.mjs                       the documents, one HTML file per record
  scripts/lib/db.mjs                     one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/                   plain SQL schema, tables and views
  supabase/seed.sql                      demo data (Matai Engineering)
  docs/compliance.md                     the rules /compliance checks, each with its source
  docs/replace-ostendo.md                moving off the incumbent
  docs/why-no-front-end.md               the honest trade-offs
  exports/                               whole database dumps
  drafts/                                letters written for a person to send
```

## Built with Claude Code

This repository was built with Claude Code as the primary development tool, from the schema to the commands, and it is meant to be extended the same way. Ask for a new command and it writes one.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end, nothing that sends, and the gates stay gates.

## Want it installed and run for you?

Enterprise DNA installs Job Shop for Claude Code for your company, migrates your Ostendo data, connects it to the rest of your tools, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: https://calendly.com/sam-mckay/discovery-call
- Read more: https://enterprisedna.co/omni/instead-of/ostendo

## License

MIT. Copyright (c) 2026 Enterprise DNA.
