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
import type { MatchResult, Match } from "./matcher";
import { saveAs } from "file-saver";

export function downloadReport(result: MatchResult, outletCode: string, dateFrom: string, dateTo: string) {
  const wb = XLSX.utils.book_new();

  // Sort matches chronologically with stable tie-break by amount
  const ordered = [...result.matches].sort((a, b) => {
    const t = a.bankDate.getTime() - b.bankDate.getTime();
    if (t !== 0) return t;
    return b.bankAmount - a.bankAmount;
  });

  // ───── Sheet 1: Action Plan ─────
  const actionPlanRows = ordered.map((m, i) => ({
    "#": i + 1,
    "Done": "",
    "Date": fmtDate(m.bankDate),
    "Bank Amount": m.bankAmount,
    "Dir": m.direction === "Credit" ? "CR" : "DR",
    "Tier": m.tier,
    "BC Doc(s) to Apply": m.bcDocs,
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
    .map((b, i) => ({
      "#": i + 1,
      "Done": "",
      "Date": fmtDate(b.date),
      "Amount": b.absAmount,
      "Dir": b.direction === "Credit" ? "CR" : "DR",
      "Type": humanCategory(b.category),
      "Narration": b.narration,
      "Note": "",
    }));
  const sheet3 = XLSX.utils.json_to_sheet(ubRows);
  applyColWidths(sheet3, [4, 7, 11, 14, 5, 16, 70, 30]);
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
