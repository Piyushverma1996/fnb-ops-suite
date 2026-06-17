/**
 * Excel export utility for the reconciliation report.
 */
import * as XLSX from "xlsx";
import type { MatchResult } from "./matcher";
import { saveAs } from "file-saver";

export function downloadReport(result: MatchResult, outletCode: string, dateFrom: string, dateTo: string) {
  const wb = XLSX.utils.book_new();

  // Summary
  const summaryRows = result.summary.map(s => ({
    Date: s.date,
    "Bank Entries": s.bankEntries,
    "BC Entries": s.bcEntries,
    "Matched (Bank)": s.matched,
    "Unmatched Bank": s.unmatchedBank,
    "Unmatched BC": s.unmatchedBC,
    "Match %": s.matchPct,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "Summary");

  // Matched
  const matchedRows = result.matches.map(m => ({
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
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(matchedRows), "Matched");

  // Unmatched Bank
  const ubRows = result.unmatchedBank.map(b => ({
    "Date": fmtDate(b.date),
    "Narration": b.narration,
    "Direction": b.direction,
    "Amount": b.absAmount,
    "Category": b.category,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ubRows), "Unmatched Bank");

  // Unmatched BC
  const ucRows = result.unmatchedBC.map(c => ({
    "Posting Date": fmtDate(c.postingDate),
    "Doc No.": c.documentNo,
    "Description": c.description,
    "Direction": c.direction,
    "Amount": c.absAmount,
    "Category": c.category,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ucRows), "Unmatched BC");

  // BC Match Guide
  const guideRows = result.matches.map(m => ({
    "Bank Date": fmtDate(m.bankDate),
    "Bank Statement Description": m.bankNarration,
    "Bank Amount": m.bankAmount,
    "Match Tier": m.tierLabel,
    "BC Docs to Match (tick these)": m.bcDocs,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(guideRows), "BC Match Guide");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  saveAs(blob, `BankReco_${outletCode}_${dateFrom}_${dateTo}.xlsx`);
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
