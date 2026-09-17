---
description: The last 7 days of hours by person. Booked against capacity, the charge value recovered, and who has stopped filling in time.
---

1. Run `npm run shop -- labour`.
2. Recovery under about 70% for a tradesperson is either unbooked time (a record and margin problem) or genuinely idle hours (a loading problem). Say which it looks like; `loading` helps.
3. Gaps of 3 days or more while jobs are in progress land on `attention` and in `compliance time-records`. The fix is honest backfilling: `time <job> <person> <hours> --on=<the real day>`.
4. Rates live on the person and are captured per entry: changing a rate never rewrites history.
