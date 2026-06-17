/** Inspect a generated Bank Reco Excel report. */
import * as fs from "node:fs";
import * as XLSX from "xlsx";

const path = process.argv[2];
const buf = fs.readFileSync(path);
const wb = XLSX.read(buf, { type: "buffer", cellDates: true });

console.log("SHEETS:", wb.SheetNames);
for (const name of wb.SheetNames) {
  console.log(`\n=== ${name} ===`);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: null });
  console.log(`Total rows: ${rows.length}`);
  if (rows.length) {
    console.log("Columns:", Object.keys(rows[0]));
    console.log("First 3 rows:");
    rows.slice(0, 3).forEach((r, i) => console.log(`  [${i}]`, JSON.stringify(r).slice(0, 300)));
  }
}
