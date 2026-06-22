"use client";

import { useState, useCallback, useMemo } from "react";
import { saveAs } from "file-saver";
import {
  Loader2, Play, Download, AlertTriangle, CheckCircle2, Layers,
} from "lucide-react";
import { MultiFileDropzone } from "@/components/multi-file-dropzone";
import { FileDropzone } from "@/components/file-dropzone";
import { parseSettlementFile } from "@/lib/settlement";
import { parseSalesInvoices } from "@/lib/sales-invoices";
import type { SettlementInput, CashInvoiceInput } from "@/lib/matcher";
import {
  pairFilesByOutlet, runBatch, packageBatchZip,
  type BatchResult, type OutletJob,
} from "@/lib/batch";

export function BatchMode() {
  const [bankFiles, setBankFiles] = useState<File[]>([]);
  const [bcFiles, setBcFiles] = useState<File[]>([]);
  const [settlementFiles, setSettlementFiles] = useState<File[]>([]);
  const [siFile, setSiFile] = useState<File | null>(null);
  const [jobs, setJobs] = useState<OutletJob[] | null>(null);
  const [results, setResults] = useState<BatchResult[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ i: number; total: number; outlet: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRun = bankFiles.length > 0 && bcFiles.length > 0 && !running;

  // Pair outlets once both bank + BC files exist (preview before running)
  const preview = useCallback(async () => {
    if (bankFiles.length === 0 || bcFiles.length === 0) { setJobs(null); return; }
    try {
      const paired = await pairFilesByOutlet(bankFiles, bcFiles);
      setJobs(paired);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pairing failed");
    }
  }, [bankFiles, bcFiles]);

  // Run pairing whenever inputs change
  useMemo(() => { preview(); }, [preview]);

  const onRun = useCallback(async () => {
    if (!jobs) return;
    setRunning(true); setError(null); setResults([]); setProgress({ i: 0, total: jobs.length, outlet: "" });
    try {
      // Parse settlements + cash invoices once
      const settlements: SettlementInput[] = [];
      for (const f of settlementFiles) {
        try { settlements.push(...(await parseSettlementFile(f))); }
        catch (e) { console.warn(`Skip ${f.name}`, e); }
      }
      let cashInvoices: CashInvoiceInput[] = [];
      if (siFile) {
        try {
          const si = await parseSalesInvoices(siFile);
          cashInvoices = si.filter(x => x.paymentType.toUpperCase() === "CASH")
            .map(x => ({ docNo: x.docNo, postingDate: x.postingDate, locationCode: x.locationCode, grossTotal: x.grossTotal }));
        } catch (e) { console.warn("SI parse failed", e); }
      }
      const out = await runBatch({
        jobs, allBCFiles: bcFiles, settlements, cashInvoices,
        dateTol: 2, amountTol: 1, maxComponents: 100,
        onProgress: (i, total, outlet) => setProgress({ i, total, outlet }),
      });
      setResults(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Batch failed");
    } finally {
      setRunning(false); setProgress(null);
    }
  }, [jobs, bcFiles, settlementFiles, siFile]);

  const onDownloadZip = useCallback(async () => {
    if (results.length === 0) return;
    const blob = await packageBatchZip(results);
    const today = new Date().toISOString().slice(0, 10);
    saveAs(blob, `BankReco_Fleet_${today}.zip`);
  }, [results]);

  // Aggregate stats
  const fleetStats = useMemo(() => {
    if (results.length === 0) return null;
    const bank = results.reduce((s, r) => s + r.stats.totalBank, 0);
    const matched = results.reduce((s, r) => s + r.stats.matchedBank, 0);
    return {
      outlets: results.length,
      success: results.filter(r => !r.error).length,
      bank,
      matched,
      pct: bank ? Math.round((matched / bank) * 1000) / 10 : 0,
    };
  }, [results]);

  return (
    <div>
      {/* Inputs */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 mb-5">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Layers className="h-4 w-4" /> Drop every outlet's files
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <MultiFileDropzone
            label="Bank statements (one per outlet)"
            subtitle="HDFC .xls files — outlet detected from filename"
            accept={{
              "application/vnd.ms-excel": [".xls"],
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
            }}
            files={bankFiles} onChange={setBankFiles}
          />
          <MultiFileDropzone
            label="BC bank ledgers (every outlet)"
            subtitle="HDFC<code> (<outlet>).xlsx files — used for primary + cross-outlet T7"
            accept={{
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
            }}
            files={bcFiles} onChange={setBcFiles}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <MultiFileDropzone
            label="Aggregator settlement files (shared)"
            subtitle="Swiggy / Zomato / AmEx / PhonePe CSVs — one set for the whole fleet"
            accept={{
              "text/csv": [".csv"],
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
            }}
            files={settlementFiles} onChange={setSettlementFiles}
          />
          <FileDropzone
            label="Sales Invoices (shared)"
            subtitle="BC Sales Invoices export — used for cash-deposit matching across all outlets"
            file={siFile} onChange={setSiFile}
          />
        </div>
      </div>

      {/* Pairing preview */}
      {jobs && jobs.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 mb-5">
          <h3 className="text-sm font-semibold mb-2">Pairing preview ({jobs.length} outlets)</h3>
          <div className="overflow-auto max-h-48 -mx-2">
            <table className="w-full text-xs">
              <thead className="text-slate-500 dark:text-slate-400 sticky top-0 bg-white dark:bg-slate-900">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">Outlet</th>
                  <th className="px-2 py-1.5 text-left font-medium">Bank file</th>
                  <th className="px-2 py-1.5 text-left font-medium">BC file</th>
                  <th className="px-2 py-1.5 text-right font-medium">BC entries</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j, i) => (
                  <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-2 py-1.5 font-mono font-semibold">{j.displayCode}{j.outletCode !== j.displayCode && <span className="text-slate-400 ml-1">→ {j.outletCode}</span>}</td>
                    <td className="px-2 py-1.5 truncate max-w-xs" title={j.bankFile.name}>{j.bankFile.name}</td>
                    <td className="px-2 py-1.5 truncate max-w-xs" title={j.bcFile.name}>{j.bcFile.name}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{j.bcEntryCount ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Run button */}
      <button
        onClick={onRun}
        disabled={!canRun}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold shadow-sm hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {running
          ? <><Loader2 className="h-4 w-4 animate-spin" /> Reconciling {progress?.outlet} ({progress?.i ?? 0}/{progress?.total ?? 0})</>
          : <><Play className="h-4 w-4" /> Run batch reconciliation ({jobs?.length ?? 0} outlets)</>}
      </button>

      {error && (
        <div className="mt-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 p-3 text-sm text-rose-900 dark:text-rose-200 flex gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" /><div>{error}</div>
        </div>
      )}

      {/* Results */}
      {fleetStats && (
        <div className="mt-8">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
            <Stat label="Outlets processed" value={fleetStats.success} sub={`${fleetStats.outlets} attempted`} variant="default" />
            <Stat label="Bank entries" value={fleetStats.bank.toLocaleString("en-IN")} variant="muted" />
            <Stat label="Auto-matched" value={fleetStats.matched.toLocaleString("en-IN")} variant="success" />
            <Stat label="Fleet match %" value={fleetStats.pct + "%"} variant="success" />
            <button onClick={onDownloadZip} className="rounded-xl bg-gradient-to-br from-emerald-600 to-emerald-500 text-white p-4 shadow-sm hover:from-emerald-700 hover:to-emerald-600 transition-colors">
              <div className="flex items-center justify-center gap-2 h-full">
                <Download className="h-5 w-5" />
                <span className="text-sm font-semibold">Download all reports (zip)</span>
              </div>
            </button>
          </div>

          {/* Leaderboard */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
            <h3 className="text-sm font-semibold mb-3">Per-outlet leaderboard</h3>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium">Outlet</th>
                    <th className="px-2 py-2 text-right font-medium">Bank</th>
                    <th className="px-2 py-2 text-right font-medium">Matched</th>
                    <th className="px-2 py-2 text-right font-medium">Match %</th>
                    <th className="px-2 py-2 text-right font-medium">T1/T2/T5/T7/T8</th>
                    <th className="px-2 py-2 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...results].sort((a, b) => b.stats.matchPct - a.stats.matchPct).map((r, i) => (
                    <tr key={i} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-2 py-2 font-mono font-semibold">{r.displayCode}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{r.stats.totalBank}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{r.stats.matchedBank}</td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        <span className={`font-semibold ${r.stats.matchPct >= 80 ? "text-emerald-600 dark:text-emerald-400" : r.stats.matchPct >= 60 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400"}`}>
                          {r.stats.matchPct}%
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right text-xs font-mono text-slate-500">
                        {r.tierCounts.T1 ?? 0}/{r.tierCounts.T2 ?? 0}/{r.tierCounts.T5 ?? 0}/{r.tierCounts.T7 ?? 0}/{r.tierCounts.T8 ?? 0}
                      </td>
                      <td className="px-2 py-2 text-xs">
                        {r.error
                          ? <span className="inline-flex items-center gap-1 text-rose-600"><AlertTriangle className="h-3 w-3" /> {r.error.slice(0, 40)}</span>
                          : <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3 w-3" /> OK</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, variant }: { label: string; value: string | number; sub?: string; variant: "default" | "muted" | "success" }) {
  const bg = variant === "default" ? "from-blue-600 to-blue-500"
    : variant === "success" ? "from-emerald-600 to-emerald-500"
    : "from-slate-600 to-slate-500";
  return (
    <div className={`rounded-xl bg-gradient-to-br ${bg} p-4 text-white shadow-sm`}>
      <div className="text-2xl font-bold leading-none">{value}</div>
      <div className="mt-1.5 text-xs font-medium uppercase tracking-wide opacity-90">{label}</div>
      {sub && <div className="mt-0.5 text-xs opacity-75">{sub}</div>}
    </div>
  );
}
