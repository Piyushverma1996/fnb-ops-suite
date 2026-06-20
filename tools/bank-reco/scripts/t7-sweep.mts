/** Test T7 cross-outlet matching on DW with the new HDFC146 file. */
import * as fs from "node:fs";
import * as XLSX from "xlsx";
import { runMatch, classifyBank, classifyBC, type BankEntry, type BCEntry, type SettlementInput } from "../src/lib/matcher.ts";
import { parseSwiggyText, parseZomatoUtrText } from "../src/lib/settlement.ts";

function parseDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) {
    const r = Math.round(v.getTime() / 86400000) * 86400000;
    const u = new Date(r);
    const d = new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
    return d.getFullYear() >= 2020 && d.getFullYear() <= 2030 ? d : null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { const d=+m[1], mo=+m[2]-1; let y=+m[3]; if (y<100) y+=2000; const dt=new Date(y,mo,d); return dt.getFullYear()>=2020&&dt.getFullYear()<=2030?dt:null; }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) { const dt=new Date(+m[1],+m[2]-1,+m[3]); return dt.getFullYear()>=2020&&dt.getFullYear()<=2030?dt:null; }
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
    const d = parseDate(ds);
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
function parseBCSplit(buf: Buffer, br: string): { primary: BCEntry[]; cross: BCEntry[] } {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null });
  const primary: BCEntry[] = []; const cross: BCEntry[] = []; let pid = 0; let cid = 0;
  for (const row of rows) {
    const d = parseDate(row["Posting Date"]);
    if (!d) continue;
    const bc = String(row["Branch Code"] ?? "").toUpperCase().trim();
    const amount = toNum(row["Amount"]);
    if (amount === 0) continue;
    const description = String(row["Description"] ?? "");
    const isPrimary = bc === br.toUpperCase();
    const entry: BCEntry = { id: isPrimary ? pid++ : cid++, postingDate: d,
      documentType: String(row["Document Type"] ?? ""),
      documentNo: String(row["Document No."] ?? ""), description,
      branchCode: bc, amount, direction: amount > 0 ? "Credit" : "Debit",
      absAmount: round2(Math.abs(amount)), category: classifyBC(description) };
    if (isPrimary) primary.push(entry);
    else if (bc) cross.push(entry);
  }
  return { primary, cross };
}

// Load settlements once
const settlements: SettlementInput[] = [];
for (const f of fs.readdirSync("C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Aggregator settlement reports/Swiggy").filter(x => x.endsWith(".csv"))) {
  settlements.push(...parseSwiggyText(fs.readFileSync(`C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Aggregator settlement reports/Swiggy/${f}`, "utf-8"), f));
}
for (const f of fs.readdirSync("C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Aggregator settlement reports/Zomato").filter(x => x.startsWith("utr_report_") && x.endsWith(".csv"))) {
  settlements.push(...parseZomatoUtrText(fs.readFileSync(`C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Aggregator settlement reports/Zomato/${f}`, "utf-8"), f));
}

const bank0 = parseBank(fs.readFileSync("C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Bank Reco statements/DWK_9146-imp.xls"));
const { primary: bc0, cross: cross0 } = parseBCSplit(fs.readFileSync("C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/BC Clearing Ledgers/HDFC146 (DW).xlsx"), "DW");
// Also load every BC ledger file from the multi-branch folder — that's what
// the user would upload as "Other outlets' BC ledgers" in the UI.
const EXTRA_DIR = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Bank account ledger entries";
if (fs.existsSync(EXTRA_DIR)) {
  for (const f of fs.readdirSync(EXTRA_DIR).filter(x => x.endsWith(".xlsx"))) {
    const split = parseBCSplit(fs.readFileSync(`${EXTRA_DIR}/${f}`), "DW");
    cross0.push(...split.primary, ...split.cross);
  }
}
console.log(`Total cross-outlet pool after loading all BC files: ${cross0.length}`);
const from = new Date(2026, 3, 1), to = new Date(2026, 5, 15, 23, 59, 59);
const bank = bank0.filter(b => b.date >= from && b.date <= to).map((b, i) => ({ ...b, id: i }));
const bc = bc0.filter(c => c.postingDate >= from && c.postingDate <= to).map((c, i) => ({ ...c, id: i }));
const cross = cross0.filter(c => c.postingDate >= from && c.postingDate <= to).map((c, i) => ({ ...c, id: i }));

console.log(`Primary BC (DW): ${bc.length}, Cross-outlet BC: ${cross.length}`);
console.log(`Cross branches: ${[...new Set(cross.map(c => c.branchCode))].sort().join(", ")}`);

const r1 = runMatch(bank, bc, { dateToleranceDays: 2, amountTolerance: 1.0, maxComponents: 100, settlements });
console.log(`\nWITHOUT T7: ${r1.matches.length} matches, ${r1.stats.matchPct}%`);
const r2 = runMatch(bank, bc, { dateToleranceDays: 2, amountTolerance: 1.0, maxComponents: 100, settlements, crossOutletBC: cross });
console.log(`WITH T7:    ${r2.matches.length} matches, ${r2.stats.matchPct}%`);
const t7 = r2.matches.filter(m => m.tier === "T7");
console.log(`\nT7 matches: ${t7.length}`);
t7.slice(0, 12).forEach((m, i) => {
  const x = m.crossOutlet!;
  console.log(`  #${i+1}  ${m.bankDate.toISOString().slice(0,10)}  ₹${m.bankAmount.toFixed(2).padStart(10)}  ${m.direction === "Credit" ? "from" : "to"} ${x.counterpartyOutlet}  voucher ${x.counterpartyDocNo}`);
});
