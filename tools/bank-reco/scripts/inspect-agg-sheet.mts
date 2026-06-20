/** Look at the Aggregator Settlements sheet in detail. */
import * as fs from "node:fs";
import * as XLSX from "xlsx";

const buf = fs.readFileSync(process.argv[2]);
const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
for (const name of ["7 Aggregator Settlements", "8 Cash Deposits"]) {
  const sheet = wb.Sheets[name];
  if (!sheet) { console.log(`Sheet ${name} not present`); continue; }
  console.log(`\n=== ${name} ===`);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  console.log(`Rows: ${rows.length}`);
  if (rows.length) {
    console.log("Columns:", Object.keys(rows[0]).join(" | "));
    rows.forEach(r => {
      const summary = Object.entries(r).map(([k, v]) => `${k}=${v}`).slice(0, 8).join(" | ");
      console.log(`  ${summary}`);
    });
  }
}
