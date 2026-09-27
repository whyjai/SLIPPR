'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDownUp } from 'lucide-react';
import { Card, cn } from './ui';
import type { NflTeamTendencies, TendencyMetric } from '@/lib/research/nfl-teams';

type Side = 'offense' | 'defense';

function fmt(value: number | null, m: TendencyMetric): string {
  if (value == null) return '—';
  if (m.unit !== 'EPA') value = Math.round(value * 10) / 10;
  if (m.unit === '%') return `${value}%`;
  if (m.unit === 'sec') return `${value}s`;
  if (m.unit === 'pts') return `${value > 0 ? '+' : ''}${value}`;
  if (m.unit === 'EPA') return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
  return `${value}`;
}

export default function TeamTendenciesPanel({ season }: { season: number }) {
  const [result, setResult] = useState<{ season: number; data?: NflTeamTendencies; error?: string } | null>(null);
  const [side, setSide] = useState<Side>('defense');
  const [metricKey, setMetricKey] = useState('blitzRate');
  const [firstOnTop, setFirstOnTop] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/research/nfl/teams?season=${season}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (!cancelled) setResult({ season, data: json as NflTeamTendencies });
      })
      .catch((e) => !cancelled && setResult({ season, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [season]);

  const loading = result?.season !== season;
  const data = result?.data ?? null;
  const metrics = data ? (side === 'offense' ? data.offenseMetrics : data.defenseMetrics) : [];
  const metric = metrics.find((m) => m.key === metricKey) ?? metrics[0];

  const rows = useMemo(() => {
    if (!data || !metric) return [];
    return [...data.teams]
      .filter((t) => t[side][metric.key]?.rank != null)
      .sort((a, b) => (firstOnTop ? 1 : -1) * (a[side][metric.key].rank! - b[side][metric.key].rank!));
  }, [data, side, metric, firstOnTop]);

  if (loading && !data) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton h-14" />
        ))}
      </div>
    );
  }
  if (!loading && result?.error) {
    return <Card className="p-10 text-center text-sm text-zinc-400">Couldn&apos;t load team data: {result.error}</Card>;
  }
  if (!data || !metric) return null;

  const avg = data.leagueAvg[side][metric.key];
  const fromOtherSeason = metric.key === 'manRate' && data.coverageSeason != null && data.coverageSeason !== data.season;
  const n = rows.length;

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Team tendencies</h2>
      <p className="mb-4 text-sm text-zinc-500">
        How each offense plays and how each defense lines up, from play-by-play and FTN charting (blitzers, box counts,
        play-action, motion). Completed games through Week {data.throughWeek}.
      </p>

      <div className="mb-3 flex gap-2">
        {(['defense', 'offense'] as Side[]).map((s) => (
          <button
            key={s}
            onClick={() => {
              setSide(s);
              setMetricKey(s === 'offense' ? 'neutralPassRate' : 'blitzRate');
            }}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium capitalize transition',
              side === s ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/[0.02] text-zinc-400 hover:text-zinc-200',
            )}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {metrics.map((m) => (
          <button
            key={m.key}
            onClick={() => setMetricKey(m.key)}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-200',
              metric.key === m.key
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:border-white/20 hover:text-zinc-200',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="mb-4 text-xs text-zinc-500">
        {metric.hint}
        {fromOtherSeason && (
          <span className="text-amber-400/90">
            {' '}
            Coverage type is published after a season ends, so this is {data.coverageSeason}.
          </span>
        )}
      </p>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-[3.5rem_1fr_5.5rem_5.5rem_3.5rem] items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
          <button onClick={() => setFirstOnTop(!firstOnTop)} className="flex items-center gap-1 hover:text-zinc-300">
            Rank <ArrowDownUp className="h-3 w-3" />
          </button>
          <span>Team</span>
          <span className="text-right">{metric.label.length > 12 ? 'Value' : metric.label}</span>
          <span className="text-right">vs avg</span>
          <span className="text-right">GP</span>
        </div>
        {rows.map((t) => {
          const cell = t[side][metric.key];
          const diff = cell.value != null && avg != null ? cell.value - avg : null;
          const tone = cell.rank! <= 5 ? 'text-emerald-300' : cell.rank! > n - 5 ? 'text-rose-300' : 'text-zinc-300';
          return (
            <div
              key={t.team}
              className="grid grid-cols-[3.5rem_1fr_5.5rem_5.5rem_3.5rem] items-center gap-2 border-b border-white/[0.04] px-4 py-2.5 text-sm last:border-0"
            >
              <span className={cn('font-mono font-semibold', tone)}>#{cell.rank}</span>
              <span className="truncate text-zinc-200">{t.name}</span>
              <span className="text-right font-mono text-zinc-200">{fmt(cell.value, metric)}</span>
              <span className="text-right font-mono text-xs text-zinc-500">
                {diff == null ? '' : `${diff > 0 ? '+' : ''}${metric.unit === 'EPA' ? diff.toFixed(2) : Math.round(diff * 10) / 10}`}
              </span>
              <span className="text-right font-mono text-xs text-zinc-500">{t.games}</span>
            </div>
          );
        })}
        <div className="px-4 py-2.5 text-xs text-zinc-500">
          League average: {fmt(avg, metric)} · #1 = {metric.highIsFirst ? 'highest' : 'lowest'}
        </div>
      </Card>
    </section>
  );
}
