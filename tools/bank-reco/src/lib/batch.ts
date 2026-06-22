/**
 * Batch-mode helpers: outlet auto-detection from filenames, file pairing,
 * per-outlet match orchestration, and ZIP packaging.
 */
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { parseBankStatement, parseBCLedgerSplit, sniffBCLedger } from "./parsers";
import { outletForAccountSuffix } from "./bank-account-map";
import {
  runMatch, type BankEntry, type BCEntry, type MatchResult,
  type SettlementInput, type CashInvoiceInput,
} from "./matcher";
import { downloadReportToBlob } from "./export";

export type OutletJob = {
  outletCode: string;     // the ACTUAL branch code as it appears in BC
                          // (e.g. "CNSP" for NSP, "MS" for Mussoorie). This
                          // is what we filter BC entries by.
  displayCode: string;    // what we show in UI: filename-derived (e.g. "NSP")
  bankFile: File;
  bcFile: File;
  bcEntryCount?: number;  // entries the BC file has for outletCode
};

export type BatchResult = {
  outletCode: string;     // BC branch code used for filtering
  displayCode: string;    // what to show in UI / Excel filename
  bankFileName: string;
  bcFileName: string;
  stats: MatchResult["stats"];
  tierCounts: Record<string, number>;
  result: MatchResult;
  filteredBank: BankEntry[];
  dateFrom: string;
  dateTo: string;
  error?: string;
};

// ────────────────────────────────────────────────────────────────────────
// Outlet code from bank statement filename. Sandoz HDFC files follow the
// pattern `<OUTLET>_<LAST4>-imp.xls` (DWK_9146-imp.xls, JR_2160-imp.xls).
// A handful of edge cases: Min470 = LN (Lajpat Nagar), Mall51_8380 = GGN51,
// EQ5793 = GGN54, AMH = ASR (Amritsar Heritage).
// ────────────────────────────────────────────────────────────────────────
const BANK_FILENAME_OVERRIDES: Record<string, string> = {
  DWK: "DW",
  MIN: "LN",
  MALL51: "GGN51",
  EQ: "GGN54",
  AMH: "ASR",
  AM: "MUS",  // alt Amritsar code?
  MT: "MN",   // Mathura -> Moti Nagar? Actually MT could be MT for Mathura. Keep as MT.
  RS: "RS",   // unclear
  LP: "LP",
  GM: "GM",
};

export function outletCodeFromBankFilename(filename: string): string {
  // Strategy 1 (most reliable): pull the 3-4 digit suffix from the filename
  // (e.g. DWK_9146-imp.xls → "9146", EQ5793-imp.xls → "5793") and reverse-
  // lookup the HDFC account it belongs to. This handles ambiguous letter
  // prefixes (EQ → EQUIPMENT not GGN, GM → GGN54, etc.).
  const base = filename.replace(/\.(xls|xlsx|csv)$/i, "").replace(/-imp$/i, "");
  const digitMatch = base.match(/(\d{3,5})$/);
  if (digitMatch) {
    const suffix = digitMatch[1];
    const acct = outletForAccountSuffix(suffix);
    if (acct) return acct.toUpperCase();
  }
  // Strategy 2 (fallback): take leading letters from the filename
  const m = base.match(/^([A-Za-z]+)/);
  const raw = (m?.[1] ?? base).toUpperCase();
  return BANK_FILENAME_OVERRIDES[raw] ?? raw;
}

