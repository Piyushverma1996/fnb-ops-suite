"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { cn, formatINR, formatDate } from "@/lib/utils";
import type { MatchResult, Match } from "@/lib/matcher";

const TABS = [
  { id: "matched",  label: "Matched" },
  { id: "ub",       label: "Unmatched Bank" },
  { id: "uc",       label: "Unmatched BC" },
  { id: "summary",  label: "Daily Summary" },
  { id: "guide",    label: "BC Match Guide" },
] as const;

type TabId = typeof TABS[number]["id"];
type TierFilter = "ALL" | "T1" | "T2" | "T3" | "T4";

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

function Td({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return <td title={title} className={cn("px-3 py-2 text-sm text-slate-700 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800", className)}>{children}</td>;
}

function MatchedTable({ result }: { result: MatchResult }) {
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<TierFilter>("ALL");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return result.matches.filter(m => {
      if (tier !== "ALL" && !m.tier.startsWith(tier)) return false;
      if (!term) return true;
      return (
        m.bankNarration.toLowerCase().includes(term) ||
        m.bcDocs.toLowerCase().includes(term) ||
        m.bcDescriptions.toLowerCase().includes(term) ||
        String(m.bankAmount).includes(term)
      );
    });
  }, [q, tier, result.matches]);

  const tierCounts = useMemo(() => {
    const c: Record<string, number> = { T1: 0, T2: 0, T3: 0, T4: 0 };
    for (const m of result.matches) c[m.tier] = (c[m.tier] ?? 0) + 1;
    return c;
  }, [result.matches]);

  if (result.matches.length === 0) return <Empty msg="No matches found. Try widening tolerances." />;

  return (
    <div>
      <ResultsToolbar
        q={q} setQ={setQ}
        showing={filtered.length} total={result.matches.length}
      >
        <TierChips tier={tier} setTier={setTier} counts={tierCounts} />
      </ResultsToolbar>

      <TableShell>
        <thead><tr>
          <Th>Bank Date</Th><Th>Bank Narration</Th><Th className="text-right">Amount</Th>
          <Th>Tier</Th><Th>BC Docs</Th>
        </tr></thead>
        <tbody>
          {filtered.slice(0, 500).map((m: Match, i: number) => (
            <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800">
              <Td>{formatDate(m.bankDate)}</Td>
              <Td className="max-w-xs truncate" title={m.bankNarration}>{m.bankNarration}</Td>
              <Td className="text-right tabular-nums">₹{formatINR(m.bankAmount)}</Td>
              <Td><span className={cn("inline-block px-2 py-0.5 rounded text-xs font-medium", tierColor(m.tierLabel))}>{m.tierLabel}</span></Td>
              <Td className="max-w-md truncate text-xs font-mono" title={m.bcDocs}>{m.bcDocs}</Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      {filtered.length > 500 && (
        <p className="mt-2 text-xs text-slate-500">Showing first 500 rows. Download Excel for the full list.</p>
      )}
    </div>
  );
}

function UnmatchedBankTable({ result }: { result: MatchResult }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return result.unmatchedBank;
    return result.unmatchedBank.filter(b =>
      b.narration.toLowerCase().includes(term) ||
      b.category.toLowerCase().includes(term) ||
      String(b.absAmount).includes(term)
    );
  }, [q, result.unmatchedBank]);

  if (result.unmatchedBank.length === 0) return <Empty msg="✓ All bank entries matched." />;

  return (
    <div>
      <ResultsToolbar q={q} setQ={setQ} showing={filtered.length} total={result.unmatchedBank.length} />
      <TableShell>
        <thead><tr><Th>Date</Th><Th>Narration</Th><Th>Direction</Th><Th className="text-right">Amount</Th><Th>Category</Th></tr></thead>
        <tbody>
          {filtered.slice(0, 500).map(b => (
            <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
              <Td>{formatDate(b.date)}</Td>
              <Td className="max-w-md truncate" title={b.narration}>{b.narration}</Td>
              <Td>{b.direction}</Td>
              <Td className="text-right tabular-nums">₹{formatINR(b.absAmount)}</Td>
              <Td><span className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">{b.category}</span></Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </div>
  );
}

function UnmatchedBCTable({ result }: { result: MatchResult }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return result.unmatchedBC;
    return result.unmatchedBC.filter(c =>
      c.description.toLowerCase().includes(term) ||
      c.documentNo.toLowerCase().includes(term) ||
      String(c.absAmount).includes(term)
    );
  }, [q, result.unmatchedBC]);

  if (result.unmatchedBC.length === 0) return <Empty msg="✓ All BC entries matched." />;

  return (
    <div>
      <ResultsToolbar q={q} setQ={setQ} showing={filtered.length} total={result.unmatchedBC.length} />
      <TableShell>
        <thead><tr><Th>Posting Date</Th><Th>Doc No.</Th><Th>Description</Th><Th>Direction</Th><Th className="text-right">Amount</Th></tr></thead>
        <tbody>
          {filtered.slice(0, 500).map(c => (
            <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
              <Td>{formatDate(c.postingDate)}</Td>
              <Td className="font-mono text-xs">{c.documentNo}</Td>
              <Td className="max-w-md truncate" title={c.description}>{c.description}</Td>
              <Td>{c.direction}</Td>
              <Td className="text-right tabular-nums">₹{formatINR(c.absAmount)}</Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </div>
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
              <Td className="max-w-xs truncate" title={m.bankNarration}>{m.bankNarration}</Td>
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

function ResultsToolbar({
  q, setQ, showing, total, children,
}: { q: string; setQ: (s: string) => void; showing: number; total: number; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-3">
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search narration, doc no, amount…"
          className="input pl-8 pr-8 text-sm"
        />
        {q && (
          <button
            onClick={() => setQ("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            aria-label="Clear"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {children}
      <span className="text-xs text-slate-500 ml-auto">
        {showing === total ? `${total} rows` : `${showing} of ${total} rows`}
      </span>
    </div>
  );
}

function TierChips({
  tier, setTier, counts,
}: { tier: TierFilter; setTier: (t: TierFilter) => void; counts: Record<string, number> }) {
  const opts: { id: TierFilter; label: string }[] = [
    { id: "ALL", label: "All" },
    { id: "T1", label: `T1 (${counts.T1 ?? 0})` },
    { id: "T2", label: `T2 (${counts.T2 ?? 0})` },
    { id: "T3", label: `T3 (${counts.T3 ?? 0})` },
    { id: "T4", label: `T4 (${counts.T4 ?? 0})` },
  ];
  return (
    <div className="flex flex-wrap gap-1">
      {opts.map(o => (
        <button
          key={o.id}
          onClick={() => setTier(o.id)}
          className={cn(
            "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
            tier === o.id
              ? "bg-blue-600 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700",
          )}
        >
          {o.label}
        </button>
      ))}
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
