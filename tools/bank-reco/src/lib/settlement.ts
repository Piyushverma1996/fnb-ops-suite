/**
 * Aggregator settlement file parsing (Swiggy CSV + Zomato XLSX).
 *
 * Output: a normalized list of settlements, each representing one
 * (aggregator, UTR, bank-account-deposit) event with:
 *   - aggregator: "SWIGGY" | "ZOMATO"
 *   - utr: the bank UTR / transaction reference
 *   - netPayout: amount expected to hit the bank account
 *   - periodStart / periodEnd: order date range covered
 *   - rid: restaurant ID (links to outlet)
 *   - orderCount, grossSales, totalCommission, totalGstFees, totalTcs, totalTds:
 *     breakdown for the journal entries
 *   - source: filename for traceability
 */
import * as XLSX from "xlsx";

export type Settlement = {
  aggregator: "SWIGGY" | "ZOMATO";
  utr: string;
  netPayout: number;
  periodStart: Date | null;
  periodEnd: Date | null;
  rid: string;
  orderCount: number;
  grossSales: number;
  totalCommission: number;
  totalGstFees: number;
  totalTcs: number;
  totalTds: number;
  source: string;
};

const toNum = (v: unknown) => {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[₹,\s]/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

function parseDate(s: string): Date | null {
  if (!s) return null;
  // Swiggy: "4/1/2026 1:02"  or  "4/01/2026"
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
  // ISO
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
}

// -------- Swiggy CSV --------
//
// One row per order. Net Payable (after TCS, TDS) is column Y.
// All orders sharing a Current UTR pay out together in one bank credit.
export async function parseSwiggyCSV(file: File): Promise<Settlement[]> {
  const text = await file.text();
  return parseSwiggyText(text, file.name);
}

export function parseSwiggyText(text: string, source: string): Settlement[] {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = parseCSVLine(lines[0]);
  const col = (...names: string[]) => {
    for (const n of names) {
      const idx = header.findIndex(h => h.trim().toLowerCase().startsWith(n.toLowerCase()));
      if (idx >= 0) return idx;
    }
    return -1;
  };
  const I = {
    rid:        col("RID"),
    orderDate:  col("Order Date"),
    netY:       col("Net Payable Amount (after TCS and TDS"),
    customerF:  col("Customer payable"),
    swiggyFee:  col("Total Swiggy fee (including taxes) S"),
    tcs:        col("TCS X1"),
    tds:        col("TDS X2"),
    utr:        col("Current UTR", "Nodal UTR"),
    gstE:       col("GST liability of  Merchant"),
  };
  if (I.utr < 0 || I.netY < 0) return [];

  const groups = new Map<string, {
    rid: string;
    orders: number;
    gross: number;
    fee: number;
    gst: number;
    tcs: number;
    tds: number;
    net: number;
    minDate: Date | null;
    maxDate: Date | null;
  }>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const row = parseCSVLine(line);
    const utr = (row[I.utr] ?? "").trim();
    if (!utr) continue;
    const rid = (row[I.rid] ?? "").trim();
    const key = `${utr}|${rid}`;
    const d = parseDate(row[I.orderDate] ?? "");
    const cur = groups.get(key) ?? {
      rid, orders: 0, gross: 0, fee: 0, gst: 0, tcs: 0, tds: 0, net: 0,
      minDate: null as Date | null, maxDate: null as Date | null,
    };
    cur.orders++;
    cur.gross += toNum(row[I.customerF]);
    cur.fee   += toNum(row[I.swiggyFee]);
    cur.gst   += toNum(row[I.gstE]);
    cur.tcs   += toNum(row[I.tcs]);
    cur.tds   += toNum(row[I.tds]);
    cur.net   += toNum(row[I.netY]);
    if (d) {
      if (!cur.minDate || d < cur.minDate) cur.minDate = d;
      if (!cur.maxDate || d > cur.maxDate) cur.maxDate = d;
    }
    groups.set(key, cur);
  }

  const out: Settlement[] = [];
  for (const [key, g] of groups) {
    const [utr] = key.split("|");
    out.push({
      aggregator: "SWIGGY",
      utr,
      netPayout: Math.round(g.net * 100) / 100,
      periodStart: g.minDate,
      periodEnd: g.maxDate,
      rid: g.rid,
      orderCount: g.orders,
      grossSales: Math.round(g.gross * 100) / 100,
      totalCommission: Math.round(g.fee * 100) / 100,
      totalGstFees: Math.round(g.gst * 100) / 100,
      totalTcs: Math.round(g.tcs * 100) / 100,
      totalTds: Math.round(g.tds * 100) / 100,
      source,
    });
  }
  return out;
}

function parseCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// -------- Zomato XLSX --------
//
// Zomato gives a multi-sheet workbook per outlet per week. The "Summary"
// sheet holds metadata (Res id, Net Payout, Bank UTR, Pay-out cycle) but
// references hidden HSummary cells which often arrive as #REF! when read
// without the host Excel. The "Order Level" tab has per-order rows with
// the UTR, similar shape to Swiggy.
export async function parseZomatoXLSX(file: File): Promise<Settlement[]> {
  const buf = await file.arrayBuffer();
  return parseZomatoBuffer(buf, file.name);
}

