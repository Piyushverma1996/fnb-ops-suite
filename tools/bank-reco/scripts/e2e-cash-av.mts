/** End-to-end test: AV with cash deposits + SI file. */
import * as fs from "node:fs";
import * as XLSX from "xlsx";
import { runMatch, classifyBank, classifyBC, type BankEntry, type BCEntry, type SettlementInput, type CashInvoiceInput } from "../src/lib/matcher.ts";
import { parseSwiggyText, parseZomatoUtrText } from "../src/lib/settlement.ts";
import { parseSalesInvoicesBuffer } from "../src/lib/sales-invoices.ts";

const SWIGGY_DIR = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Aggregator settlement reports/Swiggy";
const ZOMATO_DIR = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Aggregator settlement reports/Zomato";
const SI_FILE = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Sales Invoices (61).xlsx";

function fixDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) {
    const r = Math.round(v.getTime() / 86400000) * 86400000;
    const u = new Date(r);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { const d=+m[1], mo=+m[2]-1; let y=+m[3]; if (y<100) y+=2000; return new Date(y, mo, d); }
  return null;
}
const toNum = (v: unknown) => typeof v === "number" ? v : Number(String(v ?? "0").replace(/,/g, "")) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;

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

// Settlements
const settlements: SettlementInput[] = [];
for (const f of fs.readdirSync(SWIGGY_DIR).filter(x => x.endsWith(".csv"))) {
  settlements.push(...parseSwiggyText(fs.readFileSync(`${SWIGGY_DIR}/${f}`, "utf-8"), f));
}
for (const f of fs.readdirSync(ZOMATO_DIR).filter(x => x.startsWith("utr_report_") && x.endsWith(".csv"))) {
  settlements.push(...parseZomatoUtrText(fs.readFileSync(`${ZOMATO_DIR}/${f}`, "utf-8"), f));
}
console.log(`Loaded ${settlements.length} settlements`);

// SI cash invoices
const siBuf = fs.readFileSync(SI_FILE);
const allSI = parseSalesInvoicesBuffer(siBuf.buffer.slice(siBuf.byteOffset, siBuf.byteOffset + siBuf.byteLength) as ArrayBuffer);
const cashInvoices: CashInvoiceInput[] = allSI
  .filter(x => x.paymentType.toUpperCase() === "CASH")
  .map(x => ({ docNo: x.docNo, postingDate: x.postingDate, locationCode: x.locationCode, grossTotal: x.grossTotal }));
console.log(`Loaded ${cashInvoices.length} cash SIs (total ₹${cashInvoices.reduce((t, c) => t + c.grossTotal, 0).toFixed(2)})`);

const bank = parseBank(fs.readFileSync("C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Bank Reco statements/AV_2574-imp.xls"));
const bc = parseBC(fs.readFileSync("C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Bank account ledger entries/Bank Account Ledger Entries (11).xlsx"), "AV");
const from = new Date(2026, 3, 1), to = new Date(2026, 5, 15, 23, 59, 59);
const bankF = bank.filter(b => b.date >= from && b.date <= to).map((b, i) => ({ ...b, id: i }));
const bcF = bc.filter(c => c.postingDate >= from && c.postingDate <= to).map((c, i) => ({ ...c, id: i }));

console.log("\n=== AV Apr 1 → Jun 15 ===");
const wo = runMatch(bankF, bcF, { dateToleranceDays: 2, amountTolerance: 1.0, maxComponents: 100, settlements });
console.log(`WITHOUT cash SI: ${wo.matches.length} matches, ${wo.stats.matchPct}%`);
const wi = runMatch(bankF, bcF, { dateToleranceDays: 2, amountTolerance: 1.0, maxComponents: 100, settlements, cashInvoices, outletCode: "AV" });
console.log(`WITH cash SI:    ${wi.matches.length} matches, ${wi.stats.matchPct}%`);
const t6 = wi.matches.filter(m => m.tier === "T6");
console.log(`\nT6 (cash deposit) matches: ${t6.length}`);
t6.forEach((m, i) => {
  const c = m.cashBucket!;
  console.log(`#${i+1}  ${m.bankDate.toISOString().slice(0,10)}  bank ₹${m.bankAmount.toFixed(2).padStart(10)}  ←→  ${c.invoiceCount} cash bills from ${c.invoiceDate} totaling ₹${c.bucketTotal.toFixed(2)}  Δ ₹${(m.bankAmount - c.bucketTotal).toFixed(2)}`);
});
