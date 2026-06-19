/**
 * End-to-end test of settlement-aware matching.
 * Uses Swiggy CSVs and tries to match an outlet's bank statement.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";
import { runMatch, classifyBank, classifyBC, type BankEntry, type BCEntry, type SettlementInput } from "../src/lib/matcher.ts";
import { parseSwiggyText } from "../src/lib/settlement.ts";

const SWIGGY_DIR = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Aggregator settlement reports/Swiggy";
const BANK_DIR = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Bank Reco statements";

const settlements: SettlementInput[] = [];
for (const f of fs.readdirSync(SWIGGY_DIR).filter(x => x.endsWith(".csv"))) {
  const txt = fs.readFileSync(`${SWIGGY_DIR}/${f}`, "utf-8");
  settlements.push(...parseSwiggyText(txt, f));
}
console.log(`Loaded ${settlements.length} Swiggy settlements across ${new Set(settlements.map(s => s.rid)).size} RIDs`);

const utrSet = new Set(settlements.map(s => s.utr));
console.log(`Unique UTRs: ${utrSet.size}`);
console.log("Sample UTRs:", [...utrSet].slice(0, 5).join(", "));

// For each bank file, look for UTRs in narration
const bankFiles = fs.readdirSync(BANK_DIR).filter(f => f.endsWith(".xls"));
console.log(`\nScanning ${bankFiles.length} bank statement files for Swiggy UTRs in narration...\n`);

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

let foundHits = 0;
for (const f of bankFiles) {
  const bank = parseBank(fs.readFileSync(`${BANK_DIR}/${f}`));
  const hits: { utr: string; bankAmt: number; settNet: number; narration: string }[] = [];
  for (const b of bank) {
    for (const s of settlements) {
      if (s.utr.length < 6) continue;
      if (b.narration.toUpperCase().includes(s.utr.toUpperCase())) {
        hits.push({ utr: s.utr, bankAmt: b.absAmount, settNet: s.netPayout, narration: b.narration.slice(0, 80) });
      }
    }
  }
  if (hits.length > 0) {
    console.log(`${f}: ${hits.length} UTR substring hits`);
    hits.slice(0, 3).forEach(h => {
      const ok = Math.abs(h.bankAmt - h.settNet) <= 1 ? "✓" : "✗";
      console.log(`  ${ok}  UTR=${h.utr}  bank=₹${h.bankAmt.toFixed(2)}  settlement=₹${h.settNet.toFixed(2)}  | ${h.narration}`);
    });
    foundHits += hits.length;
  }
}
console.log(`\nTotal UTR matches across all bank files: ${foundHits}`);
