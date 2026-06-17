"use client";

import { useState } from "react";
import { cn, formatINR, formatDate } from "@/lib/utils";
import type { MatchResult } from "@/lib/matcher";

const TABS = [
  { id: "matched",  label: "Matched" },
  { id: "ub",       label: "Unmatched Bank" },
  { id: "uc",       label: "Unmatched BC" },
  { id: "summary",  label: "Daily Summary" },
  { id: "guide",    label: "BC Match Guide" },
] as const;

type TabId = typeof TABS[number]["id"];

export function ResultsTabs({ result }: { result: MatchResult }) {
  const [tab, setTab] = useState<TabId>("matched");
  return (
    <div>
      <div className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-700 mb-3">
        {TABS.map(t => {
          const count = t.id === "matched" ? result.matches.length
            : t.id === "ub" ? result.unmatchedBank.length
            : t.id === "uc" ? result.unmatchedBC.length
            : t.id === "summary" ? result.summary.length
            : result.matches.length;
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px",
                isActive
                  ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                  : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
              )}
            >
              {t.label} <span className="ml-1 text-xs opacity-70">({count})</span>
            </button>
          );
        })}
      </div>

      {tab === "matched" && <MatchedTable result={result} />}
      {tab === "ub" && <UnmatchedBankTable result={result} />}
      {tab === "uc" && <UnmatchedBCTable result={result} />}
      {tab === "summary" && <SummaryTable result={result} />}
      {tab === "guide" && <GuideTable result={result} />}
    </div>
  );
}

function tierColor(tier: string): string {
  if (tier.startsWith("T1")) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
  if (tier.startsWith("T2")) return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300";
  if (tier.startsWith("T3")) return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
  return "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300";
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn("px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700", className)}>{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2 text-sm text-slate-700 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800", className)}>{children}</td>;
}

function MatchedTable({ result }: { result: MatchResult }) {
  if (result.matches.length === 0) return <Empty msg="No matches found. Try widening tolerances." />;
  return (
    <TableShell>
      <thead><tr>
        <Th>Bank Date</Th><Th>Bank Narration</Th><Th className="text-right">Bank Amount</Th>
        <Th>Tier</Th><Th>BC Docs</Th>
      </tr></thead>
      <tbody>
        {result.matches.slice(0, 500).map((m, i) => (
          <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800">
            <Td>{formatDate(m.bankDate)}</Td>
            <Td className="max-w-xs truncate" >{m.bankNarration}</Td>
            <Td className="text-right tabular-nums">₹{formatINR(m.bankAmount)}</Td>
            <Td><span className={cn("inline-block px-2 py-0.5 rounded text-xs font-medium", tierColor(m.tierLabel))}>{m.tierLabel}</span></Td>
            <Td className="max-w-md truncate text-xs">{m.bcDocs}</Td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function UnmatchedBankTable({ result }: { result: MatchResult }) {
  if (result.unmatchedBank.length === 0) return <Empty msg="✓ All bank entries matched!" />;
  return (
    <TableShell>
      <thead><tr><Th>Date</Th><Th>Narration</Th><Th>Direction</Th><Th className="text-right">Amount</Th><Th>Category</Th></tr></thead>
      <tbody>
        {result.unmatchedBank.slice(0, 500).map(b => (
          <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
            <Td>{formatDate(b.date)}</Td>
            <Td className="max-w-md truncate">{b.narration}</Td>
            <Td>{b.direction}</Td>
            <Td className="text-right tabular-nums">₹{formatINR(b.absAmount)}</Td>
            <Td><span className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">{b.category}</span></Td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function UnmatchedBCTable({ result }: { result: MatchResult }) {
  if (result.unmatchedBC.length === 0) return <Empty msg="✓ All BC entries matched!" />;
  return (
    <TableShell>
      <thead><tr><Th>Posting Date</Th><Th>Doc No.</Th><Th>Description</Th><Th>Direction</Th><Th className="text-right">Amount</Th></tr></thead>
      <tbody>
        {result.unmatchedBC.slice(0, 500).map(c => (
          <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
            <Td>{formatDate(c.postingDate)}</Td>
            <Td className="font-mono text-xs">{c.documentNo}</Td>
            <Td className="max-w-md truncate">{c.description}</Td>
            <Td>{c.direction}</Td>
            <Td className="text-right tabular-nums">₹{formatINR(c.absAmount)}</Td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function SummaryTable({ result }: { result: MatchResult }) {
  return (
    <TableShell>
      <thead><tr>
        <Th>Date</Th><Th className="text-right">Bank</Th><Th className="text-right">BC</Th>
        <Th className="text-right">Matched</Th><Th className="text-right">Unm. Bank</Th>
        <Th className="text-right">Unm. BC</Th><Th className="text-right">Match %</Th>
      </tr></thead>
      <tbody>
        {result.summary.map(s => (
          <tr key={s.date} className="hover:bg-slate-50 dark:hover:bg-slate-800">
            <Td>{s.date}</Td>
            <Td className="text-right tabular-nums">{s.bankEntries}</Td>
            <Td className="text-right tabular-nums">{s.bcEntries}</Td>
            <Td className="text-right tabular-nums">{s.matched}</Td>
            <Td className="text-right tabular-nums text-amber-600">{s.unmatchedBank}</Td>
            <Td className="text-right tabular-nums text-rose-600">{s.unmatchedBC}</Td>
            <Td className="text-right tabular-nums font-medium">{s.matchPct}%</Td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function GuideTable({ result }: { result: MatchResult }) {
  return (
    <div>
      <div className="mb-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-sm text-blue-900 dark:text-blue-100 border border-blue-200 dark:border-blue-900">
        <strong>How to use in BC:</strong> Open <em>Bank Account Reconciliations</em>. For each row below, find the bank statement line by Date + Amount, click <em>Match Manually</em>, and tick the BC Doc Nos listed.
      </div>
      <TableShell>
        <thead><tr>
          <Th>Bank Date</Th><Th>Description</Th><Th className="text-right">Amount</Th>
          <Th>Tier</Th><Th>BC Docs to Match</Th>
        </tr></thead>
        <tbody>
          {result.matches.map((m, i) => (
            <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800">
              <Td>{formatDate(m.bankDate)}</Td>
              <Td className="max-w-xs truncate">{m.bankNarration}</Td>
              <Td className="text-right tabular-nums">₹{formatINR(m.bankAmount)}</Td>
              <Td><span className={cn("inline-block px-2 py-0.5 rounded text-xs font-medium", tierColor(m.tierLabel))}>{m.tier}</span></Td>
              <Td className="max-w-md break-words text-xs font-mono">{m.bcDocs}</Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </div>
  );
}

function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-auto max-h-[60vh] rounded-lg border border-slate-200 dark:border-slate-700">
      <table className="min-w-full">{children}</table>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">{msg}</div>;
}
