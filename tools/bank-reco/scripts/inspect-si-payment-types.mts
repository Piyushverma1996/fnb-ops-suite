/** Look at payment-type distribution in Sales Invoices (61).xlsx. */
import * as fs from "node:fs";
import * as XLSX from "xlsx";

const buf = fs.readFileSync("C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Sales Invoices (61).xlsx");
const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null });
console.log(`Total rows: ${rows.length}`);

const byPayment = new Map<string, { count: number; total: number }>();
for (const r of rows) {
  const pt = String(r["Payment Type"] ?? "").trim();
  const amt = Number(r["Gross Total"] ?? r["Amount (After Discount)"] ?? 0);
  const cur = byPayment.get(pt) ?? { count: 0, total: 0 };
  cur.count++; cur.total += amt;
  byPayment.set(pt, cur);
}
console.log("\nBy Payment Type:");
[...byPayment.entries()].sort((a, b) => b[1].count - a[1].count).forEach(([t, v]) =>
  console.log(`  ${(t || "(blank)").padEnd(25)} ${String(v.count).padStart(5)} bills  ₹${v.total.toFixed(2)}`)
);

const byLocation = new Map<string, number>();
for (const r of rows) {
  const loc = String(r["Location Code"] ?? "").trim();
  byLocation.set(loc, (byLocation.get(loc) ?? 0) + 1);
}
console.log("\nBy Location (top 10):");
[...byLocation.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([l, n]) =>
  console.log(`  ${l.padEnd(8)} ${n}`)
);

// Sample a few rows showing PaymentType
console.log("\nFirst 5 rows with Payment Type:");
rows.slice(0, 5).forEach(r =>
  console.log(`  ${r["Posting Date"]}  ${r["Location Code"]}  ${r["Payment Type"]}  ₹${r["Gross Total"]}`)
);
