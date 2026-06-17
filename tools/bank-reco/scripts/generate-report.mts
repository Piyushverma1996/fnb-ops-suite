/** Generate a sample report from CLI (mirrors what the browser produces). */
import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";
import { runMatch, classifyBank, classifyBC, type BankEntry, type BCEntry, type Match, type MatchResult } from "../src/lib/matcher.ts";

const [, , bankPath, bcPath, branch, fromStr, toStr] = process.argv;

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

const [fy, fm, fd] = fromStr.split("-").map(Number);
const [ty, tm, td] = toStr.split("-").map(Number);
const from = new Date(fy, fm - 1, fd);
const to = new Date(ty, tm - 1, td, 23, 59, 59);
const bank0 = parseBank(fs.readFileSync(path.resolve(bankPath)));
const bc0   = parseBC(fs.readFileSync(path.resolve(bcPath)), branch);
const bank = bank0.filter(b => b.date >= from && b.date <= to).map((b, i) => ({ ...b, id: i }));
const bc   = bc0.filter(c => c.postingDate >= from && c.postingDate <= to).map((c, i) => ({ ...c, id: i }));
const result = runMatch(bank, bc, { dateToleranceDays: 2, amountTolerance: 1.0, maxComponents: 15 });

// Replicate export.ts logic without saveAs (which is browser-only)
const wb = XLSX.utils.book_new();
const ordered = [...result.matches].sort((a, b) => {
  const t = a.bankDate.getTime() - b.bankDate.getTime();
  if (t !== 0) return t;
  return b.bankAmount - a.bankAmount;
});
function fmt(d: Date): string { return d.toISOString().slice(0, 10); }
function human(c: string): string {
  const map: Record<string, string> = { CARD_SETTLEMENT: "Card", SWIGGY: "Swiggy", ZOMATO: "Zomato",
    INTERNAL_CR: "Inter-outlet ↓", INTERNAL_DR: "Inter-outlet ↑", NEFT_OTHER: "NEFT/RTGS",
    INVOICE_PAYMENT: "Invoice", INTERNAL_TRANSFER: "Inter-acct", OTHER: "Other" };
  return map[c] ?? c;
}
const ap = ordered.map((m, i) => ({
  "#": i + 1, "Done": "", "Date": fmt(m.bankDate), "Bank Amount": m.bankAmount,
  "Dir": m.direction === "Credit" ? "CR" : "DR", "Tier": m.tier,
  "BC Doc(s) to Apply": m.bcDocs, "Type": human(m.category),
  "Bank line (for reference)": m.bankNarration.length > 80 ? m.bankNarration.slice(0,77)+"…" : m.bankNarration,
}));
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ap), "1 Action Plan");

// Stmt import
const stmtLines = [
  ...result.matches.map(m => ({ d: m.bankDate, n: m.bankNarration, a: m.bankAmount, dir: m.direction })),
  ...result.unmatchedBank.map(b => ({ d: b.date, n: b.narration, a: b.absAmount, dir: b.direction })),
].sort((a, b) => a.d.getTime() - b.d.getTime());
const stmt = stmtLines.map(l => ({ "Transaction Date": fmt(l.d), "Description": l.n,
  "Statement Amount": l.dir === "Credit" ? l.a : -l.a }));
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stmt), "2 BC Stmt Import");

const outFile = `scripts/sample_report_${branch}_${fromStr}_${toStr}.xlsx`;
XLSX.writeFile(wb, outFile);
console.log(`Wrote ${outFile}`);
console.log(`  ${ap.length} action items, ${stmt.length} stmt import lines`);
