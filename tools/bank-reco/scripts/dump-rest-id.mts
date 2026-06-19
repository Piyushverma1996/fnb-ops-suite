/** Dump the Rest ID mapping cleanly. */
import * as fs from "node:fs";
import * as XLSX from "xlsx";

const buf = fs.readFileSync(process.argv[2]);
const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null });
console.log("Outlet                            Swiggy RID   Petpooja RID   Zomato RID");
console.log("-".repeat(90));
for (const r of rows) {
  console.log(
    String(r["Outlet Name"] ?? "").padEnd(33) + " " +
    String(r["Rest ID Swiggy"] ?? "").padStart(10) + "   " +
    String(r["Petpooja Rest ID"] ?? "").padStart(12) + "   " +
    String(r["Rest ID Zomato"] ?? "").padStart(10),
  );
}
console.log(`\nTotal outlets: ${rows.length}`);
