/**
 * Bank Reconciliation Matching Engine (TypeScript port).
 *
 * 4-tier matching:
 *  T1: Exact 1:1 (same date, same amount, compatible category)
 *  T2: Many-to-One same date (BC entries summing to one bank line)
 *  T3: Date-tolerant 1:1
 *  T4: Many-to-One date-tolerant
 */

export type BankEntry = {
  id: number;
  date: Date;
  narration: string;
  debit: number;
  credit: number;
  balance: number;
  amount: number;          // credit - debit
  direction: "Credit" | "Debit";
  absAmount: number;
  category: BankCategory;
};

export type BCEntry = {
  id: number;
  postingDate: Date;
  documentType?: string;
  documentNo: string;
  description: string;
  branchCode?: string;
  amount: number;
  direction: "Credit" | "Debit";
  absAmount: number;
  category: BCCategory;
};

export type BankCategory =
  | "CARD_SETTLEMENT" | "SWIGGY" | "ZOMATO" | "AMEX" | "DINEOUT"
  | "INTERNAL_CR" | "INTERNAL_DR" | "PHONEPE" | "PAYTM" | "GPAY"
  | "BHARATPE" | "UPI" | "SALARY" | "VENDOR" | "NEFT_OTHER" | "CHEQUE"
  | "CASH_DEPOSIT" | "OTHER";

export type BCCategory =
  | "CARD_SETTLEMENT" | "AMEX" | "SWIGGY" | "ZOMATO" | "DINEOUT"
  | "PHONEPE" | "PAYTM" | "GPAY" | "BHARATPE" | "UPI"
  | "INVOICE_PAYMENT" | "SALARY" | "VENDOR" | "INTERNAL_TRANSFER" | "OTHER";

export type Match = {
  bankId: number;
  bcIds: number[];
  tier: "T1" | "T2" | "T3" | "T4" | "T5" | "T6" | "T7" | "T8";
  tierLabel: string;
  confidence: number;
  bankDate: Date;
  bcDate: Date;
  bankAmount: number;
  bcSumAmount: number;
  bankNarration: string;
  bcDocs: string;
  bcDescriptions: string;
  category: BankCategory;
  direction: "Credit" | "Debit";
  settlement?: SettlementHit;
  cashBucket?: CashBucketHit;
  crossOutlet?: CrossOutletHit;
};

export type CrossOutletHit = {
  counterpartyOutlet: string;     // e.g. "AV", or full name from rest-id-map
  counterpartyBranch: string;     // raw branch code as it appeared in BC
  counterpartyDocNo: string;
  counterpartyDescription: string;
  counterpartyDate: Date;
};

export type CashBucketHit = {
  invoiceCount: number;
  invoiceDocs: string[];
  invoiceDate: string;          // YYYY-MM-DD of the bucket
  outletCode: string;
  bucketTotal: number;
};

export type SettlementHit = {
  aggregator: "SWIGGY" | "ZOMATO" | "AMEX" | "PHONEPE";
  utr: string;
  netPayout: number;
  orderCount: number;
  grossSales: number;
  totalCommission: number;
  totalGstFees: number;
  totalTcs: number;
  totalTds: number;
  periodStart: Date | null;
  periodEnd: Date | null;
  rid: string;
};

export type MatchResult = {
  matches: Match[];
  unmatchedBank: BankEntry[];
  unmatchedBC: BCEntry[];
  summary: DailySummary[];
  stats: {
    totalBank: number;
    totalBC: number;
    matchedBank: number;
    matchedBC: number;
    unmatchedBank: number;
    unmatchedBC: number;
    matchPct: number;
  };
};

export type DailySummary = {
  date: string;
  bankEntries: number;
  bcEntries: number;
  matched: number;
  unmatchedBank: number;
  unmatchedBC: number;
  matchPct: number;
};

// -------- Category classifiers --------
export function classifyBank(narr: string): BankCategory {
  const n = (narr || "").toUpperCase();
  if (n.includes("TERMINAL") && n.includes("CARDS SETTL")) return "CARD_SETTLEMENT";
  // Physical cash deposited at HDFC — matches T-1 sum of BC cash SI entries.
  if (n.includes("CASH DEPOSIT") || n.includes("CASH DEP")) return "CASH_DEPOSIT";
  if (n.includes("NEFT") && n.includes("SWIGGY")) return "SWIGGY";
  if (n.includes("NEFT") && n.includes("ZOMATO")) return "ZOMATO";
  if (n.includes("NEFT") && (n.includes("AMERICAN EXPRESS") || n.includes("AMEX"))) return "AMEX";
  if (n.includes("NEFT") && n.includes("DINEOUT")) return "DINEOUT";
  if (n.includes("IB FUNDS TRANSFER CR")) return "INTERNAL_CR";
  if (n.includes("IB FUNDS TRANSFER DR")) return "INTERNAL_DR";
  // Also recognise the short-form "FT - CR -" / "FT - DR -" pattern used for
  // transfers between the outlet's main account and the HDFC-OD overdraft.
  if (/^FT\s*-\s*CR/i.test(n)) return "INTERNAL_CR";
  if (/^FT\s*-\s*DR/i.test(n)) return "INTERNAL_DR";
  if (n.includes("PHONEPE") || n.includes("PHONE PE")) return "PHONEPE";
  if (n.includes("PAYTM")) return "PAYTM";
  if (n.includes("GPAY") || n.includes("GOOGLE PAY")) return "GPAY";
  if (n.includes("BHARATPE") || n.includes("BHARAT PE")) return "BHARATPE";
  if (n.includes("UPI")) return "UPI";
  if (n.includes("SALARY")) return "SALARY";
  if (n.includes("TPT") && n.includes("VENDOR")) return "VENDOR";
  if (n.includes("NEFT") || n.includes("RTGS") || n.includes("IMPS")) return "NEFT_OTHER";
  if (n.includes("CHQ") || n.includes("CHEQUE")) return "CHEQUE";
  return "OTHER";
}

