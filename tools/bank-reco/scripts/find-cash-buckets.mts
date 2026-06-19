/**
 * Look at unmatched bank lines (DW Apr 1-Jun 15) and see which ones look like
 * cash deposits / SI-consolidation candidates vs aggregator vs inter-outlet.
 */
import * as fs from "node:fs";
import * as XLSX from "xlsx";

const wb = XLSX.read(fs.readFileSync(process.argv[2]), { type: "buffer", cellDates: true });
const ub = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["3 Unmatched Bank"], { defval: null });
const uc = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["4 Unmatched BC"], { defval: null });

const counts = new Map<string, { rows: number; total: number; examples: string[] }>();
for (const r of ub) {
  const t = String(r["Type"] ?? "");
  const a = Number(r["Amount"]) || 0;
  const n = String(r["Narration"] ?? "");
  const cur = counts.get(t) ?? { rows: 0, total: 0, examples: [] };
  cur.rows++; cur.total += a;
  if (cur.examples.length < 3) cur.examples.push(`₹${a.toFixed(2)} | ${n.slice(0, 60)}`);
  counts.set(t, cur);
}
console.log(`Unmatched bank lines: ${ub.length}`);
console.log("\nBy type:");
console.log("Type             Rows    Total           Example");
[...counts.entries()].sort((a, b) => b[1].rows - a[1].rows).forEach(([t, v]) =>
  console.log(`${t.padEnd(16)} ${String(v.rows).padStart(4)}  ${v.total.toFixed(2).padStart(13)}   ${v.examples[0]}`),
);

console.log(`\nUnmatched BC entries: ${uc.length}`);
const ucCounts = new Map<string, { rows: number; total: number }>();
for (const r of uc) {
  const docNo = String(r["Doc No."] ?? "");
  const m = docNo.match(/^([A-Z]+)/i);
  const prefix = m ? m[1].toUpperCase() : "?";
  const a = Number(r["Amount"]) || 0;
  const cur = ucCounts.get(prefix) ?? { rows: 0, total: 0 };
  cur.rows++; cur.total += a;
  ucCounts.set(prefix, cur);
}
console.log("By doc prefix:");
[...ucCounts.entries()].sort((a, b) => b[1].rows - a[1].rows).forEach(([p, v]) =>
  console.log(`  ${p.padEnd(6)} ${String(v.rows).padStart(4)}  ₹${v.total.toFixed(2).padStart(13)}`),
);

// Spot a candidate: do daily PP/* totals approximate any bank line?
const ppByDate = new Map<string, number>();
for (const r of uc) {
  if (!String(r["Doc No."] ?? "").startsWith("PP")) continue;
  const d = String(r["Posting Date"] ?? "").slice(0, 10);
  ppByDate.set(d, (ppByDate.get(d) ?? 0) + (Number(r["Amount"]) || 0));
}
console.log("\nUnmatched PP/* daily totals (top 8 by amount):");
[...ppByDate.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([d, t]) =>
  console.log(`  ${d}  ₹${t.toFixed(2)}`),
);

// Bank lines by date+amount (unmatched only)
console.log("\nUnmatched bank lines (top 15 by amount):");
ub.slice().sort((a, b) => (Number(b["Amount"]) || 0) - (Number(a["Amount"]) || 0)).slice(0, 15).forEach(r =>
  console.log(`  ${String(r["Date"])}  ${String(r["Dir"])}  ₹${Number(r["Amount"]).toFixed(2).padStart(13)}  ${String(r["Type"]).padEnd(12)}  ${String(r["Narration"]).slice(0, 80)}`),
);
