/**
 * Excel parsers for HDFC bank statement and BC Bank Account Ledger Entries.
 */
import * as XLSX from "xlsx";
import { BankEntry, BCEntry, classifyBank, classifyBC } from "./matcher";

export async function parseBankStatement(file: File): Promise<BankEntry[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: null });

  // Find header row
  let hdrRow = -1;
  for (let i = 0; i < Math.min(40, rows.length); i++) {
    const row = (rows[i] || []).map(c => (c == null ? "" : String(c).toUpperCase()));
    const hasDate = row.some(c => c.includes("DATE"));
    const hasNarr = row.some(c => c.includes("NARRATION") || c.includes("PARTICULAR"));
    if (hasDate && hasNarr) { hdrRow = i; break; }
  }
  if (hdrRow === -1) hdrRow = 21;

  // Data rows (skip the row with asterisks if present)
  const dataStart = hdrRow + 1;
  const entries: BankEntry[] = [];
  let id = 0;

  for (let i = dataStart; i < rows.length; i++) {
    const r = rows[i] || [];
    if (!r[0]) continue;
    const dateStr = String(r[0]).trim();
    if (dateStr.includes("*") || dateStr === "" || dateStr.toLowerCase().includes("statement")) continue;
    const date = parseDate(dateStr);
    if (!date) continue;
    const narration = String(r[1] || "").trim();
    const debit = toNum(r[4]);
    const credit = toNum(r[5]);
    const balance = toNum(r[6]);
    const amount = credit - debit;
    if (debit === 0 && credit === 0) continue;
    entries.push({
      id: id++,
      date,
      narration,
      debit,
      credit,
      balance,
      amount,
      direction: amount > 0 ? "Credit" : "Debit",
      absAmount: round2(Math.abs(amount)),
      category: classifyBank(narration),
    });
  }
  return entries;
}

/** Quick metadata sniff: list distinct branch codes + posting-date range. */
export type BCMeta = {
  branches: { code: string; count: number }[];
  minDate: Date | null;
  maxDate: Date | null;
  totalRows: number;
};

export async function sniffBCLedger(file: File): Promise<BCMeta> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const counts = new Map<string, number>();
  let minD: Date | null = null;
  let maxD: Date | null = null;
  let total = 0;
  for (const row of rows) {
    const pd = row["Posting Date"];
    if (!pd) continue;
    const date = parseDate(pd);
    if (!date) continue;
    total++;
    if (!minD || date < minD) minD = date;
    if (!maxD || date > maxD) maxD = date;
    const code = row["Branch Code"] ? String(row["Branch Code"]).toUpperCase().trim() : "";
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  const branches = [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);
  return { branches, minDate: minD, maxDate: maxD, totalRows: total };
}

/** Quick sniff of bank statement: just the date range. */
export async function sniffBankStatement(file: File): Promise<{ minDate: Date | null; maxDate: Date | null; rows: number }> {
  const entries = await parseBankStatement(file);
  if (entries.length === 0) return { minDate: null, maxDate: null, rows: 0 };
  let min = entries[0].date, max = entries[0].date;
  for (const e of entries) {
    if (e.date < min) min = e.date;
    if (e.date > max) max = e.date;
  }
  return { minDate: min, maxDate: max, rows: entries.length };
}

export async function parseBCLedger(file: File, branchFilter?: string): Promise<BCEntry[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const entries: BCEntry[] = [];
  let id = 0;
  for (const row of rows) {
    const pd = row["Posting Date"];
    if (!pd) continue;
    const date = parseDate(pd);
    if (!date) continue;
    const branchCode = row["Branch Code"] ? String(row["Branch Code"]) : "";
    if (branchFilter && branchCode.toUpperCase() !== branchFilter.toUpperCase()) continue;
    const amount = toNum(row["Amount"]);
    if (amount === 0) continue;
    const description = String(row["Description"] || "");
    entries.push({
      id: id++,
      postingDate: date,
      documentType: row["Document Type"] ? String(row["Document Type"]) : "",
      documentNo: String(row["Document No."] || ""),
      description,
      branchCode,
      amount,
      direction: amount > 0 ? "Credit" : "Debit",
      absAmount: round2(Math.abs(amount)),
      category: classifyBC(description),
    });
  }
  return entries;
}

// helpers
function toNum(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/,/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) {
    // xlsx returns Excel date cells as JS Dates whose UTC time-of-day equals the
    // host TZ offset (so an Excel "31-Mar-2026" becomes 2026-03-30T18:29:50Z in
    // IST). Round to nearest UTC day, then rebuild as local midnight so the
    // calendar date matches what was visually entered in Excel.
    const ms = v.getTime();
    const rounded = Math.round(ms / 86400000) * 86400000;
    const u = new Date(rounded);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  // Excel serial number (when cellDates is off or library returns raw)
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = (v - 25569) * 86400000;
    const u = new Date(ms);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  const s = String(v).trim();
  // DD/MM/YY or DD/MM/YYYY
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const d = +m[1], mo = +m[2] - 1;
    let y = +m[3];
    if (y < 100) y += 2000;
    return new Date(y, mo, d);
  }
  // YYYY-MM-DD
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  // fallback
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
}
