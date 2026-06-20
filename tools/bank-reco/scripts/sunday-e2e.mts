/**
 * Sunday E2E: run the production matcher on every outlet with every input
 * file we have, generate the full Excel report, and assert critical
 * invariants. Lights up bugs that the per-outlet scripts miss.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";
import {
  runMatch, classifyBank, classifyBC,
  type BankEntry, type BCEntry, type SettlementInput, type CashInvoiceInput,
} from "../src/lib/matcher.ts";
import { parseSwiggyText, parseZomatoUtrText } from "../src/lib/settlement.ts";
import { parseSalesInvoicesBuffer } from "../src/lib/sales-invoices.ts";

// Pre-load every BC file we have for T7 cross-outlet pool
const ALL_BC_DIR = `C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Bank account ledger entries`;

const SRC = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data";
const BANK_DIR = `${SRC}/Bank Reco statements`;
const BC_DIR = `${SRC}/Bank account ledger entries`;
const SWIGGY_DIR = `${SRC}/Aggregator settlement reports/Swiggy`;
const ZOMATO_DIR = `${SRC}/Aggregator settlement reports/Zomato`;
const SI_PATH = `${SRC}/Sales Invoices (61).xlsx`;

const cases = [
  { outlet: "DW",  bank: "DWK_9146-imp.xls",   bc: "../Bank Account Ledger Entries - DW.xlsx" },
  { outlet: "AV",  bank: "AV_2574-imp.xls",    bc: "Bank Account Ledger Entries (11).xlsx" },
  { outlet: "JR",  bank: "JR_2160-imp.xls",    bc: "Bank Account Ledger Entries (4).xlsx" },
  { outlet: "RG",  bank: "RG_4189-imp.xls",    bc: "Bank Account Ledger Entries (5).xlsx" },
  { outlet: "DBG", bank: "DBG_6699-imp.xls",   bc: "Bank Account Ledger Entries (13).xlsx" },
  { outlet: "NP",  bank: "NP_8761-imp.xls",    bc: "Bank Account Ledger Entries (17).xlsx" },
  { outlet: "DDB", bank: "DDB_2723-imp.xls",   bc: "Bank Account Ledger Entries (16).xlsx" },
  { outlet: "PV",  bank: "PV_0891-imp.xls",    bc: "Bank Account Ledger Entries (21).xlsx" },
  { outlet: "MR",  bank: "MR_7802-imp.xls",    bc: "Bank Account Ledger Entries (19).xlsx" },
  { outlet: "SS",  bank: "SS_2321-imp.xls",    bc: "Bank Account Ledger Entries (8).xlsx" },
];

const FROM = "2026-04-01", TO = "2026-06-15";

function fixDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) {
    const r = Math.round(v.getTime() / 86400000) * 86400000;
    const u = new Date(r);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  if (typeof v === "number") { const u = new Date((v - 25569) * 86400000); return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()); }
  const s = String(v).trim();
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m1) { const d=+m1[1], mo=+m1[2]-1; let y=+m1[3]; if (y<100) y+=2000; return new Date(y, mo, d); }
  const m2 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m2) return new Date(+m2[1], +m2[2]-1, +m2[3]);
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
function parseBCCross(buf: Buffer, primaryBranch: string): BCEntry[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null });
  const out: BCEntry[] = []; let id = 0;
  for (const row of rows) {
    const d = fixDate(row["Posting Date"]);
    if (!d) continue;
    const bc = String(row["Branch Code"] ?? "").toUpperCase().trim();
    if (!bc || bc === primaryBranch.toUpperCase()) continue;
    const amount = toNum(row["Amount"]);
    if (amount === 0) continue;
    out.push({ id: id++, postingDate: d, documentType: String(row["Document Type"] ?? ""),
      documentNo: String(row["Document No."] ?? ""), description: String(row["Description"] ?? ""),
      branchCode: bc, amount, direction: amount > 0 ? "Credit" : "Debit",
      absAmount: round2(Math.abs(amount)), category: classifyBC(String(row["Description"] ?? "")) });
  }
  return out;
}

// Load every settlement file once
const settlements: SettlementInput[] = [];
for (const f of fs.readdirSync(SWIGGY_DIR).filter(x => x.endsWith(".csv"))) {
  settlements.push(...parseSwiggyText(fs.readFileSync(`${SWIGGY_DIR}/${f}`, "utf-8"), f));
}
for (const f of fs.readdirSync(ZOMATO_DIR).filter(x => x.startsWith("utr_report_") && x.endsWith(".csv"))) {
  settlements.push(...parseZomatoUtrText(fs.readFileSync(`${ZOMATO_DIR}/${f}`, "utf-8"), f));
}
console.log(`Loaded ${settlements.length} settlements (Swiggy + Zomato)`);

// Cash invoices
const siBuf = fs.readFileSync(SI_PATH);
const allSI = parseSalesInvoicesBuffer(siBuf.buffer.slice(siBuf.byteOffset, siBuf.byteOffset + siBuf.byteLength) as ArrayBuffer);
const cashInvoices: CashInvoiceInput[] = allSI
  .filter(x => x.paymentType.toUpperCase() === "CASH")
  .map(x => ({ docNo: x.docNo, postingDate: x.postingDate, locationCode: x.locationCode, grossTotal: x.grossTotal }));
console.log(`Loaded ${cashInvoices.length} cash SIs`);

const [fy, fm, fd] = FROM.split("-").map(Number);
const [ty, tm, td] = TO.split("-").map(Number);
const from = new Date(fy, fm - 1, fd);
const to = new Date(ty, tm - 1, td, 23, 59, 59);

console.log(`\nSunday E2E sweep: ${cases.length} outlets, all inputs, ${FROM} → ${TO}\n`);
console.log("Outlet  Bank  BC   Match  Pct      T1/T2/T3/T4/T5/T6/T7  Invariants");
console.log("-".repeat(110));

const results: { outlet: string; matchPct: number; matches: number; t5: number; t6: number; t7: number; issues: string[] }[] = [];

for (const c of cases) {
  const bankPath = path.join(BANK_DIR, c.bank);
  const bcPath = c.bc.startsWith("..") ? path.join(SRC, c.bc.slice(3)) : path.join(BC_DIR, c.bc);
  if (!fs.existsSync(bankPath) || !fs.existsSync(bcPath)) { console.log(`MISS ${c.outlet}`); continue; }
  const bank0 = parseBank(fs.readFileSync(bankPath));
  const bc0 = parseBC(fs.readFileSync(bcPath), c.outlet);
  const bank = bank0.filter(b => b.date >= from && b.date <= to).map((b, i) => ({ ...b, id: i }));
  const bc = bc0.filter(x => x.postingDate >= from && x.postingDate <= to).map((x, i) => ({ ...x, id: i }));
  // Build cross-outlet pool from every BC file the user has
  const crossBC: BCEntry[] = [];
  if (fs.existsSync(ALL_BC_DIR)) {
    for (const f of fs.readdirSync(ALL_BC_DIR).filter(x => x.endsWith(".xlsx"))) {
      crossBC.push(...parseBCCross(fs.readFileSync(`${ALL_BC_DIR}/${f}`), c.outlet));
    }
  }
  const crossBCF = crossBC.filter(x => x.postingDate >= from && x.postingDate <= to);
  crossBCF.forEach((x, i) => { x.id = i; });
  const r = runMatch(bank, bc, {
    dateToleranceDays: 2, amountTolerance: 1.0, maxComponents: 100,
    settlements, cashInvoices, outletCode: c.outlet,
    crossOutletBC: crossBCF.length > 0 ? crossBCF : undefined,
  });
  const tiers = { T1: 0, T2: 0, T3: 0, T4: 0, T5: 0, T6: 0, T7: 0, T8: 0 };
  for (const m of r.matches) tiers[m.tier]++;

  // Invariant checks
  const issues: string[] = [];
  // (a) no bank entry is matched twice
  const bankIdsSeen = new Set<number>();
  for (const m of r.matches) {
    if (bankIdsSeen.has(m.bankId)) issues.push(`duplicate bank match id=${m.bankId}`);
    bankIdsSeen.add(m.bankId);
  }
  // (b) no BC entry is matched twice
  const bcIdsSeen = new Set<number>();
  for (const m of r.matches) for (const id of m.bcIds) {
    if (bcIdsSeen.has(id)) issues.push(`duplicate BC match id=${id}`);
    bcIdsSeen.add(id);
  }
  // (c) T5 should have settlement
  for (const m of r.matches) {
    if (m.tier === "T5" && !m.settlement) issues.push(`T5 missing settlement`);
    if (m.tier === "T6" && !m.cashBucket) issues.push(`T6 missing cashBucket`);
  }
  // (d) matched count consistency
  if (r.stats.matchedBank !== bankIdsSeen.size) issues.push(`matchedBank count mismatch`);

  const tierStr = `${tiers.T1}/${tiers.T2}/${tiers.T3}/${tiers.T4}/${tiers.T5}/${tiers.T6}/${tiers.T7}/${tiers.T8}`;
  const invariantTag = issues.length === 0 ? "OK" : `FAIL: ${issues.join(", ")}`;
  console.log(`${c.outlet.padEnd(7)} ${String(bank.length).padStart(4)} ${String(bc.length).padStart(4)} ${String(r.stats.matchedBank).padStart(4)}   ${String(r.stats.matchPct).padStart(5)}%  ${tierStr.padEnd(19)} ${invariantTag}`);
  results.push({ outlet: c.outlet, matchPct: r.stats.matchPct, matches: r.matches.length, t5: tiers.T5, t6: tiers.T6, t7: tiers.T7, issues });
}

console.log();
const t5Total = results.reduce((s, r) => s + r.t5, 0);
const t6Total = results.reduce((s, r) => s + r.t6, 0);
const meanMatch = results.length ? results.reduce((s, r) => s + r.matchPct, 0) / results.length : 0;
const anyIssues = results.flatMap(r => r.issues);
const t7Total = results.reduce((s, r) => s + r.t7, 0);
console.log(`Total T5 matches: ${t5Total}`);
console.log(`Total T6 matches: ${t6Total}`);
console.log(`Total T7 matches: ${t7Total}`);
console.log(`Mean match%: ${meanMatch.toFixed(1)}%`);
console.log(`Invariant failures: ${anyIssues.length === 0 ? "NONE ✓" : anyIssues.join("; ")}`);
