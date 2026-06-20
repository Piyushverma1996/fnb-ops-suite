/** Find what bank narrations look like for cash deposit lines. */
import * as fs from "node:fs";
import * as XLSX from "xlsx";

const BANK_DIR = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Bank Reco statements";

function parseBankNarrations(file: string): string[] {
  const buf = fs.readFileSync(`${BANK_DIR}/${file}`);
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: null });
  let hdr = 21;
  for (let i = 0; i < Math.min(40, rows.length); i++) {
    const r = (rows[i] || []).map(c => (c == null ? "" : String(c).toUpperCase()));
    if (r.some(c => c.includes("NARRATION") || c.includes("PARTICULAR"))) { hdr = i; break; }
  }
  const out: string[] = [];
  for (let i = hdr + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (!r[1]) continue;
    out.push(String(r[1]).trim());
  }
  return out;
}

const all: string[] = [];
for (const f of fs.readdirSync(BANK_DIR).filter(x => x.endsWith(".xls"))) {
  all.push(...parseBankNarrations(f));
}

const tokens = ["CASH", "CDM", "BCTM", "DEPO", "BY CASH"];
console.log(`Total narrations: ${all.length}`);
for (const t of tokens) {
  const hits = all.filter(n => n.toUpperCase().includes(t));
  console.log(`\n"${t}" -> ${hits.length} hits. Sample:`);
  const samples = new Set<string>();
  for (const h of hits) {
    const truncated = h.slice(0, 90);
    samples.add(truncated);
    if (samples.size >= 6) break;
  }
  [...samples].forEach(s => console.log(`  ${s}`));
}
