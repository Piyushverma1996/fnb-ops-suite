/** Diff two snapshot JSONs (Python ref vs TS port). */
import * as fs from "node:fs";

const [, , refPath, tsPath] = process.argv;
if (!refPath || !tsPath) { console.error("Usage: diff-snapshots.mjs <ref.json> <ts.json>"); process.exit(1); }

const ref = JSON.parse(fs.readFileSync(refPath, "utf-8"));
const ts  = JSON.parse(fs.readFileSync(tsPath, "utf-8"));

function summarize(rows) {
  return rows.map(r => `${r.date}|${r.absAmount}|${r.direction}|${r.category}`).sort();
}
function summarizeMatch(m) {
  return m.map(x => `${x.bankDate}|${x.bankAmount}|${x.tier}|${x.bcCount}|${x.direction}|${x.category}`).sort();
}

const refBank = summarize(ref.bank_rows);
const tsBank = summarize(ts.bank_rows);
const refBC = summarize(ref.bc_rows);
const tsBC = summarize(ts.bc_rows);
const refMatch = summarizeMatch(ref.matches);
const tsMatch = summarizeMatch(ts.matches);

function diff(a, b, label) {
  const sa = new Set(a), sb = new Set(b);
  const onlyA = [...sa].filter(x => !sb.has(x));
  const onlyB = [...sb].filter(x => !sa.has(x));
  console.log(`\n=== ${label} ===`);
  console.log(`  ref count: ${a.length}, ts count: ${b.length}`);
  console.log(`  identical set: ${onlyA.length === 0 && onlyB.length === 0 ? "YES" : "NO"}`);
  if (onlyA.length) { console.log(`  in ref only (${onlyA.length}):`); onlyA.slice(0, 10).forEach(x => console.log("    -", x)); }
  if (onlyB.length) { console.log(`  in ts only (${onlyB.length}):`); onlyB.slice(0, 10).forEach(x => console.log("    +", x)); }
}

console.log("STATS:");
console.log("  ref:", ref.stats);
console.log("  ts: ", ts.stats);
const statsMatch = JSON.stringify(ref.stats) === JSON.stringify(ts.stats);
console.log(`  identical: ${statsMatch ? "YES" : "NO"}`);

diff(refBank, tsBank, "BANK ROWS");
diff(refBC, tsBC, "BC ROWS");
diff(refMatch, tsMatch, "MATCHES (date|amount|tier|bcCount|direction|category)");
