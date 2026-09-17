---
description: Retention money customers are holding. What is held, when it falls due back, and what is overdue for the asking.
---

1. Run `npm run shop -- retentions`.
2. Retention money withheld from you is held on trust under the Construction Contracts Act 2002 subpart 2A. It is your money, and it comes back to the people who ask on the day it falls due.
3. Anything overdue: draft the claim letter (to `drafts/`), and when it lands, `retention received <number>`.
4. New retentions get a due date at billing time (`bill --retention=5% --retention-due=`): a retention with no date is a retention nobody will ever chase.
