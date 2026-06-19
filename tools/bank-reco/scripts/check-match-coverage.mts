/** Inspect what BC doc prefixes got matched in the Action Plan sheet. */
import * as fs from "node:fs";
import * as XLSX from "xlsx";

const wb = XLSX.read(fs.readFileSync(process.argv[2]), { type: "buffer", cellDates: true });
const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["1 Action Plan"], { defval: null });

const byPrefix = new Map<string, { rows: number; tiers: Record<string, number> }>();
for (const r of rows) {
  const docs = String(r["BC Doc(s) to Apply"] ?? "").split(";").map(s => s.trim()).filter(Boolean);
  const tier = String(r["Tier"]);
  for (const d of docs) {
    const m = d.match(/^([A-Z]+)/i);
    const p = m ? m[1].toUpperCase() : "?";
    const cur = byPrefix.get(p) ?? { rows: 0, tiers: {} };
    cur.rows++;
    cur.tiers[tier] = (cur.tiers[tier] ?? 0) + 1;
    byPrefix.set(p, cur);
  }
}
console.log(`Total action items: ${rows.length}`);
console.log("\nDoc prefix coverage:");
console.log("Prefix    Rows   T1    T2    T3    T4");
[...byPrefix.entries()].sort((a, b) => b[1].rows - a[1].rows).forEach(([p, v]) =>
  console.log(`${p.padEnd(8)} ${String(v.rows).padStart(5)}  ${String(v.tiers.T1 ?? 0).padStart(4)}  ${String(v.tiers.T2 ?? 0).padStart(4)}  ${String(v.tiers.T3 ?? 0).padStart(4)}  ${String(v.tiers.T4 ?? 0).padStart(4)}`),
);
