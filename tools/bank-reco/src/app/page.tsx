"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  Banknote, Database, CheckCircle2, AlertTriangle, XCircle, Download,
  Play, Loader2, Github, ChevronDown, Info, Sparkles,
} from "lucide-react";
import { FileDropzone } from "@/components/file-dropzone";
import { MultiFileDropzone } from "@/components/multi-file-dropzone";
import { StatCard } from "@/components/stat-card";
import { ResultsTabs } from "@/components/results-tabs";
import {
  parseBankStatement, parseBCLedgerSplit,
  sniffBCLedger, sniffBankStatement, type BCMeta,
} from "@/lib/parsers";
import { runMatch, type MatchResult, type BankEntry, type SettlementInput, type CashInvoiceInput } from "@/lib/matcher";
import { parseSettlementFile } from "@/lib/settlement";
import { parseSalesInvoices } from "@/lib/sales-invoices";
import { downloadReport } from "@/lib/export";

export default function Home() {
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [bcFile, setBcFile] = useState<File | null>(null);
  const [extraBcFiles, setExtraBcFiles] = useState<File[]>([]);
  const [settlementFiles, setSettlementFiles] = useState<File[]>([]);
  const [settlementSummary, setSettlementSummary] = useState<{ count: number; totalNet: number; aggregator: string } | null>(null);
  const [salesInvoiceFile, setSalesInvoiceFile] = useState<File | null>(null);
  const [siSummary, setSiSummary] = useState<{ totalCash: number; cashBills: number } | null>(null);

  const [bcMeta, setBcMeta] = useState<BCMeta | null>(null);
  const [bankMeta, setBankMeta] = useState<{ minDate: Date | null; maxDate: Date | null; rows: number } | null>(null);
  const [sniffing, setSniffing] = useState(false);

  const [outlet, setOutlet] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [dateTol, setDateTol] = useState(2);
  const [amountTol, setAmountTol] = useState(1);
  const [maxComp, setMaxComp] = useState(100);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [filteredBank, setFilteredBank] = useState<BankEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Sniff BC when uploaded
  useEffect(() => {
    if (!bcFile) { setBcMeta(null); return; }
    let cancelled = false;
    setSniffing(true);
    sniffBCLedger(bcFile)
      .then(meta => {
        if (cancelled) return;
        setBcMeta(meta);
        // Default branch = most populous one
        if (meta.branches.length > 0 && !outlet) setOutlet(meta.branches[0].code);
      })
      .catch(e => { if (!cancelled) setError(`Could not read BC file: ${e instanceof Error ? e.message : "Unknown error"}`); })
      .finally(() => { if (!cancelled) setSniffing(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bcFile]);

  // Pre-parse settlement files to show a quick hint
  useEffect(() => {
    if (settlementFiles.length === 0) { setSettlementSummary(null); return; }
    let cancelled = false;
    (async () => {
      let count = 0, totalNet = 0;
      const aggregators = new Set<string>();
      for (const f of settlementFiles) {
        try {
          const list = await parseSettlementFile(f);
          for (const s of list) {
            count++; totalNet += s.netPayout; aggregators.add(s.aggregator);
          }
        } catch { /* surfaced at run time */ }
      }
      if (!cancelled) setSettlementSummary({ count, totalNet, aggregator: [...aggregators].join(" + ") || "-" });
    })();
    return () => { cancelled = true; };
  }, [settlementFiles]);

  // Pre-parse Sales Invoice file when uploaded
  useEffect(() => {
    if (!salesInvoiceFile) { setSiSummary(null); return; }
    let cancelled = false;
    parseSalesInvoices(salesInvoiceFile)
      .then(rows => {
        if (cancelled) return;
        const cash = rows.filter(r => r.paymentType.toUpperCase() === "CASH");
        const total = cash.reduce((t, r) => t + r.grossTotal, 0);
        setSiSummary({ totalCash: total, cashBills: cash.length });
      })
      .catch(() => { /* surfaced at run time */ });
    return () => { cancelled = true; };
  }, [salesInvoiceFile]);

  // Sniff bank file when uploaded
  useEffect(() => {
    if (!bankFile) { setBankMeta(null); return; }
    let cancelled = false;
    sniffBankStatement(bankFile)
      .then(meta => { if (!cancelled) setBankMeta(meta); })
      .catch(() => { /* surface at parse time */ });
    return () => { cancelled = true; };
  }, [bankFile]);

  // Auto-pick date range = intersection of bank & BC
  useEffect(() => {
    if (!bankMeta?.minDate || !bcMeta?.minDate) return;
    const lo = bankMeta.minDate > bcMeta.minDate ? bankMeta.minDate : bcMeta.minDate;
    const hi = bankMeta.maxDate! < bcMeta.maxDate! ? bankMeta.maxDate! : bcMeta.maxDate!;
    setDateFrom(toISODate(lo));
    setDateTo(toISODate(hi));
  }, [bankMeta, bcMeta]);

  const canRun = !!bankFile && !!bcFile && !!outlet && !!dateFrom && !!dateTo && !running;

  const onRun = useCallback(async () => {
    if (!bankFile || !bcFile) return;
    setRunning(true); setError(null); setResult(null);
    try {
      const bank = await parseBankStatement(bankFile);
      const { primary: bc, cross: crossBC } = await parseBCLedgerSplit(bcFile, outlet || undefined);
      // Pull cross-outlet entries from any additional BC files the user
      // uploaded — every entry from these files whose branch ≠ selected
      // branch joins the T7 pool. Each file gets independent BCEntry IDs;
      // we re-id below.
      for (const f of extraBcFiles) {
        try {
          const split = await parseBCLedgerSplit(f, outlet || undefined);
          // Treat both buckets as "cross" because the selected outlet's
          // primary is whatever the user explicitly chose in the first file.
          crossBC.push(...split.primary, ...split.cross);
        } catch (e) {
          console.warn(`Failed to parse extra BC file ${f.name}`, e);
        }
      }
      // Re-id the merged cross-outlet pool
      crossBC.forEach((c, i) => { c.id = i; });
      // Parse YYYY-MM-DD as local midnight so they line up with parsed
      // cell dates (which are also normalised to local midnight).
      const [fy, fm, fd] = dateFrom.split("-").map(Number);
      const [ty, tm, td] = dateTo.split("-").map(Number);
      const from = new Date(fy, fm - 1, fd);
      const to = new Date(ty, tm - 1, td, 23, 59, 59);
      const bankF = bank.filter(b => b.date >= from && b.date <= to);
      const bcF = bc.filter(c => c.postingDate >= from && c.postingDate <= to);
      if (bankF.length === 0) {
        throw new Error(`No bank entries between ${dateFrom} and ${dateTo}. Check date range.`);
      }
      if (bcF.length === 0) {
        const available = bcMeta?.branches.map(b => `${b.code} (${b.count})`).join(", ") || "none";
        throw new Error(
          `No BC entries for branch "${outlet}" between ${dateFrom} and ${dateTo}. Available branches in this file: ${available}.`,
        );
      }
      // Parse any settlement files the user dropped in (auto-detects format)
      const settlements: SettlementInput[] = [];
      for (const f of settlementFiles) {
        try {
          settlements.push(...(await parseSettlementFile(f)));
        } catch (e) {
          console.warn(`Failed to parse settlement ${f.name}`, e);
        }
      }
      // Parse Sales Invoices (cash deposit T+1 matching) if provided.
      let cashInvoices: CashInvoiceInput[] = [];
      if (salesInvoiceFile) {
        try {
          const si = await parseSalesInvoices(salesInvoiceFile);
          cashInvoices = si
            .filter(x => x.paymentType.toUpperCase() === "CASH")
            .map(x => ({ docNo: x.docNo, postingDate: x.postingDate, locationCode: x.locationCode, grossTotal: x.grossTotal }));
        } catch (e) {
          console.warn("Failed to parse Sales Invoices", e);
        }
      }
      // Cross-outlet BC entries: limit by the same date window so the T7 pool
      // doesn't include irrelevant FY data.
      const crossBCF = crossBC.filter(c => c.postingDate >= from && c.postingDate <= to);
      const res = runMatch(bankF, bcF, {
        dateToleranceDays: dateTol,
        amountTolerance: amountTol,
        maxComponents: maxComp,
        settlements: settlements.length > 0 ? settlements : undefined,
        cashInvoices: cashInvoices.length > 0 ? cashInvoices : undefined,
        outletCode: outlet,
        crossOutletBC: crossBCF.length > 0 ? crossBCF : undefined,
      });
      setResult(res);
      setFilteredBank(bankF);
      // Scroll to results
      setTimeout(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to process files");
    } finally {
      setRunning(false);
    }
  }, [bankFile, bcFile, outlet, dateFrom, dateTo, dateTol, amountTol, maxComp, bcMeta, settlementFiles, salesInvoiceFile, extraBcFiles]);

  const matchPct = result?.stats.matchPct ?? 0;
  const matchHealthText = useMemo(() => {
    if (!result) return "";
    if (matchPct >= 80) return "Excellent — most entries auto-matched.";
    if (matchPct >= 65) return "Good — review the unmatched tab for edge cases.";
    if (matchPct >= 40) return "Partial — widen tolerances or check categories.";
    return "Low — check that the branch code is correct.";
  }, [matchPct, result]);

  // "What to upload to get closer to 100%" — scans unmatched bank lines and
  // suggests the right input file based on category fingerprints.
  const upgradeSuggestions = useMemo(() => {
    if (!result) return [] as { label: string; missing: string; count: number; estPct: number }[];
    const totalBank = result.stats.totalBank || 1;
    const suggestions: { label: string; missing: string; count: number; estPct: number }[] = [];

    const aggregatorCount = result.unmatchedBank.filter(b => {
      const n = b.narration.toUpperCase();
      return (
        b.category === "SWIGGY" || b.category === "ZOMATO" ||
        n.includes("BUNDL TECHNOLOGIES") || n.includes("ETERNAL LIMITED") ||
        n.includes("SWIGGY") || n.includes("ZOMATO")
      );
    }).length;
    if (aggregatorCount > 0 && settlementFiles.length === 0) {
      suggestions.push({
        label: "Aggregator settlement files (Swiggy + Zomato)",
        missing: "Upload all Swiggy `consolidate-annexure*.csv` and Zomato `utr_report_*.csv` files",
        count: aggregatorCount,
        estPct: Math.round((aggregatorCount / totalBank) * 1000) / 10,
      });
    }

    const cashDepositCount = result.unmatchedBank.filter(b => b.category === "CASH_DEPOSIT").length;
    if (cashDepositCount > 0 && !salesInvoiceFile) {
      suggestions.push({
        label: "Sales Invoices file (cash deposits)",
        missing: "Upload the BC `Sales Invoices` export with Payment Type column",
        count: cashDepositCount,
        estPct: Math.round((cashDepositCount / totalBank) * 1000) / 10,
      });
    }

    return suggestions;
  }, [result, settlementFiles, salesInvoiceFile]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-sm">
              <Banknote className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">Bank Reconciliation</h1>
              <p className="text-xs text-slate-500">Match BC ledger to bank statements in seconds</p>
            </div>
          </div>
          <a
            href="https://github.com/Piyushverma1996/fnb-ops-suite"
            target="_blank"
            rel="noopener"
            className="hidden sm:inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
          >
            <Github className="h-4 w-4" /> View source
          </a>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Step 1 */}
        <Step n={1} title="Upload your files" subtitle="One HDFC bank statement, one BC bank ledger export.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FileDropzone
              label="Bank Statement"
              subtitle="HDFC net-banking export (.xls)"
              file={bankFile}
              onChange={setBankFile}
            />
            <FileDropzone
              label="BC Bank Ledger"
              subtitle="Bank Account Ledger Entries (.xlsx)"
              file={bcFile}
              onChange={setBcFile}
            />
          </div>
          <div className="mt-3">
            <MultiFileDropzone
              label="Other outlets' BC bank ledgers (optional)"
              subtitle="Additional BC export files — unlocks T7 inter-outlet IB FUNDS TRANSFER matching"
              accept={{
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
                "application/vnd.ms-excel": [".xls"],
              }}
              files={extraBcFiles}
              onChange={setExtraBcFiles}
            />
          </div>
          <div className="mt-3">
            <MultiFileDropzone
              label="Aggregator settlement files (optional)"
              subtitle="Swiggy consolidate-annexure CSV or Zomato Settlement XLSX — unlocks T5 many-to-one matching"
              accept={{
                "text/csv": [".csv"],
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
              }}
              files={settlementFiles}
              onChange={setSettlementFiles}
            />
            {settlementSummary && settlementSummary.count > 0 && (
              <p className="mt-2 text-xs text-violet-700 dark:text-violet-300">
                Parsed <strong>{settlementSummary.count}</strong> {settlementSummary.aggregator} settlement{settlementSummary.count === 1 ? "" : "s"}
                {" "}totaling <strong>₹{settlementSummary.totalNet.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</strong> net payout.
                T5 matches will appear after you hit Match.
              </p>
            )}
          </div>
          <div className="mt-3">
            <FileDropzone
              label="Sales Invoices (optional)"
              subtitle="BC Sales Invoice export with Payment Type column — unlocks T6 cash deposit matching"
              file={salesInvoiceFile}
              onChange={setSalesInvoiceFile}
            />
            {siSummary && siSummary.cashBills > 0 && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                Parsed <strong>{siSummary.cashBills}</strong> cash-payment bills across all outlets
                {" "}totaling <strong>₹{siSummary.totalCash.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</strong>.
                T6 matches the daily totals for branch <code className="font-mono">{outlet || "-"}</code> to bank cash deposit lines (T-1 to T+0).
              </p>
            )}
          </div>
          {(bankMeta || bcMeta) && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {bankMeta && (
                <Hint>
                  <strong>Bank:</strong> {bankMeta.rows} entries
                  {bankMeta.minDate && bankMeta.maxDate && ` · ${toISODate(bankMeta.minDate)} → ${toISODate(bankMeta.maxDate)}`}
                </Hint>
              )}
              {bcMeta && (
                <Hint>
                  <strong>BC:</strong> {bcMeta.totalRows} entries · {bcMeta.branches.length} branch{bcMeta.branches.length === 1 ? "" : "es"}
                  {bcMeta.minDate && bcMeta.maxDate && ` · ${toISODate(bcMeta.minDate)} → ${toISODate(bcMeta.maxDate)}`}
                </Hint>
              )}
            </div>
          )}
        </Step>

        {/* Step 2 */}
        <Step n={2} title="Pick branch & date range" subtitle="We pre-fill these from your files — adjust if needed." disabled={!bcFile || !bankFile}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Branch / Outlet">
              {bcMeta && bcMeta.branches.length > 0 ? (
                <div className="relative">
                  <select
                    value={outlet}
                    onChange={e => setOutlet(e.target.value)}
                    className="input appearance-none pr-8"
                  >
                    {bcMeta.branches.map(b => (
                      <option key={b.code} value={b.code}>{b.code} — {b.count} entries</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                </div>
              ) : (
                <input
                  type="text"
                  value={outlet}
                  onChange={e => setOutlet(e.target.value.toUpperCase())}
                  placeholder={sniffing ? "Reading file…" : "e.g. DW, AV, RG"}
                  className="input"
                />
              )}
            </Field>
            <Field label="From date">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input" />
            </Field>
            <Field label="To date">
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input" />
            </Field>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced(v => !v)}
            className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
            Advanced matching settings
          </button>
          {showAdvanced && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700">
              <Field label={`Date tolerance: ±${dateTol} day${dateTol === 1 ? "" : "s"}`}>
                <input type="range" min={0} max={7} step={1} value={dateTol} onChange={e => setDateTol(Number(e.target.value))} className="w-full" />
                <p className="text-[10px] text-slate-500 mt-1">How far apart bank & BC dates can be for a match.</p>
              </Field>
              <Field label={`Amount tolerance: ±₹${amountTol}`}>
                <input type="range" min={0} max={100} step={0.5} value={amountTol} onChange={e => setAmountTol(Number(e.target.value))} className="w-full" />
                <p className="text-[10px] text-slate-500 mt-1">For absorbing rounding when summing many BC lines.</p>
              </Field>
              <Field label={`Max BC entries per bank line: ${maxComp}`}>
                <input type="range" min={1} max={25} step={1} value={maxComp} onChange={e => setMaxComp(Number(e.target.value))} className="w-full" />
                <p className="text-[10px] text-slate-500 mt-1">Caps the many-to-one subset-sum search.</p>
              </Field>
            </div>
          )}
        </Step>

        {/* Step 3 */}
        <Step n={3} title="Run the match" subtitle="Everything runs in your browser. No data leaves your machine." disabled={!canRun && !running}>
          <button
            onClick={onRun}
            disabled={!canRun}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold shadow-sm hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {running ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Matching…</>
            ) : (
              <><Play className="h-4 w-4" /> Match {bankMeta?.rows ?? ""} bank entries against BC</>
            )}
          </button>

          {error && (
            <div className="mt-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 p-3 text-sm text-rose-900 dark:text-rose-200 flex gap-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          )}
        </Step>

        {result && (
          <div id="results" className="mt-10">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="h-5 w-5 text-amber-500" />
              <h2 className="text-base font-semibold">Results</h2>
              <span className="text-sm text-slate-500">· {matchHealthText}</span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
              <StatCard label="Bank Entries" value={result.stats.totalBank} variant="default" icon={Banknote} />
              <StatCard label="BC Entries" value={result.stats.totalBC} variant="muted" icon={Database} />
              <StatCard label={`Matched (${result.stats.matchPct}%)`} value={result.stats.matchedBank} variant="success" icon={CheckCircle2} />
              <StatCard label="Unmatched Bank" value={result.stats.unmatchedBank} variant="warning" icon={AlertTriangle} />
              <StatCard label="Unmatched BC" value={result.stats.unmatchedBC} variant="error" icon={XCircle} />
            </div>

            {upgradeSuggestions.length > 0 && (
              <div className="mb-5 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-4">
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-100 mb-2">
                  Push match % higher — add these files and rerun:
                </p>
                <ul className="space-y-1.5">
                  {upgradeSuggestions.map((s, i) => (
                    <li key={i} className="text-sm text-amber-900 dark:text-amber-100 flex items-start gap-2">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-300 mt-2 flex-shrink-0" />
                      <div>
                        <strong>{s.label}</strong> — could clear up to {s.count} unmatched bank lines (~{s.estPct}% lift). {s.missing}.
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <p className="text-xs text-slate-500">
                  {result.matches.length} match{result.matches.length === 1 ? "" : "es"} across 4 tiers · {result.unmatchedBank.length} bank + {result.unmatchedBC.length} BC entries to review manually
                </p>
                <button
                  onClick={() => downloadReport(result, outlet, dateFrom, dateTo, filteredBank)}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  <Download className="h-4 w-4" /> Download Excel Report
                </button>
              </div>
              <ResultsTabs result={result} />
            </div>
          </div>
        )}

        <footer className="mt-12 pb-6 text-xs text-slate-400 text-center space-y-1">
          <p>F&B Ops Suite · Built with Next.js · All processing client-side</p>
          <p>Your files never leave your browser.</p>
        </footer>
      </main>
    </div>
  );
}

function Step({
  n, title, subtitle, children, disabled,
}: { n: number; title: string; subtitle?: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <section className={`mb-6 transition-opacity ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-7 h-7 rounded-full bg-blue-600 text-white text-sm font-semibold flex items-center justify-center">{n}</div>
        <div>
          <h2 className="text-sm font-semibold leading-tight">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
        {children}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 text-blue-900 dark:text-blue-100">
      <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
