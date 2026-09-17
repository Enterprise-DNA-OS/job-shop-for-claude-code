---
description: The job board. Every open job with its promise date, how much of the quote is burnt, hours booked and what is left to bill.
---

1. Run `npm run shop -- jobs`.
2. Read it as a workshop manager, not a list: what is late (days past the promise), what is bleeding (burnt at 80%+ and unfinished), what is quiet (see `attention` for stalled jobs), and what is finished but unbilled.
3. For any job the operator asks about, `npm run shop -- job <ref>` and read the whole card before answering: plan against issued, hours, orders, invoices, notes.
4. Numbers come from the commands. Quote burnt is cost against a fixed quote; on time and materials there is no burn, only the meter.
