/**
 * Excel export utility for the reconciliation report.
 *
 * Sheet structure (designed for accountant-only reconciliation workflow):
 *   1. "1 Action Plan"   — chronological, numbered, tick-as-you-go in BC
 *   2. "2 BC Stmt Import"— BC bank statement import format (Date, Description, Amount)
 *   3. "3 Unmatched Bank"— bank lines with no BC counterpart, needs investigation
 *   4. "4 Unmatched BC"  — BC vouchers with no bank counterpart
 *   5. "5 Summary"       — daily roll-up
 *   6. "6 All Matches"   — raw match detail with narration + descriptions
 */
import * as XLSX from "xlsx";
import type { MatchResult, Match, BankEntry } from "./matcher";
import { outletForSwiggy, outletForZomato } from "./rest-id-map";
import { outletFromNarration } from "./bank-account-map";
import { saveAs } from "file-saver";

export function downloadReport(
  result: MatchResult,
  outletCode: string,
  dateFrom: string,
  dateTo: string,
  bank: BankEntry[] = [],
) {
  const buf = buildReportBuffer(result, outletCode, dateFrom, dateTo, bank);
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  saveAs(blob, `BankReco_${outletCode}_${dateFrom}_${dateTo}.xlsx`);
}

/** Same as downloadReport but returns the raw .xlsx ArrayBuffer for ZIP packaging. */
export function downloadReportToBlob(
  result: MatchResult,
  outletCode: string,
  dateFrom: string,
  dateTo: string,
  bank: BankEntry[] = [],
): ArrayBuffer {
  return buildReportBuffer(result, outletCode, dateFrom, dateTo, bank);
}

