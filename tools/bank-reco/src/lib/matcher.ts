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
  | "BHARATPE" | "UPI" | "SALARY" | "VENDOR" | "NEFT_OTHER" | "CHEQUE" | "OTHER";

export type BCCategory =
  | "CARD_SETTLEMENT" | "AMEX" | "SWIGGY" | "ZOMATO" | "DINEOUT"
  | "PHONEPE" | "PAYTM" | "GPAY" | "BHARATPE" | "UPI"
  | "INVOICE_PAYMENT" | "SALARY" | "VENDOR" | "INTERNAL_TRANSFER" | "OTHER";

export type Match = {
  bankId: number;
  bcIds: number[];
  tier: "T1" | "T2" | "T3" | "T4";
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
  if (n.includes("NEFT") && n.includes("SWIGGY")) return "SWIGGY";
  if (n.includes("NEFT") && n.includes("ZOMATO")) return "ZOMATO";
  if (n.includes("NEFT") && (n.includes("AMERICAN EXPRESS") || n.includes("AMEX"))) return "AMEX";
  if (n.includes("NEFT") && n.includes("DINEOUT")) return "DINEOUT";
  if (n.includes("IB FUNDS TRANSFER CR")) return "INTERNAL_CR";
  if (n.includes("IB FUNDS TRANSFER DR")) return "INTERNAL_DR";
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
  OTHER:           new Set(["OTHER"]),
};

// -------- Subset-sum helper --------
function findSubset(pool: BCEntry[], target: number, tolerance: number, maxSize: number): number[] | null {
  if (pool.length === 0) return null;
  const sorted = [...pool].sort((a, b) => b.absAmount - a.absAmount);

  // Single match
  const exact = sorted.find(p => Math.abs(p.absAmount - target) <= tolerance);
  if (exact) return [exact.id];

  // Greedy descending
  const chosen: number[] = [];
  let total = 0;
  for (const p of sorted) {
    if (total + p.absAmount <= target + tolerance) {
      chosen.push(p.id);
      total += p.absAmount;
      if (Math.abs(total - target) <= tolerance) return chosen;
    }
    if (chosen.length >= maxSize) break;
  }
  if (Math.abs(total - target) <= tolerance && chosen.length > 0) return chosen;

  // Exact subset-sum for small pools
  if (sorted.length <= 20) {
    const ids = sorted.map(s => s.id);
    const amts = sorted.map(s => s.absAmount);
    for (let sz = 2; sz <= Math.min(maxSize, sorted.length); sz++) {
      const result = subsetSumOfSize(amts, ids, target, tolerance, sz);
      if (result) return result;
    }
  }
  return null;
}

function subsetSumOfSize(amts: number[], ids: number[], target: number, tol: number, size: number): number[] | null {
  const n = amts.length;
  const idx: number[] = new Array(size).fill(0);
  for (let i = 0; i < size; i++) idx[i] = i;
  while (true) {
    let s = 0;
    for (let i = 0; i < size; i++) s += amts[idx[i]];
    if (Math.abs(s - target) <= tol) return idx.map(i => ids[i]);
    // advance combination
    let i = size - 1;
    while (i >= 0 && idx[i] === n - size + i) i--;
    if (i < 0) return null;
    idx[i]++;
    for (let j = i + 1; j < size; j++) idx[j] = idx[j - 1] + 1;
  }
}

// -------- Main matcher --------
export type MatchOptions = {
  dateToleranceDays: number;
  amountTolerance: number;
  maxComponents: number;
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
