# The rule book /compliance runs

`npm run shop -- compliance` checks the records against the rules below and reports what is breached, with the source cited. The CLI also enforces the sharpest ones at the gate: `issue` refuses traceable material onto a structural job without a heat number, and `bill` drafts construction work as a payment claim unless the operator turns it off.

**None of this is legal or safety advice.** It is a rule book a New Zealand engineering job shop pointed this system at, written down with sources so it can be checked, argued with, and changed. Your obligations are defined by the Acts, the regulations, the standards your contracts adopt and your own operation; edit this file and the checks together (`/customise` does both).

## The six rules

### 1. traceability: a heat number on every traceable item issued to a structural job

**Source:** AS/NZS 5131 (structural steelwork: fabrication and erection) expects material traceability to test certificates for structural work, and the construction category on the job drives how strict that is. The MBIE guidance on steel fabricator certification and the SCNZ certification scheme both stand on the same expectation. When a certifier, an engineer or a dispute asks what went into the build, the heat number on the issue record is the answer.
**The check:** no issue of a traceable item onto a job flagged structural is missing a heat or certificate number.
**The gate:** `issue` refuses traceable material onto a structural job without `--heat=`. The number comes off the mill certificate that arrived with the steel; `heat <job> <item> <number>` backfills honestly when the cert turns up later.
**Fix:** find the certificate in the delivery paperwork and record it. If it cannot be found, tell the engineer before the steel is buried in the build, not after.

### 2. plant-maintenance: every work centre inside its service interval

**Source:** Health and Safety at Work Act 2015 s 36 (primary duty of care), with the General Risk and Workplace Management Regulations 2016 behind it: plant is maintained so it remains safe. Guarding, interlocks and light curtains on the brake, the saw and the machine line get checked at service, which is why the service record is the safety record.
**The check:** no work centre is past its service interval (months, set per centre).
**Fix:** book the service, then `centre service <code> --on=`. If your regime is hours-based or annual for some plant, change the interval on the centre: the rule follows the record.

### 3. payment-claims: construction work invoiced as a payment claim

**Source:** Construction Contracts Act 2002 ss 20 to 23. A valid payment claim identifies the construction work and the period, states the claimed amount and the due date, and states that it is made under the Act. Served properly, the payer must respond with a payment schedule or pay; no schedule by the due date and the claimed amount is recoverable as a debt. An invoice sent plain has none of that behind it.
**The check:** no unpaid invoice on a job flagged construction work is missing the payment claim flag.
**The gate:** `bill` drafts construction-work invoices as payment claims by default and renders the Act's statement on the document; `--no-payment-claim` is the operator's own call. A draft that missed the flag: `invoice claim <number>` before it is served.
**Fix:** for one already sent plain, serve the next claim properly; the Act works claim by claim.

### 4. retentions: retention money claimed when it falls due

**Source:** Construction Contracts Act 2002 subpart 2A (the retentions regime, tightened by the 2023 amendments): retention money withheld from you must be held on trust, with records, and you are entitled to it at the end of the defects period. In practice it comes back to the subcontractors who ask on the day, and quietly evaporates for the ones who forget.
**The check:** no retention with a due date in the past is still unreceived.
**Fix:** invoice or write for it the week it falls due (draft the letter, a person sends it), then `retention received <number>` when it lands. Set `--retention-due=` at billing time: a retention with no date is a retention nobody will chase.

### 5. ppsr-rot: a financing statement behind retention-of-title terms on real money

**Source:** Personal Property Securities Act 1999. Retention-of-title terms in your conditions of sale are a security interest (s 17), and priority belongs to the registered. Unregistered, the goods you made and delivered on credit belong to the liquidator the day the customer folds: the classic small-manufacturer loss. Registration is cheap and online at ppsr.govt.nz.
**The check:** no trade customer owing $10,000 or more is without a recorded PPSR registration. The threshold is this file's, not the Act's: change it to your own appetite in the check and here together.
**Fix:** register the financing statement, then `ppsr <customer> --registered=`.

### 6. time-records: time records complete while the floor is busy

**Source:** Employment Relations Act 2000 s 130 (wages and time records kept for six years), and the Holidays Act 2003 record duties beside it. Here the time entries are that record and the job costing at once, so a gap is both a compliance gap and margin leaking silently off a job.
**The check:** no active tradesperson has gone 3 or more days without booking time while jobs are in progress.
**Fix:** book the missing days with honest dates (`time <job> <person> <hours> --on=`). Someone on leave is fine; the flag clears the day they book again.

## Australia, at a high level

The same shapes exist under different names; a shop operating in Australia rebuilds this file on its own state's rules. The parts to read:

- **Traceability:** AS/NZS 5131 applies on both sides of the Tasman, with the construction category set by the engineer.
- **Plant:** the model WHS Act (ss 19, 21) and the model WHS Regulations Part 4.5 on plant, as enacted in your state; the "managing the risks of plant in the workplace" Code of Practice.
- **Payment claims:** every state has a security of payment Act (NSW 1999, Vic 2002, Qld's BIF Act 2017, and so on), each with its own claim form and clocks. The habit is the same: claim properly, every time.
- **Retentions:** Qld's project bank accounts and the NSW retention trust scheme are the local versions of the same trust idea.
- **PPSR:** the Personal Property Securities Act 2009 (Cth) has the same retention-of-title trap and the same fix, at ppsr.gov.au.
- **Time records:** the Fair Work Act 2009 and its record-keeping regulations.

`/customise` rewrites the rules and the checks together. Change the words and the SQL in the same commit, so the report never claims a rule the doc does not carry.
