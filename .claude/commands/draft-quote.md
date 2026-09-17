---
description: The quotation document, drafted from the job's own scope, price and allowed materials, into docs-out/ on the company's letterhead. Never sent from here.
---

1. The job must exist as a quote first (`/quote` registers it, `plan` puts the materials on).
2. `npm run docs -- quote` renders every open quote; add the ref's id-prefix to render one.
3. Read it before handing it over: scope in the customer's words, the price plain (fixed plus GST, or the T&M basis), the delivery honest against `shortages` and `loading`.
4. It is a draft on the letterhead. The operator sends it, and the send gets a `log`.
