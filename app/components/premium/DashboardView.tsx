'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  Loader2,
  Play,
  RefreshCw,
  Shield,
  TrendingUp,
} from 'lucide-react';
import { Badge, Card, PageHeader } from './ui';
import type { BotResponse } from './types';

type DashboardViewProps = {
  embedded?: boolean;
};

const tierTones: Array<{ match: RegExp; tone: 'emerald' | 'amber' | 'rose' | 'violet' | 'zinc' }> = [
  { match: /safe/i, tone: 'emerald' },
  { match: /balanced/i, tone: 'zinc' },
  { match: /aggressive/i, tone: 'amber' },
  { match: /longshot/i, tone: 'rose' },
  { match: /prop/i, tone: 'violet' },
];

function tierTone(tier: string) {
  return tierTones.find((t) => t.match.test(tier))?.tone ?? 'emerald';
}

export default function DashboardView({ embedded = false }: DashboardViewProps) {
  const [slate, setSlate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<BotResponse | null>(null);

  const runBot = async () => {
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/bot');
      if (!res.ok) throw new Error('Bot request failed');
      const json: BotResponse = await res.json();
      setData(json);
    } catch {
      setError('Could not generate slips. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`relative px-6 pb-16 lg:px-10 ${embedded ? 'pt-10' : 'pt-24'}`}>
      <div className="mx-auto max-w-7xl">
        <PageHeader
          eyebrow="Live Dashboard"
          title="Run the bot"
          description="Generate 20+ tiered consensus slips, review council grades, and catch predatory lines before they catch you."
          actions={
            <button
              onClick={runBot}
              disabled={loading}
              className="btn-primary px-7 py-3.5"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {loading ? 'Council deliberating…' : 'Run Bot'}
            </button>
          }
        />

        {error && (
          <div className="animate-fade-up mb-6 rounded-2xl border border-rose-500/25 bg-rose-500/[0.07] px-5 py-4 text-sm text-rose-300">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          {/* Slate input */}
          <Card className="animate-fade-up delay-75 p-6 sm:p-8 xl:col-span-4">
            <h2 className="mb-1 text-lg font-semibold">Today&apos;s Slate</h2>
            <p className="mb-5 text-sm text-zinc-500">
              Optional context for your session. The bot pulls live data from the engine.
            </p>
            <textarea
              value={slate}
              onChange={(e) => setSlate(e.target.value)}
              placeholder="Paste games, odds, or notes…"
              className="h-52 w-full resize-none rounded-xl border border-white/[0.08] bg-black/30 p-4 text-sm text-zinc-200 placeholder:text-zinc-600 transition focus:border-emerald-500/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:h-64"
            />
            <button
              onClick={runBot}
              disabled={loading}
              className="btn-ghost mt-4 w-full py-3.5"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh All Data
            </button>
            {data && (
              <p className="mt-4 font-mono text-xs text-zinc-500">
                Last run · {new Date(data.timestamp).toLocaleString()}
              </p>
            )}
          </Card>

          {/* Slips */}
          <Card className="animate-fade-up delay-150 p-6 sm:p-8 xl:col-span-8">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Tiered Slips</h2>
              {data && (
                <Badge>{data.slips.length} slips generated</Badge>
              )}
            </div>

            {loading && !data ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="skeleton h-40" />
                ))}
              </div>
            ) : !data ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/20">
                  <Shield className="h-7 w-7 text-emerald-400" />
                </div>
                <p className="mb-1 font-medium text-zinc-300">No slips yet</p>
                <p className="text-sm text-zinc-600">
                  Hit Run Bot to generate today&apos;s board
                </p>
              </div>
            ) : (
              <div className="grid max-h-[600px] gap-4 overflow-y-auto pr-1 sm:grid-cols-2">
                {data.slips.map((slip, i) => (
                  <div
                    key={i}
                    className="animate-fade-up rounded-xl border border-white/[0.06] bg-black/25 p-5 transition hover:border-emerald-500/30"
                    style={{ animationDelay: `${Math.min(i * 45, 400)}ms` }}
                  >
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <Badge tone={tierTone(slip.tier)}>{slip.tier}</Badge>
                      <span className="font-mono text-xs text-zinc-500">
                        {slip.overallConfidence}% conf
                      </span>
                    </div>
                    <div className="mb-3 font-mono text-2xl font-bold text-white">
                      {slip.odds}
                    </div>
                    <ul className="space-y-1.5">
                      {slip.legs.map((leg, idx) => (
                        <li key={idx} className="text-xs leading-relaxed text-zinc-400">
                          {leg}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Council + Warnings */}
        {data && (
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card className="animate-fade-up p-6 sm:p-8">
              <div className="mb-2 flex items-center gap-2.5">
                <TrendingUp className="h-5 w-5 text-emerald-400" />
                <h2 className="text-lg font-semibold">AI Council Transparency</h2>
              </div>
              <p className="mb-6 text-sm text-zinc-500">
                Average confidence{' '}
                <span className="font-mono font-medium text-emerald-400">
                  {data.councilConsensus.averageConfidence}%
                </span>
              </p>
              <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
                {data.councilConsensus.models.slice(0, 6).map((model) => (
                  <div
                    key={model.model}
                    className="rounded-xl border border-white/[0.05] bg-black/25 p-4"
                  >
                    <div className="mb-2 text-sm font-medium">{model.model}</div>
                    {model.grades.slice(0, 3).map((g, i) => (
                      <div
                        key={i}
                        className="flex justify-between gap-4 py-0.5 text-xs text-zinc-400"
                      >
                        <span className="truncate">{g.leg}</span>
                        <span className="shrink-0 font-mono text-emerald-400">
                          {g.confidence}/100
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </Card>

            <div className="space-y-6">
              <Card className="animate-fade-up delay-75 border-rose-500/20 bg-rose-500/[0.04] p-6 sm:p-8">
                <div className="mb-4 flex items-center gap-2.5">
                  <AlertTriangle className="h-5 w-5 text-rose-400" />
                  <h2 className="text-lg font-semibold text-rose-300">
                    Predatory Line Warnings
                  </h2>
                </div>
                <ul className="space-y-2.5">
                  {data.warnings.map((w, i) => (
                    <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-rose-200/80">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-rose-400" />
                      {w}
                    </li>
                  ))}
                </ul>
              </Card>

              {data.sharpPublic && (
                <Card className="animate-fade-up delay-150 p-6 sm:p-8">
                  <h2 className="mb-5 text-lg font-semibold">Sharp vs Public</h2>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <p className="eyebrow mb-3">Sharp</p>
                      {data.sharpPublic.sharpLegs.map((leg, i) => (
                        <div key={i} className="py-1 text-xs text-zinc-400">
                          {leg.name}{' '}
                          <span className="font-mono text-emerald-400">+{leg.edge}%</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <p className="eyebrow mb-3 !text-rose-400">Public</p>
                      {data.sharpPublic.publicLegs.map((leg, i) => (
                        <div key={i} className="py-1 text-xs text-zinc-400">
                          {leg.name}
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