function buildReportBuffer(
  result: MatchResult,
  outletCode: string,
  dateFrom: string,
  dateTo: string,
  bank: BankEntry[] = [],
): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  // Statement balances (for the BC reconciliation header fields)
  const bankSorted = [...bank].sort((a, b) => a.date.getTime() - b.date.getTime());
  const first = bankSorted[0];
  const last  = bankSorted[bankSorted.length - 1];
  const openingBalance = first ? round2(first.balance - first.amount) : 0;
  const endingBalance  = last  ? round2(last.balance) : 0;

  // Sort matches chronologically with stable tie-break by amount
  const ordered = [...result.matches].sort((a, b) => {
    const t = a.bankDate.getTime() - b.bankDate.getTime();
    if (t !== 0) return t;
    return b.bankAmount - a.bankAmount;
  });

  // ───── Sheet 1: START HERE (workflow + header values + diagnostic) ─────
  const totalBank = result.stats.totalBank || 1;
  const matched = result.stats.matchedBank;
  const matchPct = result.stats.matchPct;
  const missingRows = buildMissingReport(result);
  const t5Count = ordered.filter(m => m.tier === "T5").length;
  const t6Count = ordered.filter(m => m.tier === "T6").length;
  const t7Count = ordered.filter(m => m.tier === "T7").length;

  const startHere: (string | number)[][] = [
    [`BANK RECONCILIATION — ${outletCode}`],
    [`Period: ${dateFrom} → ${dateTo}    Match: ${matched} / ${totalBank} (${matchPct}%)`],
    [],
    ["═════════════════════════════════════════════════════════════════"],
    ["  STEP 1.  BC HEADER VALUES — type these into the new reconciliation"],
    ["═════════════════════════════════════════════════════════════════"],
    ["Field", "Value"],
    ["Bank Account No.",         "(pick the HDFC account for this outlet)"],
    ["Statement No.",            `(next sequential, e.g. ${dateTo.slice(5,7)}/${dateTo.slice(2,4)})`],
    ["Statement Date",           dateTo],
    ["Balance Last Statement",   openingBalance],
    ["Statement Ending Balance", endingBalance],
    [],
    ["═════════════════════════════════════════════════════════════════"],
    ["  STEP 2.  PASTE STATEMENT LINES INTO BC"],
    ["═════════════════════════════════════════════════════════════════"],
    ["Open Sheet 2 (BC Stmt Import). Select rows 2 onwards (NOT the header). Ctrl+C."],
    ["In BC, click the empty Bank Statement Lines grid → Ctrl+V. Done."],
    [],
    ["═════════════════════════════════════════════════════════════════"],
    ["  STEP 3.  AUTO-MATCH IN BC (15 sec)"],
    ["═════════════════════════════════════════════════════════════════"],
    ["BC: Matching → Match Automatically. BC handles the obvious 1:1 cases."],
    [],
    ["═════════════════════════════════════════════════════════════════"],
    ["  STEP 4.  WALK THE ACTION PLAN (Sheet 3) — the main work"],
    ["═════════════════════════════════════════════════════════════════"],
    ["For each row in Sheet 3 (Action Plan):"],
    ["  - In BC, click that statement line → Matching → Match Manually"],
    ["  - Tick the BC docs listed in column 'BC Doc(s) to Apply'"],
    ["  - Mark 'Done' in the Excel sheet."],
    ["  - T1 entries (100% confidence): tick without checking. ~1 sec/row."],
    ["  - T2/T7 entries: same idea, confidence 92-95%."],
    [],
    ...(t5Count > 0 ? [
      ["═════════════════════════════════════════════════════════════════"] as (string | number)[],
      [`  STEP 5.  AGGREGATOR VOUCHERS (Sheet 4) — ${t5Count} BR vouchers to create`],
      ["═════════════════════════════════════════════════════════════════"] as (string | number)[],
      ["For each row in Sheet 4 (Aggregator Settlements):"] as (string | number)[],
      ["  - Create one BR voucher for the bank line at the Net Payout amount"] as (string | number)[],
      ["  - Plus journal entries for the deduction lines (Commission, GST, TCS, TDS)"] as (string | number)[],
      ["  - The row gives you every number you need."] as (string | number)[],
      [] as (string | number)[],
    ] : []),
    ...(t7Count > 0 ? [
      ["═════════════════════════════════════════════════════════════════"] as (string | number)[],
      [`  STEP 6.  INTER-OUTLET TRANSFERS (Sheet 5) — ${t7Count} pairings`],
      ["═════════════════════════════════════════════════════════════════"] as (string | number)[],
      ["For each row in Sheet 5 (Inter-outlet Matches):"] as (string | number)[],
      ["  - The counterparty outlet + voucher number is given."] as (string | number)[],
      ["  - In BC, find that voucher on the counterparty's BC ledger and confirm."] as (string | number)[],
      ["  - Tick the bank line + that voucher."] as (string | number)[],
      [] as (string | number)[],
    ] : []),
    ...(t6Count > 0 ? [
      ["═════════════════════════════════════════════════════════════════"] as (string | number)[],
      [`  STEP 7.  CASH DEPOSIT VOUCHERS (Sheet 6) — ${t6Count} vouchers to create`],
      ["═════════════════════════════════════════════════════════════════"] as (string | number)[],
      ["For each row in Sheet 6 (Cash Deposits):"] as (string | number)[],
      ["  - Create one deposit voucher for the cash bills listed."] as (string | number)[],
      [] as (string | number)[],
    ] : []),
    ["═════════════════════════════════════════════════════════════════"],
    ["  STEP 8.  REMAINING UNMATCHED — see what's blocking 100%"],
    ["═════════════════════════════════════════════════════════════════"],
    ["The diagnostic table below tells you EXACTLY which file or action would close each category."],
    ["ACTION = upload a file. WORKFLOW = waiting on accountant timing. MANUAL = handle row-by-row."],
    [],
    ["Tier", "Category", "# Lines", "Total ₹", "% of bank", "What to do"],
    ...missingRows.map(r => [
      r.tier.toUpperCase(),
      r.title,
      r.count,
      r.amount,
      `${r.pct}%`,
      r.action,
    ]),
    [],
    ["═════════════════════════════════════════════════════════════════"],
    ["  STEP 9.  POST THE RECONCILIATION"],
    ["═════════════════════════════════════════════════════════════════"],
    ["When Total Difference = 0 in BC → click Post."],
  ];
  const sheet1Start = XLSX.utils.aoa_to_sheet(startHere);
  applyColWidths(sheet1Start, [12, 38, 9, 14, 10, 80]);
  XLSX.utils.book_append_sheet(wb, sheet1Start, "1 Start Here");

  // ───── Sheet 2: BC Bank Statement Import (with UTR) ─────
  const stmtImportRows = collectStatementLines(result).map(l => ({
    "Transaction Date": fmtDate(l.date),
    "UTR / Ref No": extractUTR(l.narration),
    "Description": l.narration,
    "Statement Amount": l.direction === "Credit" ? l.amount : -l.amount,
  }));
  const sheet2 = XLSX.utils.json_to_sheet(stmtImportRows);
  applyColWidths(sheet2, [14, 22, 70, 16]);
  XLSX.utils.book_append_sheet(wb, sheet2, "2 BC Stmt Import");

  // ───── Sheet 3: Action Plan (tick-list, the main work) ─────
  const actionPlanRows = ordered.map((m, i) => ({
    "#": i + 1,
    "Done": "",
    "Date": fmtDate(m.bankDate),
    "Bank Amount": m.bankAmount,
    "Dir": m.direction === "Credit" ? "CR" : "DR",
    "Tier": m.tier,
    "BC Doc(s) to Apply":
      m.tier === "T5" && m.settlement
        ? `Create BR voucher: Net ₹${m.settlement.netPayout.toFixed(2)} (${m.settlement.aggregator} UTR ${m.settlement.utr})`
        : m.tier === "T6" && m.cashBucket
        ? `Create cash deposit voucher: ${m.cashBucket.invoiceCount} cash bills from ${m.cashBucket.invoiceDate} totaling ₹${m.cashBucket.bucketTotal.toFixed(2)}`
        : m.tier === "T7" && m.crossOutlet
        ? `Inter-outlet: pair this bank line with voucher ${m.crossOutlet.counterpartyDocNo} on ${m.crossOutlet.counterpartyOutlet} BC ledger (${fmtDate(m.crossOutlet.counterpartyDate)})`
        : m.bcDocs,
    "Type": humanCategory(m.category),
    "Bank line (for reference)": shortenNarration(m.bankNarration),
  }));
  const sheet3 = XLSX.utils.json_to_sheet(actionPlanRows);
  applyColWidths(sheet3, [4, 7, 11, 14, 5, 6, 50, 16, 60]);
  XLSX.utils.book_append_sheet(wb, sheet3, "3 Action Plan");

  // ───── Sheet 3: Unmatched Bank ─────
  const ubRows = result.unmatchedBank
    .slice()
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((b, i) => {
      let suggestion = "";
      // (a) Inter-outlet transfers: decode account → outlet
      if (b.category === "INTERNAL_CR" || b.category === "INTERNAL_DR") {
        const other = outletFromNarration(b.narration);
        if (other) {
          suggestion = b.category === "INTERNAL_CR"
            ? `Transfer from ${other} — check that outlet's BC ledger for the matching contra voucher`
            : `Transfer to ${other} — check that outlet's BC ledger for the matching contra voucher`;
        }
      }
      // (b) Aggregator-shaped narrations with no UTR match: tell user which
      //     settlement file to download.
      if (!suggestion) {
        const upper = b.narration.toUpperCase();
        const isSwiggy = upper.includes("SWIGGY") || upper.includes("BUNDL TECHNOLOGIES");
        const isZomato = upper.includes("ZOMATO") || upper.includes("ETERNAL LIMITED");
        if (isSwiggy || isZomato) {
          // Pull a long alphanumeric token that looks like a UTR
          const m = b.narration.match(/\b([A-Z]{4,}[0-9A-Z]{6,})\b/);
          const utr = m?.[1];
          const aggName = isSwiggy ? "Swiggy" : "Zomato";
          const filename = isSwiggy ? "consolidate-annexure-orders" : "utr_report_mid";
          if (utr) {
            suggestion = `${aggName} settlement file missing for UTR ${utr} (${fmtDate(b.date)}). Download a ${aggName} ${filename}*.csv covering this date and rerun.`;
          } else {
            suggestion = `${aggName} settlement file missing for this period. Download the ${aggName} ${filename}*.csv and rerun.`;
          }
        }
      }
      // (c) Cash deposit with no T6 match: ask for the SI file
      if (!suggestion && b.category === "CASH_DEPOSIT") {
        suggestion = `Cash deposit not yet booked. Upload BC Sales Invoices export so the matcher can sum T-1 cash bills against this line.`;
      }
      return {
        "#": i + 1,
        "Done": "",
        "Date": fmtDate(b.date),
        "Amount": b.absAmount,
        "Dir": b.direction === "Credit" ? "CR" : "DR",
        "Type": humanCategory(b.category),
        "Suggested Action": suggestion,
        "Narration": b.narration,
        "Note": "",
      };
    });
  const sheetUB = XLSX.utils.json_to_sheet(ubRows);
  applyColWidths(sheetUB, [4, 7, 11, 14, 5, 16, 60, 70, 30]);
  // Sheet 7 — inserted in final order below

  // ───── Sheet 4: Unmatched BC ─────
  const ucRows = result.unmatchedBC
    .slice()
    .sort((a, b) => a.postingDate.getTime() - b.postingDate.getTime())
    .map((c, i) => ({
      "#": i + 1,
      "Done": "",
      "Posting Date": fmtDate(c.postingDate),
      "Amount": c.absAmount,
      "Dir": c.direction === "Credit" ? "CR" : "DR",
      "Doc No.": c.documentNo,
      "Type": humanCategory(c.category),
      "Description": c.description,
      "Note": "",
    }));
  const sheet4 = XLSX.utils.json_to_sheet(ucRows);
  applyColWidths(sheet4, [4, 7, 13, 14, 5, 22, 16, 50, 30]);
  const sheetUC = sheet4; void sheetUC;
  // Sheet 8 — inserted in final order below

  // ───── Sheet 5: Summary ─────
  const summaryHeader = [
    ["Bank Reconciliation Report"],
    [`Outlet: ${outletCode}    Period: ${dateFrom} → ${dateTo}`],
    [],
    ["BC Reconciliation Header values"],
    ["Statement Date",            dateTo],
    ["Balance Last Statement",    openingBalance],
    ["Statement Ending Balance",  endingBalance],
    [],
    [
      "Bank Entries",
      "BC Entries",
      "Auto-Matched",
      "Unmatched Bank",
      "Unmatched BC",
      "Match %",
    ],
    [
      result.stats.totalBank,
      result.stats.totalBC,
      result.stats.matchedBank,
      result.stats.unmatchedBank,
      result.stats.unmatchedBC,
      result.stats.matchPct + "%",
    ],
    [],
    ["Tier breakdown"],
    ["T1 Exact 1:1", tierCount(result.matches, "T1")],
    ["T2 Many-to-One same date", tierCount(result.matches, "T2")],
    ["T3 Date-tolerant 1:1", tierCount(result.matches, "T3")],
    ["T4 Many-to-One date-tolerant", tierCount(result.matches, "T4")],
    [],
    ["Daily breakdown"],
    ["Date", "Bank Entries", "BC Entries", "Matched", "Unmatched Bank", "Unmatched BC", "Match %"],
    ...result.summary.map(s => [
      s.date,
      s.bankEntries,
      s.bcEntries,
      s.matched,
      s.unmatchedBank,
      s.unmatchedBC,
      s.matchPct + "%",
    ]),
  ];
  const sheet5 = XLSX.utils.aoa_to_sheet(summaryHeader);
  applyColWidths(sheet5, [16, 16, 16, 16, 16, 12, 12]);
  const sheetSummary = sheet5; void sheetSummary;
  // Sheet 9 — inserted in final order below

  // ───── Aggregator Settlements (T5) — extra sheet if any ─────
  const t5 = ordered.filter(m => m.tier === "T5" && m.settlement);
  if (t5.length > 0) {
    const t5Rows = t5.map((m, i) => {
      const s = m.settlement!;
      const gap = m.bankAmount - s.netPayout;
      const period = s.periodStart && s.periodEnd
        ? `${fmtDate(s.periodStart)} → ${fmtDate(s.periodEnd)}` : "";
      const outletNames = s.rid.split(",").map(r => r.trim()).map(r => {
        const o = s.aggregator === "SWIGGY" ? outletForSwiggy(r) : outletForZomato(r);
        return o?.outletName ?? `RID ${r}`;
      }).filter((v, idx, a) => a.indexOf(v) === idx).join("; ");
      return {
        "#": i + 1,
        "Done": "",
        "Bank Date": fmtDate(m.bankDate),
        "Bank Amount": m.bankAmount,
        "Aggregator": s.aggregator,
        "Outlet (via RID)": outletNames,
        "Bank UTR": s.utr,
        "Settlement Period": period,
        "Orders": s.orderCount,
        "Gross sales (book as Revenue)": s.grossSales,
        "Commission + fees (book as Expense)": s.totalCommission,
        "GST on commission (book as GST input)": s.totalGstFees,
        "TCS (book as TCS receivable)": s.totalTcs,
        "TDS (book as TDS receivable)": s.totalTds,
        "Net Payout (per settlement file)": s.netPayout,
        "Δ vs Bank": round2(gap),
        "Notes": Math.abs(gap) > 100 ? "Verify deductions — significant gap" : "",
      };
    });
    const s7 = XLSX.utils.json_to_sheet(t5Rows);
    applyColWidths(s7, [4, 7, 12, 13, 11, 28, 22, 22, 7, 16, 16, 16, 14, 14, 16, 11, 32]);
    XLSX.utils.book_append_sheet(wb, s7, "4 Aggregator Settlements");
  }

  // ───── Cash Deposits (T6) — extra sheet if any ─────
  const t6 = ordered.filter(m => m.tier === "T6" && m.cashBucket);
  if (t6.length > 0) {
    const t6Rows = t6.map((m, i) => {
      const c = m.cashBucket!;
      return {
        "#": i + 1,
        "Done": "",
        "Bank Date": fmtDate(m.bankDate),
        "Bank Amount": m.bankAmount,
        "Cash Bills From": c.invoiceDate,
        "# Bills": c.invoiceCount,
        "Bucket Total": c.bucketTotal,
        "Δ vs Bank": round2(m.bankAmount - c.bucketTotal),
        "Outlet": c.outletCode,
        "Sample Doc Nos (first 5)": c.invoiceDocs.slice(0, 5).join("; "),
        "Bank Narration": shortenNarration(m.bankNarration),
      };
    });
    const s8 = XLSX.utils.json_to_sheet(t6Rows);
    applyColWidths(s8, [4, 7, 12, 13, 14, 8, 13, 11, 8, 60, 60]);
    XLSX.utils.book_append_sheet(wb, s8, "6 Cash Deposits");
  }

  // ───── Inter-outlet matches (T7) — extra sheet if any ─────
  const t7 = ordered.filter(m => m.tier === "T7" && m.crossOutlet);
  if (t7.length > 0) {
    const t7Rows = t7.map((m, i) => {
      const x = m.crossOutlet!;
      return {
        "#": i + 1,
        "Done": "",
        "Bank Date": fmtDate(m.bankDate),
        "Amount": m.bankAmount,
        "Dir": m.direction === "Credit" ? "CR" : "DR",
        "Counterparty Outlet": x.counterpartyOutlet,
        "Counterparty Doc No": x.counterpartyDocNo,
        "Counterparty Date": fmtDate(x.counterpartyDate),
        "Counterparty Description": x.counterpartyDescription,
        "Bank Narration": shortenNarration(m.bankNarration),
      };
    });
    const s9 = XLSX.utils.json_to_sheet(t7Rows);
    applyColWidths(s9, [4, 7, 12, 13, 5, 20, 26, 14, 50, 60]);
    XLSX.utils.book_append_sheet(wb, s9, "5 Inter-outlet Matches");
  }

  // ───── Sheet 6: All Matches (raw detail) ─────
  const allMatchedRows = ordered.map(m => ({
    "Bank Date": fmtDate(m.bankDate),
    "Bank Narration": m.bankNarration,
    "Direction": m.direction,
    "Bank Amount": m.bankAmount,
    "Match Tier": m.tierLabel,
    "Confidence %": m.confidence,
    "BC Sum Amount": m.bcSumAmount,
    "BC Doc Nos": m.bcDocs,
    "BC Descriptions": m.bcDescriptions,
    "Category": m.category,
  }));
  // Final ordering: sheets 4, 5, 6 (aggregator / inter-outlet / cash) are
  // added conditionally above. Now insert 7, 8, 9, 10 in order.
  XLSX.utils.book_append_sheet(wb, sheetUB, "7 Unmatched Bank");
  XLSX.utils.book_append_sheet(wb, sheet4, "8 Unmatched BC");
  XLSX.utils.book_append_sheet(wb, sheet5, "9 Summary");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(allMatchedRows), "10 All Matches");

  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Pull a likely UTR / bank reference number out of a bank narration.
 * Targets the common HDFC patterns seen in the Sandoz data:
 *   - AXISCN1304413427           (Swiggy / Axis NEFT)
 *   - CITIN26679282420           (Zomato / Citi NEFT)
 *   - YESF26134                  (Swiggy YES Bank IMPS)
 *   - HDFCR52026060165078625     (HDFC RTGS reference)
 *   - 609146045038               (PhonePe IMPS — 12 digit numeric)
 * Heuristic: pick the longest alpha-numeric token of length >=10 that
 * starts with letters OR a 12+ digit numeric token. Falls back to "".
 */
