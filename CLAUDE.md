# Job Shop for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Company:** [YOUR COMPANY], a make-to-order engineering / fabrication / machining shop in [city, country]
- **Operator:** [YOUR NAME], [owner / workshop manager / office manager]
- **The work:** [what the shop makes: structural steel, stainless, machining, trailers, repairs; roughly the mix of fixed-price and time-and-materials]
- **The team:** [the estimator, the tradespeople and their charge-out rates, who runs the store, who authorises credits and stops]
- **The floor:** [the work centres: saw, bays, machine shop, brake, paint, and who owns their service records]
- **Where the accounts live:** [your accounting system. Invoices are drafted here, sent and reconciled there.]
- **What matters most:** [for example: no traceable steel out without its heat number, time booked daily, nothing finished sits unbilled a week, retentions chased on the day]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything for a customer, run `job <ref>` and read the whole card: the plan, the hours, the money, the notes. Before touching an account, run `customer <name>` and read the history.
3. **Plain language.** Short sentences. No filler. Numbers in tables. The trade's words, not software words: the floor, a traveller, a heat number, the meter, on the tools, outwork, a progress claim, a retention.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or faces a customer waits for a yes in this session.
6. **Never invent a fact.** Codes, dates, rates, hours and heat numbers come from the operator or the database. If a fact is missing, say which one. A heat number especially: it comes off the mill certificate or it does not exist.
7. **Never state a legal or safety position you have not checked.** The traceability, plant, payment claim, retention, PPSR and time-record rules are in `docs/compliance.md` with their sources. Quote the source. If the question is outside what is written there, say so and stop. Nothing here is legal advice.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| What needs doing today | `/attention` |
| What is on, what is late, what is bleeding | `/jobs` |
| One job's whole story | `/job` |
| Price this up for a customer | `/quote` (register, plan, draft the document) |
| They said yes | `/win` (`job won`, `job start`) |
| They said no | `job lost <ref> --reason=` |
| Steel to the floor | `issue <ref> <item> <qty> [--heat=]` |
| The cert turned up late | `heat <ref> <item> <number>` |
| Hours worked | `time <ref> <person> <hours> --centre=` |
| What are we short of | `/shortages` |
| The shelf | `/stock`; corrections via `stock set --reason=` |
| Order material or outwork | `/purchasing` (`po raise`, `po add`, `po receive`) |
| What is our WIP | `/wip` |
| Did we make money on it | `/job-costing` |
| How full is the shop | `/loading`; services via `centre service` |
| Who booked what | `/labour` |
| Bill it | `/bill` (progress, balance, or the T&M meter) |
| An invoice went out, got paid | `invoice sent`, `invoice paid` |
| Who owes us money | `/debtors`; the whole exposure picture is `customers` |
| Our money they are holding | `/retentions`; `retention received` when it lands |
| Everything about one account | `/customer` |
| Hold an account, release it | `stop <customer>`, `unstop <customer>` |
| The PPSR got registered | `ppsr <customer> --registered=` |
| A quote letter, a chasing letter | `/draft-quote`, `/draft-overdue-letter` |
| I spoke to them, note it down | `/log` |
| The Monday review | `/weekly-review` |
| Would this pass an audit | `/compliance` |
| Bring the business over from Ostendo | `/import` |
| Change how this system works | `/customise` |
| A new page to look at | `/new-view` |
| The paperwork, in our brand | `npm run docs` |

If an ask fits nothing here, run the CLI directly (`npm run shop -- help`) and then propose a new command for it.

## Hard rules

- **Traceable steel does not issue to a structural job without a heat number. Ever.** The number comes off the mill certificate (AS/NZS 5131). `issue` refuses; `heat` backfills only certs that genuinely exist. Never invent one, and never bury uncertified steel in a structural build quietly: tell the operator.
- **Construction work bills as a payment claim.** `bill` does it by default; turning it off is the operator's own call, made in this session. A claim served properly is the Act working for you; one skipped is a plain bill with nothing behind it.
- Never send email, invoices, quotes or letters from here. Draft to `drafts/`, render with `npm run docs`, a person sends. Every time.
- Never quote a stopped account on your own judgment. The refusal is the credit policy working; escalate to the operator.
- Never adjust job cost by editing rows. Cost is issues, hours and received POs; a discount is a decision by the operator on the invoice before it is sent, and a write-off at close carries its reason in the record.
- Never move a promise date quietly. Say what is short or late and what it does to the date; the operator makes the call to the customer.
- Time is booked to the day it happened, with honest dates on backfills. The time entries are the shop's legal time records (ERA 2000 s 130) and the job costing at once; bending one bends both.
- A retention with no due date is a retention nobody will chase: set `--retention-due=` at billing, and ask for the money the week it falls due.
- Never delete records without an explicit yes in this session. A customer who leaves goes `former`; a dead quote goes `lost` with its reason. History is the asset.
- The database is the source of truth. If the answer is not in it, say so.

## Words this shop uses

- A **job** (`J-…`) runs quote, accepted, in-progress, complete, closed. A **quote** is a job that has not been won yet, and it is either **fixed price** or **time and materials**.
- The **traveller** is the card the floor works from: the scope, the planned materials against issued, the hours. `npm run docs` prints it.
- A **heat number** ties a piece of steel to its mill certificate. **Structural** jobs demand one on every traceable issue; that gate is the law working, not admin.
- **Burnt** is cost against a fixed quote. A job 80% burnt and unfinished needs a decision, not hope.
- **WIP** is cost sitting in open jobs that no invoice covers: the accountant's month-end number, live here any day.
- **Outwork** is work you buy in (galvanising, laser, machining): a direct-to-job PO whose cost lands at receipt.
- A **progress claim** bills part of a fixed price mid-job. On **construction work** it goes out as a **payment claim** under the CCA 2002, and the response clock is the Act's.
- A **retention** is your money a customer holds. It is trust money, it has a due date, and it comes back to the people who ask.
- **Exposure** is owing plus WIP, and it is the number the credit limit is measured against, not the statement balance.
- **Recovery** is booked hours against capacity. Unbooked hours are unrecovered hours.

## Where things live

- `scripts/shop.mjs` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it. Never edit an applied migration; add the next one.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `brand.json`, `views.json`, `documents.json` the HTML output: whose name is on it, what pages, what paperwork.
- `docs/compliance.md` the rules `/compliance` checks, each with its source. `docs/replace-ostendo.md` moving off the incumbent. `docs/why-no-front-end.md` the honest trade-offs.
- `exports/` whole database dumps. `drafts/` anything written for a person to send.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/ostendo