// ────────────────────────────────────────────────────────────────────────
// Pair bank files with BC files: each bank file gets the BC file with the
// most entries for that outlet's branch code. Multiple bank files can share
// a BC file; one BC file can serve as cross-outlet pool for others.
// ────────────────────────────────────────────────────────────────────────
export async function pairFilesByOutlet(
  bankFiles: File[],
  bcFiles: File[],
): Promise<OutletJob[]> {
  // Sniff every BC file once for its branch distribution
  const bcMeta = await Promise.all(
    bcFiles.map(async f => ({ file: f, meta: await sniffBCLedger(f) })),
  );

  // Edge-case aliases from the actual BC data: bank filename gives one code
  // but BC stores transactions under a different branch code.
  // The KEY is the outlet code returned by outletCodeFromBankFilename. With
  // the new suffix-based resolution, that key is usually the BC bank-account
  // master label (DWARKA / EQUIPMENT / GGN54 / RESERVE etc.). FALLBACK keys
  // (DW / NSP / SDA / etc.) are still here for filenames where the suffix
  // couldn't be resolved.
  const FILENAME_TO_BC: Record<string, string[]> = {
    // bank-account-master labels (preferred path, set by outletForAccountSuffix)
    DWARKA:    ["DW", "DWK", "DWARKA"],
    AV:        ["AV"],
    JR:        ["JR"],
    TN:        ["JR", "TN"],                // HDFC160 labelled TN but bank file is JR_2160
    RG:        ["RG"],
    NP:        ["NP"],
    DD:        ["DDB", "DD"],               // HDFC723 labelled DD; bank file is DDB_2723
    PV:        ["PV"],
    MR:        ["MR"],
    NSP:       ["CNSP", "NSP"],
    SN:        ["CSN", "SN"],
    HK:        ["HK"],
    KB:        ["KB"],
    BBQ:       ["BBQ"],
    LN:        ["LN"],
    "L-10":    ["CLB"],
    SDA:       ["CSDA", "SDA"],
    MN:        ["MN", "MT"],
    MUS:       ["MS", "MUS"],
    AMRITSAR:  ["AMRITSAR", "ASR"],
    GGN51:     ["CG", "MALL 51", "GGN51"],
    GGN54:     ["GGN", "GGN54"],
    EQUIPMENT: ["EQUIPMENT"],                // EQ5793 = EQUIPMENT, no matching BC outlet → won't pair
    DBG:       ["DBG"],
    DDB:       ["DDB"],
    SS:        ["SS"],
    "HDFC-OD": ["HO"],                       // OD account stores transactions under HO
    "BK VENDOR CONTROL": ["HO"],
    NB:        ["NB"],
    CLB:       ["CLB"],
    MT:        ["MN", "MT"],
    "N BLOCK CP": ["NB"],
    // HDFC321 is labeled "CP" in the bank-account master, but it's
    // operationally used by the SS outlet (Sandoz CP P Block).
    // SS_2321-imp.xls would otherwise label as "CP" and fail to pair.
    CP:        ["SS"],

    // Legacy filename-prefix fallbacks (in case suffix lookup misses)
    DW:        ["DW", "DWK"],
    DWK:       ["DW", "DWK"],
    GGN:       ["GGN", "CG", "MALL 51"],
    EQ:        ["EQUIPMENT", "GGN", "CG"],
    GM:        ["GGN", "GGN54"],             // GM_1976-imp.xls = GGN54 (suffix 1976)
    MALL:      ["MALL 51", "CG", "GGN51"],
    MALL51:    ["MALL 51", "CG", "GGN51"],
    ASR:       ["AMRITSAR", "ASR"],
    AMH:       ["AMRITSAR", "ASR"],
    AMR:       ["AMRITSAR", "ASR"],
    AM:        ["AMRITSAR", "ASR"],
    MIN:       ["LN"],
    LP:        ["LP", "LB"],
    RS:        ["RS"],
  };

  const jobs: OutletJob[] = [];
  for (const bank of bankFiles) {
    const filenameCode = outletCodeFromBankFilename(bank.name);
    const candidates = FILENAME_TO_BC[filenameCode] ?? [filenameCode, `C${filenameCode}`];
    // Find BC file whose branch list has the most entries for any candidate code
    let best: { file: File; code: string; count: number } | null = null;
    for (const { file, meta } of bcMeta) {
      for (const cand of candidates) {
        const hit = meta.branches.find(b => b.code === cand);
        if (hit && (!best || hit.count > best.count)) {
          best = { file, code: cand, count: hit.count };
        }
      }
    }
    if (best) {
      jobs.push({ outletCode: best.code, displayCode: filenameCode, bankFile: bank, bcFile: best.file, bcEntryCount: best.count });
    } else {
      jobs.push({ outletCode: filenameCode, displayCode: filenameCode, bankFile: bank, bcFile: bcMeta[0]?.file ?? bank, bcEntryCount: 0 });
    }
  }
  return jobs;
}

// ────────────────────────────────────────────────────────────────────────
// Run match for one OutletJob, drawing the cross-outlet pool from every
// uploaded BC file (so transfers between outlets all chain through T7).
// ────────────────────────────────────────────────────────────────────────
type RunBatchOpts = {
  jobs: OutletJob[];
  allBCFiles: File[];
  settlements: SettlementInput[];
  cashInvoices: CashInvoiceInput[];
  dateTol: number;
  amountTol: number;
  maxComponents: number;
  onProgress?: (i: number, total: number, outletCode: string) => void;
};

