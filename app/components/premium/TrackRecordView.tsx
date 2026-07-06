'use client';

import { useEffect, useState } from 'react';
import { BadgeCheck, Info, TrendingUp } from 'lucide-react';
import { Badge, Card, PageHeader, SectionLabel, cn } from './ui';
import type { TrackRecordSummary } from '@/lib/track-record';

type TrackResponse = { configured: boolean; summary: TrackRecordSummary | null };

export default function TrackRecordView() {
  const [data, setData] = useState<TrackResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/track-record')
      .then((res) => (res.ok ? res.json() : null))
      .then((json: TrackResponse | null) => setData(json))
      .finally(() => setLoading(false));
  }, []);

  const summary = data?.summary;
  const hasGraded = summary && summary.totalGraded > 0;

  return (
    <div className="px-6 pb-16 pt-10 lg:px-10">
      <div className="mx-auto max-w-5xl">
        <PageHeader
          eyebrow="Verified Results"
          title="Track record"
          description="Every published pick, logged at its entry price and graded honestly — wins and losses. No cherry-picking, no hidden slips."
          actions={<Badge tone="emerald"><BadgeCheck className="h-3.5 w-3.5" /> Auto-graded</Badge>}
        />

        {/* Why CLV — the trust builder */}
        <Card className="animate-fade-up mb-6 border-emerald-500/15 bg-emerald-500/[0.03] p-6">
          <div className="flex gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <div>
              <h2 className="mb-1 text-sm font-semibold text-emerald-300">
                Why we lead with Closing Line Value (CLV)
              </h2>
              <p className="text-xs leading-relaxed text-zinc-400">
                CLV measures whether the price we posted beat the market&apos;s final closing
                line. Win rates can be cherry-picked; consistently beating the close cannot.
                A positive average CLV over a large sample is the single hardest-to-fake proof
                that a service is genuinely sharp — so it&apos;s the first number we show you.
              </p>
            </div>
          </div>
        </Card>

        {loading ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-28" />
            ))}
          </div>
        ) : !hasGraded ? (
          <Card className="animate-fade-up p-12 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/20">
              <TrendingUp className="h-7 w-7 text-emerald-400" />
            </div>
            <p className="mb-1 font-medium text-zinc-300">
              {data?.configured
                ? 'Building the record'
                : 'Track record activates with live data'}
            </p>
            <p className="mx-auto max-w-md text-sm text-zinc-600">
              {data?.configured
                ? 'Picks are being logged now. Results and CLV populate here as today’s games close and settle — the record grows automatically every window.'
                : 'Once the odds API + database keys are set, every live pick is logged at its entry price, closing lines are captured, and results grade automatically. This page then fills with an honest, public W/L + CLV history.'}
            </p>
            {summary && summary.pendingCount > 0 && (
              <p className="mt-4 font-mono text-xs text-emerald-400">
                {summary.pendingCount} picks logged and awaiting settlement
              </p>
            )}
          </Card>
        ) : (
          <>
            {/* Headline metrics */}
            <div className="animate-fade-up mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Metric
                label="Avg CLV"
                value={fmtSigned(summary!.avgClv, ' pts')}
                highlight
                sub={summary!.clvPositiveRate != null ? `${summary!.clvPositiveRate}% beat the close` : undefined}
              />
              <Metric label="Record" value={`${summary!.wins}–${summary!.losses}`} sub={`${summary!.totalGraded} graded`} />
              <Metric label="Win Rate" value={summary!.winRate != null ? `${summary!.winRate}%` : '—'} />
              <Metric
                label="ROI (flat $100)"
                value={fmtSigned(summary!.roiPer100, '%')}
                tone={roiTone(summary!.roiPer100)}
              />
            </div>

            {/* By grade */}
            {summary!.byGrade.length > 0 && (
              <Card className="animate-fade-up delay-75 mb-6 p-6 sm:p-7">
                <SectionLabel className="mb-4">Win rate by council grade</SectionLabel>
                <div className="space-y-3">
                  {summary!.byGrade.map((g) => (
                    <div key={g.grade} className="flex items-center gap-4">
                      <Badge tone={g.grade.startsWith('A') ? 'emerald' : g.grade.startsWith('B') ? 'violet' : 'amber'}>
                        {g.grade}
                      </Badge>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400"
                          style={{ width: `${g.winRate ?? 0}%` }}
                        />
                      </div>
                      <span className="w-24 text-right font-mono text-xs text-zinc-400">
                        {g.winRate != null ? `${g.winRate}%` : '—'} · {g.graded}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Recent picks — wins AND losses */}
            <Card className="animate-fade-up delay-150 overflow-hidden">
              <div className="border-b border-white/[0.06] px-6 py-4">
                <h2 className="text-sm font-semibold">Recent graded picks</h2>
              </div>
              <div className="divide-y divide-white/[0.04]">
                {summary!.recent.map((p, i) => (
                  <div key={i} className="flex items-center gap-4 px-6 py-3.5">
                    <Badge tone="zinc" className="!px-2 !text-[10px]">{p.sport}</Badge>
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{p.pick}</span>
                    <span className="font-mono text-xs text-zinc-500">
                      {p.entryOdds > 0 ? `+${p.entryOdds}` : p.entryOdds}
                    </span>
                    {p.clv != null && (
                      <span className={cn('font-mono text-xs', p.clv > 0 ? 'text-emerald-400' : 'text-zinc-500')}>
                        {p.clv > 0 ? '+' : ''}{p.clv} CLV
                      </span>
                    )}
                    <Badge tone={p.result === 'win' ? 'emerald' : p.result === 'loss' ? 'rose' : 'zinc'}>
                      {p.result}
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}

        <p className="mt-6 text-center text-[11px] leading-relaxed text-zinc-600">
          Past performance does not guarantee future results. SLIPPR provides informational
          analysis for entertainment only. 21+ · 1-800-GAMBLER.
        </p>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  highlight,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  tone?: string;
}) {
  return (
    <Card className={cn('p-5', highlight && 'pg-glow-ring bg-emerald-500/[0.04]')}>
      <div className={cn('font-mono text-2xl font-bold', tone ?? (highlight ? 'text-emerald-400' : 'text-zinc-100'))}>
        {value}
      </div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
      {sub && <div className="mt-0.5 text-[11px] text-zinc-600">{sub}</div>}
    </Card>
  );
}

function fmtSigned(n: number | null, unit: string): string {
  if (n == null) return '—';
  return `${n > 0 ? '+' : ''}${n}${unit}`;
}

function roiTone(roi: number | null): string {
  if (roi == null) return 'text-zinc-100';
  return roi >= 0 ? 'text-emerald-400' : 'text-rose-400';
}
