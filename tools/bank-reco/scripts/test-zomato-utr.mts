/** Test Zomato UTR CSV parsing + match against bank statements. */
import * as fs from "node:fs";
import * as XLSX from "xlsx";
import { runMatch, classifyBank, classifyBC, type BankEntry, type BCEntry, type SettlementInput } from "../src/lib/matcher.ts";
import { parseZomatoUtrText } from "../src/lib/settlement.ts";

const ZOMATO_DIR = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Aggregator settlement reports/Zomato";
const BANK_DIR = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Bank Reco statements";

const settlements: SettlementInput[] = [];
for (const f of fs.readdirSync(ZOMATO_DIR).filter(x => x.startsWith("utr_report_") && x.endsWith(".csv"))) {
  const txt = fs.readFileSync(`${ZOMATO_DIR}/${f}`, "utf-8");
  const parsed = parseZomatoUtrText(txt, f);
  settlements.push(...parsed);
  console.log(`${f}: ${parsed.length} settlements`);
}
console.log(`\nTotal Zomato settlements: ${settlements.length} across ${new Set(settlements.map(s => s.rid)).size} RIDs`);
console.log(`Total net payouts: ₹${settlements.reduce((t, s) => t + s.netPayout, 0).toFixed(2)}`);
console.log("Sample settlements:");
settlements.slice(0, 5).forEach(s =>
  console.log(`  ${s.utr.padEnd(20)} RID=${s.rid.padEnd(10)} ${s.orderCount} orders  Net=₹${s.netPayout.toFixed(2)}`)
);

// Now scan bank statements for matching UTRs
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

let totalHits = 0;
console.log("\n=== Cross-matching Zomato UTRs against bank statements ===");
for (const f of fs.readdirSync(BANK_DIR).filter(x => x.endsWith(".xls"))) {
  const bank = parseBank(fs.readFileSync(`${BANK_DIR}/${f}`));
  const hits: { utr: string; bankAmt: number; settleNet: number; narration: string }[] = [];
  for (const b of bank) {
    if (b.direction !== "Credit") continue;
    for (const s of settlements) {
      if (s.utr.length < 6) continue;
      if (b.narration.toUpperCase().includes(s.utr.toUpperCase())) {
        hits.push({ utr: s.utr, bankAmt: b.absAmount, settleNet: s.netPayout, narration: b.narration.slice(0, 70) });
      }
    }
  }
  if (hits.length > 0) {
    console.log(`${f}: ${hits.length} UTR hits`);
    hits.slice(0, 3).forEach(h => {
      const tol = Math.max(100, h.bankAmt * 0.02);
      const ok = Math.abs(h.bankAmt - h.settleNet) <= tol ? "✓" : "✗";
      console.log(`  ${ok}  ${h.utr.padEnd(20)} bank ₹${h.bankAmt.toFixed(2).padStart(10)}  settle ₹${h.settleNet.toFixed(2).padStart(10)}  Δ ₹${(h.bankAmt - h.settleNet).toFixed(2)}`);
    });
    totalHits += hits.length;
  }
}
console.log(`\nTotal Zomato UTR matches across all bank files: ${totalHits}`);
