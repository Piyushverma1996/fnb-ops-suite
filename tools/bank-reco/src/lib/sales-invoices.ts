/**
 * Sales Invoice parser — drives cash-deposit T+1 matching.
 *
 * Input shape: BC's standard "Sales Invoices" export with the columns
 *   No., Sell-to Customer No., Posting Date, Location Code, Payment Type,
 *   Gross Total, Amount (After Discount), …
 *
 * We keep only what the matcher needs and group by Posting Date × Location
 * × Payment Type, ready to be summed against a bank line.
 */
import * as XLSX from "xlsx";

export type SalesInvoice = {
  docNo: string;
  postingDate: Date;
  locationCode: string;
  paymentType: string;
  grossTotal: number;
};

const CASH_PAYMENT_TYPES = new Set(["CASH"]);

const toNum = (v: unknown) => {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[₹,\s]/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

function fixDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) {
    // Same xlsx-IST midnight fix as the BC parser.
    const ms = v.getTime();
    const rounded = Math.round(ms / 86400000) * 86400000;
    const u = new Date(rounded);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    const u = new Date((v - 25569) * 86400000);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  const s = String(v).trim();
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m1) { const d=+m1[1], mo=+m1[2]-1; let y=+m1[3]; if (y<100) y+=2000; return new Date(y, mo, d); }
  const m2 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m2) return new Date(+m2[1], +m2[2]-1, +m2[3]);
  return null;
}

export async function parseSalesInvoices(file: File): Promise<SalesInvoice[]> {
  const buf = await file.arrayBuffer();
  return parseSalesInvoicesBuffer(buf);
}

export function parseSalesInvoicesBuffer(buf: ArrayBuffer): SalesInvoice[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null });
  const out: SalesInvoice[] = [];
  for (const r of rows) {
    const d = fixDate(r["Posting Date"]);
    if (!d) continue;
    const docNo = String(r["No."] ?? "").trim();
    if (!docNo) continue;
    const amount = toNum(r["Gross Total"] ?? r["Amount Including VAT"] ?? r["Amount (After Discount)"]);
    if (amount === 0) continue;
    out.push({
      docNo,
      postingDate: d,
      locationCode: String(r["Location Code"] ?? "").trim().toUpperCase(),
      paymentType: String(r["Payment Type"] ?? "").trim().toUpperCase(),
      grossTotal: Math.round(amount * 100) / 100,
    });
  }
  return out;
}

/** Filter to just the cash-payment invoices for a given outlet/branch code. */
export function cashInvoicesForOutlet(invoices: SalesInvoice[], outletCode: string): SalesInvoice[] {
  const target = outletCode.trim().toUpperCase();
  return invoices.filter(i =>
    CASH_PAYMENT_TYPES.has(i.paymentType.toUpperCase()) && i.locationCode === target,
  );
}
