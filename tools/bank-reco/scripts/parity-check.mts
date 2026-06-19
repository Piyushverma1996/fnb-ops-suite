/**
 * Phase 1 parity harness.
 *
 * Loads the same Excel files the Python reference loads, replicates the
 * browser-side parse using xlsx + Buffer (no File API in Node), then runs
 * the production TypeScript matcher and emits a canonical JSON snapshot
 * comparable to BankReco/reference_DW_Apr01_05.json.
 *
 * Run with:  node --experimental-strip-types scripts/parity-check.mts <bank.xls> <bc.xlsx> <BRANCH> <FROM> <TO>
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";
import {
  runMatch, classifyBank, classifyBC,
  type BankEntry, type BCEntry, type Match,
} from "../src/lib/matcher.ts";

const [, , bankPath, bcPath, branch, fromStr, toStr, outPath] = process.argv;
if (!bankPath || !bcPath || !branch || !fromStr || !toStr) {
  console.error("Usage: parity-check.mts <bank.xls> <bc.xlsx> <BRANCH> <FROM> <TO> [out.json]");
  process.exit(1);
}

function toNum(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/,/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function round2(n: number): number { return Math.round(n * 100) / 100; }
function parseDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) {
    const ms = v.getTime();
    const rounded = Math.round(ms / 86400000) * 86400000;
    const u = new Date(rounded);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = (v - 25569) * 86400000;
    const u = new Date(ms);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const d = +m[1], mo = +m[2] - 1;
    let y = +m[3]; if (y < 100) y += 2000;
    return new Date(y, mo, d);
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
}

function parseBank(buf: Buffer): BankEntry[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: null });
  let hdr = -1;
  for (let i = 0; i < Math.min(40, rows.length); i++) {
    const r = (rows[i] || []).map(c => (c == null ? "" : String(c).toUpperCase()));
    const hasDate = r.some(c => c.includes("DATE"));
    const hasNarr = r.some(c => c.includes("NARRATION") || c.includes("PARTICULAR"));
    if (hasDate && hasNarr) { hdr = i; break; }
  }
  if (hdr === -1) hdr = 21;
  const out: BankEntry[] = [];
  let id = 0;
  for (let i = hdr + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (!r[0]) continue;
    const ds = String(r[0]).trim();
    if (ds.includes("*") || ds === "" || ds.toLowerCase().includes("statement")) continue;
    const d = parseDate(ds);
    if (!d) continue;
    const narration = String(r[1] || "").trim();
    const debit = toNum(r[4]);
    const credit = toNum(r[5]);
    const balance = toNum(r[6]);
    const amount = credit - debit;
    if (debit === 0 && credit === 0) continue;
    out.push({
      id: id++, date: d, narration, debit, credit, balance, amount,
      direction: amount > 0 ? "Credit" : "Debit",
      absAmount: round2(Math.abs(amount)),
      category: classifyBank(narration),
    });
  }
  return out;
}

function parseBC(buf: Buffer, br: string): BCEntry[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const out: BCEntry[] = [];
  let id = 0;
  for (const row of rows) {
    const pd = row["Posting Date"];
    if (!pd) continue;
    const d = parseDate(pd);
    if (!d) continue;
    const bc = row["Branch Code"] ? String(row["Branch Code"]) : "";
    if (br && bc.toUpperCase() !== br.toUpperCase()) continue;
    const amount = toNum(row["Amount"]);
    if (amount === 0) continue;
    const description = String(row["Description"] || "");
    out.push({
      id: id++, postingDate: d,
      documentType: row["Document Type"] ? String(row["Document Type"]) : "",
      documentNo: String(row["Document No."] || ""),
      description, branchCode: bc, amount,
      direction: amount > 0 ? "Credit" : "Debit",
      absAmount: round2(Math.abs(amount)),
      category: classifyBC(description),
    });
  }
  return out;
}

const bankBuf = fs.readFileSync(path.resolve(bankPath));
const bcBuf   = fs.readFileSync(path.resolve(bcPath));
const bank0   = parseBank(bankBuf);
const bc0     = parseBC(bcBuf, branch);

const [fy, fm, fd] = fromStr.split("-").map(Number);
const [ty, tm, td] = toStr.split("-").map(Number);
const from = new Date(fy, fm - 1, fd);
const to = new Date(ty, tm - 1, td, 23, 59, 59);
const bank = bank0.filter(b => b.date >= from && b.date <= to).map((b, i) => ({ ...b, id: i }));
const bc   = bc0.filter(c => c.postingDate >= from && c.postingDate <= to).map((c, i) => ({ ...c, id: i }));

const dt = Number(process.env.DT ?? 2);
const at = Number(process.env.AT ?? 1.0);
const mc = Number(process.env.MC ?? 15);
const result = runMatch(bank, bc, { dateToleranceDays: dt, amountTolerance: at, maxComponents: mc });

const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

const bankRows = bank.map(b => ({
  id: b.id, date: isoDate(b.date), direction: b.direction, absAmount: b.absAmount, category: b.category,
})).sort((a, b) => (a.date+a.absAmount+a.direction).localeCompare(b.date+b.absAmount+b.direction));

const bcRows = bc.map(c => ({
  id: c.id, date: isoDate(c.postingDate), direction: c.direction, absAmount: c.absAmount, category: c.category,
})).sort((a, b) => (a.date+a.absAmount+a.direction).localeCompare(b.date+b.absAmount+b.direction));

const matches = result.matches.map((m: Match) => ({
  tier: m.tier,
  confidence: m.confidence,
  bankDate: isoDate(m.bankDate),
  bankAmount: m.bankAmount,
  bcSumAmount: m.bcSumAmount,
  direction: m.direction,
  category: m.category,
  bcCount: m.bcIds.length,
})).sort((a, b) => (a.bankDate+a.bankAmount+a.tier).toString().localeCompare((b.bankDate+b.bankAmount+b.tier).toString()));

const snap = {
  bank_rows: bankRows,
  bc_rows: bcRows,
  matches,
  stats: {
    total_bank: result.stats.totalBank,
    total_bc: result.stats.totalBC,
    matched_bank: result.stats.matchedBank,
    matched_bc: result.stats.matchedBC,
    unmatched_bank: result.stats.unmatchedBank,
    unmatched_bc: result.stats.unmatchedBC,
    match_pct: result.stats.matchPct,
  },
};

const outFile = outPath ?? path.resolve("scripts/ts_snapshot.json");
fs.writeFileSync(outFile, JSON.stringify(snap, null, 2));
console.log(`WROTE ${outFile}`);
console.log(`  bank rows: ${bankRows.length}  bc rows: ${bcRows.length}`);
console.log(`  matches:   ${matches.length}  stats=${JSON.stringify(snap.stats)}`);
