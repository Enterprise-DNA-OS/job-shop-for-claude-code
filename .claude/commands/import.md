---
description: Bring the business across from Ostendo, or any system that exports CSV. Customers, suppliers, items and the job history, in one command, dry run first.
---

1. Read `docs/replace-ostendo.md` with the operator: it says which Ostendo screens export what, and what deliberately does not come across.
2. Dry run first, always:
   `npm run shop -- import ostendo --customers=customers.csv --suppliers=suppliers.csv --items=items.csv --jobs=jobs.csv --dry-run`
3. Read the counts and the skips back. Customers import before jobs, or the jobs skip.
4. Run it for real. Re-running updates rather than duplicates, so a second export is safe.
5. Say out loud what did not import and why: heat numbers, work centre services and open-job costing start from a walk of the racks and cutover day, not from the old system's word (the doc says why).
6. Any other system's CSV goes through `import csv` with the same flags.
