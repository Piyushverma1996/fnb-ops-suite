/** Reproduce the user's setup: DWK_9146 bank + HDFC146 (DW) BC. */
import * as fs from "node:fs";
import * as XLSX from "xlsx";
import { runMatch, classifyBank, classifyBC, type BankEntry, type BCEntry } from "../src/lib/matcher.ts";

function parseDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) {
    const r = Math.round(v.getTime() / 86400000) * 86400000;
    const u = new Date(r);
    return saneOrNull(new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()));
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { const d=+m[1], mo=+m[2]-1; let y=+m[3]; if (y<100) y+=2000; return saneOrNull(new Date(y, mo, d)); }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return saneOrNull(new Date(+m[1], +m[2]-1, +m[3]));
  m = s.match(/^(\d{1,2})[\-\s]+([A-Za-z]{3,})[\-\s]+(\d{4})$/);
  if (m) {
    const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    const mi = months.indexOf(m[2].slice(0, 3).toUpperCase());
    if (mi >= 0) return saneOrNull(new Date(+m[3], mi, +m[1]));
  }
  return null;
}
function saneOrNull(d: Date | null): Date | null {
  if (!d) return null;
  const y = d.getFullYear();
  if (y < 2020 || y > 2030) return null;
  return d;
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
  const out: BankEntry[] = []; let id = 0; let rejected = 0;
  for (let i = hdr + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (!r[0]) continue;
    const ds = String(r[0]).trim();
    if (ds.includes("*") || ds.toLowerCase().includes("statement")) continue;
    const d = parseDate(ds);
    if (!d) { rejected++; continue; }
    const narration = String(r[1] || "").trim();
    const debit = toNum(r[4]), credit = toNum(r[5]), balance = toNum(r[6]);
    const amount = credit - debit;
    if (debit === 0 && credit === 0) continue;
    out.push({ id: id++, date: d, narration, debit, credit, balance, amount,
      direction: amount > 0 ? "Credit" : "Debit", absAmount: round2(Math.abs(amount)),
      category: classifyBank(narration) });
  }
  console.log(`Bank parsed: ${out.length} entries, ${rejected} rejected (bad date)`);
  return out;
}

function parseBC(buf: Buffer, br: string): BCEntry[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null });
  const out: BCEntry[] = []; let id = 0;
  const branches = new Set<string>();
  for (const row of rows) {
    const d = parseDate(row["Posting Date"]);
    if (!d) continue;
    const bc = String(row["Branch Code"] ?? "").toUpperCase().trim();
    if (bc) branches.add(bc);
    if (br && bc !== br.toUpperCase()) continue;
    const amount = toNum(row["Amount"]);
    if (amount === 0) continue;
    out.push({ id: id++, postingDate: d, documentType: String(row["Document Type"] ?? ""),
      documentNo: String(row["Document No."] ?? ""), description: String(row["Description"] ?? ""),
      branchCode: bc, amount, direction: amount > 0 ? "Credit" : "Debit",
      absAmount: round2(Math.abs(amount)), category: classifyBC(String(row["Description"] ?? "")) });
  }
  console.log(`BC parsed for branch ${br}: ${out.length} entries. All branches in file: ${[...branches].join(", ")}`);
  return out;
}

const bank0 = parseBank(fs.readFileSync("C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Bank Reco statements/DWK_9146-imp.xls"));
const bc0 = parseBC(fs.readFileSync("C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/BC Clearing Ledgers/HDFC146 (DW).xlsx"), "DW");

const dateMin = bank0.reduce((m, b) => b.date < m ? b.date : m, bank0[0].date);
const dateMax = bank0.reduce((m, b) => b.date > m ? b.date : m, bank0[0].date);
console.log(`Bank date range: ${dateMin.toISOString().slice(0,10)} → ${dateMax.toISOString().slice(0,10)}`);

const from = new Date(2026, 3, 1);
const to = new Date(2026, 5, 15, 23, 59, 59);
const bank = bank0.filter(b => b.date >= from && b.date <= to).map((b, i) => ({ ...b, id: i }));
const bc = bc0.filter(c => c.postingDate >= from && c.postingDate <= to).map((c, i) => ({ ...c, id: i }));
console.log(`\nAfter Apr 1 → Jun 15 filter: bank=${bank.length}, bc=${bc.length}`);

const r = runMatch(bank, bc, { dateToleranceDays: 2, amountTolerance: 1.0, maxComponents: 100 });
console.log(`Result: ${r.matches.length} matches, ${r.stats.matchPct}% (${r.unmatchedBank.length} unmatched bank, ${r.unmatchedBC.length} unmatched BC)`);

// Categorise unmatched bank
const unmatchedCat = new Map<string, number>();
for (const b of r.unmatchedBank) unmatchedCat.set(b.category, (unmatchedCat.get(b.category) ?? 0) + 1);
console.log("\nUnmatched bank by category (what would lift match% if SI/settlement provided):");
[...unmatchedCat.entries()].sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(`  ${c.padEnd(16)} ${n}`));
