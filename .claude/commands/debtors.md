---
description: Aged debtors, drafts never sent, and the difference between chasing a payment claim and chasing a plain invoice.
---

1. Run `npm run shop -- debtors`.
2. Chase in this order: sent payment claims past due (the Act is behind you: no payment schedule by the due date means the sum is recoverable as a debt), then plain invoices by age, then drafts that never went out (send them, today).
3. The chasing letter is drafted from the record (`/draft-overdue-letter`), never sent from here.
4. Exposure is owing plus WIP: the full picture per account is `customers`, and anyone over their limit gets no new work without the operator's own yes.
