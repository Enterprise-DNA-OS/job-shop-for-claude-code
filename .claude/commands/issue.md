---
description: Stock onto a job. The shelf goes down, the job cost goes up, and structural jobs demand heat numbers.
---

1. `npm run shop -- issue <ref> <item> <qty> [--heat=H1234] [--by=]`.
2. On a structural job, a traceable item refuses to issue without `--heat=`. The number is on the mill certificate. That refusal is AS/NZS 5131 traceability working: do not invent a number, find the cert.
3. If the cert turns up after the steel went out: `heat <ref> <item> <number>`, honest backfills only.
4. The command warns when the shelf drops through the reorder level: raise the PO then, not when the next job needs it.