export function classifyBC(desc: string): BCCategory {
  const d = (desc || "").toUpperCase();
  if (d.includes("CARD GROUP") && d.includes("AMERICAN")) return "AMEX";
  if (d.includes("CARD GROUP")) return "CARD_SETTLEMENT";
  if (d.includes("AMERICAN") && d.includes("CARD")) return "AMEX";
  // Some PBR descriptions use "TERMINAL ... CARDS SETTL." instead of "Card Group".
  if (d.includes("CARDS SETTL")) return "CARD_SETTLEMENT";
  if (d.includes("SWIGGY")) return "SWIGGY";
  if (d.includes("ZOMATO")) return "ZOMATO";
  if (d.includes("DINEOUT")) return "DINEOUT";
  if (d.includes("PHONE PE") || d.includes("PHONEPE")) return "PHONEPE";
  if (d.includes("PAYTM")) return "PAYTM";
  if (d.includes("GPAY") || d.includes("GOOGLE PAY")) return "GPAY";
  if (d.includes("BHARATPE") || d.includes("BHARAT PE")) return "BHARATPE";
  if (d.includes("UPI")) return "UPI";
  if (d.includes("INVOICE")) return "INVOICE_PAYMENT";
  if (d.includes("SALARY")) return "SALARY";
  if (d.includes("VENDOR") || d.includes("VC/") || d.includes("CV/")) return "VENDOR";
  if (d.includes("HDFC") && (d.includes("50200") || d.includes("99910"))) return "INTERNAL_TRANSFER";
  if (d.includes("IB FUNDS")) return "INTERNAL_TRANSFER";
  return "OTHER";
}

// Compatible BC categories for each bank category
const CATEGORY_MAP: Record<BankCategory, Set<BCCategory>> = {
  CARD_SETTLEMENT: new Set(["CARD_SETTLEMENT", "INVOICE_PAYMENT"]),
  SWIGGY:          new Set(["SWIGGY", "DINEOUT", "INVOICE_PAYMENT"]),
  ZOMATO:          new Set(["ZOMATO", "DINEOUT", "INVOICE_PAYMENT"]),
  AMEX:            new Set(["AMEX", "CARD_SETTLEMENT", "INVOICE_PAYMENT"]),
  DINEOUT:         new Set(["DINEOUT", "SWIGGY", "INVOICE_PAYMENT"]),
  INTERNAL_CR:     new Set(["INTERNAL_TRANSFER"]),
  INTERNAL_DR:     new Set(["INTERNAL_TRANSFER"]),
  PHONEPE:         new Set(["PHONEPE", "INVOICE_PAYMENT"]),
  PAYTM:           new Set(["PAYTM", "INVOICE_PAYMENT"]),
  GPAY:            new Set(["GPAY", "INVOICE_PAYMENT"]),
  BHARATPE:        new Set(["BHARATPE", "INVOICE_PAYMENT"]),
  UPI:             new Set(["UPI", "INVOICE_PAYMENT"]),
  SALARY:          new Set(["SALARY"]),
  VENDOR:          new Set(["VENDOR"]),
  NEFT_OTHER:      new Set(["INVOICE_PAYMENT", "VENDOR", "INTERNAL_TRANSFER", "OTHER"]),
  CHEQUE:          new Set(["INVOICE_PAYMENT", "VENDOR", "OTHER"]),
  // Physical cash deposits reconcile to the sum of cash-payment Sales Invoices
  // (BC posts each cash SI as one bank-ledger entry with description starting
  // "Invoice PP/..." — classified as INVOICE_PAYMENT). Allow OTHER as a
  // looser fallback for descriptions like "Cash Sale (HDFC)".
  CASH_DEPOSIT:    new Set(["INVOICE_PAYMENT", "OTHER"]),
  OTHER:           new Set(["OTHER"]),
};

