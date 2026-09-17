---
description: Planned material the shelf cannot cover, per job, with what is on order and when it lands against the promise date.
---

1. Run `npm run shop -- shortages`.
2. For each line: is an order coming, and does it land before the promise date? If nothing is coming, that is today's phone call: `po raise <supplier>`, `po add`, and the customer conversation now, not on the promise date.
3. Cross-check `stock --short` for anything through its reorder level with no demand yet: that is next month's shortage.
4. Never quietly move a promise date. Say what is short, what it does to the date, and let the operator make the call to the customer.
