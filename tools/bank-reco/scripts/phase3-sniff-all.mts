/** Phase 3: sniff every BC file in the source folder, report branches detected. */
import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";

const FOLDER = process.argv[2];
if (!FOLDER) { console.error("Usage: phase3-sniff-all.mts <folder>"); process.exit(1); }

function fixDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) {
    const rounded = Math.round(v.getTime() / 86400000) * 86400000;
    const u = new Date(rounded);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  return null;
}

const files = fs.readdirSync(FOLDER).filter(f => f.endsWith(".xlsx")).sort();
console.log(`Scanning ${files.length} files in ${FOLDER}\n`);

const failures: string[] = [];
for (const f of files) {
  try {
    const buf = fs.readFileSync(path.join(FOLDER, f));
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
    const counts = new Map<string, number>();
    let minD: Date | null = null, maxD: Date | null = null, total = 0;
    for (const r of rows) {
      const d = fixDate(r["Posting Date"]);
      if (!d) continue;
      total++;
      if (!minD || d < minD) minD = d;
      if (!maxD || d > maxD) maxD = d;
      const code = String(r["Branch Code"] ?? "").trim().toUpperCase();
      if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    const branches = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const range = minD && maxD ? `${minD.toISOString().slice(0,10)}→${maxD.toISOString().slice(0,10)}` : "(no dates)";
    const top = branches.slice(0, 5).map(([c, n]) => `${c}=${n}`).join(", ");
    console.log(`OK  ${f.padEnd(48)} ${total.toString().padStart(5)} rows | ${range} | ${branches.length} branches: ${top}${branches.length > 5 ? "…" : ""}`);
  } catch (e: unknown) {
    failures.push(`${f}: ${e instanceof Error ? e.message : String(e)}`);
    console.log(`FAIL ${f}: ${e instanceof Error ? e.message : e}`);
  }
}
console.log(`\nDone. ${files.length - failures.length} ok, ${failures.length} failed.`);
