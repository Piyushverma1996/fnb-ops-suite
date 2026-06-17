# 🏦 Bank Reconciliation Tool

Auto-match Business Central bank ledger entries to bank statements in seconds, using a 4-tier matching engine. Replaces a multi-day manual reconciliation chore with a 5-minute review.

**Live demo:** [bank-reco.vercel.app](https://bank-reco.vercel.app)

![screenshot](./public/screenshots/hero.png)

## The problem

BC's built-in bank reconciliation only does **one-to-one** matching with a date-tolerance window. But real restaurant data looks like this:

- **Bank statement** shows one consolidated entry: `NEFT CR-SWIGGY LIMITED ₹54,290` on Apr 5
- **BC ledger** shows 12 individual customer payment vouchers totalling ₹54,290, posted across Apr 4–5

BC can't match them. Accountants do it by hand. Multiply by 24 outlets × 28 days × multiple aggregators and you're looking at days of manual work every closing cycle.

## The solution

A 4-tier matching engine that handles:

| Tier | Match rule | Confidence | Example |
|------|-----------|-----------|---------|
| **T1** | Exact 1:1, same date, same amount, compatible category | 100% | Card settlement ₹16,262.11 ↔ BR voucher ₹16,262.11 |
| **T2** | Many-to-one same date (BC entries summing to one bank line) | 95% | One Swiggy NEFT ↔ 12 BC vouchers totalling exactly |
| **T3** | Same amount, date within ±N days (configurable) | 80% | Card T+2 settlement |
| **T4** | Many-to-one with date tolerance | 70% | Aggregator settlement across day boundary |

Plus narration → category classification so the matcher only pairs Swiggy bank lines with Swiggy/Dineout BC entries (and ignores Card / Internal / Salary / Vendor categories cross-bleeding).

## Stack

- **Next.js 16** (App Router) + **TypeScript** + **Tailwind CSS**
- **`xlsx`** for client-side Excel parsing
- **`react-dropzone`** for upload UX
- All processing happens **client-side** — financial data never leaves the browser

## Demo data

`public/sample-data/` contains synthetic Excel files you can use to try the tool without any real data:

- `sample-bank-statement.xlsx` — mock HDFC format
- `sample-bc-ledger.xlsx` — mock BC Bank Account Ledger Entries (with branch `DEMO`)

Regenerate with:
```bash
node scripts/generate-sample-data.mjs
```

## Local development

```bash
npm install
npm run dev
# Opens http://localhost:3000
```

## Build & deploy

```bash
npm run build
```

Deploys cleanly to Vercel (zero config). The whole app is static + client-side; no server runtime required.

## Real-world results (Sandoz Restaurants, Apr 2026)

| Outlet | Period | Bank entries | BC entries | Auto-match % | Time saved |
|--------|--------|--------------|------------|--------------|-----------|
| DW (Dwarka) | Apr 1–5 | 56 | 191 | 73.2% | ~40 min/day |

Goal across all 24 outlets: **~250 hours/month → ~30 hours/month**.

## Roadmap

- [ ] **BC API integration** — push matches directly into BC Bank Reconciliation table (no manual "Match Manually" clicks)
- [ ] **Outlet auto-detection** — sniff branch code from Bank Ledger file instead of asking user
- [ ] **Multi-bank batch mode** — upload all 27 outlets at once, get a zip of reports
- [ ] **History / audit trail** — store past reconciliations in IndexedDB
- [ ] **Custom category rules editor** — let accountants tune the narration → category mapping

## License

MIT