// -------- Subset-sum helper --------
//
// Strategy by pool size:
//   ≤19       : exact enumeration of all combinations of size 2..maxSize
//   20-28     : meet-in-the-middle (sort one half's sums, binary-search the other)
//   29-200    : multi-start greedy with several pivot strategies + 1-swap repair
//   >200      : single greedy descending pass
//
// Empirical: real daily SI-payment pools per outlet are 30-100 entries — the
// previous "exact only up to 20, greedy thereafter" missed most consolidations
// because the greedy ordering rarely matches the actual deposit composition.
function findSubset(pool: BCEntry[], target: number, tolerance: number, maxSize: number): number[] | null {
  if (pool.length === 0) return null;
  const sorted = [...pool].sort((a, b) => b.absAmount - a.absAmount);
  const ids = sorted.map(s => s.id);
  const amts = sorted.map(s => s.absAmount);

  // Trivial: a single entry already within tolerance
  for (let i = 0; i < amts.length; i++) {
    if (Math.abs(amts[i] - target) <= tolerance) return [ids[i]];
  }

  const n = amts.length;
  const effectiveMax = Math.min(maxSize, n);

  // Tier A: exhaustive enumeration for small pools
  if (n <= 19) {
    for (let sz = 2; sz <= effectiveMax; sz++) {
      const r = exactSubsetOfSize(amts, ids, target, tolerance, sz);
      if (r) return r;
    }
    return null;
  }

  // Tier B: meet-in-the-middle
  if (n <= 28) {
    const r = meetInTheMiddle(amts, ids, target, tolerance, effectiveMax);
    if (r) return r;
    return null;
  }

  // Tier C: multi-start greedy with repair
  return multiStartGreedy(amts, ids, target, tolerance, effectiveMax);
}

function exactSubsetOfSize(amts: number[], ids: number[], target: number, tol: number, size: number): number[] | null {
  const n = amts.length;
  if (size > n) return null;
  const idx: number[] = new Array(size).fill(0);
  for (let i = 0; i < size; i++) idx[i] = i;
  while (true) {
    let s = 0;
    for (let i = 0; i < size; i++) s += amts[idx[i]];
    if (Math.abs(s - target) <= tol) return idx.map(i => ids[i]);
    let i = size - 1;
    while (i >= 0 && idx[i] === n - size + i) i--;
    if (i < 0) return null;
    idx[i]++;
    for (let j = i + 1; j < size; j++) idx[j] = idx[j - 1] + 1;
  }
}

function meetInTheMiddle(amts: number[], ids: number[], target: number, tol: number, maxSize: number): number[] | null {
  const n = amts.length;
  const half = n >> 1;
  // Enumerate all 2^half subsets of the first half, store {sum, mask}
  const leftSums: { sum: number; mask: number }[] = [];
  const leftLimit = 1 << half;
  for (let m = 1; m < leftLimit; m++) {
    let s = 0, c = 0;
    for (let i = 0; i < half; i++) if (m & (1 << i)) { s += amts[i]; c++; }
    if (c <= maxSize) leftSums.push({ sum: s, mask: m });
  }
  // Sort by sum for binary search
  leftSums.sort((a, b) => a.sum - b.sum);
  const sumsOnly = leftSums.map(x => x.sum);

  // Enumerate all 2^(n-half) subsets of the second half
  const rightLen = n - half;
  const rightLimit = 1 << rightLen;
  for (let m = 0; m < rightLimit; m++) {
    let s = 0, c = 0;
    for (let i = 0; i < rightLen; i++) if (m & (1 << i)) { s += amts[half + i]; c++; }
    if (c > maxSize) continue;
    const need = target - s;
    // include empty-left case (m=0 not in leftSums, handle separately)
    if (Math.abs(need) <= tol && m !== 0) return collectMask(ids, half, m, rightLen);
    if (c === maxSize) continue; // can't add more from left
    // binary search for need in leftSums (within tolerance)
    const lo = lowerBound(sumsOnly, need - tol);
    for (let j = lo; j < sumsOnly.length; j++) {
      if (sumsOnly[j] > need + tol) break;
      const lm = leftSums[j].mask;
      const totalCount = popcount(lm) + c;
      if (totalCount <= maxSize && totalCount >= 2) {
        return collectMasks(ids, half, lm, m, rightLen);
      }
    }
  }
  return null;
}

function lowerBound(a: number[], v: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; }
  return lo;
}

function popcount(m: number): number {
  let c = 0; while (m) { c += m & 1; m >>>= 1; } return c;
}

function collectMask(ids: number[], half: number, rightMask: number, rightLen: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < rightLen; i++) if (rightMask & (1 << i)) out.push(ids[half + i]);
  return out;
}

function collectMasks(ids: number[], half: number, leftMask: number, rightMask: number, rightLen: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < half; i++) if (leftMask & (1 << i)) out.push(ids[i]);
  for (let i = 0; i < rightLen; i++) if (rightMask & (1 << i)) out.push(ids[half + i]);
  return out;
}

