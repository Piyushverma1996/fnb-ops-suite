/** Dump all bank accounts with their codes and names. */
import * as fs from "node:fs";
import * as XLSX from "xlsx";

const buf = fs.readFileSync(process.argv[2]);
const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null });
console.log(`Total: ${rows.length}`);
console.log("Code".padEnd(10) + " | " + "Name".padEnd(50) + " | Acct No.");
console.log("-".repeat(90));
for (const r of rows) {
  console.log(String(r["No."] ?? "").padEnd(10) + " | " + String(r["Name"] ?? "").padEnd(50) + " | " + String(r["Bank Account No."] ?? ""));
}
