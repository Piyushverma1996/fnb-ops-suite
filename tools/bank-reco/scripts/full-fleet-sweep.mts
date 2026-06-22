/**
 * Full fleet sweep — every bank file we have, with the matching primary BC
 * ledger + every other BC ledger as cross-outlet pool + all settlements.
 * This is the "what does the system deliver across the whole Sandoz fleet"
 * snapshot.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";
import {
  runMatch, classifyBank, classifyBC,
  type BankEntry, type BCEntry, type SettlementInput, type CashInvoiceInput,
} from "../src/lib/matcher.ts";
import { parseSwiggyText, parseZomatoUtrText, parseAmexText, parsePhonePeText } from "../src/lib/settlement.ts";
import { parseSalesInvoicesBuffer } from "../src/lib/sales-invoices.ts";

const SRC = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data";
const BANK_DIR = `${SRC}/Bank Reco statements`;
const CLEARING_DIR = `${SRC}/BC Clearing Ledgers`;

function fixDate(v: unknown): Date | null {
  if (!v) return null;
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
function parseBCSplit(buf: Buffer, primaryBranch: string): { primary: BCEntry[]; cross: BCEntry[] } {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null });
  const primary: BCEntry[] = []; const cross: BCEntry[] = []; let pid = 0; let cid = 0;
  for (const row of rows) {
    const d = fixDate(row["Posting Date"]);
    if (!d) continue;
    const bc = String(row["Branch Code"] ?? "").toUpperCase().trim();
    const amount = toNum(row["Amount"]);
    if (amount === 0) continue;
    const description = String(row["Description"] ?? "");
    const isPrimary = bc === primaryBranch.toUpperCase();
    const entry: BCEntry = { id: isPrimary ? pid++ : cid++, postingDate: d,
      documentType: String(row["Document Type"] ?? ""),
      documentNo: String(row["Document No." ] ?? ""), description,
      branchCode: bc, amount, direction: amount > 0 ? "Credit" : "Debit",
      absAmount: round2(Math.abs(amount)), category: classifyBC(description) };
    if (isPrimary) primary.push(entry);
    else if (bc) cross.push(entry);
  }
  return { primary, cross };
}

// Map bank file → outlet code → BC clearing file
// outlet = the ACTUAL Branch Code used inside the BC file (CNSP, MS, etc.)
// displayCode = what we show in the leaderboard (NSP, MUS, etc.)
const cases: { outlet: string; display: string; bankFile: string; bcFile: string }[] = [
  { display: "DW",    outlet: "DW",      bankFile: "DWK_9146-imp.xls",   bcFile: "HDFC146 (DW).xlsx" },
  { display: "AV",    outlet: "AV",      bankFile: "AV_2574-imp.xls",    bcFile: "HDFC574 (AV).xlsx" },
  { display: "JR",    outlet: "JR",      bankFile: "JR_2160-imp.xls",    bcFile: "HDFC160 (TN).xlsx" },
  { display: "RG",    outlet: "RG",      bankFile: "RG_4189-imp.xls",    bcFile: "HDFC189 (RG).xlsx" },
  { display: "NP",    outlet: "NP",      bankFile: "NP_8761-imp.xls",    bcFile: "HDFC761 (NP).xlsx" },
  { display: "DDB",   outlet: "DDB",     bankFile: "DDB_2723-imp.xls",   bcFile: "HDFC723 (DD).xlsx" },
  { display: "PV",    outlet: "PV",      bankFile: "PV_0891-imp.xls",    bcFile: "HDFC891 (PV).xlsx" },
  { display: "MR",    outlet: "MR",      bankFile: "MR_7802-imp.xls",    bcFile: "HDFC802 (MR).xlsx" },
  { display: "NSP",   outlet: "CNSP",    bankFile: "NSP_9190-imp.xls",   bcFile: "HDFC190 (NSP).xlsx" },
  { display: "SN",    outlet: "CSN",     bankFile: "SN_4124-imp.xls",    bcFile: "HDFC124 (SN).xlsx" },
  { display: "HK",    outlet: "HK",      bankFile: "HK_4902-imp.xls",    bcFile: "HDFC902 (HK).xlsx" },
  { display: "KB",    outlet: "KB",      bankFile: "KB_1810-imp.xls",    bcFile: "HDFC810 (KB).xlsx" },
  { display: "BBQ",   outlet: "BBQ",     bankFile: "BBQ_7931-imp.xls",   bcFile: "HDFC931 (BBQ).xlsx" },
  { display: "LN",    outlet: "LN",      bankFile: "Min470-imp.xls",     bcFile: "HDFC460 (LN).xlsx" },
  { display: "CLB",   outlet: "CLB",     bankFile: "CLB_0035-imp.xls",   bcFile: "HDFC035 (L-10).xlsx" },
  { display: "SDA",   outlet: "CSDA",    bankFile: "SDA_8712-imp.xls",   bcFile: "HDFC712 (SDA).xlsx" },
  { display: "MT",    outlet: "MN",      bankFile: "MT_8711-imp.xls",    bcFile: "HDFC711 (MN).xlsx" },
  { display: "MUS",   outlet: "MS",      bankFile: "MU_0230-imp.xls",    bcFile: "HDFC230 (MUS).xlsx" },
  { display: "ASR",   outlet: "ASR",     bankFile: "AMH_4623-imp.xls",   bcFile: "HDFC801 (ASR).xlsx" },
  { display: "GGN51", outlet: "CG",      bankFile: "Mall51_8380-imp.xls",bcFile: "HDFC380 (GGN51).xlsx" },
  { display: "GGN54", outlet: "GGN",     bankFile: "EQ5793-imp.xls",     bcFile: "HDFC976 (GGN 54).xlsx" },
];

// Load all settlements
const settlements: SettlementInput[] = [];
const SWIGGY_DIR = `${SRC}/Aggregator settlement reports/Swiggy`;
const ZOMATO_DIR = `${SRC}/Aggregator settlement reports/Zomato`;
const AMEX_DIR = `${SRC}/Aggregator settlement reports/Amex`;
const PHONEPE_DIR = `${SRC}/Aggregator settlement reports/Phonepe`;
if (fs.existsSync(SWIGGY_DIR)) for (const f of fs.readdirSync(SWIGGY_DIR).filter(x => x.endsWith(".csv"))) settlements.push(...parseSwiggyText(fs.readFileSync(`${SWIGGY_DIR}/${f}`, "utf-8"), f));
if (fs.existsSync(ZOMATO_DIR)) for (const f of fs.readdirSync(ZOMATO_DIR).filter(x => x.startsWith("utr_report_") && x.endsWith(".csv"))) settlements.push(...parseZomatoUtrText(fs.readFileSync(`${ZOMATO_DIR}/${f}`, "utf-8"), f));
if (fs.existsSync(AMEX_DIR)) for (const f of fs.readdirSync(AMEX_DIR).filter(x => x.endsWith(".csv"))) settlements.push(...parseAmexText(fs.readFileSync(`${AMEX_DIR}/${f}`, "utf-8"), f));
if (fs.existsSync(PHONEPE_DIR)) for (const f of fs.readdirSync(PHONEPE_DIR).filter(x => x.endsWith(".csv"))) settlements.push(...parsePhonePeText(fs.readFileSync(`${PHONEPE_DIR}/${f}`, "utf-8"), f));
console.log(`Loaded ${settlements.length} settlements`);

// SI
const SI_PATH = `${SRC}/Sales Invoices (62).xlsx`;
let cashInvoices: CashInvoiceInput[] = [];
if (fs.existsSync(SI_PATH)) {
  const siBuf = fs.readFileSync(SI_PATH);
  const allSI = parseSalesInvoicesBuffer(siBuf.buffer.slice(siBuf.byteOffset, siBuf.byteOffset + siBuf.byteLength) as ArrayBuffer);
  cashInvoices = allSI.filter(x => x.paymentType.toUpperCase() === "CASH").map(x => ({ docNo: x.docNo, postingDate: x.postingDate, locationCode: x.locationCode, grossTotal: x.grossTotal }));
}
console.log(`Loaded ${cashInvoices.length} cash SIs`);

// Pre-load every clearing-ledger file into the cross-outlet pool (used by ALL outlets)
const allClearingFiles = fs.existsSync(CLEARING_DIR)
  ? fs.readdirSync(CLEARING_DIR).filter(x => x.startsWith("HDFC") && x.endsWith(".xlsx"))
  : [];
console.log(`Found ${allClearingFiles.length} HDFC clearing-ledger files for cross-outlet pool`);

const from = new Date(2026, 3, 1);
const to = new Date(2026, 5, 16, 23, 59, 59);

console.log(`\nFull fleet sweep, ${cases.length} outlets, Apr 1 -> Jun 16:\n`);
console.log("Outlet  Bank file               Match  Pct      T1/T2/T3/T4/T5/T6/T7/T8");
console.log("-".repeat(95));

const results: { outlet: string; matchPct: number; bank: number; matched: number; t7: number }[] = [];
let totalBank = 0, totalMatched = 0;

for (const c of cases) {
  const bankPath = path.join(BANK_DIR, c.bankFile);
  const bcPath = c.bcFile ? path.join(CLEARING_DIR, c.bcFile) : "";
  if (!fs.existsSync(bankPath) || !bcPath || !fs.existsSync(bcPath)) {
    console.log(`${c.display.padEnd(7)} ${c.bankFile.padEnd(23)} MISS file`);
    continue;
  }
  const bank0 = parseBank(fs.readFileSync(bankPath));
  const { primary: bc0, cross: cross0 } = parseBCSplit(fs.readFileSync(bcPath), c.outlet);

  // Add cross-outlet from all other clearing files
  for (const otherFile of allClearingFiles) {
    if (otherFile === c.bcFile) continue;
    const split = parseBCSplit(fs.readFileSync(path.join(CLEARING_DIR, otherFile)), c.outlet);
    cross0.push(...split.primary, ...split.cross);
  }

  const bank = bank0.filter(b => b.date >= from && b.date <= to).map((b, i) => ({ ...b, id: i }));
  const bc   = bc0.filter(x => x.postingDate >= from && x.postingDate <= to).map((x, i) => ({ ...x, id: i }));
  const cross = cross0.filter(x => x.postingDate >= from && x.postingDate <= to);
  cross.forEach((x, i) => { x.id = i; });

  const r = runMatch(bank, bc, {
    dateToleranceDays: 2, amountTolerance: 1.0, maxComponents: 100,
    settlements, cashInvoices, outletCode: c.outlet,
    crossOutletBC: cross.length > 0 ? cross : undefined,
  });
  const tiers = { T1: 0, T2: 0, T3: 0, T4: 0, T5: 0, T6: 0, T7: 0, T8: 0 };
  for (const m of r.matches) tiers[m.tier]++;
  const tierStr = `${tiers.T1}/${tiers.T2}/${tiers.T3}/${tiers.T4}/${tiers.T5}/${tiers.T6}/${tiers.T7}/${tiers.T8}`;
  console.log(`${c.display.padEnd(7)} ${c.bankFile.padEnd(23)} ${String(r.stats.matchedBank).padStart(4)}/${String(bank.length).padStart(4)} ${String(r.stats.matchPct).padStart(5)}%  ${tierStr}`);
  results.push({ outlet: c.display, matchPct: r.stats.matchPct, bank: bank.length, matched: r.stats.matchedBank, t7: tiers.T7 });
  totalBank += bank.length; totalMatched += r.stats.matchedBank;
}
console.log();
console.log(`Total: ${totalMatched}/${totalBank} = ${(totalMatched/Math.max(totalBank,1)*100).toFixed(1)}% across the fleet`);
console.log(`Mean per-outlet match%: ${(results.reduce((s,r)=>s+r.matchPct,0)/Math.max(results.length,1)).toFixed(1)}%`);
