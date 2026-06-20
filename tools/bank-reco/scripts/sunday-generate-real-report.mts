/**
 * Generate a real-data Excel report for DW with all 4 inputs and audit
 * its structure: sheet names, row counts, column shape.
 */
import * as fs from "node:fs";
import * as XLSX from "xlsx";
import {
  runMatch, classifyBank, classifyBC,
  type BankEntry, type BCEntry, type SettlementInput, type CashInvoiceInput, type Match,
} from "../src/lib/matcher.ts";
import { parseSwiggyText, parseZomatoUtrText } from "../src/lib/settlement.ts";
import { parseSalesInvoicesBuffer } from "../src/lib/sales-invoices.ts";
import { outletForSwiggy, outletForZomato } from "../src/lib/rest-id-map.ts";
import { outletFromNarration } from "../src/lib/bank-account-map.ts";

const SRC = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data";

function fixDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) {
    const r = Math.round(v.getTime() / 86400000) * 86400000;
    const u = new Date(r);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  if (typeof v === "number") { const u = new Date((v - 25569) * 86400000); return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()); }
  const s = String(v).trim();
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m1) { const d=+m1[1], mo=+m1[2]-1; let y=+m1[3]; if (y<100) y+=2000; return new Date(y, mo, d); }
  const m2 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m2) return new Date(+m2[1], +m2[2]-1, +m2[3]);
  return null;
}
const toNum = (v: unknown) => typeof v === "number" ? v : Number(String(v ?? "0").replace(/,/g, "")) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;
function fmtDate(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }

function parseBank(buf: Buffer): BankEntry[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: null });
  let hdr = -1;
  for (let i = 0; i < Math.min(40, rows.length); i++) {
    const r = (rows[i] || []).map(c => (c == null ? "" : String(c).toUpperCase()));
    if (r.some(c => c.includes("DATE")) && r.some(c => c.includes("NARRATION") || c.includes("PARTICULAR"))) { hdr = i; break; }
  }
  if (hdr === -1) hdr = 21;
  const out: BankEntry[] = []; let id = 0;
  for (let i = hdr + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (!r[0]) continue;
    const ds = String(r[0]).trim();
    if (ds.includes("*") || ds.toLowerCase().includes("statement")) continue;
    const d = fixDate(ds);
    if (!d) continue;
    const narration = String(r[1] || "").trim();
    const debit = toNum(r[4]), credit = toNum(r[5]), balance = toNum(r[6]);
    const amount = credit - debit;
    if (debit === 0 && credit === 0) continue;
    out.push({ id: id++, date: d, narration, debit, credit, balance, amount,
      direction: amount > 0 ? "Credit" : "Debit", absAmount: round2(Math.abs(amount)),
      category: classifyBank(narration) });
  }
  return out;
}
function parseBC(buf: Buffer, br: string): BCEntry[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null });
  const out: BCEntry[] = []; let id = 0;
  for (const row of rows) {
    const d = fixDate(row["Posting Date"]);
    if (!d) continue;
    const bc = String(row["Branch Code"] ?? "").toUpperCase().trim();
    if (br && bc !== br.toUpperCase()) continue;
    const amount = toNum(row["Amount"]);
    if (amount === 0) continue;
    out.push({ id: id++, postingDate: d, documentType: String(row["Document Type"] ?? ""),
      documentNo: String(row["Document No."] ?? ""), description: String(row["Description"] ?? ""),
      branchCode: bc, amount, direction: amount > 0 ? "Credit" : "Debit",
      absAmount: round2(Math.abs(amount)), category: classifyBC(String(row["Description"] ?? "")) });
  }
  return out;
}

