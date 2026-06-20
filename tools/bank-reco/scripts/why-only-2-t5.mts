/**
 * Why only 2 T5 matches on DW? Look at the unmatched Swiggy/Zomato bank
 * lines and check whether their UTRs are in our settlement files.
 */
import * as fs from "node:fs";
import * as XLSX from "xlsx";
import { classifyBank, classifyBC, type BankEntry, type BCEntry, runMatch, type SettlementInput } from "../src/lib/matcher.ts";
import { parseSwiggyText, parseZomatoUtrText } from "../src/lib/settlement.ts";

const SWIGGY_DIR = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Aggregator settlement reports/Swiggy";
const ZOMATO_DIR = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Aggregator settlement reports/Zomato";

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
function parseBC(buf: Buffer, br: string): BCEntry[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null });
  const out: BCEntry[] = []; let id = 0;
  for (const row of rows) {
    const d = parseDate(row["Posting Date"]);
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
  settlements.push(...parseSwiggyText(fs.readFileSync(`${SWIGGY_DIR}/${f}`, "utf-8"), f));
}
for (const f of fs.readdirSync(ZOMATO_DIR).filter(x => x.startsWith("utr_report_") && x.endsWith(".csv"))) {
  settlements.push(...parseZomatoUtrText(fs.readFileSync(`${ZOMATO_DIR}/${f}`, "utf-8"), f));
}
const utrSet = new Set(settlements.map(s => s.utr));
const ridSet = new Set(settlements.map(s => s.rid));
console.log(`Loaded ${settlements.length} settlements, ${utrSet.size} unique UTRs, ${ridSet.size} unique RIDs`);
console.log(`RIDs in our files: ${[...ridSet].sort().join(", ")}`);

const bank = parseBank(fs.readFileSync("C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Bank Reco statements/DWK_9146-imp.xls"));
const bc = parseBC(fs.readFileSync("C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/BC Clearing Ledgers/HDFC146 (DW).xlsx"), "DW");
const from = new Date(2026, 3, 1), to = new Date(2026, 5, 15, 23, 59, 59);
const bankF = bank.filter(b => b.date >= from && b.date <= to).map((b, i) => ({ ...b, id: i }));
const bcF = bc.filter(c => c.postingDate >= from && c.postingDate <= to).map((c, i) => ({ ...c, id: i }));

const r = runMatch(bankF, bcF, { dateToleranceDays: 2, amountTolerance: 1.0, maxComponents: 100, settlements });
console.log(`\nResult: ${r.matches.length} matches, ${r.stats.matchPct}%`);
const t5 = r.matches.filter(m => m.tier === "T5");
console.log(`T5 matches: ${t5.length}`);
t5.forEach(m => console.log(`  ${m.bankDate.toISOString().slice(0,10)} ₹${m.bankAmount} ${m.settlement?.aggregator} UTR ${m.settlement?.utr} RID ${m.settlement?.rid}`));

// Now look at unmatched bank lines that LOOK like Swiggy/Zomato but didn't match
console.log("\n=== Unmatched bank lines that mention SWIGGY/ZOMATO/BUNDL/ETERNAL ===");
const unmatchedAggregator = r.unmatchedBank.filter(b => {
  const n = b.narration.toUpperCase();
  return n.includes("SWIGGY") || n.includes("ZOMATO") || n.includes("BUNDL TECHNOLOGIES") || n.includes("ETERNAL LIMITED");
});
console.log(`Found ${unmatchedAggregator.length} unmatched aggregator-shaped bank lines:`);
unmatchedAggregator.forEach(b => {
  // Extract UTR from narration
  const m = b.narration.match(/(AXISCN[0-9A-Z]+|CITIN[0-9A-Z]+|YESF[0-9A-Z]+|[A-Z]{4,}[0-9]{8,})/i);
  const utrInNarration = m?.[1];
  const inOurFiles = utrInNarration ? utrSet.has(utrInNarration) : false;
  console.log(`  ${b.date.toISOString().slice(0,10)} ₹${b.absAmount.toFixed(2).padStart(10)}  UTR-in-narration=${utrInNarration ?? "(none found)"}  in-our-settlement-files=${inOurFiles ? "YES" : "NO"}`);
  console.log(`    "${b.narration.slice(0, 90)}"`);
});

// Diagnostic: Zomato RIDs hitting DW account
console.log("\n=== Zomato RIDs that paid into DW (from matched + unmatched UTRs that appear in DW bank file) ===");
const dwZomatoRids = new Set<string>();
for (const b of bankF) {
  const m = b.narration.match(/CITIN[0-9A-Z]+/i);
  if (!m) continue;
  const matchedSettlement = settlements.find(s => s.utr === m[0]);
  if (matchedSettlement && matchedSettlement.aggregator === "ZOMATO") dwZomatoRids.add(matchedSettlement.rid);
}
console.log(`Distinct Zomato RIDs from DW bank narrations: ${[...dwZomatoRids].join(", ")}`);
