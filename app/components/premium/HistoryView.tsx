'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, History as HistoryIcon } from 'lucide-react';
import { Badge, Card, PageHeader } from './ui';
import { exportToCSV, type BetHistoryEntry } from '../BetHistoryPanel';

type HistoryViewProps = {
  userId?: string | null;
};

function resultTone(result: string | null): 'emerald' | 'rose' | 'zinc' {
  if (result === 'win') return 'emerald';
  if (result === 'loss') return 'rose';
  return 'zinc';
}

export default function HistoryView({ userId }: HistoryViewProps) {
  const [history, setHistory] = useState<BetHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const res = await fetch(`/api/bet-history?user_id=${encodeURIComponent(userId)}`);
        if (!res.ok || cancelled) return;
        const data: BetHistoryEntry[] = await res.json();
        if (!cancelled) setHistory(data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const summary = useMemo(() => {
    const settled = history.filter((h) => h.result === 'win' || h.result === 'loss');
    const wins = settled.filter((h) => h.result === 'win').length;
    const rois = history.map((h) => h.roi).filter((r): r is number => r != null);
    const avgRoi = rois.length
      ? rois.reduce((a, b) => a + b, 0) / rois.length
      : null;

    return {
      record: settled.length ? `${wins}–${settled.length - wins}` : '—',
      avgRoi: avgRoi != null ? `${avgRoi >= 0 ? '+' : ''}${avgRoi.toFixed(1)}%` : '—',
      pending: history.filter((h) => !h.result).length,
    };
  }, [history]);

  return (
    <div className="px-6 pb-16 pt-10 lg:px-10">
      <div className="mx-auto max-w-5xl">
        <PageHeader
          eyebrow="Track Record"
          title="Bet history"
          description="Every slip logged. Results, ROI, and exports — full accountability over time."
          actions={
            <button
              onClick={() => exportToCSV(history)}
              disabled={history.length === 0}
              className="btn-ghost px-6 py-3"
            >
              <Download className="h-4 w-4" /> Export CSV
            </button>
          }
        />

        {/* Summary strip */}
        <div className="animate-fade-up delay-75 mb-6 grid grid-cols-3 gap-4">
          {[
            { label: 'Record', value: summary.record },
            { label: 'Avg ROI', value: summary.avgRoi },
            { label: 'Pending', value: String(summary.pending) },
          ].map((s) => (
            <Card key={s.label} className="px-6 py-5 text-center">
              <div className="font-mono text-2xl font-bold text-emerald-400">{s.value}</div>
              <div className="mt-1 text-xs uppercase tracking-wider text-zinc-500">
                {s.label}
              </div>
            </Card>
          ))}
        </div>

        <Card className="animate-fade-up delay-150 overflow-hidden">
          {loading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skeleton h-14" />
              ))}
            </div>
          ) : !userId ? (
            <EmptyState
              title="Sign in to track your bets"
              sub="Slips you run are logged automatically once you're signed in."
            />
          ) : history.length === 0 ? (
            <EmptyState
              title="No bets logged yet"
              sub="Run the bot and your slips will show up here with results and ROI."
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wider text-zinc-500">
                  <th className="px-6 py-4 font-medium">Date</th>
                  <th className="px-6 py-4 font-medium">Tier</th>
                  <th className="px-6 py-4 font-medium">Odds</th>
                  <th className="px-6 py-4 font-medium">Result</th>
                  <th className="px-6 py-4 text-right font-medium">ROI</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-white/[0.04] transition last:border-0 hover:bg-white/[0.02]"
                  >
                    <td className="px-6 py-4 text-zinc-300">
                      {new Date(entry.date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-zinc-400">{entry.slip.tier ?? '—'}</td>
                    <td className="px-6 py-4 font-mono text-zinc-200">
                      {entry.slip.odds ?? '—'}
                    </td>
                    <td className="px-6 py-4">
                      <Badge tone={resultTone(entry.result)}>
                        {entry.result ?? 'pending'}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-right font-mono text-zinc-300">
                      {entry.roi != null
                        ? `${entry.roi >= 0 ? '+' : ''}${entry.roi}%`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}

function EmptyState({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/20">
        <HistoryIcon className="h-7 w-7 text-emerald-400" />
      </div>
      <p className="mb-1 font-medium text-zinc-300">{title}</p>
      <p className="max-w-sm text-sm text-zinc-600">{sub}</p>
    </div>
  );
}
