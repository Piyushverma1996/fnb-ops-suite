# F&B Ops Suite

> Open-source toolkit for the operations, accounting, and marketing pain points of a multi-outlet restaurant business.
> Built from real problems solved at production restaurants — every tool ships with sample data and a live demo.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg)](https://www.typescriptlang.org/)
[![Deployed on Vercel](https://img.shields.io/badge/deploy-Vercel-black.svg)](https://vercel.com/)

## Why this exists

Running F&B operations means dealing with:
- **POS data** scattered across Petpooja, Rista, and a long tail of legacy systems
- **Business Central (ERP)** that needs constant sync to keep books closeable
- **Bank statements** with consolidated entries (one line = many ledger postings)
- **Aggregator settlements** (Zomato, Swiggy, Dineout) on different cycles
- **Daily reconciliation** that takes accountants days of manual matching every month
- **Social media** content production that eats hours that owners don't have

This monorepo is where I build the tools that fix each of those pain points one at a time.

## Tools

| Tool | Status | Description | Live demo |
|------|--------|-------------|-----------|
| 🏦 [Bank Reconciliation](./tools/bank-reco) | ✅ Live | Auto-match BC bank ledger to bank statements with a 4-tier matching engine. 73%+ auto-match rate on real restaurant data. | [bank-reco.vercel.app](https://bank-reco.vercel.app) |
| 📸 [Pamma Biryani — Brand Site + IG Automation](./tools/pamma-biryani) | ✅ Live | Brand storefront + Instagram content automation for a Hyderabadi biryani QSR. | [pamma-biryani.vercel.app](https://pamma-biryani.vercel.app) |
| 📊 Petpooja → BC Sales Invoice Generator | 🚧 Next | Pipeline that pulls Petpooja Dynamic Reports, deduplicates across overlapping batches, and generates a BC-ready Sales Invoice Buffer | — |
| 🍽️ Multi-POS Reconciliation | 🚧 Planned | Cross-check Petpooja / Rista / Growth Report figures bill-by-bill to detect missing or mis-classified sales | — |
| 💸 Aggregator Settlement Tracker | 🚧 Planned | Reconcile gross sale vs net settlement from Zomato/Swiggy with commission/charge breakup | — |
| 📈 Daily Closing Dashboard | 🚧 Planned | Per-outlet daily closing: sales, cash, card, UPI, aggregator splits with anomaly flagging | — |
| 🧾 GST Filing Helper | 🚧 Planned | GSTR-1 line-item generator from BC posted invoices with HSN summary | — |
| 🎯 Menu Pricing Analyzer | 🚧 Planned | Detect items where billed price differs from menu price (silent discounts) | — |

See [docs/roadmap.md](./docs/roadmap.md) for the full build order.

## Design principles

1. **Privacy first** — financial data never leaves the user's browser unless absolutely necessary
2. **Excel in, Excel out** — accountants live in Excel. Don't force a new format on them
3. **Self-serve** — every tool ships with sample data and a one-click demo
4. **Open** — MIT licensed, well-documented, easy to fork and adapt

## Tech stack

- **Next.js 16** (App Router) + **TypeScript** + **Tailwind CSS**
- Client-side Excel parsing via `xlsx`
- Hosted on **Vercel**

## Architecture

Monorepo where each tool under `tools/` is a standalone Next.js app deployable to its own Vercel project.

```
fnb-ops-suite/
├── tools/
│   ├── bank-reco/          # Tool #1 — Bank reconciliation
│   ├── pamma-biryani/      # Tool #2 — Restaurant storefront + IG automation
│   └── ...                 # Future tools
├── docs/                    # Roadmap & shared docs
└── README.md
```

## Contributing

Built for and used in production. Open to PRs, issues, and integration ideas with other F&B POS / ERP systems.

## License

MIT — see [LICENSE](./LICENSE)