// Inline the export.ts logic (saveAs is browser-only)
function buildWorkbook(result: ReturnType<typeof runMatch>, outletCode: string, dateFrom: string, dateTo: string, bank: BankEntry[]) {
  const wb = XLSX.utils.book_new();
  const sorted = [...bank].sort((a, b) => a.date.getTime() - b.date.getTime());
  const first = sorted[0], last = sorted[sorted.length - 1];
  const openBal = first ? round2(first.balance - first.amount) : 0;
  const endBal = last ? round2(last.balance) : 0;
  const ordered = [...result.matches].sort((a, b) => {
    const t = a.bankDate.getTime() - b.bankDate.getTime();
    if (t !== 0) return t;
    return b.bankAmount - a.bankAmount;
  });

  // Sheet 0 — abbreviated
  const howTo = [
    ["BANK RECONCILIATION — STEP BY STEP"],
    [`Outlet: ${outletCode}    Period: ${dateFrom} → ${dateTo}`],
    [],
    ["BC HEADER VALUES"],
    ["Statement Date", dateTo],
    ["Balance Last Statement", openBal],
    ["Statement Ending Balance", endBal],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(howTo), "0 How to Use");

  // Sheet 1 — Action plan
  const action = ordered.map((m, i) => ({
    "#": i + 1, "Done": "", "Date": fmtDate(m.bankDate), "Bank Amount": m.bankAmount,
    "Dir": m.direction === "Credit" ? "CR" : "DR", "Tier": m.tier,
    "BC Doc(s) to Apply": m.tier === "T5" && m.settlement
      ? `Create BR voucher: Net ₹${m.settlement.netPayout.toFixed(2)} (${m.settlement.aggregator} UTR ${m.settlement.utr})`
      : m.tier === "T6" && m.cashBucket
      ? `Create cash deposit voucher: ${m.cashBucket.invoiceCount} cash bills from ${m.cashBucket.invoiceDate} totaling ₹${m.cashBucket.bucketTotal.toFixed(2)}`
      : m.bcDocs,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(action), "1 Action Plan");

  // Sheet 2 — Stmt import
  const stmtLines = [
    ...result.matches.map(m => ({ d: m.bankDate, n: m.bankNarration, a: m.bankAmount, dir: m.direction })),
    ...result.unmatchedBank.map(b => ({ d: b.date, n: b.narration, a: b.absAmount, dir: b.direction })),
  ].sort((a, b) => a.d.getTime() - b.d.getTime());
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stmtLines.map(l => ({
    "Transaction Date": fmtDate(l.d), "Description": l.n, "Statement Amount": l.dir === "Credit" ? l.a : -l.a,
  }))), "2 BC Stmt Import");

  // Sheet 3 — Unmatched Bank with suggestions
  const ub = result.unmatchedBank.slice().sort((a, b) => a.date.getTime() - b.date.getTime()).map((b, i) => {
    let suggestion = "";
    if (b.category === "INTERNAL_CR" || b.category === "INTERNAL_DR") {
      const other = outletFromNarration(b.narration);
      if (other) suggestion = b.category === "INTERNAL_CR"
        ? `Transfer from ${other} — check that outlet's BC ledger`
        : `Transfer to ${other} — check that outlet's BC ledger`;
    }
    return { "#": i + 1, "Date": fmtDate(b.date), "Amount": b.absAmount, "Dir": b.direction === "Credit" ? "CR" : "DR",
      "Type": b.category, "Suggested Action": suggestion, "Narration": b.narration };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ub), "3 Unmatched Bank");

  // Sheet 4 — Unmatched BC
  const uc = result.unmatchedBC.slice().sort((a, b) => a.postingDate.getTime() - b.postingDate.getTime()).map((c, i) => ({
    "#": i + 1, "Posting Date": fmtDate(c.postingDate), "Amount": c.absAmount,
    "Dir": c.direction === "Credit" ? "CR" : "DR", "Doc No.": c.documentNo,
    "Type": c.category, "Description": c.description,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(uc), "4 Unmatched BC");

  // Sheet 5 — Summary
  const stats = [
    ["Bank Reconciliation Report"],
    [`Outlet: ${outletCode}    Period: ${dateFrom} → ${dateTo}`],
    [],
    ["Bank Entries", result.stats.totalBank],
    ["BC Entries", result.stats.totalBC],
    ["Auto-Matched", result.stats.matchedBank],
    ["Match %", result.stats.matchPct + "%"],
    ["Balance Last Statement", openBal],
    ["Statement Ending Balance", endBal],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(stats), "5 Summary");

  // Sheet 6 — All matches
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ordered.map(m => ({
    "Bank Date": fmtDate(m.bankDate), "Bank Narration": m.bankNarration, "Direction": m.direction,
    "Bank Amount": m.bankAmount, "Match Tier": m.tierLabel, "Confidence %": m.confidence,
    "BC Sum Amount": m.bcSumAmount, "BC Doc Nos": m.bcDocs, "BC Descriptions": m.bcDescriptions, "Category": m.category,
  }))), "6 All Matches");

  // Sheet 7 — Aggregator T5
  const t5 = ordered.filter(m => m.tier === "T5" && m.settlement);
  if (t5.length > 0) {
    const t5Rows = t5.map((m, i) => {
      const s = m.settlement!;
      const outletNames = s.rid.split(",").map(r => r.trim()).map(r => {
        const o = s.aggregator === "SWIGGY" ? outletForSwiggy(r) : outletForZomato(r);
        return o?.outletName ?? `RID ${r}`;
      }).filter((v, idx, a) => a.indexOf(v) === idx).join("; ");
      return {
        "#": i + 1, "Bank Date": fmtDate(m.bankDate), "Bank Amount": m.bankAmount, "Aggregator": s.aggregator,
        "Outlet (via RID)": outletNames, "Bank UTR": s.utr,
        "Settlement Period": s.periodStart && s.periodEnd ? `${fmtDate(s.periodStart)} → ${fmtDate(s.periodEnd)}` : "",
        "Orders": s.orderCount,
        "Gross sales": s.grossSales, "Commission + fees": s.totalCommission,
        "GST on commission": s.totalGstFees, "TCS": s.totalTcs, "TDS": s.totalTds,
        "Net Payout": s.netPayout, "Δ vs Bank": round2(m.bankAmount - s.netPayout),
      };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(t5Rows), "7 Aggregator Settlements");
  }

  // Sheet 8 — Cash T6
  const t6 = ordered.filter(m => m.tier === "T6" && m.cashBucket);
  if (t6.length > 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(t6.map((m, i) => {
      const c = m.cashBucket!;
      return { "#": i + 1, "Bank Date": fmtDate(m.bankDate), "Bank Amount": m.bankAmount,
        "Cash Bills From": c.invoiceDate, "# Bills": c.invoiceCount, "Bucket Total": c.bucketTotal,
        "Δ vs Bank": round2(m.bankAmount - c.bucketTotal), "Outlet": c.outletCode,
        "Sample Doc Nos": c.invoiceDocs.slice(0, 5).join("; "), "Bank Narration": m.bankNarration,
      };
    })), "8 Cash Deposits");
  }
  return wb;
}

