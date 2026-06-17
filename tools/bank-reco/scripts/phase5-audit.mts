/**
 * Phase 5: dump unmatched bank narrations grouped by classified category.
 * Helps identify missing classifier patterns.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";
import { runMatch, classifyBank, classifyBC, type BankEntry, type BCEntry } from "../src/lib/matcher.ts";

const SRC = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data";
const BANK_DIR = path.join(SRC, "Bank Reco statements");
const BC_DIR = path.join(SRC, "Bank account ledger entries");

const cases = [
  { outlet: "DW",  bank: "DWK_9146-imp.xls",   bc: "../Bank Account Ledger Entries - DW.xlsx" },
  { outlet: "AV",  bank: "AV_2574-imp.xls",    bc: "Bank Account Ledger Entries (11).xlsx" },
  { outlet: "JR",  bank: "JR_2160-imp.xls",    bc: "Bank Account Ledger Entries (4).xlsx" },
  { outlet: "RG",  bank: "RG_4189-imp.xls",    bc: "Bank Account Ledger Entries (5).xlsx" },
  { outlet: "DDB", bank: "DDB_2723-imp.xls",   bc: "Bank Account Ledger Entries (16).xlsx" },
];
const FROM = "2026-04-01", TO = "2026-04-05";

function fixDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) {
    const r = Math.round(v.getTime() / 86400000) * 86400000;
    const u = new Date(r);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { const d=+m[1], mo=+m[2]-1; let y=+m[3]; if (y<100) y+=2000; return new Date(y, mo, d); }
  return null;
}
function toNum(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}
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

const [fy, fm, fd] = FROM.split("-").map(Number);
const [ty, tm, td] = TO.split("-").map(Number);
const from = new Date(fy, fm - 1, fd);
const to = new Date(ty, tm - 1, td, 23, 59, 59);

const bankByCat: Record<string, { narration: string; amount: number; outlet: string }[]> = {};
for (const c of cases) {
  const bankPath = path.join(BANK_DIR, c.bank);
  const bcPath = c.bc.startsWith("..") ? path.join(SRC, c.bc.slice(3)) : path.join(BC_DIR, c.bc);
  const bank0 = parseBank(fs.readFileSync(bankPath));
  const bc0   = parseBC(fs.readFileSync(bcPath), c.outlet);
  const bank = bank0.filter(b => b.date >= from && b.date <= to).map((b, i) => ({ ...b, id: i }));
  const bc   = bc0.filter(x => x.postingDate >= from && x.postingDate <= to).map((x, i) => ({ ...x, id: i }));
  const r = runMatch(bank, bc, { dateToleranceDays: 2, amountTolerance: 1.0, maxComponents: 15 });
  for (const u of r.unmatchedBank) {
    (bankByCat[u.category] ??= []).push({ narration: u.narration, amount: u.absAmount, outlet: c.outlet });
  }
}
console.log("UNMATCHED BANK ENTRIES by category (across DW/AV/JR/RG/DDB, Apr 1-5):\n");
for (const cat of Object.keys(bankByCat).sort()) {
  console.log(`\n=== ${cat} (${bankByCat[cat].length}) ===`);
  bankByCat[cat].slice(0, 8).forEach(e => {
    const n = e.narration.length > 80 ? e.narration.slice(0,80)+"…" : e.narration;
    console.log(`  [${e.outlet}] ₹${e.amount.toFixed(2).padStart(10)}  ${n}`);
  });
  if (bankByCat[cat].length > 8) console.log(`  … +${bankByCat[cat].length - 8} more`);
}