function extractUTR(narration: string): string {
  if (!narration) return "";
  const up = narration.toUpperCase();
  // Prefer prefixed alphanumeric refs (AXISCN, CITIN, YESF, HDFCR, INDR, etc.)
  const alpha = up.match(/\b[A-Z]{4,}[0-9A-Z]{6,}\b/g);
  if (alpha && alpha.length > 0) {
    return alpha.reduce((longest, cur) => cur.length > longest.length ? cur : longest, "");
  }
  // Otherwise look for a 12+ digit numeric reference (PhonePe IMPS UTRs)
  const num = up.match(/\b\d{12,}\b/g);
  if (num && num.length > 0) {
    return num.reduce((longest, cur) => cur.length > longest.length ? cur : longest, "");
  }
  return "";
}

/**
 * Build a structured "what's missing" report from a MatchResult. Used to
 * render Sheet 0a in the Excel export; mirrors the logic of the in-app
 * post-match diagnostic panel.
 */
type MissingTier = "action" | "workflow" | "manual";
type MissingItem = { tier: MissingTier; title: string; count: number; pct: number; amount: number; action: string };

function buildMissingReport(result: MatchResult): MissingItem[] {
  const byCat = new Map<string, { count: number; amount: number }>();
  for (const b of result.unmatchedBank) {
    const cur = byCat.get(b.category) ?? { count: 0, amount: 0 };
    cur.count++; cur.amount += b.absAmount;
    byCat.set(b.category, cur);
  }
  const total = result.stats.totalBank || 1;
  const pctOf = (n: number) => Math.round((n / total) * 1000) / 10;
  const items: MissingItem[] = [];

  const aggregator = (cat: string, brand: string, fileHint: string) => {
    const d = byCat.get(cat);
    if (!d || d.count === 0) return;
    items.push({
      tier: "action", title: `${brand} settlements (${cat})`,
      count: d.count, pct: pctOf(d.count), amount: round2(d.amount),
      action: `Upload the ${fileHint} covering the dates of these ${d.count} lines. The file likely doesn't span this window yet.`,
    });
  };
  aggregator("SWIGGY", "Swiggy", "Swiggy `consolidate-annexure-orders*.csv`");
  aggregator("ZOMATO", "Zomato", "Zomato `utr_report_mid*.csv`");
  aggregator("NEFT_OTHER", "Zomato/Swiggy under legal name (NEFT_OTHER)", "Zomato `utr_report_mid*.csv` or Swiggy CSV");
  aggregator("AMEX", "AmEx", "AmEx `Settlements*.csv` from the AmEx Merchant Statement export");
  aggregator("PHONEPE", "PhonePe", "PhonePe `*_FORWARD_TRANSACTION_*.csv`");

  const ic = byCat.get("INTERNAL_CR")?.count ?? 0;
  const id = byCat.get("INTERNAL_DR")?.count ?? 0;
  if (ic + id > 0) {
    const amt = (byCat.get("INTERNAL_CR")?.amount ?? 0) + (byCat.get("INTERNAL_DR")?.amount ?? 0);
    items.push({
      tier: "action", title: "Inter-outlet IB FUNDS TRANSFER / FT-CR/DR",
      count: ic + id, pct: pctOf(ic + id), amount: round2(amt),
      action: `Upload the BC bank ledger exports for the counterparty outlets into the "Other outlets' BC bank ledgers" dropzone. Sheet 3 column "Suggested Action" tells you which outlet each line points to.`,
    });
  }

  const cd = byCat.get("CASH_DEPOSIT");
  if (cd && cd.count > 0) {
    items.push({
      tier: "action", title: "Cash deposits",
      count: cd.count, pct: pctOf(cd.count), amount: round2(cd.amount),
      action: `Upload the BC Sales Invoices export with Payment Type column covering the date range of these deposits. If already uploaded, re-export with a wider date range.`,
    });
  }

  const vendor = byCat.get("VENDOR");
  if (vendor && vendor.count > 0) {
    items.push({
      tier: "action", title: "Vendor / Vendor Control TPT",
      count: vendor.count, pct: pctOf(vendor.count), amount: round2(vendor.amount),
      action: `Upload the BC Bank Account Ledger export for the BK Vendor Control account (HDFC412 in BC's bank account master).`,
    });
  }

  const cheque = byCat.get("CHEQUE");
  if (cheque && cheque.count > 0) {
    items.push({
      tier: "manual", title: "Cheques (CHQ PAID-CTS)",
      count: cheque.count, pct: pctOf(cheque.count), amount: round2(cheque.amount),
      action: `Cheques don't have a settlement file. Match manually against the corresponding vendor / staff payment voucher in BC.`,
    });
  }

  const other = byCat.get("OTHER");
  if (other && other.count > 0) {
    items.push({
      tier: "manual", title: "Other (RTGS, ACH, non-categorised)",
      count: other.count, pct: pctOf(other.count), amount: round2(other.amount),
      action: `Mixed bag — RTGS/NEFT vendor payments, ACH credits, non-HDFC originated transfers. Spot-check Sheet 3 for the dominant pattern; usually handled row-by-row.`,
    });
  }

  const neft = byCat.get("NEFT_OTHER");
  if (neft && neft.count > 0 && !items.some(i => i.title.includes("NEFT_OTHER"))) {
    items.push({
      tier: "manual", title: "NEFT/RTGS (generic)",
      count: neft.count, pct: pctOf(neft.count), amount: round2(neft.amount),
      action: `Mostly outgoing vendor RTGS or incoming non-aggregator NEFTs. Match manually against vendor / customer payment vouchers.`,
    });
  }

  const sal = byCat.get("SALARY");
  if (sal && sal.count > 0) {
    items.push({
      tier: "manual", title: "Salary",
      count: sal.count, pct: pctOf(sal.count), amount: round2(sal.amount),
      action: `Match manually against the salary disbursement voucher in BC.`,
    });
  }

  items.sort((a, b) => b.count - a.count);
  return items;
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function tierCount(matches: Match[], t: string): number {
  return matches.filter(m => m.tier === t).length;
}

function applyColWidths(sheet: XLSX.WorkSheet, widths: number[]) {
  sheet["!cols"] = widths.map(w => ({ wch: w }));
}

function shortenNarration(s: string): string {
  if (s.length <= 80) return s;
  return s.slice(0, 77) + "…";
}

function humanCategory(c: string): string {
  const map: Record<string, string> = {
    CARD_SETTLEMENT: "Card",
    SWIGGY: "Swiggy",
    ZOMATO: "Zomato",
    AMEX: "AmEx",
    DINEOUT: "Dineout",
    INTERNAL_CR: "Inter-outlet ↓",
    INTERNAL_DR: "Inter-outlet ↑",
    PHONEPE: "PhonePe",
    PAYTM: "Paytm",
    GPAY: "GPay",
    BHARATPE: "BharatPe",
    UPI: "UPI",
    SALARY: "Salary",
    VENDOR: "Vendor",
    NEFT_OTHER: "NEFT/RTGS",
    CHEQUE: "Cheque",
    CASH_DEPOSIT: "Cash deposit",
    INVOICE_PAYMENT: "Invoice",
    INTERNAL_TRANSFER: "Inter-acct",
    OTHER: "Other",
  };
  return map[c] ?? c;
}

/**
 * Reconstruct the full bank-statement line list (matched + unmatched, in date
 * order) so the accountant can use this sheet to import directly into BC.
 */
function collectStatementLines(result: MatchResult): { date: Date; narration: string; amount: number; direction: "Credit" | "Debit" }[] {
  const out: { date: Date; narration: string; amount: number; direction: "Credit" | "Debit" }[] = [];
  for (const m of result.matches) {
    out.push({ date: m.bankDate, narration: m.bankNarration, amount: m.bankAmount, direction: m.direction });
  }
  for (const b of result.unmatchedBank) {
    out.push({ date: b.date, narration: b.narration, amount: b.absAmount, direction: b.direction });
  }
  out.sort((a, b) => a.date.getTime() - b.date.getTime());
  return out;
}
