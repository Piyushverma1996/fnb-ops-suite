"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  Banknote, Database, CheckCircle2, AlertTriangle, XCircle, Download,
  Play, Loader2, Github, ChevronDown, Info, Sparkles,
} from "lucide-react";
import { FileDropzone } from "@/components/file-dropzone";
import { StatCard } from "@/components/stat-card";
import { ResultsTabs } from "@/components/results-tabs";
import {
  parseBankStatement, parseBCLedger,
  sniffBCLedger, sniffBankStatement, type BCMeta,
} from "@/lib/parsers";
import { runMatch, type MatchResult, type BankEntry } from "@/lib/matcher";
import { downloadReport } from "@/lib/export";

export default function Home() {
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [bcFile, setBcFile] = useState<File | null>(null);

  const [bcMeta, setBcMeta] = useState<BCMeta | null>(null);
  const [bankMeta, setBankMeta] = useState<{ minDate: Date | null; maxDate: Date | null; rows: number } | null>(null);
  const [sniffing, setSniffing] = useState(false);

  const [outlet, setOutlet] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [dateTol, setDateTol] = useState(2);
  const [amountTol, setAmountTol] = useState(1);
  const [maxComp, setMaxComp] = useState(15);
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
      const bc = await parseBCLedger(bcFile, outlet || undefined);
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
      const res = runMatch(bankF, bcF, {
        dateToleranceDays: dateTol,
        amountTolerance: amountTol,
        maxComponents: maxComp,
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
  }, [bankFile, bcFile, outlet, dateFrom, dateTo, dateTol, amountTol, maxComp, bcMeta]);

  const matchPct = result?.stats.matchPct ?? 0;
  const matchHealthText = useMemo(() => {
    if (!result) return "";
    if (matchPct >= 80) return "Excellent — most entries auto-matched.";
    if (matchPct >= 65) return "Good — review the unmatched tab for edge cases.";
    if (matchPct >= 40) return "Partial — widen tolerances or check categories.";
    return "Low — check that the branch code is correct.";
  }, [matchPct, result]);

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
