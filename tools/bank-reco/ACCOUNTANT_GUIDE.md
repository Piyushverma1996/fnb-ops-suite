# Bank Reconciliation — Accountant Quick Guide

> **Live URL:** [fnb-ops-suite.vercel.app](https://fnb-ops-suite.vercel.app)
>
> **What it does:** Auto-matches your HDFC bank statement against BC's Bank Account Ledger Entries. Spits out an Excel file with row-by-row instructions for what to tick in BC. Brings reconciliation from ~6 hours/outlet to ~15 min/outlet.

---

## The 6-step Monday morning routine (per outlet, per month)

### Step 1 — Export from BC (5 min)

For one outlet, export from Business Central:

| What | Where in BC | Save as |
|---|---|---|
| HDFC bank statement | HDFC NetBanking → download `.xls` | `<outlet>_<lastDigits>-imp.xls` |
| **Primary outlet** BC Bank Account Ledger | BC → Bank Account Ledger Entries → filter Branch Code → Export | `HDFC<code> (<outlet>).xlsx` |
| **All other outlets**' BC Bank Ledgers | Same export, one per outlet | `HDFC<code> (<outlet>).xlsx` |
| Aggregator settlements | Download from Swiggy / Zomato / AmEx / PhonePe partner dashboards | Various `.csv` |
| Sales Invoices | BC → Sales Invoices → Export with Payment Type column | `Sales Invoices.xlsx` |

### Step 2 — Open the tool (30 sec)

Go to [fnb-ops-suite.vercel.app](https://fnb-ops-suite.vercel.app).

### Step 3 — Drop the files (1 min)

| Dropzone | What to drop |
|---|---|
| Bank Statement | The HDFC `.xls` |
| BC Bank Ledger | This outlet's BC ledger (the primary one) |
| **Other outlets' BC bank ledgers** | Every other outlet's BC ledger (multi-file) |
| **Aggregator settlement files** | All Swiggy `consolidate-annexure-orders*.csv` + Zomato `utr_report_mid*.csv` + AmEx `Settlements*.csv` + PhonePe `*_FORWARD_TRANSACTION_*.csv` |
| Sales Invoices | The BC SI export |

The Branch dropdown auto-fills. Date range auto-fills to the intersection of bank ∩ BC.

### Step 4 — Hit Match (5 sec)

Bottom of Step 3 — the big purple "Match N bank entries against BC" button.

### Step 5 — Review the "What's missing" panel (~1 min)

After Match, a panel appears between the stat cards and the result tabs. Three badge colours:

- **ACTION** (amber) — upload a file to close these. The action sentence tells you exactly which file.
- **WORKFLOW** (blue) — depends on accounting workflow (cash deposit timing, etc.).
- **MANUAL** (grey) — no auto-match possible, handle row-by-row in Step 6.

If any ACTION row is large enough to bother you, grab the file and re-upload. Otherwise skip to Step 6.

### Step 6 — Download Excel and reconcile in BC (10–15 min)

Click **Download Excel Report**. Open it.

| Sheet | What to do with it |
|---|---|
| **0 How to Use** | Read once. Pre-fills your BC reconciliation header values (Statement Date, Opening Balance, Closing Balance). |
| **0a What's Missing** | Same diagnostic as the UI panel — for posterity. |
| **1 Action Plan** | The main one. Numbered, chronological. For each row: in BC, find that bank statement line → Match Manually → tick the BC docs listed in column G → tick "Done" in the Excel. ~1 sec/row. |
| **2 BC Stmt Import** | Ctrl+C the rows → paste into BC's empty Bank Statement Lines grid. Skips the manual import step. |
| **3 Unmatched Bank** | Bank lines without a BC counterpart. The "Suggested Action" column tells you whether to create a voucher, check another outlet's ledger, or investigate manually. |
| **4 Unmatched BC** | BC vouchers without a bank counterpart. Usually cross-month timing. |
| **5 Summary** | Daily roll-up + header values. |
| **6 All Matches** | Audit trail. |
| **7 Aggregator Settlements** | (Only if T5 matches.) For each Swiggy/Zomato/AmEx/PhonePe NEFT, the full deduction breakdown — create one BR voucher + JV. |
| **9 Inter-outlet Matches** | (Only if T7 matches.) For each IB FUNDS TRANSFER, the counterparty outlet's voucher number — confirm and tick. |

---

## Expected match% per outlet (with full file coverage)

| Outlet | Realistic Match% |
|---|---|
| **DW** | 96–97% |
| **JR** | 87–88% |
| **AV** | 80–82%* |
| **MR** | 70–75% |
| **DBG** | 75–80% |
| **NP** | 70–75% |
| **RG** | 70–72% |
| **DDB** | 40–45%† |
| **SS** | 65–70% |

* AV requires uploading the HDFC-OD (HDFC8915) BC ledger to break past 85%
† DDB's lower number is structural (lots of cross-outlet flow without full data); not a tool issue

## The 8 matching tiers (in priority order)

| Tier | Catches | Confidence |
|---|---|---|
| T1 | Exact 1:1 same-day same-amount | 100% |
| T2 | Many BC entries summing to one bank line, same date | 95% |
| T3 | Date-tolerant 1:1 | 80% |
| T4 | Date-tolerant many-to-one | 70% |
| T5 | Aggregator settlement match (UTR or brand+amount) | 90% |
| T6 | Cash deposit T+1 against Sales Invoices | 88% |
| T7 | Inter-outlet IB FUNDS TRANSFER ↔ counterparty contra voucher | 92% |
| T8 | Brand-narration (AmEx/Swiggy/Zomato/PhonePe brand words on both sides) | 85% |

---

## When something looks wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| Match% way below expected | Wrong outlet selected | Check the Branch dropdown matches your bank file |
| Branch dropdown empty | BC file is wrong format | Re-export from BC's Bank Account Ledger Entries page |
| "Sheet 0a What's Missing" not in Excel | Cached deploy | Hard-refresh (Ctrl+Shift+R) and re-Match |
| Aggregator row says "Already have settlements" but match% didn't move | The settlement files don't cover the dates of those bank lines | Download newer settlement CSVs from the partner dashboard |
| Inter-outlet count stays high after uploading other ledgers | Counterparty account isn't in `bank-account-map.ts` | Tell the dev team the unmatched HDFC account number |

---

## Privacy

All processing is in your browser. **No file ever leaves your machine.** The Vercel server only serves the JavaScript bundle — no data is uploaded.

---

**This guide last updated: 2026-06-22.** Live URL: [fnb-ops-suite.vercel.app](https://fnb-ops-suite.vercel.app). Source: [github.com/Piyushverma1996/fnb-ops-suite](https://github.com/Piyushverma1996/fnb-ops-suite).
