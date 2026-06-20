/**
 * Phase 4: run the matcher across multiple (outlet, bank file, BC file) triples.
 * For each triple, report bank rows, BC rows, matches, tier breakdown, % match.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";
import { runMatch, classifyBank, classifyBC, type BankEntry, type BCEntry, type SettlementInput } from "../src/lib/matcher.ts";
import { parseSwiggyText, parseZomatoUtrText } from "../src/lib/settlement.ts";

const SWIGGY_DIR = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Aggregator settlement reports/Swiggy";
const ZOMATO_DIR = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Aggregator settlement reports/Zomato";
const settlements: SettlementInput[] = [];
if (fs.existsSync(SWIGGY_DIR)) {
  for (const f of fs.readdirSync(SWIGGY_DIR).filter(x => x.endsWith(".csv"))) {
    settlements.push(...parseSwiggyText(fs.readFileSync(`${SWIGGY_DIR}/${f}`, "utf-8"), f));
  }
}
if (fs.existsSync(ZOMATO_DIR)) {
  for (const f of fs.readdirSync(ZOMATO_DIR).filter(x => x.startsWith("utr_report_") && x.endsWith(".csv"))) {
    settlements.push(...parseZomatoUtrText(fs.readFileSync(`${ZOMATO_DIR}/${f}`, "utf-8"), f));
  }
}

const SRC = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data";
const BANK_DIR = path.join(SRC, "Bank Reco statements");
const BC_DIR = path.join(SRC, "Bank account ledger entries");

// (outlet, bank file, BC file) — pick the BC file whose primary branch matches.
const cases = [
  { outlet: "DW",  bank: "DWK_9146-imp.xls",   bc: "../Bank Account Ledger Entries - DW.xlsx" }, // single-branch reference
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
  if (typeof v === "number") {
    const u = new Date((v - 25569) * 86400000);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { const d=+m[1], mo=+m[2]-1; let y=+m[3]; if (y<100) y+=2000; return new Date(y, mo, d); }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2]-1, +m[3]);
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
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
    out.push({ id: id++, postingDate: d,
      documentType: String(row["Document Type"] ?? ""),
      documentNo: String(row["Document No."] ?? ""),
      description: String(row["Description"] ?? ""),
      branchCode: bc, amount,
      direction: amount > 0 ? "Credit" : "Debit",
      absAmount: round2(Math.abs(amount)),
      category: classifyBC(String(row["Description"] ?? "")) });
  }
  return out;
}

const [fy, fm, fd] = FROM.split("-").map(Number);
const [ty, tm, td] = TO.split("-").map(Number);
const from = new Date(fy, fm - 1, fd);
const to = new Date(ty, tm - 1, td, 23, 59, 59);

console.log(`Sweep: ${cases.length} outlets · ${FROM} → ${TO}\n`);
console.log(`(loaded ${settlements.length} Swiggy settlements)\n`);
console.log("Outlet  Bank file               BC file                            Bank  BC    Match  Pct    T1/T2/T3/T4/T5");
console.log("-".repeat(120));

const results: { outlet: string; bank: number; bc: number; matched: number; pct: number }[] = [];
for (const c of cases) {
  try {
    const bankPath = path.join(BANK_DIR, c.bank);
    const bcPath = c.bc.startsWith("..") ? path.join(SRC, c.bc.slice(3)) : path.join(BC_DIR, c.bc);
    if (!fs.existsSync(bankPath)) { console.log(`MISS  bank ${c.bank}`); continue; }
    if (!fs.existsSync(bcPath))   { console.log(`MISS  bc   ${c.bc}`);   continue; }
    const bank0 = parseBank(fs.readFileSync(bankPath));
    const bc0   = parseBC(fs.readFileSync(bcPath), c.outlet);
    const bank = bank0.filter(b => b.date >= from && b.date <= to).map((b, i) => ({ ...b, id: i }));
    const bc   = bc0.filter(x => x.postingDate >= from && x.postingDate <= to).map((x, i) => ({ ...x, id: i }));
    const r = runMatch(bank, bc, { dateToleranceDays: 2, amountTolerance: 1.0, maxComponents: 100, settlements });
    const tiers = { T1: 0, T2: 0, T3: 0, T4: 0, T5: 0 };
    for (const m of r.matches) tiers[m.tier]++;
    const tierStr = `${tiers.T1}/${tiers.T2}/${tiers.T3}/${tiers.T4}/${tiers.T5}`;
    console.log(`${c.outlet.padEnd(7)} ${c.bank.padEnd(23)} ${c.bc.slice(0,34).padEnd(35)} ${String(bank.length).padStart(4)}  ${String(bc.length).padStart(4)}  ${String(r.stats.matchedBank).padStart(4)}   ${String(r.stats.matchPct).padStart(5)}%  ${tierStr}`);
    results.push({ outlet: c.outlet, bank: bank.length, bc: bc.length, matched: r.stats.matchedBank, pct: r.stats.matchPct });
  } catch (e: unknown) {
    console.log(`ERR   ${c.outlet}: ${e instanceof Error ? e.message : e}`);
  }
}
console.log();
const ok = results.filter(r => r.bank > 0 && r.bc > 0).length;
const avgPct = results.length ? results.reduce((s, r) => s + r.pct, 0) / results.length : 0;
console.log(`Ran ${results.length} outlets. ${ok} had non-empty bank+BC. Mean match %: ${avgPct.toFixed(1)}%`);
