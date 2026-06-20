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

  // ───── Sheet 0: How to Use ─────
  const howTo = [
    ["BANK RECONCILIATION — STEP BY STEP"],
    [`Outlet: ${outletCode}    Period: ${dateFrom} → ${dateTo}`],
    [],
    ["VALUES TO TYPE INTO BC RECONCILIATION HEADER"],
    ["Field", "Value"],
    ["Bank Account No.",           "(pick the HDFC account for this outlet)"],
    ["Statement No.",              "(next sequential, e.g. 04/26 for April 2026)"],
    ["Statement Date",             dateTo],
    ["Balance Last Statement",     openingBalance],
    ["Statement Ending Balance",   endingBalance],
    [],
    ["WORKFLOW"],
    ["#", "Step", "Where", "Time"],
    [1, "Open BC → Bank Acc. Reconciliations → New",                                "BC",      "10 sec"],
    [2, "Fill the 5 header fields above (see Sheet 5 Summary for daily detail)",    "BC",      "30 sec"],
    [3, "Click into the empty Bank Statement Lines grid (first row, first cell)",   "BC",      "5 sec"],
    [4, "Open Sheet 2 (BC Stmt Import), select rows 2 onwards (all data, NOT header)", "Excel", "5 sec"],
    [5, "Copy (Ctrl+C) → switch to BC → Paste (Ctrl+V) — grid fills automatically", "BC",      "10 sec"],
    [6, "Click Matching → Match Automatically. BC matches what it can.",            "BC",      "15 sec"],
    [7, "Open Sheet 1 (Action Plan) — these are matches BC's auto-match may miss",  "Excel",   "—"],
    [8, "For each row in Action Plan: in BC click that statement line → Matching → Match Manually → tick the BC Doc Nos listed → tick Done column in Excel", "Both", "~1 sec/row"],
    [9, "Sheet 3 (Unmatched Bank) → create new BR vouchers in BC for these",        "BC",      "varies"],
    [10, "Sheet 4 (Unmatched BC) → investigate (usually cross-month timing)",       "BC",      "varies"],
    [11, "When Total Difference = 0 → Post the reconciliation",                     "BC",      "5 sec"],
    [],
    ["TIPS"],
    ["·  T1 = 100% confidence (same date, same amount). Tick without checking."],
    ["·  T2 = many BC docs sum to one bank line (still 95%+ confidence)."],
    ["·  T3/T4 = date-tolerant. Quick sanity check before ticking."],
    ["·  The Done column is just for your tracking — Excel doesn't push back to BC."],
  ];
  const sheet0 = XLSX.utils.aoa_to_sheet(howTo);
  applyColWidths(sheet0, [6, 70, 12, 12]);
  XLSX.utils.book_append_sheet(wb, sheet0, "0 How to Use");

  // ───── Sheet 1: Action Plan ─────
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
        : m.bcDocs,
    "Type": humanCategory(m.category),
    "Bank line (for reference)": shortenNarration(m.bankNarration),
  }));
  const sheet1 = XLSX.utils.json_to_sheet(actionPlanRows);
  applyColWidths(sheet1, [4, 7, 11, 14, 5, 6, 50, 16, 60]);
  XLSX.utils.book_append_sheet(wb, sheet1, "1 Action Plan");

  // ───── Sheet 2: BC Bank Statement Import ─────
  // BC's "Suggest Lines" / "Import Bank Statement" feature accepts a flat list
  // of statement lines. Generating this means accountant can skip the manual
  // bank statement import step entirely.
  const stmtImportRows = collectStatementLines(result).map(l => ({
    "Transaction Date": fmtDate(l.date),
    "Description": l.narration,
    "Statement Amount": l.direction === "Credit" ? l.amount : -l.amount,
  }));
  const sheet2 = XLSX.utils.json_to_sheet(stmtImportRows);
  applyColWidths(sheet2, [14, 70, 16]);
  XLSX.utils.book_append_sheet(wb, sheet2, "2 BC Stmt Import");

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
  const sheet3 = XLSX.utils.json_to_sheet(ubRows);
  applyColWidths(sheet3, [4, 7, 11, 14, 5, 16, 60, 70, 30]);
  XLSX.utils.book_append_sheet(wb, sheet3, "3 Unmatched Bank");

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
  XLSX.utils.book_append_sheet(wb, sheet4, "4 Unmatched BC");

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
  XLSX.utils.book_append_sheet(wb, sheet5, "5 Summary");

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
    XLSX.utils.book_append_sheet(wb, s7, "7 Aggregator Settlements");
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
    XLSX.utils.book_append_sheet(wb, s8, "8 Cash Deposits");
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
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(allMatchedRows), "6 All Matches");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  saveAs(blob, `BankReco_${outletCode}_${dateFrom}_${dateTo}.xlsx`);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
