/** Find the bank entry that's being parsed as year 2225 (or any other crazy year). */
import * as fs from "node:fs";
import * as XLSX from "xlsx";

const buf = fs.readFileSync("C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Bank Reco statements/DWK_9146-imp.xls");
const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: null });

let hdr = 21;
for (let i = 0; i < Math.min(40, rows.length); i++) {
  const r = (rows[i] || []).map(c => (c == null ? "" : String(c).toUpperCase()));
  if (r.some(c => c.includes("DATE")) && r.some(c => c.includes("NARRATION") || c.includes("PARTICULAR"))) { hdr = i; break; }
}
console.log(`Header at row ${hdr}`);

// Parse the same way our matcher does
function parseDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) {
    const r = Math.round(v.getTime() / 86400000) * 86400000;
    const u = new Date(r);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { const d=+m[1], mo=+m[2]-1; let y=+m[3]; if (y<100) y+=2000; return new Date(y, mo, d); }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2]-1, +m[3]);
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
}

// Look at ALL non-trivial dates
let parsedCount = 0;
const yearHist = new Map<number, number>();
for (let i = hdr + 1; i < rows.length; i++) {
  const r = rows[i] || [];
  if (!r[0]) continue;
  const ds = String(r[0]).trim();
  if (ds.includes("*") || ds.toLowerCase().includes("statement")) continue;
  const d = parseDate(ds);
  if (!d) continue;
  parsedCount++;
  const y = d.getFullYear();
  yearHist.set(y, (yearHist.get(y) ?? 0) + 1);
  if (y > 2030 || y < 2020) {
    console.log(`Row ${i}: date string "${ds}" → parsed as ${d.toISOString()}  | narration: ${String(r[1] ?? "").slice(0, 60)}`);
  }
}
console.log(`\nTotal parsed: ${parsedCount}`);
console.log(`Year distribution:`);
[...yearHist.entries()].sort((a, b) => a[0] - b[0]).forEach(([y, n]) => console.log(`  ${y}: ${n}`));
