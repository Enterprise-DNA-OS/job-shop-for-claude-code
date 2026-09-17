---
description: The billing run. Draft invoices from the job record: progress claims, balances at completion, or the meter on time and materials. Payment claims and retentions handled properly.
---

1. Who needs billing: `npm run shop -- attention` (finished-not-invoiced) and `wip` (cost unbilled).
2. Draft:
   - Fixed price, mid-job: `bill <ref> --percent=40` or `--amount=`, the progress claim.
   - Fixed price, complete: `bill <ref>`, the balance bills itself.
   - Time and materials: `bill <ref>`, the meter to date, labour at charge plus materials at sell plus outwork, less anything already invoiced.
3. On a construction job the draft goes out as a payment claim automatically, with the Construction Contracts Act statement rendered on the document. `--no-payment-claim` only when the operator says so.
4. Retentions the customer will withhold: `--retention=5%` (or an amount) and `--retention-due=` when the defects period is known. `retentions` watches them from then on.
5. Render with `npm run docs -- invoice`, the operator sends it, then `invoice sent <number>`, later `invoice paid <number>`. Nothing sends from here, ever.
