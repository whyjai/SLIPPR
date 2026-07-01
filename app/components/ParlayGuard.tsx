'use client';

import { useState } from 'react';
import { Shield, AlertTriangle, RefreshCw, Download } from 'lucide-react';
import BankrollCalculator from './BankrollCalculator';
import BetHistoryPanel, {
  exportToCSV,
  type BetHistoryEntry,
} from './BetHistoryPanel';
import { SharpPublicView } from './SharpPublicView';
import type { SharpPublicData } from '@/lib/sharp-public';

type Slip = {
  tier: string;
  legs: string[];
  odds: string;
  confidence: string;
};

type LegGrade = {
  leg: string;
  confidence: number;
  reasoning: string;
};

type Council = {
  models: Array<{
    model: string;
    grades: LegGrade[];
  }>;
};

type ModelRanking = {
  model: string;
  avgConfidence: number;
  totalSlips: number;
};

type BotResponse = {
  timestamp: string;
  slips: Array<{
    tier: string;
    legs: string[];
    odds: string;
    overallConfidence: number;
  }>;
  warnings: string[];
  councilConsensus: Council;
  weeklyRankings: ModelRanking[];
  sharpPublic?: SharpPublicData;
};

export default function ParlayGuard() {
  const [slips, setSlips] = useState<Slip[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [council, setCouncil] = useState<Council | null>(null);
  const [weeklyRankings, setWeeklyRankings] = useState<ModelRanking[]>([]);
  const [sharpPublic, setSharpPublic] = useState<SharpPublicData | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState<BetHistoryEntry[]>([]);

  const runBot = async () => {
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/bot');
      if (!res.ok) throw new Error('Failed to fetch bot data');

      const data: BotResponse = await res.json();
      setSlips(
        data.slips.map((slip) => ({
          tier: slip.tier,
          legs: slip.legs,
          odds: slip.odds,
          confidence: `${slip.overallConfidence}%`,
        })),
      );
      setWarnings(data.warnings);
      setCouncil(data.councilConsensus);
      setWeeklyRankings(data.weeklyRankings ?? []);
      setSharpPublic(data.sharpPublic ?? null);
      setLastRefresh(new Date(data.timestamp).toLocaleTimeString());
    } catch {
      setError('Could not load data. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">
        <header className="flex flex-wrap gap-4 justify-between items-center mb-12">
          <div className="flex items-center gap-4">
            <Shield className="w-10 h-10 text-emerald-500" />
            <div>
              <h1 className="text-4xl font-bold">SLIPPR</h1>
              <p className="text-zinc-400">
                Fresh Data • AI Council • Protection First
                {lastRefresh && (
                  <span className="ml-2 text-zinc-500">• Last refresh {lastRefresh}</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => exportToCSV(history)}
              disabled={history.length === 0}
              className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 px-5 py-2 rounded-xl text-sm flex items-center gap-2"
            >
              <Download size={16} /> Export CSV
            </button>
            <button
              onClick={runBot}
              disabled={loading}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 px-6 py-3 rounded-2xl font-semibold disabled:opacity-50"
            >
              <RefreshCw className={loading ? 'animate-spin' : ''} /> Refresh All Data
              (8x/day)
            </button>
          </div>
        </header>

        <div className="mb-12 grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl">
          <BankrollCalculator />
          <BetHistoryPanel onHistoryLoaded={setHistory} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {slips.map((slip, i) => (
            <div
              key={i}
              className="card bg-zinc-900 border border-zinc-800 rounded-3xl p-6 hover:border-emerald-500 transition-colors"
            >
              <div className="text-emerald-400 text-sm font-medium mb-2">{slip.tier}</div>
              <div className="text-3xl font-bold mb-4">{slip.odds}</div>
              <div className="space-y-3">
                {slip.legs.map((leg, idx) => (
                  <div key={idx} className="text-sm bg-zinc-800 p-3 rounded-2xl">
                    {leg}
                  </div>
                ))}
              </div>
              <div className="mt-6 text-xs text-zinc-500">
                Overall Confidence: {slip.confidence}
              </div>
            </div>
          ))}
        </div>

        {sharpPublic && (
          <div className="mt-12">
            <SharpPublicView data={sharpPublic} />
          </div>
        )}

        {council && (
          <div className="mt-12">
            <h3 className="font-semibold mb-4">AI Council Grading</h3>
            {council.models.map((model) => (
              <div key={model.model} className="bg-zinc-900 p-4 rounded-2xl mb-4">
                <div className="font-medium">{model.model}</div>
                {model.grades.map((grade, i) => (
                  <div key={i} className="text-sm mt-2">
                    {grade.leg} —{' '}
                    <span className="text-emerald-400">{grade.confidence}/100</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {weeklyRankings.length > 0 && (
          <div className="mt-12">
            <h3 className="font-semibold mb-4">Weekly Model Rankings</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {weeklyRankings.map((ranking, i) => (
                <div
                  key={ranking.model}
                  className="card bg-zinc-900 border border-zinc-800 p-4 rounded-2xl"
                >
                  <div className="flex justify-between items-center">
                    <span className="font-medium">
                      #{i + 1} {ranking.model}
                    </span>
                    <span className="text-emerald-400 text-sm">
                      {ranking.avgConfidence.toFixed(1)} avg
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">
                    {ranking.totalSlips} tracked runs
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-12 bg-red-950 border border-red-900 rounded-3xl p-8">
          <h3 className="text-red-400 flex items-center gap-2 text-lg font-semibold mb-4">
            <AlertTriangle /> Predatory Line Warnings (Live)
          </h3>
          {error ? (
            <p className="text-red-300">{error}</p>
          ) : warnings.length > 0 ? (
            <ul className="space-y-2 text-red-300">
              {warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
          ) : (
            <p className="text-red-300">
              High juice on public favorites detected. Limited props on sharp sides. Shop 3+
              books.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
