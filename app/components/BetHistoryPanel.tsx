'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';

export type BetHistorySlip = {
  odds?: string;
  tier?: string;
  legs?: string[];
  overallConfidence?: number;
};

export type BetHistoryEntry = {
  id: string;
  user_id: string;
  date: string;
  slip: BetHistorySlip;
  result: string | null;
  roi: number | null;
};

type BetHistoryPanelProps = {
  userId?: string | null;
  onHistoryLoaded?: (history: BetHistoryEntry[]) => void;
};

function exportToCSV(history: BetHistoryEntry[]) {
  const header = 'date,odds,result,roi';
  const rows = history.map(
    (h) =>
      `${h.date},${h.slip.odds ?? ''},${h.result ?? 'pending'},${h.roi ?? ''}`,
  );
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'slippr-history.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function BetHistoryPanel({ userId, onHistoryLoaded }: BetHistoryPanelProps) {
  const [history, setHistory] = useState<BetHistoryEntry[]>([]);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    void (async () => {
      const res = await fetch(`/api/bet-history?user_id=${encodeURIComponent(userId)}`);
      if (!res.ok || cancelled) return;

      const data: BetHistoryEntry[] = await res.json();
      if (cancelled) return;

      setHistory(data);
      onHistoryLoaded?.(data);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, onHistoryLoaded]);

  return (
    <div className="card bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">Bet History</h3>
        <button
          onClick={() => exportToCSV(history)}
          disabled={history.length === 0}
          className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 px-5 py-2 rounded-xl text-sm flex items-center gap-2"
        >
          <Download size={16} /> Export CSV
        </button>
      </div>

      {!userId ? (
        <p className="text-sm text-zinc-500">Sign in to track and export bet history.</p>
      ) : history.length === 0 ? (
        <p className="text-sm text-zinc-500">No bets logged yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {history.map((entry) => (
            <li
              key={entry.id}
              className="flex justify-between bg-zinc-800 p-3 rounded-xl"
            >
              <span>{new Date(entry.date).toLocaleDateString()}</span>
              <span>{entry.slip.odds ?? '—'}</span>
              <span className="text-zinc-400">{entry.result ?? 'pending'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export { exportToCSV };