function multiStartGreedy(amts: number[], ids: number[], target: number, tol: number, maxSize: number): number[] | null {
  // Strategy 1: descending greedy (largest first, take if fits)
  const r1 = greedyPass(amts, ids, target, tol, maxSize, (a, b) => b - a);
  if (r1) return r1;
  // Strategy 2: ascending greedy
  const ascAmts = [...amts].sort((a, b) => a - b);
  const ascIds = amts.map((_, i) => i).sort((a, b) => amts[a] - amts[b]).map(i => ids[i]);
  const r2 = greedyPassRaw(ascAmts, ascIds, target, tol, maxSize);
  if (r2) return r2;
  // Strategy 3: descending greedy with 1-swap repair
  return greedyDescWithSwap(amts, ids, target, tol, maxSize);
}

function greedyPass(amts: number[], ids: number[], target: number, tol: number, maxSize: number, cmp: (a: number, b: number) => number): number[] | null {
  const idx = amts.map((_, i) => i).sort((a, b) => cmp(amts[a], amts[b]));
  const sortedA = idx.map(i => amts[i]);
  const sortedI = idx.map(i => ids[i]);
  return greedyPassRaw(sortedA, sortedI, target, tol, maxSize);
}

function greedyPassRaw(amts: number[], ids: number[], target: number, tol: number, maxSize: number): number[] | null {
  const chosen: number[] = [];
  let total = 0;
  for (let i = 0; i < amts.length; i++) {
    if (chosen.length >= maxSize) break;
    if (total + amts[i] <= target + tol) {
      chosen.push(ids[i]);
      total += amts[i];
      if (Math.abs(total - target) <= tol) return chosen;
    }
  }
  return Math.abs(total - target) <= tol && chosen.length > 0 ? chosen : null;
}

function greedyDescWithSwap(amts: number[], ids: number[], target: number, tol: number, maxSize: number): number[] | null {
  // Build descending greedy candidate (allowing overshoot up to one item)
  const chosen: number[] = [];
  const chosenAmts: number[] = [];
  let total = 0;
  const remaining: { amt: number; id: number }[] = [];
  for (let i = 0; i < amts.length; i++) {
    if (chosen.length < maxSize && total + amts[i] <= target + tol) {
      chosen.push(ids[i]); chosenAmts.push(amts[i]); total += amts[i];
      if (Math.abs(total - target) <= tol) return chosen;
    } else {
      remaining.push({ amt: amts[i], id: ids[i] });
    }
  }
  if (Math.abs(total - target) <= tol && chosen.length > 0) return chosen;
  // Try swapping one chosen item with one unchosen item to land on target
  const need = target - total;
  for (let i = 0; i < chosen.length; i++) {
    const wanted = chosenAmts[i] + need;
    for (const r of remaining) {
      if (Math.abs(r.amt - wanted) <= tol) {
        const out = chosen.slice();
        out[i] = r.id;
        return out;
      }
    }
  }
  return null;
}

// -------- Main matcher --------
export type MatchOptions = {
  dateToleranceDays: number;
  amountTolerance: number;
  maxComponents: number;
  settlements?: SettlementInput[];
  cashInvoices?: CashInvoiceInput[];
  outletCode?: string;
  // BC entries from OTHER branches in the same export (or additional uploaded
  // BC files). Used by T7 to find contra vouchers for IB FUNDS TRANSFER bank
  // lines that pair against another outlet's ledger.
  crossOutletBC?: BCEntry[];
};

/** A single cash-payment Sales Invoice, used for T6 deposit matching. */
export type CashInvoiceInput = {
  docNo: string;
  postingDate: Date;
  locationCode: string;
  grossTotal: number;
};

/** Slim view of a parsed settlement — passed in from settlement.ts. */
export type SettlementInput = {
  aggregator: "SWIGGY" | "ZOMATO" | "AMEX" | "PHONEPE";
  utr: string;
  netPayout: number;
  rid: string;
  orderCount: number;
  grossSales: number;
  totalCommission: number;
  totalGstFees: number;
  totalTcs: number;
  totalTds: number;
  periodStart: Date | null;
  periodEnd: Date | null;
};

