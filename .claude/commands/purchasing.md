---
description: Purchase orders. Stock POs feed the shelf; direct-to-job POs are outwork and buy-ins whose cost lands on the job at receipt.
---

1. What is open and what is late: `npm run shop -- po`. Overdue orders holding a job are on `attention`.
2. Raise: `po raise <supplier> [--job=<ref>] [--expected=] [--note=]`, then `po add <ref> <item|"description"> <qty> <unit-cost>` per line.
   - No `--job` means stock: receiving moves the shelf up and refreshes the item's latest cost.
   - With `--job` it is outwork or a buy-in for that job: receiving puts the cost straight onto the job and never touches the shelf.
3. Receive: `po receive <ref> [--on=]`. Cancel what will never come: `po cancel <ref>`.
4. Chasing a supplier is a call, then a `log`. The paper trail is why the "you never ordered it" conversation stays short.