// Load all inputs
const settlements: SettlementInput[] = [];
for (const f of fs.readdirSync(`${SRC}/Aggregator settlement reports/Swiggy`).filter(x => x.endsWith(".csv"))) {
  settlements.push(...parseSwiggyText(fs.readFileSync(`${SRC}/Aggregator settlement reports/Swiggy/${f}`, "utf-8"), f));
}
for (const f of fs.readdirSync(`${SRC}/Aggregator settlement reports/Zomato`).filter(x => x.startsWith("utr_report_") && x.endsWith(".csv"))) {
  settlements.push(...parseZomatoUtrText(fs.readFileSync(`${SRC}/Aggregator settlement reports/Zomato/${f}`, "utf-8"), f));
}
const siBuf = fs.readFileSync(`${SRC}/Sales Invoices (61).xlsx`);
const allSI = parseSalesInvoicesBuffer(siBuf.buffer.slice(siBuf.byteOffset, siBuf.byteOffset + siBuf.byteLength) as ArrayBuffer);
const cashInvoices: CashInvoiceInput[] = allSI
  .filter(x => x.paymentType.toUpperCase() === "CASH")
  .map(x => ({ docNo: x.docNo, postingDate: x.postingDate, locationCode: x.locationCode, grossTotal: x.grossTotal }));

// Run on DBG (more T5 hits to validate)
const bank0 = parseBank(fs.readFileSync(`${SRC}/Bank Reco statements/DBG_6699-imp.xls`));
const bc0 = parseBC(fs.readFileSync(`${SRC}/Bank account ledger entries/Bank Account Ledger Entries (13).xlsx`), "DBG");
const FROM = "2026-04-01", TO = "2026-06-15";
const [fy, fm, fd] = FROM.split("-").map(Number);
const [ty, tm, td] = TO.split("-").map(Number);
const from = new Date(fy, fm-1, fd);
const to = new Date(ty, tm-1, td, 23, 59, 59);
const bank = bank0.filter(b => b.date >= from && b.date <= to).map((b, i) => ({ ...b, id: i }));
const bc = bc0.filter(c => c.postingDate >= from && c.postingDate <= to).map((c, i) => ({ ...c, id: i }));

const result = runMatch(bank, bc, {
  dateToleranceDays: 2, amountTolerance: 1.0, maxComponents: 100,
  settlements, cashInvoices, outletCode: "DBG",
});

const wb = buildWorkbook(result, "DBG", FROM, TO, bank);
const outPath = `scripts/sunday_real_report_DBG.xlsx`;
XLSX.writeFile(wb, outPath);
console.log(`Wrote ${outPath}`);
console.log(`  Sheets: ${wb.SheetNames.join(", ")}`);
console.log(`  Result: ${JSON.stringify(result.stats)}`);
console.log(`  Matches by tier: ${(["T1","T2","T3","T4","T5","T6"] as const).map(t => `${t}=${result.matches.filter((m: Match) => m.tier === t).length}`).join(", ")}`);
