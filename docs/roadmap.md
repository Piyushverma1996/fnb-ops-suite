# F&B Ops Suite — Roadmap

## Vision

A self-contained toolkit for every operational and accounting pain point in a multi-outlet restaurant chain. Each tool is a standalone Next.js app under `tools/`, deployable independently to Vercel, sharing a consistent design system and UX.

## Build order (priority)

### Wave 1 — Reconciliation + Brand (live)
1. ✅ **Bank Reconciliation** — done
2. ✅ **Pamma Biryani — brand site + IG automation** — live at [pamma-biryani.vercel.app](https://pamma-biryani.vercel.app); source migration into this monorepo pending

### Wave 2 — POS / ERP sync
2. **Petpooja → BC Sales Invoice Buffer Generator**
   - Input: Petpooja Dynamic Report CSV (multi-day, can span overlapping batches)
   - Output: 25-column BC Sales Invoice Buffer CSV, chunked at 1,500 rows/file
   - Handles: deduplication, business-date logic (7 AM cutoff), item code mapping, payment-type normalization, packaging charges, complementary order collision detection
3. **Multi-POS Reconciliation (Petpooja vs Rista vs Growth Report)**
   - Input: Petpooja Dynamic Report + Rista POS Export + Growth Report per outlet
   - Output: Bill-by-bill reconciliation showing any mismatches in count, amount, or payment type
   - Already prototyped in Python (`final_recon.py`) — port to web

### Wave 3 — Cash flow & settlement
4. **Aggregator Settlement Tracker**
   - Input: Zomato/Swiggy settlement reports + POS gross sales
   - Output: Per-day, per-outlet reconciliation of gross sale → commission → net settlement → bank credit
   - Highlights anomalies (T+3 delay, commission rate drift, missing settlements)
5. **Cash Deposit Tracker**
   - Input: Cash sales from POS + bank cash-deposit entries
   - Output: Match cash deposits to source outlets/dates; flag deposits > N days delayed

### Wave 4 — Reporting & dashboards
6. **Daily Closing Dashboard**
   - Per-outlet daily closing summary (sales, cash, card, UPI, aggregator splits)
   - Anomaly flagging (negative items, voided bills > X% of revenue, payment-type anomalies)
   - Drill-down by category, hour, item
7. **Menu Pricing Analyzer**
   - Compare `core_total` (menu price) vs `item_total` (billed price) across all bills
   - Identify items where staff routinely override prices (potential leakage)
   - Per-outlet, per-item, per-staff heat map

### Wave 5 — Statutory
8. **GST Filing Helper**
   - Generate GSTR-1 line-item input from BC Posted Sales Invoices
   - HSN summary, tax-rate summary, B2C summary
   - Validate against Petpooja Growth Report
9. **TDS / TCS Worksheet**
   - Aggregator TDS deductions worksheet
   - Vendor TCS aggregation

### Wave 6 — Forward-looking
10. **Menu Pricing & Profitability** (BOM-aware)
    - Input: BOM/recipe + actual sale price
    - Output: Item-level GP margin, recommended price adjustments
11. **Forecasting** (light)
    - Daily sales forecast per outlet (simple moving-average baseline + seasonality)

## Cross-cutting infrastructure

- **Shared UI library** (`packages/ui`) — extract StatCard, FileDropzone, ResultsTabs into a reusable workspace package once 2nd tool exists
- **Shared parsers** (`packages/parsers`) — extract Petpooja, BC, Rista, HDFC bank statement parsers
- **Auth & history** (optional, behind a feature flag) — let accountants save past reconciliations to their browser (IndexedDB) or to a hosted backend
- **CLI** — same engines runnable from a terminal for batch processing

## Open questions

1. **Does the suite stay public-data-only**, or do we add a small backend (e.g. Supabase) for history/audit at some point?
2. **Multi-tenant** — does it ever leave Sandoz, or is it Sandoz-only? If multi-tenant, need user accounts + per-tenant config (categories, outlets, banks).
3. **Mobile-friendly?** Accountants typically work on desktop, but a mobile read-only view for owners checking daily closing makes sense.
