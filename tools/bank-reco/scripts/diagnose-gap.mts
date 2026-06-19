/** Run matcher and dump diagnostic info on what's unmatched and why. */
import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";
import { runMatch, classifyBank, classifyBC, type BankEntry, type BCEntry } from "../src/lib/matcher.ts";

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
const result = runMatch(bank, bc, { dateToleranceDays: 5, amountTolerance: 1.0, maxComponents: 100 });

console.log(`Stats: ${JSON.stringify(result.stats)}`);

// Unmatched bank by category
const ubCat = new Map<string, { count: number; total: number; samples: string[] }>();
for (const b of result.unmatchedBank) {
  const cur = ubCat.get(b.category) ?? { count: 0, total: 0, samples: [] };
  cur.count++; cur.total += b.absAmount;
  if (cur.samples.length < 2) cur.samples.push(`₹${b.absAmount.toFixed(2)} | ${b.narration.slice(0, 60)}`);
  ubCat.set(b.category, cur);
}
console.log(`\nUnmatched bank (${result.unmatchedBank.length}) by category:`);
[...ubCat.entries()].sort((a, b) => b[1].count - a[1].count).forEach(([c, v]) =>
  console.log(`  ${c.padEnd(16)} ${String(v.count).padStart(4)} entries  ₹${v.total.toFixed(2).padStart(13)}  ${v.samples[0]}`),
);

// Unmatched BC by doc prefix
const ucPrefix = new Map<string, { count: number; total: number; cat: string }>();
for (const c of result.unmatchedBC) {
  const m = c.documentNo.match(/^([A-Z]+)/i);
  const p = m ? m[1].toUpperCase() : "?";
  const cur = ucPrefix.get(p) ?? { count: 0, total: 0, cat: c.category };
  cur.count++; cur.total += c.absAmount;
  ucPrefix.set(p, cur);
}
console.log(`\nUnmatched BC (${result.unmatchedBC.length}) by doc prefix:`);
[...ucPrefix.entries()].sort((a, b) => b[1].count - a[1].count).forEach(([p, v]) =>
  console.log(`  ${p.padEnd(6)} ${String(v.count).padStart(4)} entries  ₹${v.total.toFixed(2).padStart(13)}  (mostly ${v.cat})`),
);

// Daily PP/* total vs nearest unmatched bank line
const ppByDate = new Map<string, number>();
for (const c of result.unmatchedBC) {
  if (!c.documentNo.startsWith("PP")) continue;
  const d = c.postingDate.toISOString().slice(0, 10);
  ppByDate.set(d, (ppByDate.get(d) ?? 0) + c.absAmount);
}
console.log("\nDaily PP/* unmatched totals (top 10):");
[...ppByDate.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([d, t]) => {
  // Find any unmatched bank line within ±2 days of this date with similar amount
  const dDate = new Date(d);
  const candidates = result.unmatchedBank.filter(b =>
    Math.abs(b.date.getTime() - dDate.getTime()) <= 2 * 86400000 &&
    Math.abs(b.absAmount - t) / Math.max(b.absAmount, t) < 0.1,
  );
  const hint = candidates.length ? `  → matches ${candidates.length} bank line(s) within 10% & ±2d` : "  (no near-amount bank line)";
  console.log(`  ${d}  ₹${t.toFixed(2).padStart(12)}${hint}`);
});
