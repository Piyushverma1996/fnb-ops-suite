/** End-to-end: DBG outlet with Swiggy settlements integrated. */
import * as fs from "node:fs";
import * as XLSX from "xlsx";
import { runMatch, classifyBank, classifyBC, type BankEntry, type BCEntry, type SettlementInput } from "../src/lib/matcher.ts";
import { parseSwiggyText } from "../src/lib/settlement.ts";

const SWIGGY_DIR = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Aggregator settlement reports/Swiggy";
const BANK = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Bank Reco statements/DBG_6699-imp.xls";
const BC = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Bank account ledger entries/Bank Account Ledger Entries (13).xlsx";
const BRANCH = "DBG";
const FROM = "2026-04-01", TO = "2026-06-15";

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

// Load settlements
const settlements: SettlementInput[] = [];
for (const f of fs.readdirSync(SWIGGY_DIR).filter(x => x.endsWith(".csv"))) {
  const txt = fs.readFileSync(`${SWIGGY_DIR}/${f}`, "utf-8");
  settlements.push(...parseSwiggyText(txt, f));
}
console.log(`Loaded ${settlements.length} Swiggy settlements`);

const bank0 = parseBank(fs.readFileSync(BANK));
const bc0   = parseBC(fs.readFileSync(BC), BRANCH);
const [fy, fm, fd] = FROM.split("-").map(Number);
const [ty, tm, td] = TO.split("-").map(Number);
const from = new Date(fy, fm - 1, fd);
const to = new Date(ty, tm - 1, td, 23, 59, 59);
const bank = bank0.filter(b => b.date >= from && b.date <= to).map((b, i) => ({ ...b, id: i }));
const bc   = bc0.filter(c => c.postingDate >= from && c.postingDate <= to).map((c, i) => ({ ...c, id: i }));

console.log(`\n=== ${BRANCH} ${FROM} → ${TO} ===`);
const wo = runMatch(bank, bc, { dateToleranceDays: 5, amountTolerance: 1.0, maxComponents: 100 });
console.log(`WITHOUT settlements: ${wo.matches.length} matches, ${wo.stats.matchPct}% (${wo.unmatchedBank.length} unmatched bank, ${wo.unmatchedBC.length} unmatched BC)`);
const wi = runMatch(bank, bc, { dateToleranceDays: 5, amountTolerance: 1.0, maxComponents: 100, settlements });
console.log(`WITH settlements:    ${wi.matches.length} matches, ${wi.stats.matchPct}% (${wi.unmatchedBank.length} unmatched bank, ${wi.unmatchedBC.length} unmatched BC)`);
const t5 = wi.matches.filter(m => m.tier === "T5");
console.log(`\nT5 (settlement) matches added: ${t5.length}`);
t5.forEach((m, i) => {
  const s = m.settlement!;
  const gap = m.bankAmount - s.netPayout;
  console.log(`\n#${i+1}  ${m.bankDate.toISOString().slice(0,10)}  Bank ₹${m.bankAmount.toFixed(2)}  vs Settle ₹${s.netPayout.toFixed(2)}  Δ ₹${gap.toFixed(2)}`);
  console.log(`     UTR ${s.utr}  ${s.orderCount} orders  RID ${s.rid}`);
  console.log(`     Gross ₹${s.grossSales.toFixed(2)}  Comm ₹${s.totalCommission.toFixed(2)}  GST ₹${s.totalGstFees.toFixed(2)}  TCS ₹${s.totalTcs.toFixed(2)}  TDS ₹${s.totalTds.toFixed(2)}`);
});
