/** Verify the new parseDate rejects garbage like "2225.06" and "STATEMENT". */
function parseDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) {
    const ms = v.getTime();
    const rounded = Math.round(ms / 86400000) * 86400000;
    const u = new Date(rounded);
    return saneOrNull(new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()));
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = (v - 25569) * 86400000;
    const u = new Date(ms);
    return saneOrNull(new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()));
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { const d=+m[1], mo=+m[2]-1; let y=+m[3]; if (y<100) y+=2000; return saneOrNull(new Date(y, mo, d)); }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return saneOrNull(new Date(+m[1], +m[2]-1, +m[3]));
  m = s.match(/^(\d{1,2})[\-\s]+([A-Za-z]{3,})[\-\s]+(\d{4})$/);
  if (m) {
    const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    const mi = months.indexOf(m[2].slice(0, 3).toUpperCase());
    if (mi >= 0) return saneOrNull(new Date(+m[3], mi, +m[1]));
  }
  return null;
}
function saneOrNull(d: Date | null): Date | null {
  if (!d) return null;
  const y = d.getFullYear();
  if (!Number.isFinite(y) || y < 2020 || y > 2030) return null;
  return d;
}

const cases: [unknown, "VALID"|"REJECT", string?][] = [
  ["01/04/26", "VALID", "DD/MM/YY → 2026-04-01"],
  ["01/04/2026", "VALID", "DD/MM/YYYY"],
  ["2026-04-01", "VALID", "ISO"],
  ["31-Mar-2026", "VALID", "DD-MMM-YYYY"],
  ["2225.06", "REJECT", "the bug — HDFC statement footer"],
  ["STATEMENT", "REJECT", ""],
  ["", "REJECT", ""],
  ["10/10/30", "VALID", "2030 OK"],
  ["10/10/31", "REJECT", "2031 out of plausible window"],
  ["10/10/19", "REJECT", "2019 out of plausible window"],
  ["01/04/26 page 6", "REJECT", "trailing junk → strict regex fails"],
];

let pass = 0, fail = 0;
for (const [input, expected, note] of cases) {
  const result = parseDate(input);
  const actual = result === null ? "REJECT" : "VALID";
  const ok = actual === expected;
  if (ok) pass++; else fail++;
  const mark = ok ? "✓" : "✗";
  console.log(`${mark}  parseDate(${JSON.stringify(input)}) → ${result?.toISOString().slice(0,10) ?? "null"}  expected ${expected}  ${note ?? ""}`);
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
