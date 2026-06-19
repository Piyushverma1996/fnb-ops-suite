/** Test settlement match with multi-RID UTR aggregation. */
import * as fs from "node:fs";
import * as XLSX from "xlsx";
import { classifyBank, type BankEntry, type SettlementInput, runMatch, classifyBC, type BCEntry } from "../src/lib/matcher.ts";
import { parseSwiggyText } from "../src/lib/settlement.ts";

const SWIGGY_DIR = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Aggregator settlement reports/Swiggy";
const BANK_DIR = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Bank Reco statements";
const BC_DW = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Bank Account Ledger Entries - DW.xlsx";

const settlements: SettlementInput[] = [];
for (const f of fs.readdirSync(SWIGGY_DIR).filter(x => x.endsWith(".csv"))) {
  const txt = fs.readFileSync(`${SWIGGY_DIR}/${f}`, "utf-8");
  settlements.push(...parseSwiggyText(txt, f));
}

// Group by UTR (across RIDs)
const byUtr = new Map<string, SettlementInput[]>();
for (const s of settlements) {
  if (!byUtr.has(s.utr)) byUtr.set(s.utr, []);
  byUtr.get(s.utr)!.push(s);
}
console.log(`${byUtr.size} unique UTRs, ${[...byUtr.values()].filter(g => g.length > 1).length} with multiple RIDs`);
[...byUtr.entries()].filter(([, g]) => g.length > 1).slice(0, 5).forEach(([u, g]) =>
  console.log(`  UTR ${u}: ${g.length} RIDs, total net = ₹${g.reduce((t, s) => t + s.netPayout, 0).toFixed(2)}`)
);

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

// Test full run on DW Apr 1 - Jun 15
const bank = parseBank(fs.readFileSync(`${BANK_DIR}/DWK_9146-imp.xls`));
const bc = parseBC(fs.readFileSync(BC_DW), "DW");
const from = new Date(2026, 3, 1), to = new Date(2026, 5, 15, 23, 59, 59);
const bankF = bank.filter(b => b.date >= from && b.date <= to).map((b, i) => ({ ...b, id: i }));
const bcF = bc.filter(c => c.postingDate >= from && c.postingDate <= to).map((c, i) => ({ ...c, id: i }));

console.log("\n=== DW Apr 1 → Jun 15 ===");
const wo = runMatch(bankF, bcF, { dateToleranceDays: 5, amountTolerance: 1.0, maxComponents: 100 });
console.log(`WITHOUT settlements: ${wo.matches.length} matches, ${wo.stats.matchPct}%`);

// Find any bank line (matched or not) where the UTR substring is in narration
console.log("\nAll bank lines with a parsed-settlement UTR in narration:");
const allHits: { b: BankEntry; matched: boolean; utr: string; settleNet: number }[] = [];
for (const b of bankF) {
  for (const s of settlements) {
    if (s.utr.length >= 6 && b.narration.toUpperCase().includes(s.utr.toUpperCase())) {
      const matched = wo.matches.some(m => m.bankId === b.id);
      allHits.push({ b, matched, utr: s.utr, settleNet: s.netPayout });
      break;
    }
  }
}
console.log(`Total bank lines with UTR substring: ${allHits.length}`);
console.log(`  → already matched by T1-T4: ${allHits.filter(h => h.matched).length}`);
console.log(`  → unmatched (T5 candidates): ${allHits.filter(h => !h.matched).length}`);
allHits.slice(0, 5).forEach(h => {
  const tag = h.matched ? "MATCHED" : "UNMATCHED";
  console.log(`  ${tag.padEnd(10)} ${h.b.date.toISOString().slice(0,10)}  ₹${h.b.absAmount.toFixed(2).padStart(12)} vs settle ₹${h.settleNet.toFixed(2)}  utr=${h.utr}`);
});

console.log("\nUnmatched bank lines with Swiggy in narration:");
const swiggyUnmatched = wo.unmatchedBank.filter(b => {
  const u = b.narration.toUpperCase();
  return u.includes("SWIGGY") || u.includes("BUNDL TECHNOLOGIES");
});
swiggyUnmatched.forEach(b => {
  // Find UTRs in narration
  const hits = settlements.filter(s => b.narration.toUpperCase().includes(s.utr.toUpperCase()));
  const hint = hits.length ? `→ ${hits.length} settlement(s): ${hits.map(s => `${s.utr}=₹${s.netPayout}`).join(", ")}` : "(no UTR match)";
  console.log(`  ${b.date.toISOString().slice(0,10)}  ₹${b.absAmount.toFixed(2)}  ${b.narration.slice(0, 80)} ${hint}`);
});

const wi = runMatch(bankF, bcF, { dateToleranceDays: 5, amountTolerance: 1.0, maxComponents: 100, settlements });
console.log(`\nWITH settlements:    ${wi.matches.length} matches, ${wi.stats.matchPct}%`);
const t5 = wi.matches.filter(m => m.tier === "T5");
console.log(`T5 (settlement) matches: ${t5.length}`);
t5.slice(0, 5).forEach(m => {
  console.log(`  ${m.bankDate.toISOString().slice(0,10)}  ₹${m.bankAmount.toFixed(2).padStart(12)}  ${m.tierLabel}`);
  if (m.settlement) console.log(`    Gross ₹${m.settlement.grossSales.toFixed(2)}  Comm ₹${m.settlement.totalCommission.toFixed(2)}  ${m.settlement.orderCount} orders  RID ${m.settlement.rid}`);
});
