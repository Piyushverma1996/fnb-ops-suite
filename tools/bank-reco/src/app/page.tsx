"use client";

import { useState, useCallback } from "react";
import { Banknote, Database, CheckCircle2, AlertTriangle, XCircle, Download, Play, Loader2, Settings2, Github } from "lucide-react";
import { FileDropzone } from "@/components/file-dropzone";
import { StatCard } from "@/components/stat-card";
import { ResultsTabs } from "@/components/results-tabs";
import { parseBankStatement, parseBCLedger } from "@/lib/parsers";
import { runMatch, type MatchResult } from "@/lib/matcher";
import { downloadReport } from "@/lib/export";

export default function Home() {
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [bcFile, setBcFile] = useState<File | null>(null);
  const [outlet, setOutlet] = useState("DW");
  const [dateTol, setDateTol] = useState(2);
  const [amountTol, setAmountTol] = useState(1);
  const [maxComp, setMaxComp] = useState(15);
  const [dateFrom, setDateFrom] = useState("2026-04-01");
  const [dateTo, setDateTo] = useState("2026-06-30");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRun = !!bankFile && !!bcFile && !running;

  const onRun = useCallback(async () => {
    if (!bankFile || !bcFile) return;
    setRunning(true); setError(null); setResult(null);
    try {
      const bank = await parseBankStatement(bankFile);
      const bc = await parseBCLedger(bcFile, outlet || undefined);
      const from = new Date(dateFrom), to = new Date(dateTo);
      const bankF = bank.filter(b => b.date >= from && b.date <= to);
      const bcF = bc.filter(c => c.postingDate >= from && c.postingDate <= to);
      if (bankF.length === 0) throw new Error("No bank entries in selected date range");
      if (bcF.length === 0) throw new Error(`No BC entries for Branch '${outlet}' in selected date range`);
      const res = runMatch(bankF, bcF, {
        dateToleranceDays: dateTol,
        amountTolerance: amountTol,
        maxComponents: maxComp,
      });
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to process files");
    } finally {
      setRunning(false);
    }
  }, [bankFile, bcFile, outlet, dateFrom, dateTo, dateTol, amountTol, maxComp]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-sm">
              <Banknote className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">Bank Reconciliation Tool</h1>
              <p className="text-xs text-slate-500">F&B Ops Suite · Match BC ledger to bank statements in seconds</p>
            </div>
          </div>
          <a
            href="https://github.com/"
            target="_blank"
            rel="noopener"
            className="hidden sm:inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
          >
            <Github className="h-4 w-4" /> View source
          </a>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <section className="lg:col-span-1 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
            <h2 className="text-sm font-semibold flex items-center gap-2 mb-4">
              <Settings2 className="h-4 w-4" /> Settings
            </h2>
            <div className="space-y-4">
              <Field label="Outlet / Branch Code">
                <input type="text" value={outlet} onChange={e => setOutlet(e.target.value.toUpperCase())} placeholder="e.g. DW, AV, RG" className="input" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="From"><input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input" /></Field>
                <Field label="To"><input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input" /></Field>
              </div>
              <Field label={`Date tolerance: ${dateTol} day(s)`}>
                <input type="range" min={0} max={7} step={1} value={dateTol} onChange={e => setDateTol(Number(e.target.value))} className="w-full" />
              </Field>
              <Field label={`Amount tolerance: ₹${amountTol}`}>
                <input type="range" min={0} max={100} step={0.5} value={amountTol} onChange={e => setAmountTol(Number(e.target.value))} className="w-full" />
              </Field>
              <Field label={`Max BC entries per match: ${maxComp}`}>
                <input type="range" min={1} max={25} step={1} value={maxComp} onChange={e => setMaxComp(Number(e.target.value))} className="w-full" />
              </Field>
            </div>
          </section>

          <section className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
            <h2 className="text-sm font-semibold mb-4">Upload Files</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FileDropzone label="Bank Statement" subtitle="HDFC net-banking export (.xls)" file={bankFile} onChange={setBankFile} />
              <FileDropzone label="BC Bank Ledger" subtitle="Bank Account Ledger Entries (.xlsx)" file={bcFile} onChange={setBcFile} />
            </div>

            <button onClick={onRun} disabled={!canRun} className="mt-5 w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium shadow-sm hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {running ? <><Loader2 className="h-4 w-4 animate-spin" /> Matching…</> : <><Play className="h-4 w-4" /> Run Reconciliation Match</>}
            </button>

            {error && (
              <div className="mt-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 p-3 text-sm text-rose-900 dark:text-rose-200">
                {error}
              </div>
            )}

            <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
              <strong>Privacy:</strong> All processing happens in your browser. Files never leave your machine.
            </p>
          </section>
        </div>

        {result && (
          <div className="mt-6">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
              <StatCard label="Bank Entries" value={result.stats.totalBank} variant="default" icon={Banknote} />
              <StatCard label="BC Entries" value={result.stats.totalBC} variant="muted" icon={Database} />
              <StatCard label={`Matched (${result.stats.matchPct}%)`} value={result.stats.matchedBank} variant="success" icon={CheckCircle2} />
              <StatCard label="Unmatched Bank" value={result.stats.unmatchedBank} variant="warning" icon={AlertTriangle} />
              <StatCard label="Unmatched BC" value={result.stats.unmatchedBC} variant="error" icon={XCircle} />
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">Results</h2>
                <button onClick={() => downloadReport(result, outlet, dateFrom, dateTo)} className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">
                  <Download className="h-4 w-4" /> Download Excel Report
                </button>
              </div>
              <ResultsTabs result={result} />
            </div>
          </div>
        )}

        <footer className="mt-10 pb-6 text-xs text-slate-400 text-center">
          F&B Ops Suite · Built with Next.js · All processing client-side · No data leaves your browser
        </footer>
      </main>
    </div>
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
