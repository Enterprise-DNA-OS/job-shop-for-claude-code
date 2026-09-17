---
description: A customer wants work priced. Register the quote, plan the materials at today's rates, and draft the quotation document. The counter flow.
---

The operator says who, what, and roughly what it should sell for. Run the flow; the CLI holds the gates.

1. New customer first: `add customer "<name>" --type=trade|consumer ...`. A stopped account refuses to quote; that refusal is the credit policy working, escalate rather than `--force` on your own judgment.
2. Register it: `job quote <customer> --title="..." --value=4800 [--basis=tm] [--promised=] [--structural] [--construction] [--by=]`.
   - `--structural` means every traceable item will demand a heat number at issue.
   - `--construction` means invoices go out as payment claims under the Construction Contracts Act 2002.
3. Plan the materials: `plan <ref> <item> <qty>` per line. Rates are captured today, so the estimate stands still while the price list moves. If the shelf cannot cover it, the command says so: check `shortages` before promising a date.
4. Paper: `npm run docs -- quote` renders the quotation draft from the job's own scope and allowed materials. It goes on the letterhead and the operator sends it.
5. Say the ref back, the price, and the one date not to promise before checking `shortages` and `loading`.
