---
description: The shelf. On hand, allocated to open jobs, free, on order, and what has fallen through its reorder level.
---

1. Run `npm run shop -- stock` (or `stock --short` for just the trouble).
2. One item's story: `item <code>`, recent issues, open orders and the reorder position.
3. Receipts move the shelf through `po receive`, issues through `issue`, corrections through `stock set <item> <qty> --reason=`. Never edit quantities without a reason on the record.
4. Traceable items are marked: they will demand heat numbers on structural jobs.