export async function runBatch(opts: RunBatchOpts): Promise<BatchResult[]> {
  const out: BatchResult[] = [];

  // Pre-parse the entire cross-outlet pool ONCE (every entry from every BC
  // file with a non-empty Branch Code).
  const wholePool: BCEntry[] = [];
  for (const bc of opts.allBCFiles) {
    try {
      const split = await parseBCLedgerSplit(bc, undefined);
      wholePool.push(...split.primary, ...split.cross);
    } catch (e) {
      console.warn(`Failed to parse ${bc.name}`, e);
    }
  }

  for (let i = 0; i < opts.jobs.length; i++) {
    const job = opts.jobs[i];
    opts.onProgress?.(i, opts.jobs.length, job.outletCode);
    try {
      const bank = await parseBankStatement(job.bankFile);
      const { primary: bc } = await parseBCLedgerSplit(job.bcFile, job.outletCode);
      // Cross-outlet pool = whole pool minus this outlet's entries
      const cross = wholePool.filter(e => (e.branchCode ?? "").toUpperCase() !== job.outletCode.toUpperCase());

      // Date range = intersection of bank and BC dates
      const allDates = [...bank.map(b => b.date), ...bc.map(c => c.postingDate)];
      if (allDates.length === 0) throw new Error("No dates parsed from files");
      const bMin = bank.reduce<Date>((m, b) => !m || b.date < m ? b.date : m, bank[0].date);
      const bMax = bank.reduce<Date>((m, b) => !m || b.date > m ? b.date : m, bank[0].date);
      const cMin = bc.length ? bc.reduce<Date>((m, c) => !m || c.postingDate < m ? c.postingDate : m, bc[0].postingDate) : bMin;
      const cMax = bc.length ? bc.reduce<Date>((m, c) => !m || c.postingDate > m ? c.postingDate : m, bc[0].postingDate) : bMax;
      const from = bMin > cMin ? bMin : cMin;
      const to = bMax < cMax ? bMax : cMax;
      // Pad `to` to end-of-day
      const toEnd = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59);

      const bankF = bank.filter(b => b.date >= from && b.date <= toEnd).map((b, idx) => ({ ...b, id: idx }));
      const bcF   = bc.filter(c => c.postingDate >= from && c.postingDate <= toEnd).map((c, idx) => ({ ...c, id: idx }));
      const crossF = cross.filter(c => c.postingDate >= from && c.postingDate <= toEnd);
      crossF.forEach((c, idx) => { c.id = idx; });

      if (bankF.length === 0 || bcF.length === 0) {
        out.push({
          outletCode: job.outletCode,
          displayCode: job.displayCode,
          bankFileName: job.bankFile.name,
          bcFileName: job.bcFile.name,
          stats: { totalBank: bankF.length, totalBC: bcF.length, matchedBank: 0, matchedBC: 0, unmatchedBank: bankF.length, unmatchedBC: bcF.length, matchPct: 0 },
          tierCounts: {},
          result: { matches: [], unmatchedBank: bankF, unmatchedBC: bcF, summary: [],
            stats: { totalBank: bankF.length, totalBC: bcF.length, matchedBank: 0, matchedBC: 0, unmatchedBank: bankF.length, unmatchedBC: bcF.length, matchPct: 0 } },
          filteredBank: bankF,
          dateFrom: isoDate(from), dateTo: isoDate(to),
          error: bankF.length === 0 ? "No bank entries in date intersection" : "No BC entries in date intersection",
        });
        continue;
      }

      const result = runMatch(bankF, bcF, {
        dateToleranceDays: opts.dateTol,
        amountTolerance: opts.amountTol,
        maxComponents: opts.maxComponents,
        settlements: opts.settlements.length ? opts.settlements : undefined,
        cashInvoices: opts.cashInvoices.length ? opts.cashInvoices : undefined,
        outletCode: job.outletCode,
        crossOutletBC: crossF.length ? crossF : undefined,
      });
      const tierCounts: Record<string, number> = { T1: 0, T2: 0, T3: 0, T4: 0, T5: 0, T6: 0, T7: 0, T8: 0 };
      for (const m of result.matches) tierCounts[m.tier] = (tierCounts[m.tier] ?? 0) + 1;
      out.push({
        outletCode: job.outletCode,
        displayCode: job.displayCode,
        bankFileName: job.bankFile.name,
        bcFileName: job.bcFile.name,
        stats: result.stats,
        tierCounts,
        result,
        filteredBank: bankF,
        dateFrom: isoDate(from), dateTo: isoDate(to),
      });
    } catch (e) {
      out.push({
        outletCode: job.outletCode,
        displayCode: job.displayCode,
        bankFileName: job.bankFile.name,
        bcFileName: job.bcFile.name,
        stats: { totalBank: 0, totalBC: 0, matchedBank: 0, matchedBC: 0, unmatchedBank: 0, unmatchedBC: 0, matchPct: 0 },
        tierCounts: {},
        result: { matches: [], unmatchedBank: [], unmatchedBC: [], summary: [],
          stats: { totalBank: 0, totalBC: 0, matchedBank: 0, matchedBC: 0, unmatchedBank: 0, unmatchedBC: 0, matchPct: 0 } },
        filteredBank: [],
        dateFrom: "", dateTo: "",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  opts.onProgress?.(opts.jobs.length, opts.jobs.length, "done");
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// ZIP packager: every outlet's Excel + one fleet-summary workbook.
// ────────────────────────────────────────────────────────────────────────
export async function packageBatchZip(results: BatchResult[]): Promise<Blob> {
  const zip = new JSZip();

  for (const r of results) {
    if (r.error) continue;
    const blob = downloadReportToBlob(r.result, r.displayCode, r.dateFrom, r.dateTo, r.filteredBank);
    zip.file(`BankReco_${r.displayCode}_${r.dateFrom}_${r.dateTo}.xlsx`, blob);
  }

  // Fleet summary workbook
  const fleetWB = XLSX.utils.book_new();
  const summaryRows = results.map(r => ({
    "Outlet": r.displayCode,
    "BC Branch": r.outletCode,
    "Bank File": r.bankFileName,
    "BC File": r.bcFileName,
    "Date From": r.dateFrom,
    "Date To": r.dateTo,
    "Bank Entries": r.stats.totalBank,
    "BC Entries": r.stats.totalBC,
    "Matched": r.stats.matchedBank,
    "Match %": r.stats.matchPct,
    "Unmatched Bank": r.stats.unmatchedBank,
    "Unmatched BC": r.stats.unmatchedBC,
    "T1": r.tierCounts.T1 ?? 0,
    "T2": r.tierCounts.T2 ?? 0,
    "T5": r.tierCounts.T5 ?? 0,
    "T7": r.tierCounts.T7 ?? 0,
    "T8": r.tierCounts.T8 ?? 0,
    "Error": r.error ?? "",
  }));
  summaryRows.sort((a, b) => b["Match %"] - a["Match %"]);
  const totalBank = results.reduce((s, r) => s + r.stats.totalBank, 0);
  const totalMatched = results.reduce((s, r) => s + r.stats.matchedBank, 0);
  const fleetPct = totalBank ? Math.round((totalMatched / totalBank) * 1000) / 10 : 0;
  summaryRows.unshift({
    "Outlet": "═ FLEET TOTAL ═",
    "BC Branch": "",
    "Bank File": "",
    "BC File": "",
    "Date From": "", "Date To": "",
    "Bank Entries": totalBank, "BC Entries": results.reduce((s, r) => s + r.stats.totalBC, 0),
    "Matched": totalMatched, "Match %": fleetPct,
    "Unmatched Bank": results.reduce((s, r) => s + r.stats.unmatchedBank, 0),
    "Unmatched BC": results.reduce((s, r) => s + r.stats.unmatchedBC, 0),
    "T1": results.reduce((s, r) => s + (r.tierCounts.T1 ?? 0), 0),
    "T2": results.reduce((s, r) => s + (r.tierCounts.T2 ?? 0), 0),
    "T5": results.reduce((s, r) => s + (r.tierCounts.T5 ?? 0), 0),
    "T7": results.reduce((s, r) => s + (r.tierCounts.T7 ?? 0), 0),
    "T8": results.reduce((s, r) => s + (r.tierCounts.T8 ?? 0), 0),
    "Error": "",
  });
  const sh = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(fleetWB, sh, "Fleet Summary");
  const fleetBuf = XLSX.write(fleetWB, { bookType: "xlsx", type: "array" });
  zip.file(`FLEET_SUMMARY.xlsx`, fleetBuf);

  return zip.generateAsync({ type: "blob" });
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
