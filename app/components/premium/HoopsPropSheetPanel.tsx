'use client';

import { useEffect, useState } from 'react';
import { Card, cn } from './ui';
import PropTrackBox from './PropTrackBox';
import type { HoopsPropPlayer, HoopsPropSheet } from '@/lib/research/hoops-props';

const tipoffLabel = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';
const chanceTone = (c: number) => (c >= 60 ? 'text-emerald-300' : c <= 40 ? 'text-rose-300' : 'text-zinc-300');

function PlayerRows({ p }: { p: HoopsPropPlayer }) {
  return (
    <>
      {p.props.map((pr, i) => (
        <tr key={pr.stat} className={cn('border-t border-white/[0.04] align-top', i === 0 && 'border-white/[0.08]')}>
          <td className="py-1.5 pr-3">
            {i === 0 && (
              <div>
                <span className="font-sans font-medium text-zinc-100">{p.name}</span> <span className="text-zinc-500">{p.pos}</span>
                <div className="font-sans text-[10px] text-zinc-500">
                  {p.minutes} min{p.gamesThisSeason ? ` · ${p.gamesThisSeason} games this season` : ' · from last season'}
                  {p.injury && (
                    <span className="text-amber-300" title={p.injury.note}>
                      {' '}
                      · {p.injury.status}
                    </span>
                  )}
                </div>
              </div>
            )}
          </td>
          <td className="pr-3 font-sans text-zinc-400">{pr.label}</td>
          <td className="pr-3 text-right text-zinc-100">{pr.median}</td>
          <td className="pr-3 text-right text-zinc-500">
            {pr.low}–{pr.high}
          </td>
          <td className="text-right">
            <div className="flex flex-wrap justify-end gap-x-3">
              {pr.lines.map((l) => (
                <span key={l.line} title={`Last ${l.games} games over ${l.line}: ${l.hits}`}>
                  <span className="text-zinc-500">o{l.line}</span> <span className={chanceTone(l.chance)}>{l.chance}%</span>{' '}
                  <span className="text-[10px] text-zinc-600">
                    {l.hits}/{l.games}
                  </span>
                </span>
              ))}
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

export default function HoopsPropSheetPanel({ league }: { league: 'nba' | 'wnba' }) {
  const [result, setResult] = useState<{ data?: HoopsPropSheet; error?: string } | null>(null);
  const [game, setGame] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/research/${league}/props`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (!cancelled) setResult({ data: json as HoopsPropSheet });
      })
      .catch((e) => !cancelled && setResult({ error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [league]);

  if (!result) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-28" />
        ))}
      </div>
    );
  }
  if (result.error || !result.data) return <Card className="p-10 text-center text-sm text-zinc-400">Couldn&apos;t build the prop sheet: {result.error}</Card>;
  const data = result.data;
  if (!data.games.length) return <Card className="p-10 text-center text-sm text-zinc-400">No upcoming games on the schedule.</Card>;
  const shown = game ? data.games.filter((g) => g.id === game) : data.games;

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Prop cheat sheet</h2>
      <div className="mb-4 space-y-2 text-sm text-zinc-500">
        <p>
          Every player in the rotation for the next slate. <strong className="text-zinc-300">Median</strong> is his typical
          game: this season&apos;s average with half weight on the last 10, blended early on with last season (worth 6 games),
          the recipe that predicted best on 2022-2025.{' '}
          <strong className="text-zinc-300">Middle 50%</strong> is the range he lands in half the time.
        </p>
        <p>
          <strong className="text-zinc-300">Chance over</strong> is calibrated on a held-out season (2025-26): lines it called
          48% went over 48%, 63% → 63%, 79% → 79%, including the first games of a season, which use their own spread
          because last season&apos;s numbers overstate players early on. Small figures are his last-10 hit rate, which
          in our NFL tracking predicted worse than a coin flip: use it as color, not a signal.
        </p>
      </div>
      <PropTrackBox url={`/api/research/${league}/props/track`} />
      <div className="mb-5 flex flex-wrap gap-2">
        {[null, ...data.games.map((g) => g.id)].map((id) => {
          const g = data.games.find((x) => x.id === id);
          return (
            <button
              key={id ?? 'all'}
              onClick={() => setGame(id)}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-xs font-medium transition',
                game === id ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-white/[0.08] text-zinc-400 hover:text-zinc-200',
              )}
            >
              {g ? `${g.away} @ ${g.home}` : 'All games'}
            </button>
          );
        })}
      </div>
      <div className="space-y-4">
        {shown.map((g) => (
          <Card key={g.id} className="p-5">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h3 className="text-lg font-semibold">
                {g.away} <span className="text-zinc-500">@</span> {g.home}
              </h3>
              <span className="font-mono text-xs text-zinc-500">{tipoffLabel(g.tipoff)}</span>
            </div>
            <div className="space-y-6">
              {g.sides.map((s) => (
                <div key={s.team}>
                  <p className="mb-1 text-sm font-semibold text-zinc-200">{s.team}</p>
                  {s.out.length > 0 && (
                    <p className="mb-2 text-xs text-rose-300/90">
                      Out: {s.out.map((o) => `${o.name} (${o.status})`).join(', ')}. Teammates&apos; roles may grow beyond these numbers.
                    </p>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] font-mono text-xs text-zinc-300">
                      <thead className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
                        <tr>
                          <th className="py-1.5 pr-3 font-medium">Player</th>
                          <th className="pr-3 font-medium">Prop</th>
                          <th className="pr-3 text-right font-medium">Median</th>
                          <th className="pr-3 text-right font-medium">Middle 50%</th>
                          <th className="text-right font-medium">Chance over · last-10 hits</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.players.map((p) => (
                          <PlayerRows key={p.id} p={p} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
