---
description: Book hours to a job at a work centre. Rates are captured per entry, and the entries are the shop's time records.
---

1. `npm run shop -- time <ref> <person> <hours> [--centre=WLD] [--on=] [--note=]`. Hours take 6, 6.5, 6:30 or 6h30.
2. Book to the day the work happened, not the day someone remembered. These rows are the time record (Employment Relations Act 2000 s 130) and the job costing at once.
3. The command notes when the work centre is past its service: that is a compliance item, pass it on, do not sit on it.
4. Gaps show on `labour` and on `attention`. An unbooked hour is an unrecovered hour.
