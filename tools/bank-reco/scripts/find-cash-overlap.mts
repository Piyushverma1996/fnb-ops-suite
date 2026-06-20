/** Find an outlet where bank cash deposits AND SI cash bills overlap in date. */
import * as fs from "node:fs";
import * as XLSX from "xlsx";
import { classifyBank, type BankEntry } from "../src/lib/matcher.ts";
import { parseSalesInvoicesBuffer } from "../src/lib/sales-invoices.ts";

const BANK_DIR = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Bank Reco statements";
const SI_FILE = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Sales Invoices (61).xlsx";

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

const siBuf = fs.readFileSync(SI_FILE);
const allSI = parseSalesInvoicesBuffer(siBuf.buffer.slice(siBuf.byteOffset, siBuf.byteOffset + siBuf.byteLength) as ArrayBuffer);
const cashSI = allSI.filter(x => x.paymentType === "CASH");

// Group cash SI by (location, date)
const siByLocDate = new Map<string, { count: number; total: number }>();
for (const ci of cashSI) {
  const k = `${ci.locationCode}|${ci.postingDate.toISOString().slice(0,10)}`;
  const cur = siByLocDate.get(k) ?? { count: 0, total: 0 };
  cur.count++; cur.total += ci.grossTotal;
  siByLocDate.set(k, cur);
}

const outletToFile: Record<string, string> = {
  "DW": "DWK_9146-imp.xls", "AV": "AV_2574-imp.xls", "JR": "JR_2160-imp.xls",
  "RG": "RG_4189-imp.xls", "DBG": "DBG_6699-imp.xls", "NP": "NP_8761-imp.xls",
  "DDB": "DDB_2723-imp.xls", "PV": "PV_0891-imp.xls", "MR": "MR_7802-imp.xls",
  "SS": "SS_2321-imp.xls", "NB": "NB_1670-imp.xls", "LN": "Min470-imp.xls",
  "SDA": "SDA_8712-imp.xls", "MU": "MU_0230-imp.xls",
};

// First show overall data shape
const allCashDates = new Set<string>();
for (const ci of cashSI) allCashDates.add(ci.postingDate.toISOString().slice(0, 10));
console.log("Cash SI dates available:", [...allCashDates].sort().join(", "));

const allCashLoc = new Set<string>();
for (const ci of cashSI) allCashLoc.add(ci.locationCode);
console.log("Cash SI locations:", [...allCashLoc].sort().join(", "));

console.log("\nLooking for any T6 candidates...");
for (const [outlet, file] of Object.entries(outletToFile)) {
  const path = `${BANK_DIR}/${file}`;
  if (!fs.existsSync(path)) continue;
  const bank = parseBank(fs.readFileSync(path));
  const cashDeposits = bank.filter(b => b.category === "CASH_DEPOSIT");
  // Find candidate T6 matches
  let candidateMatches = 0;
  for (const b of cashDeposits) {
    for (const delta of [-1, 0, -2, -3]) {
      const d = new Date(b.date.getFullYear(), b.date.getMonth(), b.date.getDate() + delta);
      const k = `${outlet}|${d.toISOString().slice(0,10)}`;
      const bucket = siByLocDate.get(k);
      if (bucket && Math.abs(bucket.total - b.absAmount) < 5) { candidateMatches++; break; }
    }
  }
  if (candidateMatches > 0) {
    console.log(`${outlet}: ${cashDeposits.length} cash deposit lines, ${candidateMatches} would match T6 with current SI file`);
  }
}