export function runMatch(bankAll: BankEntry[], bcAll: BCEntry[], opts: MatchOptions): MatchResult {
  const matches: Match[] = [];
  const bankUsed = new Set<number>();
  const bcUsed = new Set<number>();
  const msDay = 24 * 60 * 60 * 1000;

  const sameDate = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const withinDays = (a: Date, b: Date, days: number) =>
    Math.abs(a.getTime() - b.getTime()) <= days * msDay;

  // ---- Tier 1: Exact 1:1 ----
  for (const b of bankAll) {
    if (bankUsed.has(b.id)) continue;
    const validCats = CATEGORY_MAP[b.category];
    const cands = bcAll.filter(c =>
      !bcUsed.has(c.id) &&
      c.direction === b.direction &&
      sameDate(c.postingDate, b.date) &&
      Math.abs(c.absAmount - b.absAmount) <= 0.01 &&
      validCats.has(c.category)
    );
    if (cands.length === 1) {
      const c = cands[0];
      matches.push(mkMatch(b, [c], "T1", "T1: Exact 1:1", 100));
      bankUsed.add(b.id); bcUsed.add(c.id);
    }
  }

  // ---- Tier 2: Many-to-One same date ----
  for (const b of bankAll) {
    if (bankUsed.has(b.id)) continue;
    const validCats = CATEGORY_MAP[b.category];
    const pool = bcAll.filter(c =>
      !bcUsed.has(c.id) &&
      c.direction === b.direction &&
      sameDate(c.postingDate, b.date) &&
      validCats.has(c.category)
    );
    const combo = findSubset(pool, b.absAmount, opts.amountTolerance, opts.maxComponents);
    if (combo && combo.length > 0) {
      const matched = pool.filter(p => combo.includes(p.id));
      matches.push(mkMatch(b, matched, "T2", `T2: Many-to-One (${combo.length} BC)`, 95));
      bankUsed.add(b.id); combo.forEach(id => bcUsed.add(id));
    }
  }

  // ---- Tier 3: Date-tolerant 1:1 ----
  for (const b of bankAll) {
    if (bankUsed.has(b.id)) continue;
    const validCats = CATEGORY_MAP[b.category];
    const cands = bcAll.filter(c =>
      !bcUsed.has(c.id) &&
      c.direction === b.direction &&
      withinDays(c.postingDate, b.date, opts.dateToleranceDays) &&
      Math.abs(c.absAmount - b.absAmount) <= opts.amountTolerance &&
      validCats.has(c.category)
    );
    if (cands.length > 0) {
      cands.sort((x, y) => Math.abs(x.postingDate.getTime() - b.date.getTime()) - Math.abs(y.postingDate.getTime() - b.date.getTime()));
      const c = cands[0];
      const diff = Math.round((c.postingDate.getTime() - b.date.getTime()) / msDay);
      matches.push(mkMatch(b, [c], "T3", `T3: Date-tolerant (${diff >= 0 ? "+" : ""}${diff}d)`, 80));
      bankUsed.add(b.id); bcUsed.add(c.id);
    }
  }

  // ---- Tier 4: Many-to-One date-tolerant ----
  for (const b of bankAll) {
    if (bankUsed.has(b.id)) continue;
    const validCats = CATEGORY_MAP[b.category];
    const pool = bcAll.filter(c =>
      !bcUsed.has(c.id) &&
      c.direction === b.direction &&
      withinDays(c.postingDate, b.date, opts.dateToleranceDays) &&
      validCats.has(c.category)
    );
    const combo = findSubset(pool, b.absAmount, opts.amountTolerance, opts.maxComponents);
    if (combo && combo.length > 0) {
      const matched = pool.filter(p => combo.includes(p.id));
      matches.push(mkMatch(b, matched, "T4", `T4: Many-to-One date-tolerant (${combo.length})`, 70));
      bankUsed.add(b.id); combo.forEach(id => bcUsed.add(id));
    }
  }

  // ---- Tier 5: Aggregator settlement match ----
  //
  // For each still-unmatched bank entry, look at provided settlement files
  // (Swiggy / Zomato). A settlement matches if its UTR appears in the bank
  // narration AND its Net Payout equals the bank amount within tolerance, OR
  // (fallback) the brand name appears in narration AND the amount matches
  // within tighter tolerance.
  if (opts.settlements && opts.settlements.length > 0) {
    for (const b of bankAll) {
      if (bankUsed.has(b.id)) continue;
      const hit = findSettlementMatch(b, opts.settlements, opts.amountTolerance);
      if (!hit) continue;
      const m: Match = {
        bankId: b.id,
        bcIds: [],
        tier: "T5",
        tierLabel: `T5: ${hit.aggregator} settlement (${hit.orderCount} orders)`,
        confidence: 90,
        bankDate: b.date,
        bcDate: b.date,
        bankAmount: b.absAmount,
        bcSumAmount: hit.netPayout,
        bankNarration: b.narration,
        bcDocs: `${hit.aggregator} UTR ${hit.utr}`,
        bcDescriptions: `Gross ₹${hit.grossSales.toFixed(2)} − Commission ₹${hit.totalCommission.toFixed(2)} − GST/TDS/TCS ₹${(hit.totalGstFees + hit.totalTds + hit.totalTcs).toFixed(2)}`,
        category: b.category,
        direction: b.direction,
        settlement: {
          aggregator: hit.aggregator,
          utr: hit.utr,
          netPayout: hit.netPayout,
          orderCount: hit.orderCount,
          grossSales: hit.grossSales,
          totalCommission: hit.totalCommission,
          totalGstFees: hit.totalGstFees,
          totalTcs: hit.totalTcs,
          totalTds: hit.totalTds,
          periodStart: hit.periodStart,
          periodEnd: hit.periodEnd,
          rid: hit.rid,
        },
      };
      matches.push(m);
      bankUsed.add(b.id);
    }
  }

  // ---- Tier 8: Narration brand match (additive, no classifier change) ----
  //
  // For each still-unmatched bank line that *mentions* a known aggregator
  // brand (AmEx / Swiggy / Zomato / Bundl / Eternal) in its narration, find
  // an unmatched BC entry whose description ALSO mentions the same brand,
  // with same direction, same amount within tolerance, within ±N days.
  //
  // Why this exists: BC's PBR/BR voucher description copies the bank narration
  // verbatim, so the brand keyword is present on both sides — but the BC
  // classifier returns OTHER when the description lacks "CARD" or "CARD GROUP".
  // Strict OTHER ↔ OTHER pairing was the historical match path; touching the
  // classifier would reclassify those entries and break the historical matches.
  // T8 layers brand-substring matching on top WITHOUT changing categorisation.
  {
    const brandFingerprints: Array<{ tag: string; tokens: string[] }> = [
      { tag: "AMEX",   tokens: ["AMERICAN EXPRESS", "AMEX"] },
      { tag: "SWIGGY", tokens: ["SWIGGY", "BUNDL TECHNOLOGIES"] },
      { tag: "ZOMATO", tokens: ["ZOMATO", "ETERNAL LIMITED"] },
      { tag: "PHONEPE",tokens: ["PHONEPE", "PHONE PE", "PHONEPELIMITED"] },
    ];
    for (const b of bankAll) {
      if (bankUsed.has(b.id)) continue;
      const bn = b.narration.toUpperCase();
      const fp = brandFingerprints.find(f => f.tokens.some(t => bn.includes(t)));
      if (!fp) continue;
      const cand = bcAll.find(c =>
        !bcUsed.has(c.id) &&
        c.direction === b.direction &&
        Math.abs(c.absAmount - b.absAmount) <= opts.amountTolerance &&
        withinDays(c.postingDate, b.date, opts.dateToleranceDays) &&
        fp.tokens.some(t => c.description.toUpperCase().includes(t)),
      );
      if (!cand) continue;
      matches.push(mkMatch(b, [cand], "T8", `T8: Brand match (${fp.tag})`, 85));
      bankUsed.add(b.id); bcUsed.add(cand.id);
    }
  }

  // ---- Tier 7: Cross-outlet inter-outlet transfer match ----
  //
  // For each unmatched IB FUNDS TRANSFER bank line (categorised as
  // INTERNAL_CR / INTERNAL_DR), the bank narration carries the *other*
  // outlet's HDFC account number. If the user uploaded a multi-branch BC
  // file (or several BC files), the counter-voucher will live on that
  // other outlet's ledger — opposite direction, same amount, within the
  // date window.
  if (opts.crossOutletBC && opts.crossOutletBC.length > 0) {
    const crossUsed = new Set<number>();
    for (const b of bankAll) {
      if (bankUsed.has(b.id)) continue;
      if (b.category !== "INTERNAL_CR" && b.category !== "INTERNAL_DR") continue;
      const expectedDir: "Credit" | "Debit" = b.direction === "Credit" ? "Debit" : "Credit";
      // Inter-outlet vouchers are often posted 3-5 days after the bank
      // settles the transfer (accountant catches up at end of week). Use a
      // wider window than the default for T7 only.
      const tol = Math.max(opts.dateToleranceDays, 7);
      const candidates = opts.crossOutletBC.filter(c =>
        !crossUsed.has(c.id) &&
        c.direction === expectedDir &&
        Math.abs(c.absAmount - b.absAmount) <= opts.amountTolerance &&
        withinDays(c.postingDate, b.date, tol),
      );
      if (candidates.length === 0) continue;
      // Prefer the candidate whose date is closest to the bank date.
      candidates.sort((x, y) =>
        Math.abs(x.postingDate.getTime() - b.date.getTime()) -
        Math.abs(y.postingDate.getTime() - b.date.getTime()),
      );
      const c = candidates[0];
      const counterparty = c.branchCode || "(unknown)";
      matches.push({
        bankId: b.id,
        // T7 references a cross-outlet BC entry which lives in a different
        // ID space from the primary BC (bcAll). Keep bcIds empty so the
        // primary-BC duplicate-id invariant stays intact; all the routing
        // info needed for the action plan lives in the crossOutlet field.
        bcIds: [],
        tier: "T7",
        tierLabel: `T7: Inter-outlet match (${counterparty})`,
        confidence: 92,
        bankDate: b.date,
        bcDate: c.postingDate,
        bankAmount: b.absAmount,
        bcSumAmount: c.absAmount,
        bankNarration: b.narration,
        bcDocs: `[${counterparty}] ${c.documentNo}`,
        bcDescriptions: c.description,
        category: b.category,
        direction: b.direction,
        crossOutlet: {
          counterpartyOutlet: counterparty,
          counterpartyBranch: c.branchCode || "",
          counterpartyDocNo: c.documentNo,
          counterpartyDescription: c.description,
          counterpartyDate: c.postingDate,
        },
      });
      bankUsed.add(b.id);
      crossUsed.add(c.id);
    }
  }

  // ---- Tier 6: Cash deposit T+1 bucket match ----
  //
  // For each still-unmatched CASH_DEPOSIT bank line, look at cash Sales
  // Invoices for the outlet posted in the window [T-3, T+0] (Indian retail
  // deposits typically settle T+1 but allow weekends). Try to find a date
  // bucket whose Gross Total sum equals the bank credit within tolerance.
  if (opts.cashInvoices && opts.cashInvoices.length > 0 && opts.outletCode) {
    const outlet = opts.outletCode.toUpperCase();
    const cashByDate = new Map<string, CashInvoiceInput[]>();
    for (const ci of opts.cashInvoices) {
      if (ci.locationCode.toUpperCase() !== outlet) continue;
      const k = isoDate(ci.postingDate);
      if (!cashByDate.has(k)) cashByDate.set(k, []);
      cashByDate.get(k)!.push(ci);
    }
    for (const b of bankAll) {
      if (bankUsed.has(b.id)) continue;
      if (b.category !== "CASH_DEPOSIT") continue;
      if (b.direction !== "Credit") continue;
      const hit = findCashBucket(b, cashByDate, opts.amountTolerance);
      if (!hit) continue;
      matches.push({
        bankId: b.id,
        bcIds: [],
        tier: "T6",
        tierLabel: `T6: Cash deposit (${hit.invoiceCount} bills, ${hit.invoiceDate})`,
        confidence: 88,
        bankDate: b.date,
        bcDate: b.date,
        bankAmount: b.absAmount,
        bcSumAmount: hit.bucketTotal,
        bankNarration: b.narration,
        bcDocs: `Cash SI bucket ${hit.invoiceDate} (${hit.invoiceCount} bills)`,
        bcDescriptions: hit.invoiceDocs.slice(0, 3).join("; "),
        category: b.category,
        direction: b.direction,
        cashBucket: hit,
      });
      bankUsed.add(b.id);
    }
  }

  const unmatchedBank = bankAll.filter(b => !bankUsed.has(b.id));
  const unmatchedBC = bcAll.filter(c => !bcUsed.has(c.id));
  const summary = buildSummary(bankAll, bcAll, unmatchedBank, unmatchedBC);

  return {
    matches,
    unmatchedBank,
    unmatchedBC,
    summary,
    stats: {
      totalBank: bankAll.length,
      totalBC: bcAll.length,
      matchedBank: bankUsed.size,
      matchedBC: bcUsed.size,
      unmatchedBank: unmatchedBank.length,
      unmatchedBC: unmatchedBC.length,
      matchPct: bankAll.length === 0 ? 0 : Math.round((bankUsed.size / bankAll.length) * 1000) / 10,
    },
  };
}