export function parseZomatoBuffer(buf: ArrayBuffer, source: string): Settlement[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const orderLevel = wb.Sheets["Order Level"];
  if (!orderLevel) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(orderLevel, { header: 1, defval: null });
  if (rows.length < 4) return [];

  // Find header row — usually row index 2 or 3, has "Order ID" or similar
  let hdrIdx = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const r = (rows[i] || []).map(c => String(c ?? "").toLowerCase());
    if (r.some(c => c.includes("order id")) || r.some(c => c.includes("res id"))) { hdrIdx = i; break; }
  }
  if (hdrIdx === -1) return [];
  const header = (rows[hdrIdx] as unknown[]).map(c => String(c ?? "").trim());

  const col = (...needles: string[]): number => {
    for (const needle of needles) {
      const nLow = needle.toLowerCase();
      const idx = header.findIndex(h => h.toLowerCase().includes(nLow));
      if (idx >= 0) return idx;
    }
    return -1;
  };
  const I = {
    resId:    col("res id", "Restaurant ID"),
    orderDate:col("order date"),
    netPayout:col("net payout to res", "net payout", "amount to res"),
    utr:      col("utr", "transaction id"),
    gross:    col("total order value", "customer payable", "total amount"),
    comm:     col("zomato commission", "service fee", "commission"),
    tcs:      col("tcs"),
    tds:      col("tds"),
    gst:      col("gst on commission", "gst"),
  };
  if (I.utr < 0 || I.netPayout < 0) return [];

  const groups = new Map<string, {
    rid: string; orders: number; gross: number; fee: number; gst: number;
    tcs: number; tds: number; net: number;
    minDate: Date | null; maxDate: Date | null;
  }>();
  for (let i = hdrIdx + 1; i < rows.length; i++) {
    const r = rows[i] as unknown[];
    if (!r || r.every(c => c == null)) continue;
    const utr = String(r[I.utr] ?? "").trim();
    if (!utr || utr === "#REF!" || utr === "0") continue;
    const rid = String(r[I.resId] ?? "").trim();
    const key = `${utr}|${rid}`;
    const dRaw = r[I.orderDate];
    const d = dRaw instanceof Date ? new Date(dRaw.getFullYear(), dRaw.getMonth(), dRaw.getDate())
      : parseDate(String(dRaw ?? ""));
    const cur = groups.get(key) ?? {
      rid, orders: 0, gross: 0, fee: 0, gst: 0, tcs: 0, tds: 0, net: 0,
      minDate: null as Date | null, maxDate: null as Date | null,
    };
    cur.orders++;
    cur.gross += toNum(r[I.gross]);
    cur.fee   += toNum(r[I.comm]);
    cur.gst   += toNum(r[I.gst]);
    cur.tcs   += toNum(r[I.tcs]);
    cur.tds   += toNum(r[I.tds]);
    cur.net   += toNum(r[I.netPayout]);
    if (d) {
      if (!cur.minDate || d < cur.minDate) cur.minDate = d;
      if (!cur.maxDate || d > cur.maxDate) cur.maxDate = d;
    }
    groups.set(key, cur);
  }

  const out: Settlement[] = [];
  for (const [key, g] of groups) {
    const [utr] = key.split("|");
    out.push({
      aggregator: "ZOMATO",
      utr,
      netPayout: Math.round(g.net * 100) / 100,
      periodStart: g.minDate,
      periodEnd: g.maxDate,
      rid: g.rid,
      orderCount: g.orders,
      grossSales: Math.round(g.gross * 100) / 100,
      totalCommission: Math.round(g.fee * 100) / 100,
      totalGstFees: Math.round(g.gst * 100) / 100,
      totalTcs: Math.round(g.tcs * 100) / 100,
      totalTds: Math.round(g.tds * 100) / 100,
      source,
    });
  }
  return out;
}

// -------- Settlement-aware matching helper --------

/**
 * Find a settlement that explains a bank line. Matches when:
 *  - the UTR substring appears in the bank narration, AND amount within tol, OR
 *  - amount matches within tighter tol (₹1) and aggregator name appears in narration.
 */
export function findMatchingSettlement(
  bankNarration: string,
  bankAmount: number,
  settlements: Settlement[],
  tolerance = 1,
): Settlement | null {
  const upper = bankNarration.toUpperCase();
  // First pass: UTR substring + amount within tolerance
  for (const s of settlements) {
    if (!s.utr) continue;
    const utr = s.utr.toUpperCase();
    if (utr.length >= 6 && upper.includes(utr) && Math.abs(s.netPayout - bankAmount) <= tolerance) {
      return s;
    }
  }
  // Second pass: aggregator brand + exact amount
  const isSwiggy = upper.includes("SWIGGY") || upper.includes("BUNDL TECHNOLOGIES");
  const isZomato = upper.includes("ZOMATO") || upper.includes("ETERNAL LIMITED");
  for (const s of settlements) {
    if (Math.abs(s.netPayout - bankAmount) > tolerance) continue;
    if (isSwiggy && s.aggregator === "SWIGGY") return s;
    if (isZomato && s.aggregator === "ZOMATO") return s;
  }
  return null;
}