function mkMatch(b: BankEntry, bcEntries: BCEntry[], tier: Match["tier"], tierLabel: string, conf: number): Match {
  const sum = bcEntries.reduce((s, c) => s + c.absAmount, 0);
  return {
    bankId: b.id,
    bcIds: bcEntries.map(c => c.id),
    tier,
    tierLabel,
    confidence: conf,
    bankDate: b.date,
    bcDate: bcEntries[0].postingDate,
    bankAmount: b.absAmount,
    bcSumAmount: Math.round(sum * 100) / 100,
    bankNarration: b.narration,
    bcDocs: bcEntries.map(c => c.documentNo).join("; "),
    bcDescriptions: bcEntries.slice(0, 3).map(c => c.description).join("; "),
    category: b.category,
    direction: b.direction,
  };
}

function findSettlementMatch(
  b: BankEntry,
  settlements: SettlementInput[],
  _tolerance: number,
): SettlementInput | null {
  if (b.direction !== "Credit") return null;
  const upper = b.narration.toUpperCase();
  // Aggregator bank credits are routinely off the settlement Net Payout by
  // ₹100-₹1000 (TDS adjustments, late-cancellation refunds, bank-side fees
  // that aren't pre-deducted in the settlement file). Use a generous window
  // when the UTR matches; the discrepancy is surfaced in the report.
  const utrTol = Math.max(2000, b.absAmount * 0.02);
  const brandTol = 1;

  // First pass: UTR substring in narration. UTR identity is far more reliable
  // than the exact amount, so we widen the amount window once it's confirmed.
  let matchedUtr: string | null = null;
  for (const s of settlements) {
    if (s.utr && s.utr.length >= 6 && upper.includes(s.utr.toUpperCase())) {
      matchedUtr = s.utr;
      break;
    }
  }
  if (matchedUtr) {
    const sameUtr = settlements.filter(s => s.utr === matchedUtr);
    const agg = aggregateSettlements(sameUtr);
    if (Math.abs(agg.netPayout - b.absAmount) <= utrTol) return agg;
    // Even if amount is off by more, return aggregate — the UTR identity is
    // strong enough to count this as a match; the report shows the gap.
    return agg;
  }

  // Second pass: brand name + tight amount match (no UTR available)
  const isSwiggy  = upper.includes("SWIGGY") || upper.includes("BUNDL TECHNOLOGIES");
  const isZomato  = upper.includes("ZOMATO") || upper.includes("ETERNAL LIMITED");
  const isAmex    = upper.includes("AMERICAN EXPRESS") || upper.includes("AMEX");
  const isPhonepe = upper.includes("PHONEPE") || upper.includes("PHONE PE") || upper.includes("PHONEPELIMITED");
  for (const s of settlements) {
    if (Math.abs(s.netPayout - b.absAmount) > brandTol) continue;
    if (isSwiggy  && s.aggregator === "SWIGGY") return s;
    if (isZomato  && s.aggregator === "ZOMATO") return s;
    if (isAmex    && s.aggregator === "AMEX") return s;
    if (isPhonepe && s.aggregator === "PHONEPE") return s;
  }
  return null;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function findCashBucket(
  b: BankEntry,
  cashByDate: Map<string, CashInvoiceInput[]>,
  tolerance: number,
): CashBucketHit | null {
  // Try in priority order: T-1 (typical T+1 deposit), T-0 (same-day deposit),
  // T-2, T-3 (weekend catch-up).
  const tryOrder = [-1, 0, -2, -3];
  for (const delta of tryOrder) {
    const date = new Date(b.date.getFullYear(), b.date.getMonth(), b.date.getDate() + delta);
    const key = isoDate(date);
    const bucket = cashByDate.get(key);
    if (!bucket || bucket.length === 0) continue;
    const total = Math.round(bucket.reduce((t, ci) => t + ci.grossTotal, 0) * 100) / 100;
    if (Math.abs(total - b.absAmount) <= tolerance) {
      return {
        invoiceCount: bucket.length,
        invoiceDocs: bucket.map(ci => ci.docNo),
        invoiceDate: key,
        outletCode: bucket[0].locationCode,
        bucketTotal: total,
      };
    }
  }
  return null;
}

function aggregateSettlements(list: SettlementInput[]): SettlementInput {
  if (list.length === 1) return list[0];
  const sum = (k: keyof Pick<SettlementInput, "netPayout" | "grossSales" | "totalCommission" | "totalGstFees" | "totalTcs" | "totalTds" | "orderCount">) =>
    list.reduce((t, x) => t + (x[k] as number), 0);
  return {
    aggregator: list[0].aggregator,
    utr: list[0].utr,
    netPayout: Math.round(sum("netPayout") * 100) / 100,
    grossSales: Math.round(sum("grossSales") * 100) / 100,
    totalCommission: Math.round(sum("totalCommission") * 100) / 100,
    totalGstFees: Math.round(sum("totalGstFees") * 100) / 100,
    totalTcs: Math.round(sum("totalTcs") * 100) / 100,
    totalTds: Math.round(sum("totalTds") * 100) / 100,
    orderCount: sum("orderCount"),
    rid: list.map(s => s.rid).filter((v, i, a) => a.indexOf(v) === i).join(", "),
    periodStart: list.reduce<Date | null>((m, s) => (!m || (s.periodStart && s.periodStart < m)) ? s.periodStart : m, null),
    periodEnd:   list.reduce<Date | null>((m, s) => (!m || (s.periodEnd && s.periodEnd > m)) ? s.periodEnd : m, null),
  };
}

function buildSummary(bank: BankEntry[], bc: BCEntry[], unmatchedBank: BankEntry[], unmatchedBC: BCEntry[]): DailySummary[] {
  const dates = new Set<string>();
  bank.forEach(b => dates.add(b.date.toISOString().slice(0, 10)));
  bc.forEach(c => dates.add(c.postingDate.toISOString().slice(0, 10)));
  const sorted = [...dates].sort();
  return sorted.map(d => {
    const b = bank.filter(x => x.date.toISOString().slice(0, 10) === d);
    const c = bc.filter(x => x.postingDate.toISOString().slice(0, 10) === d);
    const ub = unmatchedBank.filter(x => x.date.toISOString().slice(0, 10) === d);
    const uc = unmatchedBC.filter(x => x.postingDate.toISOString().slice(0, 10) === d);
    return {
      date: d,
      bankEntries: b.length,
      bcEntries: c.length,
      matched: b.length - ub.length,
      unmatchedBank: ub.length,
      unmatchedBC: uc.length,
      matchPct: b.length === 0 ? 0 : Math.round(((b.length - ub.length) / b.length) * 1000) / 10,
    };
  });
}
